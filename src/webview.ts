import * as vscode from 'vscode';

export function getChatHtml(webview: vscode.Webview, codiconUri: vscode.Uri): string {
  const nonce = String(Math.random()).slice(2);
  const csp = `default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${codiconUri}" rel="stylesheet">
<style>
  :root { --gap: 10px; }
  * { box-sizing: border-box; min-width: 0; }
  html, body { max-width: 100%; overflow-x: hidden; }
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); padding: 0; margin: 0; display: flex; flex-direction: column; height: 100vh; }
  .codicon { vertical-align: middle; }

  /* ── top bar ── */
  #top { display:flex; align-items:center; gap:8px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  #status { flex:1; font-size: 11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex: none; }
  .ok { background: #3fb950; box-shadow: 0 0 6px rgba(63,185,80,.6); }
  .bad { background: #f85149; }
  .iconbtn { background:transparent; border:none; color:var(--vscode-foreground); cursor:pointer; opacity:0.75; padding:3px 7px; border-radius:5px; font-size:12px; flex: none; display:flex; align-items:center; gap:4px; }
  .iconbtn:hover { opacity:1; background:var(--vscode-toolbar-hoverBackground); }

  /* ── plan panel (todo_write) ── */
  #todos { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; background: var(--vscode-sideBar-background, transparent); }
  #todos.hidden { display: none; }
  .todohead { font-weight: 600; opacity: .65; margin-bottom: 5px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; display:flex; align-items:center; gap:5px; }
  .todoitem { padding: 2px 0; display:flex; gap:6px; align-items:center; }
  .todoitem .ic { flex:none; width:14px; display:flex; }
  .tdone { opacity: .5; text-decoration: line-through; }
  .tactive { font-weight: 600; color: var(--vscode-charts-blue, #4b8bf0); }
  .tpending { opacity: .8; }

  /* ── message log ── */
  #log { flex: 1; overflow-y: auto; overflow-x: hidden; padding: var(--gap); }
  .msg { margin: 8px 0; padding: 8px 10px; border-radius: 8px; word-wrap: break-word; overflow-wrap: anywhere; line-height:1.5; }
  .user { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
  .role { font-size: 10px; text-transform: uppercase; opacity: 0.55; margin-bottom: 3px; letter-spacing:.04em; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
  code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
  p code, li code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  .msg p { margin: 4px 0; } .msg ul { margin: 4px 0; padding-left: 20px; }
  .cursor { display:inline-block; width:6px; height:1em; background:var(--vscode-foreground); opacity:.5; vertical-align:text-bottom; margin-left:1px; animation: blink 1s step-start infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  #step { font-size: 11px; opacity: 0.7; padding: 0 10px; height: 16px; }

  /* ── tool cards (collapsible) ── */
  .toolcard { margin: 6px 0; border: 1px solid var(--vscode-panel-border); border-radius: 7px; overflow: hidden; background: var(--vscode-textCodeBlock-background); }
  .toolhead { display: flex; align-items: center; gap: 7px; padding: 6px 9px; cursor: pointer; user-select: none; }
  .toolhead:hover { background: var(--vscode-toolbar-hoverBackground); }
  .toolhead .ti { flex: none; font-size: 12px; display:flex; }
  .toolhead .tn { font-family: var(--vscode-editor-font-family); font-weight: 600; font-size: 11.5px; opacity: .9; flex: none; }
  .toolhead .tp { flex: 1; min-width: 0; opacity: .55; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family); }
  .toolhead .tstate { flex: none; font-size: 11px; opacity: .8; display:flex; }
  .toolbody { padding: 8px 9px; border-top: 1px solid var(--vscode-panel-border); }
  .toolbody.hidden { display: none; }
  .toolargs { font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; opacity: .7; margin-bottom: 6px; }
  .toolresult { font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; border-left: 3px solid var(--vscode-charts-green,#3fb950); padding: 4px 8px; background: var(--vscode-editor-background); border-radius: 4px; max-height: 320px; overflow-y: auto; }
  .toollog { font-family: var(--vscode-editor-font-family); font-size: 11px; opacity: .6; margin-bottom: 4px; }
  .filelink { cursor: pointer; text-decoration: underline; opacity: .85; font-family: var(--vscode-editor-font-family); font-size: 11.5px; display: inline-flex; align-items:center; gap:4px; margin-top: 6px; word-break: break-all; }
  .filelink:hover { opacity: 1; }

  /* ── confirmation cards (diff / command) ── */
  .confirmcard { border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700); background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,.08)); border-radius: 9px; padding: 10px 12px; margin: 10px 0; }
  .ctitle { font-weight: 600; margin-bottom: 4px; font-size: 13px; overflow-wrap: anywhere; display:flex; align-items:center; gap:6px; }
  .cdetail { font-size: 11.5px; opacity: .75; margin-bottom: 7px; display:flex; align-items:center; gap:5px; }
  .ccmd { background: var(--vscode-textCodeBlock-background); padding: 7px 9px; border-radius: 5px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 8px; font-family: var(--vscode-editor-font-family); }
  .cdiff { max-height: 280px; overflow-y: auto; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: 11.5px; border-radius: 5px; background: var(--vscode-editor-background); margin-bottom: 8px; padding: 4px 0; }
  .dline { padding: 0 8px; white-space: pre; }
  .dadd { background: rgba(63,185,80,.15); color: #3fb950; }
  .ddel { background: rgba(248,81,73,.15); color: #f85149; }
  .dctx { opacity: .55; }
  .cbtns { display: flex; gap: 8px; flex-wrap: wrap; }
  .cok { background: #2ea043; color: white; border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 12px; display:flex; align-items:center; gap:5px; }
  .cok:hover { background: #3fb950; }
  .cno { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-input-border,#555); border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 12px; display:flex; align-items:center; gap:5px; }
  .cno:hover { background: var(--vscode-toolbar-hoverBackground); }
  .cok:disabled, .cno:disabled { opacity: .4; cursor: default; }
  .cresult { font-size: 12px; opacity: .85; margin-top: 4px; font-weight: 600; display:flex; align-items:center; gap:5px; }

  /* ── changed files summary ── */
  .fileschanged { margin: 10px 0; padding: 8px 10px; border-radius: 8px; background: var(--vscode-editor-inactiveSelectionBackground); font-size: 12px; }
  .fchead { margin-bottom: 5px; opacity: .75; font-weight: 600; display:flex; align-items:center; gap:5px; }
  .fclist { display: flex; flex-wrap: wrap; gap: 6px; }

  /* ── usage indicator ── */
  #usage { flex: none; font-size: 10.5px; opacity: .6; margin-right: 2px; white-space: nowrap; }
  #usage.hidden { display: none; }

  /* ── attachments ── */
  #attachRow { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 8px 8px 8px; }
  #attachRow.hidden { display: none; }
  .attachchip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border,#555); border-radius: 5px; padding: 2px 7px; cursor: pointer; font-family: var(--vscode-editor-font-family); }
  .attachchip:hover { background: var(--vscode-toolbar-hoverBackground); }
  .attachrow { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .msg .attachrow .attachchip { cursor: default; opacity: .8; }

  /* ── input bar ── */
  #bar { display: flex; padding: 8px; gap: 6px; border-top: 1px solid var(--vscode-panel-border); }
  #inp { flex: 1; resize: none; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border,#555); border-radius: 6px; padding: 6px 8px; font-family: inherit; font-size: 13px; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 0 14px; cursor: pointer; flex: none; }
  button.primary:disabled { opacity: 0.5; cursor: default; }
  .hint { opacity: 0.7; padding: 14px 10px; font-size: 12px; line-height: 1.6; }

  /* ── notice bar (replaces native VS Code toast notifications) ── */
  #noticeBar { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font-size: 12px; border-top: 3px solid transparent; background: var(--vscode-editor-inactiveSelectionBackground); }
  #noticeBar.hidden { display: none; }
  #noticeBar.info { border-top-color: var(--vscode-charts-blue, #4b8bf0); }
  #noticeBar.warning { border-top-color: var(--vscode-charts-yellow, #cca700); }
  #noticeBar.error { border-top-color: var(--vscode-charts-red, #f85149); }
  .noticeText { flex: 1; }
  .noticeClose { cursor: pointer; opacity: .6; display: flex; }
  .noticeClose:hover { opacity: 1; }

  /* ── settings panel (models, API key, permissions, usage — all in-webview) ──
     Full-screen overlay: covers the whole extension view while open; closing it just
     reveals the chat underneath again (which was never torn down). Styled as a flat,
     filterable action list — same idiom as Claude Code's own "/" action menu. */
  #settingsPanel { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 9999; display: flex; flex-direction: column; background-color: var(--vscode-editor-background, #1e1e1e); }
  #settingsPanel.hidden { display: none; }
  .spHeader { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; font-weight: 600; font-size: 13px; }
  #spFilter { flex: none; margin: 0 14px 8px 14px; padding: 6px 2px; background: transparent; color: var(--vscode-foreground); border: none; border-bottom: 1px solid var(--vscode-panel-border); font-size: 13px; font-family: inherit; }
  #spBody { flex: 1; overflow-y: auto; padding-bottom: 20px; }
  .spSecHead { font-size: 11px; opacity: .5; padding: 14px 14px 4px 14px; }
  .spRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 14px; font-size: 13px; cursor: pointer; }
  .spRow:hover { background: var(--vscode-list-hoverBackground); }
  .spRow.spStatic { cursor: default; }
  .spRow.spStatic:hover { background: transparent; }
  .spRowRight { opacity: .55; font-size: 12.5px; display: flex; align-items: center; gap: 6px; flex: none; white-space: nowrap; }
  .spModelName { font-family: var(--vscode-editor-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spInline { flex: 1; min-width: 0; background: transparent; color: var(--vscode-input-foreground); border: none; border-bottom: 1px solid var(--vscode-input-border,#555); padding: 3px 0; font-size: 12.5px; font-family: inherit; text-align: right; }
  .spInline:focus { outline: none; border-bottom-color: var(--vscode-focusBorder, #007fd4); }
  .spInline.spNarrow { flex: none; width: 70px; }
  .spPullBtn { flex: none; background: transparent; border: none; color: var(--vscode-foreground); opacity: .7; cursor: pointer; display: flex; }
  .spPullBtn:hover { opacity: 1; }
  .spMuted { opacity: .5; font-size: 11.5px; }
  .spError { font-size: 12px; color: var(--vscode-charts-red, #f85149); }
  .spLibList { max-height: 180px; overflow-y: auto; margin: 2px 14px 10px 14px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
  .spLibRow { padding: 6px 10px; font-size: 12px; font-family: var(--vscode-editor-font-family); cursor: pointer; }
  .spLibRow:hover { background: var(--vscode-list-hoverBackground); }
  .spToggle { flex: none; width: 34px; height: 18px; border-radius: 9px; background: var(--vscode-input-border,#555); position: relative; transition: background .15s; }
  .spToggle.on { background: var(--vscode-button-background, #0e70c0); }
  .spToggleKnob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .15s; }
  .spToggle.on .spToggleKnob { left: 18px; }
  .spBtnRow { display: flex; gap: 8px; padding: 4px 14px 2px 14px; }
</style>
</head>
<body>
  <div id="top">
    <span id="status"><span class="dot bad"></span><span id="statusText">Connecting to Ollama...</span></span>
    <span id="usage" class="hidden"></span>
    <button class="iconbtn" id="settingsBtn" title="Settings (models, API key, permissions, usage)"><i class="codicon codicon-settings-gear"></i></button>
    <button class="iconbtn" id="winBtn" title="Open as editor window"><i class="codicon codicon-multiple-windows"></i> Window</button>
    <button class="iconbtn" id="newBtn" title="New conversation"><i class="codicon codicon-add"></i> New</button>
  </div>
  <div id="settingsPanel" class="hidden">
    <div class="spHeader"><span>Settings</span><button class="iconbtn" id="spClose" title="Close"><i class="codicon codicon-close"></i></button></div>
    <input id="spFilter" placeholder="Filter settings...">
    <div id="spBody"></div>
  </div>
  <div id="todos" class="hidden"></div>
  <div id="log">
    <div class="hint">👋 Hi! I'm your <b>Hearth</b> — running 100% locally with full access to the open folder.<br>
    For bigger tasks I'll lay out a <b>plan</b> up top and check it off step by step.<br>
    By default it just makes changes and tells you what it did — set permissions to "ask" (⚙ above) if you want to approve writes/edits/commands first.<br>
    Use <i class="codicon codicon-attach"></i> below to attach files as context, and <i class="codicon codicon-settings-gear"></i> above for models, permissions and usage.<br><br>
    Try:<br>• "build a todo app in python and run it"<br>• "find all .js files and describe what they do"<br>• "add feature X to file Y and run the tests"</div>
  </div>
  <div id="step"></div>
  <div id="attachRow" class="hidden"></div>
  <div id="noticeBar" class="hidden"></div>
  <div id="bar">
    <button class="iconbtn" id="attachBtn" title="Attach files as context"><i class="codicon codicon-attach"></i></button>
    <textarea id="inp" rows="2" placeholder="Type a task... (Enter to send, Shift+Enter for a new line)"></textarea>
    <button class="primary" id="send">Send</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const inp = document.getElementById('inp');
  const sendBtn = document.getElementById('send');
  const statusText = document.getElementById('statusText');
  const dot = document.querySelector('.dot');
  const stepEl = document.getElementById('step');
  const todosEl = document.getElementById('todos');
  let busy = false, hintShown = true;

  const TOOL_ICON = {
    read_file: 'eye', write_file: 'save', edit_file: 'edit', delete_file: 'trash',
    create_directory: 'new-folder', list_files: 'folder-opened', find_files: 'files', search_text: 'search',
    run_command: 'terminal', todo_write: 'checklist'
  };
  function icon(name, extra){ return '<i class="codicon codicon-'+name+(extra?' '+extra:'')+'"></i>'; }

  function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  // Mini-markdown: \`\`\` code blocks, inline \` code, ** bold, - lists, paragraphs.
  function md(text){
    const parts = text.split(/(\`\`\`[\\s\\S]*?\`\`\`)/g);
    return parts.map(p=>{
      if(p.startsWith('\`\`\`')){
        const body = p.replace(/^\`\`\`[a-zA-Z0-9]*\\n?/, '').replace(/\`\`\`$/, '');
        return '<pre><code>'+esc(body)+'</code></pre>';
      }
      let h = esc(p)
        .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
      const lines = h.split('\\n');
      let out='', inList=false;
      for(let ln of lines){
        if(/^\\s*[-*]\\s+/.test(ln)){ if(!inList){out+='<ul>';inList=true;} out+='<li>'+ln.replace(/^\\s*[-*]\\s+/,'')+'</li>'; }
        else { if(inList){out+='</ul>';inList=false;} if(ln.trim()) out+='<p>'+ln+'</p>'; }
      }
      if(inList) out+='</ul>';
      return out;
    }).join('');
  }
  function clearHint(){ if(hintShown){ log.innerHTML=''; hintShown=false; } }

  function add(cls, role, text){
    clearHint();
    const d=document.createElement('div'); d.className='msg '+cls;
    if(role){ const r=document.createElement('div'); r.className='role'; r.textContent=role; d.appendChild(r); }
    const body=document.createElement('div'); body.textContent=text;
    d.appendChild(body); log.appendChild(d); log.scrollTop=log.scrollHeight;
  }

  function addUser(text, attached){
    clearHint();
    const d=document.createElement('div'); d.className='msg user';
    const r=document.createElement('div'); r.className='role'; r.textContent='You'; d.appendChild(r);
    const body=document.createElement('div'); body.textContent=text; d.appendChild(body);
    if(attached && attached.length){
      const row=document.createElement('div'); row.className='attachrow';
      for(const p of attached){
        const chip=document.createElement('span'); chip.className='attachchip'; chip.innerHTML=icon('file')+' '+esc(p);
        row.appendChild(chip);
      }
      d.appendChild(row);
    }
    log.appendChild(d); log.scrollTop=log.scrollHeight;
  }

  // ── streaming assistant reply ──
  let curAssistant = null;
  function assistantStart(){
    clearHint();
    const d=document.createElement('div'); d.className='msg assistant';
    const r=document.createElement('div'); r.className='role'; r.textContent='Agent'; d.appendChild(r);
    const body=document.createElement('div'); body.className='body';
    const cursor=document.createElement('span'); cursor.className='cursor';
    body.appendChild(cursor);
    d.appendChild(body); log.appendChild(d); log.scrollTop=log.scrollHeight;
    curAssistant = { el: d, body, raw: '', cursor };
  }
  function assistantDelta(text){
    if(!curAssistant) assistantStart();
    curAssistant.raw += text;
    curAssistant.cursor.remove();
    curAssistant.body.textContent = curAssistant.raw;
    curAssistant.body.appendChild(curAssistant.cursor);
    log.scrollTop = log.scrollHeight;
  }
  function assistantDone(fullText){
    if(!curAssistant) assistantStart();
    curAssistant.body.innerHTML = md(fullText);
    curAssistant = null;
    log.scrollTop = log.scrollHeight;
  }

  // ── tool cards (collapsible, head+body in one card) ──
  let openToolCard = null;
  function onToolStart(name, argsStr){
    clearHint();
    let argsObj = {}; try { argsObj = JSON.parse(argsStr); } catch {}
    const preview = argsObj.path || argsObj.pattern || argsObj.query || argsObj.command || '';
    const iconName = TOOL_ICON[name] || 'tools';
    const card=document.createElement('div'); card.className='toolcard';
    const head=document.createElement('div'); head.className='toolhead';
    head.innerHTML = '<span class="ti">'+icon(iconName)+'</span><span class="tn">'+esc(name)+'</span><span class="tp">'+esc(String(preview).slice(0,80))+'</span><span class="tstate">'+icon('loading','codicon-modifier-spin')+'</span>';
    const body=document.createElement('div'); body.className='toolbody hidden';
    const argsPre=document.createElement('div'); argsPre.className='toolargs'; argsPre.textContent=argsStr;
    body.appendChild(argsPre);
    head.addEventListener('click', ()=> body.classList.toggle('hidden'));
    card.appendChild(head); card.appendChild(body);
    log.appendChild(card); log.scrollTop=log.scrollHeight;
    openToolCard = { card, head, body, pathVal: argsObj.path };
  }
  function onToolLog(text){
    if(openToolCard){
      const l=document.createElement('div'); l.className='toollog'; l.textContent=text;
      openToolCard.body.appendChild(l);
    }
  }
  function onToolResult(name, result){
    if(openToolCard){
      const stateEl = openToolCard.head.querySelector('.tstate');
      const failed = result.startsWith('ERROR') || result.startsWith('REJECTED');
      if(stateEl) stateEl.innerHTML = failed ? icon('error') : icon('check');
      const resPre=document.createElement('div'); resPre.className='toolresult'; resPre.textContent=result;
      openToolCard.body.appendChild(resPre);
      if(openToolCard.pathVal){
        const link=document.createElement('span'); link.className='filelink';
        link.innerHTML = icon('go-to-file')+' open '+esc(openToolCard.pathVal);
        link.addEventListener('click', ()=> vscode.postMessage({type:'openFile', path: openToolCard.pathVal}));
        openToolCard.body.appendChild(link);
      }
      openToolCard = null;
    } else {
      const card=document.createElement('div'); card.className='toolcard';
      const head=document.createElement('div'); head.className='toolhead'; head.innerHTML=icon('check')+' '+esc(name);
      const body=document.createElement('div'); body.className='toolbody'; body.textContent=result;
      head.addEventListener('click', ()=> body.classList.toggle('hidden'));
      card.appendChild(head); card.appendChild(body); log.appendChild(card);
    }
    log.scrollTop = log.scrollHeight;
  }

  // ── confirmation cards (diff / command) with Approve/Reject buttons ──
  const confirmFinalizers = {};
  function renderConfirmCard(m){
    clearHint();
    const card=document.createElement('div'); card.className='confirmcard';
    const kindIcon = m.kind==='delete'?'trash':m.kind==='command'?'terminal':m.kind==='edit'?'edit':'save';
    const title=document.createElement('div'); title.className='ctitle'; title.innerHTML=icon(kindIcon)+' '+esc(m.title);
    card.appendChild(title);
    if(m.detail){ const det=document.createElement('div'); det.className='cdetail'; det.textContent=m.detail; card.appendChild(det); }
    if(m.command){ const cmd=document.createElement('pre'); cmd.className='ccmd'; cmd.textContent=m.command; card.appendChild(cmd); }
    if(m.diff && m.diff.length){
      const box=document.createElement('div'); box.className='cdiff';
      for(const line of m.diff){
        const row=document.createElement('div');
        row.className='dline '+(line.type==='add'?'dadd':line.type==='del'?'ddel':'dctx');
        row.textContent=(line.type==='add'?'+ ':line.type==='del'?'- ':'  ')+line.text;
        box.appendChild(row);
      }
      card.appendChild(box);
    }
    const btns=document.createElement('div'); btns.className='cbtns';
    const okBtn=document.createElement('button'); okBtn.className='cok'; okBtn.innerHTML=icon('check')+' Approve';
    const noBtn=document.createElement('button'); noBtn.className='cno'; noBtn.innerHTML=icon('close')+' Reject';
    btns.appendChild(okBtn); btns.appendChild(noBtn);
    card.appendChild(btns);
    log.appendChild(card); log.scrollTop=log.scrollHeight;

    let done=false;
    function finalize(approved){
      if(done) return; done=true;
      btns.remove();
      const res=document.createElement('div'); res.className='cresult'; res.innerHTML = approved? icon('check')+' Approved' : icon('close')+' Rejected';
      card.appendChild(res);
    }
    okBtn.addEventListener('click', ()=>{ finalize(true); vscode.postMessage({type:'confirm-response', id:m.id, approved:true}); });
    noBtn.addEventListener('click', ()=>{ finalize(false); vscode.postMessage({type:'confirm-response', id:m.id, approved:false}); });
    confirmFinalizers[m.id] = finalize;
  }

  function renderFilesChanged(paths){
    const d=document.createElement('div'); d.className='fileschanged';
    const head=document.createElement('div'); head.className='fchead'; head.innerHTML=icon('files')+' Changed files ('+paths.length+')';
    d.appendChild(head);
    const list=document.createElement('div'); list.className='fclist';
    for(const p of paths){
      const chip=document.createElement('span'); chip.className='filelink'; chip.textContent=p;
      chip.addEventListener('click', ()=>vscode.postMessage({type:'openFile', path:p}));
      list.appendChild(chip);
    }
    d.appendChild(list);
    log.appendChild(d); log.scrollTop=log.scrollHeight;
  }

  function renderTodos(items){
    if(!items || !items.length){ todosEl.classList.add('hidden'); todosEl.innerHTML=''; return; }
    todosEl.classList.remove('hidden');
    let html = '<div class="todohead">'+icon('checklist')+' Plan</div>';
    for(const it of items){
      const cls = it.status==='completed'?'tdone':it.status==='in_progress'?'tactive':'tpending';
      const ic = it.status==='completed'?icon('pass-filled'):it.status==='in_progress'?icon('sync','codicon-modifier-spin'):icon('circle-large-outline');
      html += '<div class="todoitem '+cls+'"><span class="ic">'+ic+'</span><span>'+esc(it.content)+'</span></div>';
    }
    todosEl.innerHTML = html;
  }

  // ── attachments (pending, before send) ──
  let pendingAttachments = [];
  function renderAttachRow(){
    const row = document.getElementById('attachRow');
    if(!pendingAttachments.length){ row.classList.add('hidden'); row.innerHTML=''; return; }
    row.classList.remove('hidden'); row.innerHTML='';
    for(const p of pendingAttachments){
      const chip=document.createElement('span'); chip.className='attachchip';
      chip.innerHTML=icon('file')+' '+esc(p)+' '+icon('close');
      chip.title='Remove attachment';
      chip.addEventListener('click', ()=>vscode.postMessage({type:'detachFile', path:p}));
      row.appendChild(chip);
    }
  }

  function send(){
    const text=inp.value.trim(); if(!text||busy) return;
    vscode.postMessage({type:'send', text}); inp.value='';
  }
  sendBtn.addEventListener('click', send);
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); }});
  document.getElementById('newBtn').addEventListener('click', ()=>{ vscode.postMessage({type:'reset'}); renderTodos([]); });
  document.getElementById('winBtn').addEventListener('click', ()=>vscode.postMessage({type:'openInEditor'}));
  document.getElementById('settingsBtn').addEventListener('click', ()=>openSettings());
  document.getElementById('spClose').addEventListener('click', ()=>document.getElementById('settingsPanel').classList.add('hidden'));
  document.getElementById('attachBtn').addEventListener('click', ()=>vscode.postMessage({type:'attachFiles'}));

  // ── notice bar (in-webview replacement for native VS Code notifications) ──
  let noticeTimer = null;
  function showNotice(kind, text){
    const bar = document.getElementById('noticeBar');
    bar.className = 'notice '+kind;
    const iconName = kind==='error' ? 'error' : kind==='warning' ? 'warning' : 'info';
    bar.innerHTML = '<span class="noticeIcon">'+icon(iconName)+'</span><span class="noticeText"></span><span class="noticeClose">'+icon('close')+'</span>';
    bar.querySelector('.noticeText').textContent = text;
    bar.classList.remove('hidden');
    bar.querySelector('.noticeClose').addEventListener('click', hideNotice);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(hideNotice, 8000);
  }
  function hideNotice(){ document.getElementById('noticeBar').classList.add('hidden'); }

  // ── settings panel: a flat, filterable action list — same idiom as Claude Code's own "/" menu ──
  function openSettings(){
    document.getElementById('settingsPanel').classList.remove('hidden');
    document.getElementById('spFilter').value = '';
    vscode.postMessage({type:'getSettings'});
  }
  function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }
  function formatBytes(n){ if(!n) return ''; const gb=n/1073741824; return gb>=1? gb.toFixed(1)+' GB' : Math.round(n/1048576)+' MB'; }
  function setSetting(key, value){ vscode.postMessage({type:'setSetting', key, value}); }
  const PERM_ORDER = ['auto','ask','deny'];
  // Known OpenAI-compatible providers, so picking one just fills in the right base URL —
  // no need to look up or type the endpoint yourself. "Custom" reveals a free-text field.
  const CLOUD_PRESETS = [
    { label: 'OpenAI', url: 'https://api.openai.com/v1' },
    { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
    { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
    { label: 'Together AI', url: 'https://api.together.xyz/v1' },
    { label: 'Mistral', url: 'https://api.mistral.ai/v1' },
    { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  ];
  // Ollama's library has no public listing API — this is a curated, static snapshot of popular
  // models so "Pull new model" has something to browse. Anything not listed can still be typed
  // in by hand and pulled the same way.
  const OLLAMA_LIBRARY = [
    'llama3.2', 'llama3.2:1b', 'llama3.2:3b',
    'llama3.1', 'llama3.1:8b', 'llama3.1:70b', 'llama3.1:405b',
    'llama3', 'llama3:8b', 'llama3:70b',
    'llama2', 'llama2:7b', 'llama2:13b', 'llama2:70b',
    'codellama', 'codellama:7b', 'codellama:13b', 'codellama:34b',
    'mistral', 'mistral-nemo', 'mixtral', 'mixtral:8x22b',
    'gemma3', 'gemma3:1b', 'gemma3:4b', 'gemma3:12b', 'gemma3:27b',
    'gemma2', 'gemma2:2b', 'gemma2:9b', 'gemma2:27b',
    'qwen3', 'qwen3:0.6b', 'qwen3:4b', 'qwen3:8b', 'qwen3:14b', 'qwen3:32b',
    'qwen2.5', 'qwen2.5-coder', 'qwen2.5:0.5b', 'qwen2.5:14b', 'qwen2.5:32b', 'qwen2.5:72b',
    'phi4', 'phi3', 'phi3:mini', 'phi3:medium',
    'deepseek-r1', 'deepseek-r1:1.5b', 'deepseek-r1:7b', 'deepseek-r1:32b', 'deepseek-r1:70b',
    'deepseek-coder-v2', 'starcoder2', 'starcoder2:3b', 'starcoder2:15b',
    'llava', 'llava:7b', 'llava:13b',
    'command-r', 'command-r-plus',
    'nomic-embed-text', 'mxbai-embed-large', 'all-minilm',
    'tinyllama', 'orca-mini', 'vicuna', 'wizardlm2'
  ];
  function renderLibraryList(filterText){
    const listEl = document.getElementById('spLibraryList');
    if(!listEl) return;
    const q = (filterText||'').toLowerCase();
    const matches = OLLAMA_LIBRARY.filter(n=>!q || n.toLowerCase().includes(q)).slice(0, 25);
    listEl.innerHTML = matches.length
      ? matches.map(n=>'<div class="spLibRow" data-name="'+escAttr(n)+'">'+esc(n)+'</div>').join('')
      : '<div class="spLibRow" style="opacity:.5;cursor:default">No matches — you can still type a custom name and pull it.</div>';
    listEl.querySelectorAll('.spLibRow[data-name]').forEach(row=>{
      row.addEventListener('click', ()=>{ document.getElementById('spPullName').value = row.getAttribute('data-name'); });
    });
  }

  function renderSettingsPanel(data, opts){
    opts = opts || {};
    const body = document.getElementById('spBody');
    const isOllama = data.provider !== 'openai';
    let html = '';

    html += '<div class="spSecHead">Provider</div>';
    html += '<div class="spRow" id="spProviderRow"><span>Use cloud provider (OpenAI-compatible)</span>'
      + '<span class="spToggle'+(isOllama?'':' on')+'" id="spProviderToggle"><span class="spToggleKnob"></span></span></div>';

    if(isOllama){
      html += '<div class="spSecHead">Ollama</div>';
      html += '<div class="spRow spStatic"><span>Endpoint</span><input class="spInline" id="spEndpoint" value="'+escAttr(data.endpoint)+'"></div>';
      html += '<div class="spSecHead">Model</div>';
      if(data.modelsError){
        html += '<div class="spRow spStatic"><span class="spError">Could not reach Ollama: '+esc(data.modelsError)+'</span></div>';
      } else if(!data.models || !data.models.length){
        html += '<div class="spRow spStatic"><span class="spMuted">No models installed yet.</span></div>';
      } else {
        for(const m of data.models){
          const sel = m.name===data.model;
          html += '<div class="spRow" data-model="'+escAttr(m.name)+'"><span class="spModelName">'+esc(m.name)+'</span>'
            + '<span class="spRowRight">'+(sel?icon('check'):'')+' '+esc(formatBytes(m.size))+'</span></div>';
        }
      }
      html += '<div class="spRow spStatic"><span>Pull new model</span><input class="spInline" id="spPullName" placeholder="Search or type a name…">'
        + '<span class="spPullBtn" id="spPullBtn">'+icon('cloud-download')+'</span></div>';
      html += '<div class="spLibList" id="spLibraryList"></div>';
      html += '<div class="spRow spStatic hidden" id="spPullProgress"><span class="spMuted"></span></div>';
    } else {
      const matchedPreset = CLOUD_PRESETS.find(p => p.url === data.openaiBaseUrl);
      const presetValue = opts.forceCustom ? 'Custom' : (matchedPreset ? matchedPreset.label : 'Custom');
      html += '<div class="spSecHead">Cloud</div>';
      html += '<div class="spRow spStatic"><span>Provider</span><select class="spInline" id="spCloudPreset" style="text-align:left;flex:none;width:150px">'
        + CLOUD_PRESETS.map(p=>'<option value="'+escAttr(p.label)+'"'+(p.label===presetValue?' selected':'')+'>'+esc(p.label)+'</option>').join('')
        + '<option value="Custom"'+(presetValue==='Custom'?' selected':'')+'>Custom</option>'
        + '</select></div>';
      if(presetValue === 'Custom'){
        html += '<div class="spRow spStatic"><span>Base URL</span><input class="spInline" id="spBaseUrl" value="'+escAttr(data.openaiBaseUrl)+'"></div>';
      }
      html += '<div class="spRow spStatic"><span>Model</span><input class="spInline" id="spCloudModel" value="'+escAttr(data.cloudModel)+'"></div>';
      html += '<div class="spRow spStatic"><span>API key</span><span class="spRowRight">'+(data.hasApiKey? icon('check')+' Set' : icon('circle-slash')+' Not set')+'</span></div>';
      html += '<div class="spRow spStatic"><input class="spInline" id="spApiKey" type="password" placeholder="Paste API key, then Save…" style="text-align:left"></div>';
      html += '<div class="spBtnRow"><button id="spSaveKey" class="cok">'+icon('check')+' Save</button><button id="spClearKey" class="cno">'+icon('close')+' Clear</button></div>';
    }

    html += '<div class="spSecHead">Permissions</div>';
    html += permRow('Write &amp; edit files', 'permissions.write', data.permWrite);
    html += permRow('Delete files', 'permissions.delete', data.permDelete);
    html += permRow('Run shell commands', 'permissions.command', data.permCommand);

    const totalTok = (data.usage.promptTokens||0) + (data.usage.completionTokens||0);
    html += '<div class="spSecHead">Usage</div>';
    html += '<div class="spRow spStatic"><span>This session</span><span class="spRowRight">'
      + data.usage.requests+' requests · '+totalTok.toLocaleString()+' tokens</span></div>';
    html += '<div class="spRow spStatic"><span>Daily cloud budget (USD, 0 = off)</span><input class="spInline spNarrow" id="spBudget" type="number" min="0" step="0.5" value="'+data.dailyBudgetUsd+'"></div>';
    if(data.dailyBudgetUsd > 0){
      const pct = Math.min(100, Math.round((data.budgetSpent/data.dailyBudgetUsd)*100));
      html += '<div class="spRow spStatic"><span class="spMuted">Spent today</span><span class="spRowRight">$'+data.budgetSpent.toFixed(2)+' / $'+data.dailyBudgetUsd+' ('+pct+'%)</span></div>';
    }

    body.innerHTML = html;

    const provToggle = document.getElementById('spProviderToggle');
    if(provToggle) provToggle.addEventListener('click', ()=> setSetting('provider', isOllama ? 'openai' : 'ollama'));
    const endpointInp = document.getElementById('spEndpoint');
    if(endpointInp) endpointInp.addEventListener('change', ()=> setSetting('endpoint', endpointInp.value));
    const baseUrlInp = document.getElementById('spBaseUrl');
    if(baseUrlInp) baseUrlInp.addEventListener('change', ()=> setSetting('openaiBaseUrl', baseUrlInp.value));
    const presetSel = document.getElementById('spCloudPreset');
    if(presetSel) presetSel.addEventListener('change', ()=>{
      const preset = CLOUD_PRESETS.find(p=>p.label===presetSel.value);
      // Picking a known provider fills in its base URL immediately; picking "Custom" just
      // re-renders so the free-text Base URL field appears (no fabricated URL is set).
      if(preset) setSetting('openaiBaseUrl', preset.url);
      else renderSettingsPanel(data, { forceCustom: true });
    });
    const cloudModelInp = document.getElementById('spCloudModel');
    if(cloudModelInp) cloudModelInp.addEventListener('change', ()=> setSetting('cloudModel', cloudModelInp.value));
    document.querySelectorAll('#spBody .spRow[data-model]').forEach(row=>{
      row.addEventListener('click', ()=> setSetting('model', row.getAttribute('data-model')));
    });
    const pullNameInp = document.getElementById('spPullName');
    if(pullNameInp){
      renderLibraryList('');
      pullNameInp.addEventListener('input', ()=> renderLibraryList(pullNameInp.value));
    }
    const pullBtn = document.getElementById('spPullBtn');
    if(pullBtn) pullBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const nameInp = document.getElementById('spPullName');
      const name = nameInp.value.trim(); if(!name) return;
      pullBtn.style.pointerEvents = 'none'; pullBtn.style.opacity = '.4';
      const prog = document.getElementById('spPullProgress');
      prog.classList.remove('hidden'); prog.querySelector('span').textContent = 'Starting…';
      vscode.postMessage({type:'pullModel', name});
    });
    const saveKeyBtn = document.getElementById('spSaveKey');
    if(saveKeyBtn) saveKeyBtn.addEventListener('click', ()=>{
      const val = document.getElementById('spApiKey').value;
      vscode.postMessage({type:'saveApiKey', key: val});
    });
    const clearKeyBtn = document.getElementById('spClearKey');
    if(clearKeyBtn) clearKeyBtn.addEventListener('click', ()=> vscode.postMessage({type:'clearApiKey'}));
    document.querySelectorAll('#spBody .spRow[data-perm]').forEach(row=>{
      row.addEventListener('click', ()=>{
        const key = row.getAttribute('data-perm');
        const cur = row.getAttribute('data-value');
        const next = PERM_ORDER[(PERM_ORDER.indexOf(cur)+1)%PERM_ORDER.length];
        setSetting(key, next);
      });
    });
    const budgetInp = document.getElementById('spBudget');
    if(budgetInp) budgetInp.addEventListener('change', ()=> setSetting('dailyBudgetUsd', parseFloat(budgetInp.value)||0));
    // Text inputs live inside clickable rows for layout reasons — don't let typing/clicking in
    // them bubble up and trigger the row's own click handler (only relevant for .spRow[data-model]
    // rows, but harmless everywhere).
    document.querySelectorAll('#spBody input').forEach(i=> i.addEventListener('click', e=>e.stopPropagation()));

    applyFilter();
  }

  function permRow(label, key, value){
    return '<div class="spRow" data-perm="'+key+'" data-value="'+value+'"><span>'+label+'</span>'
      + '<span class="spRowRight">'+value+' '+icon('chevron-right')+'</span></div>';
  }

  function applyFilter(){
    const q = document.getElementById('spFilter').value.trim().toLowerCase();
    const body = document.getElementById('spBody');
    const children = Array.from(body.children);
    let lastHead = null, headVisible = false;
    for(const el of children){
      if(el.classList.contains('spSecHead')){
        if(lastHead) lastHead.style.display = headVisible ? '' : 'none';
        lastHead = el; headVisible = false;
        continue;
      }
      const match = !q || el.textContent.toLowerCase().includes(q);
      el.style.display = match ? '' : 'none';
      if(match) headVisible = true;
    }
    if(lastHead) lastHead.style.display = headVisible ? '' : 'none';
  }
  document.getElementById('spFilter').addEventListener('input', applyFilter);

  window.addEventListener('message', e=>{
    const m=e.data;
    switch(m.type){
      case 'status': {
        dot.className='dot '+(m.ok?'ok':'bad');
        const providerLabel = m.provider==='openai' ? 'Cloud' : 'Ollama';
        const folderPart = m.folder ? '📁 '+m.folder+' · ' : '⚠️ no folder open · ';
        statusText.textContent=folderPart+(m.ok?'● '+m.model+' ('+providerLabel+') — ':'✕ ')+m.detail;
        document.getElementById('status').title = m.folderPath ? 'Working folder: '+m.folderPath : '';
        break;
      }
      case 'user': addUser(m.text, m.attached); break;
      case 'attachments': pendingAttachments = m.paths || []; renderAttachRow(); break;
      case 'usage': {
        const el = document.getElementById('usage');
        const total = (m.promptTokens||0) + (m.completionTokens||0);
        el.textContent = total.toLocaleString()+' tok';
        el.classList.remove('hidden');
        break;
      }
      case 'budget': {
        const el = document.getElementById('usage');
        const pct = m.budget ? Math.round((m.spent/m.budget)*100) : 0;
        el.textContent = el.textContent + ' · $'+m.spent.toFixed(2)+'/'+m.budget+' ('+pct+'%)';
        el.classList.remove('hidden');
        break;
      }
      case 'assistant-start': assistantStart(); break;
      case 'assistant-delta': assistantDelta(m.text); break;
      case 'assistant-done': assistantDone(m.text); break;
      case 'tool-start': onToolStart(m.name, m.args); break;
      case 'tool-log': onToolLog(m.text); break;
      case 'tool-result': onToolResult(m.name, m.result); break;
      case 'confirm-request': renderConfirmCard(m); break;
      case 'confirm-resolved': if(confirmFinalizers[m.id]) confirmFinalizers[m.id](m.approved); break;
      case 'todos': renderTodos(m.items); break;
      case 'files-changed': renderFilesChanged(m.paths); break;
      case 'step': stepEl.textContent='Step '+m.step+'/'+m.max+'...'; break;
      case 'busy':
        busy=m.busy; sendBtn.disabled=m.busy; sendBtn.textContent=m.busy?'...':'Send';
        if(!m.busy) stepEl.textContent=''; break;
      case 'cleared':
        log.innerHTML=''; hintShown=false; curAssistant=null; openToolCard=null;
        renderTodos([]);
        add('assistant','Agent','🗑️ Started a new conversation.'); break;
      case 'notice': showNotice(m.kind, m.text); break;
      case 'open-settings': openSettings(); break;
      case 'settingsData': renderSettingsPanel(m); break;
      case 'pull-progress': {
        const p = document.getElementById('spPullProgress');
        if(p){ p.classList.remove('hidden'); p.querySelector('span').textContent = m.status + (m.pct ? ' ('+m.pct+'%)' : ''); }
        break;
      }
      case 'pull-done': {
        const btn = document.getElementById('spPullBtn');
        if(btn){ btn.style.pointerEvents = ''; btn.style.opacity = ''; }
        break;
      }
    }
  });
</script>
</body>
</html>`;
}
