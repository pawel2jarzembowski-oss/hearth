// Shared agent session: holds a single Agent and broadcasts events to every attached view
// (side panel + editor window). This is what makes the conversation shared between them.
import * as vscode from 'vscode';
import { ChatClient, OllamaClient, Usage } from './ollama';
import { CloudClient } from './cloud';
import { Agent } from './agent';
import { ToolContext, ConfirmRequest } from './tools';
import { estimateCostUsd } from './pricing';

export type Sink = (msg: any) => void;
export type PermLevel = 'auto' | 'ask' | 'deny';

interface BudgetState {
  day: string;
  spent: number;
  warned80: boolean;
  warnedFull: boolean;
}

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);
const API_KEY_SECRET = 'hearth.apiKey';
const BUDGET_STATE_KEY = 'hearth.budgetState';
const MAX_ATTACHMENT_CHARS = 50_000;

export class AgentSession {
  private agent?: Agent;
  private busy = false;
  private sinks = new Set<Sink>();
  // UI history buffer, so a newly opened view can replay the conversation so far.
  private uiLog: any[] = [];
  private pendingConfirms = new Map<string, (approved: boolean) => void>();
  private confirmSeq = 0;
  private attachments = new Map<string, string>();
  private usageTotals = { promptTokens: 0, completionTokens: 0, requests: 0 };

  constructor(private context: vscode.ExtensionContext) {}

  attach(sink: Sink) {
    this.sinks.add(sink);
    // replay the conversation so far into the new view
    for (const m of this.uiLog) sink(m);
    this.doPing();
  }
  detach(sink: Sink) {
    this.sinks.delete(sink);
  }

  private broadcast(msg: any, remember = true) {
    if (remember && msg.type !== 'status' && msg.type !== 'busy' && msg.type !== 'step' && msg.type !== 'assistant-delta') {
      this.uiLog.push(msg);
      if (this.uiLog.length > 500) this.uiLog.shift();
    }
    for (const s of this.sinks) s(msg);
  }

  /** Sends a transient (non-chat-history) message to every attached view — settings data,
   * notices, pull progress, etc. Everything the extension needs to tell the UI lives in this
   * one webview, not in native VS Code dialogs/notifications. */
  post(msg: any) {
    this.broadcast(msg, false);
  }

  /** Shows a small in-chat notice banner instead of a native VS Code toast notification. */
  notice(kind: 'info' | 'warning' | 'error', text: string) {
    this.broadcast({ type: 'notice', kind, text }, false);
  }

  /** Everything the in-webview settings panel needs to render itself. */
  async settingsSnapshot() {
    const cfg = this.cfg();
    const hasApiKey = !!(await this.context.secrets.get(API_KEY_SECRET));
    const today = new Date().toISOString().slice(0, 10);
    const budgetState = this.context.globalState.get<BudgetState>(BUDGET_STATE_KEY);
    const budgetSpent = budgetState && budgetState.day === today ? budgetState.spent : 0;
    return { ...cfg, hasApiKey, usage: this.usageTotals, budgetSpent };
  }

  private cfg() {
    const c = vscode.workspace.getConfiguration('hearth');
    return {
      provider: c.get<string>('provider', 'ollama'),
      endpoint: c.get<string>('endpoint', 'http://localhost:11434'),
      model: c.get<string>('model', 'qwen3:14b'),
      openaiBaseUrl: c.get<string>('openaiBaseUrl', 'https://api.openai.com/v1'),
      cloudModel: c.get<string>('cloudModel', 'gpt-4o-mini'),
      maxSteps: c.get<number>('maxSteps', 40),
      permWrite: c.get<PermLevel>('permissions.write', 'auto'),
      permDelete: c.get<PermLevel>('permissions.delete', 'auto'),
      permCommand: c.get<PermLevel>('permissions.command', 'auto'),
      dailyBudgetUsd: c.get<number>('dailyBudgetUsd', 0),
    };
  }

  private permissionFor(kind: ConfirmRequest['kind'], cfg: ReturnType<AgentSession['cfg']>): PermLevel {
    if (kind === 'delete') return cfg.permDelete;
    if (kind === 'command') return cfg.permCommand;
    return cfg.permWrite; // 'write' and 'edit' share one setting
  }

