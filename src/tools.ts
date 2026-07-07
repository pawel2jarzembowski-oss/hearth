// Agent tools. Each one has a definition (for the model) and an implementation.
// Safety: file operations are restricted to the workspace folder.
// Whether a given call needs confirmation is decided by AgentSession based on the
// hearth.permissions.* settings (auto / ask / deny per category).
import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { ToolDef } from './ollama';
import { DiffLine, safeDiffLines } from './diff';
import { resolveInside } from './pathSafety';

export interface ConfirmRequest {
  kind: 'write' | 'edit' | 'delete' | 'command';
  title: string;
  detail?: string;
  path?: string;
  command?: string;
  diff?: DiffLine[];
  fullOld?: string; // whole file before the change — used to open a real diff editor tab
  fullNew?: string; // whole file after the change
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ToolContext {
  workspaceRoot: string;
  confirm(req: ConfirmRequest): Promise<boolean>;
  log(line: string): void;
  updateTodos(items: TodoItem[]): void;
}

export interface ToolImpl {
  def: ToolDef;
  run(args: Record<string, any>, ctx: ToolContext): Promise<string>;
}

async function readText(abs: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
  return Buffer.from(bytes).toString('utf8');
}

async function writeText(abs: string, text: string): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(abs)));
  await vscode.workspace.fs.writeFile(vscode.Uri.file(abs), Buffer.from(text, 'utf8'));
}

// ───────────────────────── read_file ─────────────────────────
const readFile: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads a text file from the project. Returns the content with line numbers.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path relative to the project folder' } },
        required: ['path'],
      },
    },
  },
  async run(args, ctx) {
    const abs = resolveInside(ctx.workspaceRoot, args.path);
    const text = await readText(abs);
    ctx.log(`📖 read_file: ${args.path} (${text.length} chars)`);
    const numbered = text.split('\n').map((l, i) => `${String(i + 1).padStart(4, ' ')} | ${l}`).join('\n');
    return numbered.length > 24000 ? numbered.slice(0, 24000) + '\n... [truncated]' : numbered;
  },
};

// ───────────────────────── write_file ─────────────────────────
const writeFile: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Creates a new file or completely overwrites an existing one. ALWAYS provide the full file content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the project folder' },
          content: { type: 'string', description: 'Full new content of the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  async run(args, ctx) {
    const abs = resolveInside(ctx.workspaceRoot, args.path);
    let oldText = '';
    let existed = true;
    try {
      oldText = await readText(abs);
    } catch {
      existed = false;
    }
    const diff = safeDiffLines(oldText, args.content);
    const ok = await ctx.confirm({
      kind: 'write',
      title: `Write file: ${args.path}?`,
      detail: existed
        ? `Overwriting an existing file (${args.content.length} chars).`
        : `New file (${args.content.length} chars).`,
      path: args.path,
      diff,
      fullOld: oldText,
      fullNew: args.content,
    });
    if (!ok) return 'REJECTED: the user did not approve this write.';
    await writeText(abs, args.content);
    ctx.log(`💾 write_file: ${args.path}`);
    return `OK: wrote ${args.path} (${args.content.length} chars).`;
  },
};

// ───────────────────────── edit_file (fragment replacement) ─────────────────────────
const editFile: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Edits an existing file by replacing an exact text fragment (old_string) with a new one (new_string). ' +
        'old_string must occur EXACTLY once. Use this for precise changes instead of rewriting the whole file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          old_string: { type: 'string', description: 'Exact existing fragment to replace' },
          new_string: { type: 'string', description: 'New fragment' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  async run(args, ctx) {
    const abs = resolveInside(ctx.workspaceRoot, args.path);
    const text = await readText(abs);
    const count = args.old_string ? text.split(args.old_string).length - 1 : 0;
    if (count === 0) return `ERROR: old_string not found in ${args.path}. Read the file first (read_file).`;
    if (count > 1) return `ERROR: old_string occurs ${count} times — it must be unique. Add more context.`;
    const updated = text.replace(args.old_string, args.new_string);
    const diff = safeDiffLines(text, updated);
    const ok = await ctx.confirm({
      kind: 'edit',
      title: `Edit file: ${args.path}?`,
      detail: `Fragment replacement (${args.old_string.length} → ${args.new_string.length} chars).`,
      path: args.path,
      diff,
      fullOld: text,
      fullNew: updated,
    });
    if (!ok) return 'REJECTED: the user did not approve this edit.';
    await writeText(abs, updated);
    ctx.log(`✏️ edit_file: ${args.path}`);
    return `OK: updated ${args.path}.`;
  },
};

// ───────────────────────── delete_file ─────────────────────────
const deleteFile: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Deletes a file or folder (recursively) from the project. Use with care.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path of the file or folder to delete' } },
        required: ['path'],
      },
    },
  },
  async run(args, ctx) {
    const abs = resolveInside(ctx.workspaceRoot, args.path);
    if (path.resolve(abs) === path.resolve(ctx.workspaceRoot)) return 'REJECTED: cannot delete the project root.';
    const ok = await ctx.confirm({
      kind: 'delete',
      title: `Delete: ${args.path}?`,
      detail: 'This cannot be undone (aside from the system trash).',
      path: args.path,
    });
    if (!ok) return 'REJECTED: the user did not approve this deletion.';
    await vscode.workspace.fs.delete(vscode.Uri.file(abs), { recursive: true, useTrash: true });
    ctx.log(`🗑️ delete_file: ${args.path}`);
    return `OK: deleted ${args.path}.`;
  },
};

