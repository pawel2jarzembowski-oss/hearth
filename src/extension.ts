import * as vscode from 'vscode';
import * as path from 'path';
import { AgentSession } from './session';
import { getChatHtml } from './webview';
import { listModels, pullModel } from './ollama';

let session: AgentSession;

export function activate(context: vscode.ExtensionContext) {
  session = new AgentSession(context);

  // Side panel view
  const provider = new ChatViewProvider(context, session);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('hearth.chatView', provider)
  );

  // Command: open the chat as a LARGE editor window (Explorer stays on the left)
  context.subscriptions.push(
    vscode.commands.registerCommand('hearth.openInEditor', () => openEditorPanel(context, session))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('hearth.openChat', () => {
      vscode.commands.executeCommand('hearth.chatView.focus');
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('hearth.newConversation', () => session.reset())
  );
  // Every one of these just opens the SAME in-webview settings panel (optionally scrolled to a
  // section) — no native QuickPick/InputBox. That way Command Palette users end up in the exact
  // same place as clicking the gear icon in the chat.
  context.subscriptions.push(
    vscode.commands.registerCommand('hearth.setApiKey', () => openSettingsPanel('apiKey'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('hearth.manageModels', () => openSettingsPanel('models'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('hearth.managePermissions', () => openSettingsPanel('permissions'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('hearth.showUsage', () => openSettingsPanel('usage'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('hearth.openSettings', () => openSettingsPanel())
  );

  // Status bar item — shows the Ollama connection state and whether the agent is working.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'hearth.openChat';
  statusBar.text = '$(flame) Hearth';
  statusBar.tooltip = 'Open Hearth chat';
  statusBar.show();
  context.subscriptions.push(statusBar);

  let idleLine = '$(flame) Hearth';
  session.attach((msg: any) => {
    if (msg.type === 'status') {
      idleLine = (msg.ok ? '$(pass-filled) ' : '$(error) ') + msg.model;
      statusBar.text = idleLine;
      statusBar.tooltip = msg.detail;
    } else if (msg.type === 'busy') {
      statusBar.text = msg.busy ? '$(sync~spin) Agent working...' : idleLine;
    }
  });
}

export function deactivate() {}

// Codicons (the real icon set VS Code itself uses) ship inside the @vscode/codicons package —
// bundled here and exposed to the webview via asWebviewUri instead of hand-drawn emoji glyphs.
function codiconsDir(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist');
}
function codiconsUri(context: vscode.ExtensionContext, webview: vscode.Webview): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(codiconsDir(context), 'codicon.css'));
}

// ─────────────── Side panel (webview view) ───────────────
class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private context: vscode.ExtensionContext, private session: AgentSession) {}

  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true, localResourceRoots: [codiconsDir(this.context)] };
    view.webview.html = getChatHtml(view.webview, codiconsUri(this.context, view.webview));
    const sink = (msg: any) => view.webview.postMessage(msg);
    this.session.attach(sink);
    view.onDidDispose(() => this.session.detach(sink));
    view.webview.onDidReceiveMessage((msg) => handleMsg(msg, this.session, this.context));
  }
}

// ─────────────── Editor panel (webview panel) ───────────────
let editorPanel: vscode.WebviewPanel | undefined;
function openEditorPanel(context: vscode.ExtensionContext, session: AgentSession) {
  if (editorPanel) {
    editorPanel.reveal(vscode.ViewColumn.Active);
    return;
  }
  editorPanel = vscode.window.createWebviewPanel(
    'hearth.editorChat',
    'Hearth',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [codiconsDir(context)] }
  );
  editorPanel.webview.html = getChatHtml(editorPanel.webview, codiconsUri(context, editorPanel.webview));
  const sink = (msg: any) => editorPanel?.webview.postMessage(msg);
  session.attach(sink);
  editorPanel.webview.onDidReceiveMessage((msg) => handleMsg(msg, session, context));
  editorPanel.onDidDispose(() => {
    if (editorPanel) session.detach(sink);
    editorPanel = undefined;
  });
}

/** Focuses the chat and tells the webview to open its settings panel — used by both the gear
 * button (via postMessage) and the Command Palette entries (via these VS Code commands). */
function openSettingsPanel(section?: string) {
  vscode.commands.executeCommand('hearth.openChat');
  session.post({ type: 'open-settings', section });
}

async function openFileInEditor(relPath: string) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  const abs = vscode.Uri.file(path.join(root, relPath));
  try {
    const doc = await vscode.workspace.openTextDocument(abs);
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch {
    session.notice('error', `Could not open file: ${relPath}`);
  }
}

function handleMsg(msg: any, session: AgentSession, context: vscode.ExtensionContext) {
  if (msg.type === 'send') session.send(msg.text);
  else if (msg.type === 'reset') session.reset();
  else if (msg.type === 'ping') session.doPing();
  else if (msg.type === 'openInEditor') vscode.commands.executeCommand('hearth.openInEditor');
  else if (msg.type === 'confirm-response') session.resolveConfirm(msg.id, msg.approved);
  else if (msg.type === 'openFile') openFileInEditor(msg.path);
  else if (msg.type === 'openSettingsMenu') session.post({ type: 'open-settings' });
  else if (msg.type === 'attachFiles') attachFiles(session);
  else if (msg.type === 'detachFile') session.detachFile(msg.path);
  else if (msg.type === 'getSettings') sendSettingsData(session);
  else if (msg.type === 'setSetting') setSetting(session, msg.key, msg.value);
  else if (msg.type === 'saveApiKey') saveApiKey(context, session, msg.key);
  else if (msg.type === 'clearApiKey') saveApiKey(context, session, '');
  else if (msg.type === 'pullModel') pullModelFromPanel(session, msg.name);
}

// ─────────────── Attach files (read as text, prepended as context to the next message) ───────────────
async function attachFiles(session: AgentSession) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const picks = await vscode.window.showOpenDialog({
    canSelectMany: true,
    defaultUri: root ? vscode.Uri.file(root) : undefined,
    openLabel: 'Attach to chat',
  });
  if (!picks) return;
  for (const uri of picks) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      const rel = root ? path.relative(root, uri.fsPath).replace(/\\/g, '/') : uri.fsPath;
      session.attachFile(rel, text);
    } catch {
      session.notice('error', `Could not read "${uri.fsPath}" as text.`);
    }
  }
}