  /** Builds the right chat backend (local Ollama or a cloud OpenAI-compatible API) from settings. */
  private async makeClient(): Promise<{ client: ChatClient; model: string; provider: string } | undefined> {
    const cfg = this.cfg();
    if (cfg.provider === 'openai') {
      const apiKey = await this.context.secrets.get(API_KEY_SECRET);
      if (!apiKey) {
        const folder = vscode.workspace.workspaceFolders?.[0]?.name;
        this.broadcast(
          { type: 'status', ok: false, provider: cfg.provider, model: cfg.cloudModel, folder, detail: 'No API key set — run "Hearth: Set API Key".' },
          false
        );
        return undefined;
      }
      return { client: new CloudClient(cfg.openaiBaseUrl, apiKey, cfg.cloudModel), model: cfg.cloudModel, provider: cfg.provider };
    }
    return { client: new OllamaClient(cfg.endpoint, cfg.model), model: cfg.model, provider: cfg.provider };
  }

  async doPing() {
    const made = await this.makeClient();
    if (!made) return;
    const r = await made.client.ping();
    const folder = vscode.workspace.workspaceFolders?.[0]?.name;
    const folderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.broadcast({ type: 'status', ok: r.ok, detail: r.detail, model: made.model, provider: made.provider, folder, folderPath }, false);
  }

  reset() {
    this.agent?.reset();
    this.uiLog = [];
    this.pendingConfirms.clear();
    this.attachments.clear();
    this.broadcast({ type: 'cleared' }, false);
  }

  /** Called when the user clicks Approve/Reject on a confirm card in the chat.
   * Returns whether anything was actually pending. */
  resolveConfirm(id: string, approved: boolean): boolean {
    const resolver = this.pendingConfirms.get(id);
    if (!resolver) return false;
    this.pendingConfirms.delete(id);
    resolver(approved);
    this.broadcast({ type: 'confirm-resolved', id, approved }, false);
    return true;
  }

  /** Queues a file's content to be prepended as context to the next message. */
  attachFile(relPath: string, content: string) {
    const truncated = content.length > MAX_ATTACHMENT_CHARS ? content.slice(0, MAX_ATTACHMENT_CHARS) + '\n...[truncated]' : content;
    this.attachments.set(relPath, truncated);
    this.broadcast({ type: 'attachments', paths: Array.from(this.attachments.keys()) }, false);
  }
  detachFile(relPath: string) {
    this.attachments.delete(relPath);
    this.broadcast({ type: 'attachments', paths: Array.from(this.attachments.keys()) }, false);
  }

  private async trackUsage(model: string, u: Usage) {
    this.usageTotals.promptTokens += u.promptTokens;
    this.usageTotals.completionTokens += u.completionTokens;
    this.usageTotals.requests += 1;
    this.broadcast({ type: 'usage', ...this.usageTotals }, false);
    await this.trackBudget(model, u);
  }

  /** Optional soft daily spend cap for cloud usage — estimated from published list prices,
   * persisted across sessions, with a heads-up at 80% and again once the budget is crossed. */
  private async trackBudget(model: string, u: Usage) {
    const budget = this.cfg().dailyBudgetUsd;
    if (!budget) return;
    const cost = estimateCostUsd(model, u.promptTokens, u.completionTokens);
    if (cost === undefined) return; // unrecognized model — can't estimate, don't guess
    const today = new Date().toISOString().slice(0, 10);
    const stored = this.context.globalState.get<BudgetState>(BUDGET_STATE_KEY);
    const state: BudgetState = stored && stored.day === today ? stored : { day: today, spent: 0, warned80: false, warnedFull: false };
    state.spent += cost;
    const pct = state.spent / budget;
    this.broadcast({ type: 'budget', spent: state.spent, budget }, false);
    if (pct >= 1 && !state.warnedFull) {
      state.warnedFull = true;
      this.notice('warning', `Today's estimated cloud spend (~$${state.spent.toFixed(2)}) has passed your $${budget} daily budget.`);
    } else if (pct >= 0.8 && !state.warned80) {
      state.warned80 = true;
      this.notice('info', `~${Math.round(pct * 100)}% of today's $${budget} cloud budget used (~$${state.spent.toFixed(2)}).`);
    }
    await this.context.globalState.update(BUDGET_STATE_KEY, state);
  }