// ───────────────────────── create_directory ─────────────────────────
const createDirectory: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Creates a folder (including any missing parent folders).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path of the folder to create' } },
        required: ['path'],
      },
    },
  },
  async run(args, ctx) {
    const abs = resolveInside(ctx.workspaceRoot, args.path);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(abs));
    ctx.log(`📁 create_directory: ${args.path}`);
    return `OK: created folder ${args.path}.`;
  },
};

// ───────────────────────── list_files ─────────────────────────
const listFiles: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Lists files and folders in a project directory (defaults to the root).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Folder path relative to the project, defaults to "."' } },
      },
    },
  },
  async run(args, ctx) {
    const rel = args.path || '.';
    const abs = resolveInside(ctx.workspaceRoot, rel);
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(abs));
    ctx.log(`📂 list_files: ${rel} (${entries.length})`);
    return entries.map(([name, type]) => (type === vscode.FileType.Directory ? `${name}/` : name)).join('\n') || '(empty)';
  },
};

// ───────────────────────── find_files (glob) ─────────────────────────
const findFiles: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'find_files',
      description: 'Finds files by glob pattern across the whole project, e.g. "**/*.ts" or "src/**/*.py".',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string', description: 'Glob pattern, e.g. **/*.js' } },
        required: ['pattern'],
      },
    },
  },
  async run(args, ctx) {
    const rel = new vscode.RelativePattern(ctx.workspaceRoot, args.pattern);
    const uris = await vscode.workspace.findFiles(rel, '**/node_modules/**', 200);
    ctx.log(`🔎 find_files: ${args.pattern} (${uris.length})`);
    if (!uris.length) return '(no matches)';
    return uris.map((u) => path.relative(ctx.workspaceRoot, u.fsPath).replace(/\\/g, '/')).join('\n');
  },
};

// ───────────────────────── search_text (grep) ─────────────────────────
const searchText: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'search_text',
      description: 'Searches for text/regex across project files. Returns matching lines with path and line number.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text or regular expression to search for' },
          glob: { type: 'string', description: 'Optional file filter, e.g. **/*.ts (defaults to all files)' },
        },
        required: ['query'],
      },
    },
  },
  async run(args, ctx) {
    const incl = new vscode.RelativePattern(ctx.workspaceRoot, args.glob || '**/*');
    const uris = await vscode.workspace.findFiles(incl, '**/node_modules/**', 300);
    let re: RegExp;
    try { re = new RegExp(args.query, 'i'); } catch { re = new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
    const out: string[] = [];
    for (const u of uris) {
      let text: string;
      try { text = await readText(u.fsPath); } catch { continue; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          const rel = path.relative(ctx.workspaceRoot, u.fsPath).replace(/\\/g, '/');
          out.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
          if (out.length >= 100) break;
        }
      }
      if (out.length >= 100) break;
    }
    ctx.log(`🔍 search_text: "${args.query}" (${out.length} matches)`);
    return out.length ? out.join('\n') : '(no matches)';
  },
};

// ───────────────────────── run_command (with output readback) ─────────────────────────
const runCommand: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Runs a shell command in the project folder and RETURNS its output (stdout+stderr). ' +
        'Use it for build/test/git/ls etc. The agent sees the output and can react to it.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Command, e.g. "npm test" or "git status"' } },
        required: ['command'],
      },
    },
  },
  async run(args, ctx) {
    const ok = await ctx.confirm({ kind: 'command', title: 'Run this command?', command: args.command });
    if (!ok) return 'REJECTED: the user did not approve running this command.';
    ctx.log(`▶️ run_command: ${args.command}`);
    return await new Promise<string>((resolve) => {
      exec(args.command, { cwd: ctx.workspaceRoot, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          const out = (stdout || '').trim();
          const errOut = (stderr || '').trim();
          let res = '';
          if (out) res += `STDOUT:\n${out}\n`;
          if (errOut) res += `STDERR:\n${errOut}\n`;
          if (err && (err as any).code !== 0) res += `EXIT CODE: ${(err as any).code ?? 'error'}\n`;
          if (!res) res = '(no output, command finished)';
          resolve(res.length > 12000 ? res.slice(0, 12000) + '\n... [truncated]' : res);
        });
    });
  },
};

// ───────────────────────── todo_write (plan visible to the user) ─────────────────────────
const todoWrite: ToolImpl = {
  def: {
    type: 'function',
    function: {
      name: 'todo_write',
      description:
        'Writes/updates a task list (plan) visible to the user in the chat panel. ' +
        'Use it for multi-step tasks: lay out the steps up front, mark a step "in_progress" when you start it ' +
        'and "completed" right after finishing it. Always provide the FULL, current list (not just a diff).',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'The full, current task list',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Short task description' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  async run(args, ctx) {
    const items: TodoItem[] = Array.isArray(args.items)
      ? args.items.map((i: any) => ({
          content: String(i?.content || ''),
          status: (['pending', 'in_progress', 'completed'].includes(i?.status) ? i.status : 'pending') as TodoItem['status'],
        }))
      : [];
    ctx.updateTodos(items);
    ctx.log(`📋 todo_write: ${items.length} tasks`);
    return `OK: task list updated (${items.length}).`;
  },
};

export const ALL_TOOLS: ToolImpl[] = [
  readFile, writeFile, editFile, deleteFile, createDirectory, listFiles, findFiles, searchText, runCommand, todoWrite,
];

export function toolDefs(): ToolDef[] {
  return ALL_TOOLS.map((t) => t.def);
}

export function findTool(name: string): ToolImpl | undefined {
  return ALL_TOOLS.find((t) => t.def.function.name === name);
}
