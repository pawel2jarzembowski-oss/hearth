// Agentic loop: the model thinks -> calls tools -> gets results -> repeats until it replies with plain text.
import { ChatClient, ChatMessage, Usage } from './ollama';
import { ToolContext, toolDefs, findTool } from './tools';

const SYSTEM_PROMPT = `You are "Hearth" — an autonomous coding assistant inside VS Code, running fully locally.
Every path you use is relative to the ROOT of the currently open workspace folder — that folder, and
nothing outside it, is the entire project. You have FULL access to it through these tools:
- list_files(path) — see what's in a directory
- find_files(pattern) — find files by glob, e.g. **/*.py
- search_text(query, glob?) — search text/regex across files (like grep)
- read_file(path) — read a file (with line numbers)
- write_file(path, content) — create/overwrite a file (full content) — the user will see a diff and can reject it
- edit_file(path, old_string, new_string) — precise replacement of a fragment (old_string must be unique) — also shows a diff
- create_directory(path) — create a folder
- delete_file(path) — delete a file or folder (goes to trash)
- run_command(command) — run a shell command in the project and READ its output (build/test/git/ls...)
- todo_write(items) — show the user your plan as a task list (pending/in_progress/completed)

Working strategy (like an experienced developer):
- ALWAYS investigate the project with tools first (list_files / find_files / search_text / read_file) — NEVER guess file contents or paths.
- If a task has more than ~2 steps, call todo_write at the START with the full plan, then update each item's status
  (in_progress -> completed) as you go, so the user sees live progress. Skip the plan for trivial, single-step requests
  (e.g. "read file X").
- Use edit_file for small changes (fragment replacement). Use write_file for new files or large rewrites (full content).
- For anything beyond a single throwaway script, create a dedicated subfolder for it (short, kebab-case name
  matching the project) instead of dropping loose files at the workspace root — e.g. a "todo app" goes in
  todo-app/, not as stray files next to whatever else is already in the folder. Keep unrelated projects separated
  the same way. A one-off single-file request (e.g. "write a script that does X") can stay a loose file.
- After making changes, you can run tests/build via run_command and fix errors based on the output.
- Work independently through each step until the task is done — don't ask for confirmation at every step,
  the UI (diff + buttons) already handles asking the user for approval where needed.
- When you're done, write a short summary in plain text WITHOUT calling any more tools.
- Be careful with run_command: never run destructive commands without an explicit request from the user.`;

export interface AgentEvents {
  onAssistantStart(): void;
  onAssistantDelta(delta: string): void;
  onAssistantDone(fullText: string): void;
  onToolStart(name: string, args: any): void;
  onToolResult(name: string, result: string): void;
  onStep(step: number, maxSteps: number): void;
  onUsage(usage: Usage): void;
}

export class Agent {
  private history: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  constructor(
    private client: ChatClient,
    private ctx: ToolContext,
    private maxSteps: number
  ) {}

  reset() {
    this.history = [{ role: 'system', content: SYSTEM_PROMPT }];
  }

  async send(userText: string, ev: AgentEvents): Promise<void> {
    this.history.push({ role: 'user', content: userText });

    for (let step = 1; step <= this.maxSteps; step++) {
      ev.onStep(step, this.maxSteps);
      let started = false;
      const res = await this.client.chatStream(this.history, toolDefs(), (delta) => {
        if (!started) {
          started = true;
          ev.onAssistantStart();
        }
        ev.onAssistantDelta(delta);
      });

      if (res.usage) ev.onUsage(res.usage);

      // Remember the assistant's turn (including any tool_calls).
      this.history.push({
        role: 'assistant',
        content: res.content,
        tool_calls: res.toolCalls.length ? res.toolCalls : undefined,
      });

      if (res.content && res.content.trim()) {
        ev.onAssistantDone(res.content.trim());
      }

      // No tool calls => the model is finished.
      if (!res.toolCalls.length) {
        return;
      }

      // Run each tool and append its result as a role=tool message.
      for (const tc of res.toolCalls) {
        const name = tc.function.name;
        const args = tc.function.arguments || {};
        ev.onToolStart(name, args);
        const tool = findTool(name);
        let result: string;
        if (!tool) {
          result = `ERROR: unknown tool "${name}".`;
        } else {
          try {
            result = await tool.run(args as any, this.ctx);
          } catch (e: any) {
            result = `ERROR running ${name}: ${e.message}`;
          }
        }
        ev.onToolResult(name, result);
        this.history.push({ role: 'tool', content: result, tool_name: name, tool_call_id: tc.id });
      }
    }
    ev.onAssistantStart();
    ev.onAssistantDone(
      `⚠️ Reached the ${this.maxSteps}-step limit. The task may be unfinished — say "continue" to keep going.`
    );
  }
}