  private async build(): Promise<Agent | undefined> {
    const cfg = this.cfg();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.broadcast({ type: 'assistant-start' }, false);
      this.broadcast({ type: 'assistant-done', text: '⚠️ Open a folder first (File → Open Folder) so the agent can work on files.' });
      return undefined;
    }
    const made = await this.makeClient();
    if (!made) {
      this.broadcast({ type: 'assistant-start' }, false);
      this.broadcast({
        type: 'assistant-done',
        text: '⚠️ No API key configured for the cloud provider. Run "Hearth: Set API Key" from the Command Palette, or switch hearth.provider back to "ollama".',
      });
      return undefined;
    }
    const ctx: ToolContext = {
      workspaceRoot: root,
      log: (line) => this.broadcast({ type: 'tool-log', text: line }, false),
      confirm: async (req: ConfirmRequest) => {
        const level = this.permissionFor(req.kind, cfg);
        if (level === 'deny') {
          this.broadcast({ type: 'assistant-start' }, false);
          this.broadcast({
            type: 'assistant-done',
            text: `🚫 Blocked by settings: **${req.kind}** is disabled (hearth.permissions.${req.kind === 'delete' ? 'delete' : req.kind === 'command' ? 'command' : 'write'} = "deny"). Run "Hearth: Permissions" to change it.`,
          });
          return false;
        }
        // "auto" (the default) just does it — no tab, no popup, nothing opens. The agent
        // reports what it did in its chat reply, same as any other tool result.
        if (level === 'auto') return true;
        const id = `c${++this.confirmSeq}`;
        const pending = new Promise<boolean>((resolve) => this.pendingConfirms.set(id, resolve));
        this.broadcast({ type: 'confirm-request', id, ...req }, false);
        return pending;
      },
      updateTodos: (items) => this.broadcast({ type: 'todos', items }),
    };
    return new Agent(made.client, ctx, cfg.maxSteps);
  }

  async send(text: string) {
    if (this.busy) {
      this.broadcast({ type: 'assistant-start' }, false);
      this.broadcast({ type: 'assistant-done', text: '⏳ Hang on, still working on the previous task...' });
      return;
    }

    let augmentedText = text;
    const attachedPaths = Array.from(this.attachments.keys());
    if (attachedPaths.length) {
      const blocks = Array.from(this.attachments.entries())
        .map(([p, c]) => `Attached file: ${p}\n\`\`\`\n${c}\n\`\`\``)
        .join('\n\n');
      augmentedText = `${blocks}\n\n${text}`;
      this.attachments.clear();
      this.broadcast({ type: 'attachments', paths: [] }, false);
    }
    this.broadcast({ type: 'user', text, attached: attachedPaths.length ? attachedPaths : undefined });

    if (!this.agent) this.agent = await this.build();
    if (!this.agent) return;

    const cfg = this.cfg();
    this.busy = true;
    this.broadcast({ type: 'busy', busy: true }, false);
    const changedFiles = new Set<string>();
    let lastPath: string | undefined;
    try {
      await this.agent.send(augmentedText, {
        onStep: (s, max) => this.broadcast({ type: 'step', step: s, max }, false),
        onAssistantStart: () => this.broadcast({ type: 'assistant-start' }, false),
        onAssistantDelta: (d) => this.broadcast({ type: 'assistant-delta', text: d }, false),
        onAssistantDone: (t) => this.broadcast({ type: 'assistant-done', text: t }),
        onToolStart: (name, args) => {
          if (FILE_TOOLS.has(name) && args && typeof args.path === 'string') lastPath = args.path;
          this.broadcast({ type: 'tool-start', name, args: JSON.stringify(args) });
        },
        onToolResult: (name, result) => {
          this.broadcast({ type: 'tool-result', name, result: result.slice(0, 4000) });
          if (FILE_TOOLS.has(name) && lastPath && result.startsWith('OK')) changedFiles.add(lastPath);
        },
        onUsage: (u) => {
          void this.trackUsage(cfg.provider === 'openai' ? cfg.cloudModel : cfg.model, u);
        },
      });
    } catch (e: any) {
      this.broadcast({ type: 'assistant-start' }, false);
      this.broadcast({ type: 'assistant-done', text: `❌ Error: ${e.message}` });
    } finally {
      this.busy = false;
      this.broadcast({ type: 'busy', busy: false }, false);
      // Just a list of clickable names in chat — nothing opens on its own.
      if (changedFiles.size) this.broadcast({ type: 'files-changed', paths: Array.from(changedFiles) });
    }
  }
}