// ─────────────── Settings panel data + actions (all rendered inside the webview itself) ───────────────
async function sendSettingsData(session: AgentSession) {
  const snap: any = await session.settingsSnapshot();
  let models: { name: string; size: number }[] = [];
  let modelsError: string | undefined;
  if (snap.provider === 'ollama') {
    try {
      models = await listModels(snap.endpoint);
    } catch (e: any) {
      modelsError = e.message;
    }
  }
  session.post({ type: 'settingsData', ...snap, models, modelsError });
}

async function setSetting(session: AgentSession, key: string, value: any) {
  await vscode.workspace.getConfiguration('hearth').update(key, value, vscode.ConfigurationTarget.Global);
  session.doPing();
  await sendSettingsData(session);
}

// ─────────────── API key (stored securely via SecretStorage, never in settings.json) ───────────────
async function saveApiKey(context: vscode.ExtensionContext, session: AgentSession, key: string) {
  if (key.trim()) {
    await context.secrets.store('hearth.apiKey', key.trim());
    session.notice('info', 'API key saved.');
  } else {
    await context.secrets.delete('hearth.apiKey');
    session.notice('info', 'API key cleared.');
  }
  session.doPing();
  await sendSettingsData(session);
}

// ─────────────── Pull a new Ollama model, reporting progress back into the panel ───────────────
async function pullModelFromPanel(session: AgentSession, name: string) {
  if (!name) return;
  const endpoint = vscode.workspace.getConfiguration('hearth').get<string>('endpoint', 'http://localhost:11434');
  session.post({ type: 'pull-progress', status: 'Starting…', pct: 0 });
  try {
    let lastPct = 0;
    await pullModel(endpoint, name, (status, completed, total) => {
      const pct = total && completed ? Math.floor((completed / total) * 100) : lastPct;
      lastPct = pct;
      session.post({ type: 'pull-progress', status, pct });
    });
    await vscode.workspace.getConfiguration('hearth').update('model', name, vscode.ConfigurationTarget.Global);
    session.post({ type: 'pull-done', ok: true });
    session.notice('info', `Pulled and switched to "${name}".`);
    session.doPing();
    await sendSettingsData(session);
  } catch (e: any) {
    session.post({ type: 'pull-done', ok: false });
    session.notice('error', `Failed to pull "${name}": ${e.message}`);
  }
}
