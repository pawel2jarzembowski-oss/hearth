// HTTP client for Ollama (compatible with /api/chat, with tool-calling, streaming and model management).
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string; // for role=tool messages (informational)
  tool_call_id?: string; // required by OpenAI-compatible APIs to match a tool result to its call
}

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage?: Usage;
}

// Implemented by every backend (local Ollama or a cloud OpenAI-compatible API) so Agent
// doesn't need to know which one it's talking to.
export interface ChatClient {
  chatStream(messages: ChatMessage[], tools: ToolDef[], onDelta: (text: string) => void): Promise<ChatResult>;
  ping(): Promise<{ ok: boolean; detail: string }>;
}

function request(urlStr: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Ollama HTTP ${res.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Invalid JSON from Ollama: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', (e) =>
      reject(new Error(`Could not connect to Ollama (${urlStr}): ${e.message}. Is the server running?`))
    );
    req.write(data);
    req.end();
  });
}

function getJson(urlStr: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON from Ollama: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', (e) =>
      reject(new Error(`Could not connect to Ollama (${urlStr}): ${e.message}. Is the server running?`))
    );
    req.end();
  });
}

// Like request(), but processes the response as a stream of newline-delimited JSON objects
// (Ollama's streaming format) and calls onChunk for each one as it arrives. Errors thrown
// inside onChunk (e.g. a pull-progress error object) reject the returned promise.
function requestStream(urlStr: string, payload: unknown, onChunk: (obj: any) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => reject(new Error(`Ollama HTTP ${res.statusCode}: ${body}`)));
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
            if (!line) continue;
            let obj: any;
            try {
              obj = JSON.parse(line);
            } catch {
              continue; // incomplete/corrupted line — skip
            }
            try {
              onChunk(obj);
            } catch (e) {
              reject(e);
            }
          }
        });
        res.on('end', () => resolve());
      }
    );
    req.on('error', (e) =>
      reject(new Error(`Could not connect to Ollama (${urlStr}): ${e.message}. Is the server running?`))
    );
    req.write(data);
    req.end();
  });
}

export class OllamaClient implements ChatClient {
  constructor(private endpoint: string, private model: string) {}

  /** A single (non-streaming) chat call with tools. */
  async chat(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult> {
    const payload = {
      model: this.model,
      messages: messages.map((m) => this.toWire(m)),
      tools: tools.length ? tools : undefined,
      stream: false,
      options: { temperature: 0.4 },
    };
    const r = await request(`${this.endpoint}/api/chat`, payload);
    const msg = r.message || {};
    const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc: any, i: number) => ({
      id: tc.id || `call_${i}`,
      function: {
        name: tc.function?.name,
        arguments:
          typeof tc.function?.arguments === 'string'
            ? safeParse(tc.function.arguments)
            : tc.function?.arguments || {},
      },
    }));
    return { content: msg.content || '', toolCalls };
  }

  /** Like chat(), but streams the response content token by token via onDelta. */
  async chatStream(messages: ChatMessage[], tools: ToolDef[], onDelta: (text: string) => void): Promise<ChatResult> {
    const payload = {
      model: this.model,
      messages: messages.map((m) => this.toWire(m)),
      tools: tools.length ? tools : undefined,
      stream: true,
      options: { temperature: 0.4 },
    };
    let content = '';
    let toolCalls: ToolCall[] = [];
    let usage: Usage | undefined;
    await requestStream(`${this.endpoint}/api/chat`, payload, (obj) => {
      const msg = obj.message || {};
      if (msg.content) {
        content += msg.content;
        onDelta(msg.content);
      }
      if (msg.tool_calls && msg.tool_calls.length) {
        toolCalls = msg.tool_calls.map((tc: any, i: number) => ({
          id: tc.id || `call_${i}`,
          function: {
            name: tc.function?.name,
            arguments:
              typeof tc.function?.arguments === 'string'
                ? safeParse(tc.function.arguments)
                : tc.function?.arguments || {},
          },
        }));
      }
      // The final chunk (done: true) carries token counts for the whole exchange.
      if (obj.done && (obj.prompt_eval_count !== undefined || obj.eval_count !== undefined)) {
        usage = { promptTokens: obj.prompt_eval_count || 0, completionTokens: obj.eval_count || 0 };
      }
    });
    return { content, toolCalls, usage };
  }

  /** Checks whether the server responds and the model exists. */
  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const r = await request(`${this.endpoint}/api/show`, { model: this.model });
      if (r && (r.modelfile || r.details)) {
        return { ok: true, detail: 'Connected to Ollama, model available.' };
      }
      return { ok: true, detail: 'Connected to Ollama.' };
    } catch (e: any) {
      return { ok: false, detail: e.message };
    }
  }

  private toWire(m: ChatMessage): any {
    const w: any = { role: m.role, content: m.content };
    if (m.tool_calls) {
      w.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    if (m.tool_call_id) w.tool_call_id = m.tool_call_id;
    return w;
  }
}

export interface OllamaModelInfo {
  name: string;
  size: number;
}

/** Lists models already pulled into the local Ollama instance. */
export async function listModels(endpoint: string): Promise<OllamaModelInfo[]> {
  const r = await getJson(`${endpoint}/api/tags`);
  return (r.models || []).map((m: any) => ({ name: m.name as string, size: (m.size as number) || 0 }));
}

/** Downloads a model into the local Ollama instance, reporting progress as it streams in. */
export function pullModel(
  endpoint: string,
  name: string,
  onProgress: (status: string, completed?: number, total?: number) => void
): Promise<void> {
  return requestStream(`${endpoint}/api/pull`, { name, stream: true }, (obj) => {
    if (obj.error) throw new Error(obj.error);
    onProgress(obj.status || '', obj.completed, obj.total);
  });
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
