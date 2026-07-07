# Hearth

[![Latest Release](https://img.shields.io/github/v/release/pawel2jarzembowski-oss/hearth)](https://github.com/pawel2jarzembowski-oss/hearth/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A local-first autonomous coding agent for VS Code — it lives at home instead of in the cloud. Hearth runs on your own [Ollama](https://ollama.com) model by default (no API key, nothing leaves your machine), with an optional one-click switch to a cloud OpenAI-compatible provider when you want a stronger model.

It runs a fully agentic loop: the model reads files, writes files, and runs commands on its own — step by step — while showing you its plan and the changes it wants to make.

## Agent tools (10 of them)
- `list_files` — list a directory
- `find_files` — find files by glob pattern (e.g. `**/*.py`)
- `search_text` — search text/regex across files (grep)
- `read_file` — read a file (with line numbers)
- `write_file` — create/overwrite a file (full content)
- `edit_file` — precise fragment replacement (old_string → new_string)
- `delete_file` — delete a file/folder (goes to trash)
- `create_directory` — create a folder
- `run_command` — run a command and **read back its output** (stdout/stderr), so the agent reacts to it
- `todo_write` — lays out and live-updates its task plan, shown in a panel above the chat

## What it looks like in practice
- **Live plan (📋)** — for multi-step tasks the agent writes out its steps and checks them off one by one, so you can see exactly what it's doing and how much is left.
- **Streamed replies** — the agent's text appears token by token, like a cloud chat model, instead of waiting for the whole answer at once.
- **No ceremony by default** — with permissions at `auto` (the default), the agent just makes the change and tells you what it did in its reply, the same way a human collaborator would describe their own commit. Nothing pops up, no tabs open on their own.
- **Collapsible tool cards** — every tool call is one clickable card (icon + name + argument preview) that expands to show the full arguments and result, if you want to check.
- **Change summary** — after finishing a task, the agent lists every file it touched; click a path to open it in the editor, on your terms.
- **Status bar indicator** in VS Code shows live whether the backend is reachable and whether the agent is currently working.
- **Attach files as context** — the 📎 button opens a file picker; attached files are prepended to your next message and shown as removable chips.
- **Ask mode when you want it** — set a permission category to `ask` and that category's changes show a card in the chat (with a diff for write/edit) with Approve/Reject buttons before anything happens.
- **Everything lives in the chat panel** — models, API key, permissions, and usage are all a click on the ⚙ gear away, rendered as a filterable settings list right there in the webview. No native VS Code Quick Pick/input-box dialogs, no toast notifications in the corner — status and errors show up as a small notice banner right above where you type.

## Settings panel (⚙)
Click the gear icon (or run any of the commands below from the Command Palette — they all open the same panel, with a filter box at the top to jump straight to what you need):
- **Models** — for Ollama: a list of installed models to switch between, plus a name field to pull a brand-new one straight from the UI with a live progress readout (with a built-in browsable list of popular models to search, like `llama3.2` or `qwen3`). For the cloud provider: just the model name.
- **Provider & API Key** — pick a provider (OpenAI, OpenRouter, Groq, Together AI, Mistral, DeepSeek, or Custom) and the base URL fills itself in — then paste your key into the password field and hit Save. Backed by VS Code's encrypted **SecretStorage**: never written to `settings.json`, never leaves your machine except in requests to the provider you picked.
- **Permissions** — click a row to cycle `auto` → `ask` → `deny` for write & edit, delete, and shell commands. `auto` (default) just does it and reports back in the chat — no popup, nothing opens. `ask` shows a diff/command to approve first. `deny` refuses outright, no prompt at all. Read-only tools (`list_files`, `read_file`, `find_files`, `search_text`, `todo_write`) are never gated.
- **Usage** — live session stats (requests, prompt/completion/total tokens) and the optional daily cloud budget.

Two backends, switchable from the same panel or via `hearth.provider`:
- `"ollama"` (default): fully local, no key required.
- `"openai"`: any OpenAI-compatible API (OpenAI, OpenRouter, Groq, etc.) via `hearth.openaiBaseUrl` + `hearth.cloudModel`.

**`hearth.dailyBudgetUsd`** (default `0` = off) is an optional soft spend cap for the cloud provider, estimated locally from published list prices for a handful of recognized OpenAI models — **not a real balance check** (no OpenAI-compatible provider exposes account balance to a plain API key), and unrecognized models are simply skipped rather than guessed at. You get a notice banner at 80% of the budget and again once it's crossed; it resets at midnight and persists across restarts.

## Safety
- File operations are restricted to the open **project folder** (protected against `../`).
- With the default `"ollama"` provider, nothing leaves your machine at all.
- If you switch to `"openai"`, your conversation and file contents are sent to whichever provider you configured — same as any cloud AI tool. Your API key is kept in SecretStorage, not in plain settings.
- ⚠️ With permissions set to `auto` (the default) the agent can overwrite/delete files and run any command **within the project**. Work in a folder that doesn't contain anything irreplaceable, use git, or set `hearth.permissions.*` to `ask`/`deny`.

## Requirements
- Either a running **Ollama** instance (pull a model once with e.g. `ollama run qwen3:14b`, or pull it straight from the ⚙ settings panel) — or an API key for an OpenAI-compatible cloud provider. The model must support tool calling either way.
- Node.js + npm (to build).

## Installing it
Hearth isn't on the VS Code Marketplace yet — grab it from [Releases](https://github.com/pawel2jarzembowski-oss/hearth/releases/latest):

1. Download `hearth-0.2.0.vsix` from the latest release.
2. In VS Code: **Extensions** view → `...` menu (top right) → **Install from VSIX...** → pick the downloaded file.
   (Or from a terminal: `code --install-extension hearth-0.2.0.vsix`)
3. Reload VS Code, open a project folder, and click the flame icon in the activity bar (or the status bar item at the bottom) to start chatting.

### Building from source
Prefer to build it yourself, or want to hack on it?

```bash
git clone https://github.com/pawel2jarzembowski-oss/hearth.git
cd hearth
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
code --install-extension hearth-0.2.0.vsix
```

Press **F5** in this folder to launch an Extension Development Host with your changes loaded live. Run `npm test` to run the test suite (`node`'s built-in test runner, no extra dependencies — covers the diff algorithm, path-traversal safety, and both streaming backends against fake local servers).

## Settings
- `hearth.provider` — `"ollama"` (default, local) or `"openai"` (cloud, OpenAI-compatible)
- `hearth.endpoint` — Ollama address (default `http://localhost:11434`)
- `hearth.model` — Ollama model name (default `qwen3:14b`)
- `hearth.openaiBaseUrl` — cloud API base URL (default `https://api.openai.com/v1`)
- `hearth.cloudModel` — cloud model name (default `gpt-4o-mini`)
- `hearth.maxSteps` — step limit per request (default 40)
- `hearth.permissions.write` / `.delete` / `.command` — `auto` / `ask` / `deny` (default `auto` for all three)
- `hearth.dailyBudgetUsd` — soft daily spend cap estimate for the cloud provider (default `0`, off)

## A note on quality
The default local 14B model is noticeably weaker than a large cloud model at long multi-step agentic work. It handles simple tasks (read/write/explain) well, but can lose the thread on complex ones. Switch `hearth.provider` to `"openai"` and point it at a stronger model if you need more reliable multi-step behavior — that's exactly what the provider switch is for.

## License
[MIT](LICENSE)
