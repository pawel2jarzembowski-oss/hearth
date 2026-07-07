// Client for any OpenAI-compatible /v1/chat/completions API (OpenAI, OpenRouter, Groq, etc.),
// used as an optional alternative to the local Ollama backend when the user supplies an API key.
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { ChatClient, ChatMessage, ChatResult, ToolCall, ToolDef, Usage } from './ollama';

interface PendingToolCall {
  id?: string;
  name?: string;
  args: string;
}

export class CloudClient implements ChatClient {
  constructor(private baseUrl: string, private apiKey: string, private model: string) {}

  async chatStream(messages: ChatMessage[], tools: ToolDef[], onDelta: (text: string) => void): Promise<ChatResult> {
    const payload = {
      model: this.model,
      messages: messages.map((m) => this.toWire(m)),
      tools: tools.length ? tools : undefined,
      stream: true,
      temperature: 0.4,
      stream_options: { include_usage: true },
    };
    let content = '';
    let usage: Usage | undefined;
    const calls = new Map<number, PendingToolCall>();
    await this.postSSE('/chat/completions', payload, (obj) => {
      // The final chunk (when stream_options.include_usage is honored) has empty choices and
      // carries token totals for the whole exchange — check it before the choices[0] guard below.
      if (obj.usage) {
        usage = { promptTokens: obj.usage.prompt_tokens || 0, completionTokens: obj.usage.completion_tokens || 0 };
      }
      const choice = obj.choices && obj.choices[0];
      if (!choice) return;
      const delta = choice.delta || {};
      if (delta.content) {
        content += delta.content;
        onDelta(delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : 0;
          const cur = calls.get(idx) || { args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(idx, cur);
        }
      }
    });
    const toolCalls: ToolCall[] = Array.from(calls.values())
      .filter((c) => c.name)
      .map((c, i) => ({
        id: c.id || `call_${i}`,
        function: { name: c.name as string, arguments: safeParse(c.args) },
      }));
    return { content, toolCalls, usage };
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    if (!this.apiKey) {
      return { ok: false, detail: 'No API key set — run "Hearth: Set API Key".' };
    }
    try {
      await this.getJson('/models');
      return { ok: true, detail: `Connected to ${this.baseUrl}.` };
    } catch (e: any) {
      return { ok: false, detail: e.message };
    }
  }

  private toWire(m: ChatMessage): any {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id || m.tool_name || 'call_0' };
    }
    const w: any = { role: m.role, content: m.content };
    if (m.tool_calls) {
      w.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) },
      }));
    }
    return w;
  }

  private postSSE(path: string, payload: unknown, onEvent: (obj: any) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const lib = url.protocol === 'https:' ? https : http;
      const data = Buffer.from(JSON.stringify(payload), 'utf8');
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (body += c));
            res.on('end', () => reject(new Error(`API HTTP ${res.statusCode}: ${body.slice(0, 300)}`)));
            return;
          }
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 1);
              if (!line.startsWith('data:')) continue;
              const payloadStr = line.slice(5).trim();
              if (payloadStr === '[DONE]') continue;
              let obj: any;
              try {
                obj = JSON.parse(payloadStr);
              } catch {
                continue;
              }
              try {
                onEvent(obj);
              } catch (e) {
                reject(e);
              }
            }
          });
          res.on('end', () => resolve());
        }
      );
      req.on('error', (e) => reject(new Error(`Could not reach ${this.baseUrl}: ${e.message}`)));
      req.write(data);
      req.end();
    });
  }

  private getJson(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: 'GET',
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`API HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve({});
            }
          });
        }
      );
      req.on('error', (e) => reject(new Error(`Could not reach ${this.baseUrl}: ${e.message}`)));
      req.end();
    });
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
