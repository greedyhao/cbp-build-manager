import * as path from "path";
import * as vscode from "vscode";
import { CbpDataManager } from "../services/DataManager";
import {
  buildUnitTree,
  CompilerLinkerEntry,
  encodeXmlAttr,
  extractCompilerLinkerSections,
  extractUnitEntries,
  filterUnitTree,
  planUnitInsertions,
  rewriteSectionBody,
  toCbpRelativePath,
  UnitTreeNode,
} from "./cbpEditorUtils";

const unitPattern = /<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/Unit>|<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*\/>/gi;
const targetPattern = /<Target\b[^>]*\btitle\s*=\s*["']([^"']+)["'][^>]*>/gi;

function getUnits(text: string): string[] {
  return Array.from(text.matchAll(unitPattern), (match) => match[1] || match[2]);
}

function getTargets(text: string): string[] {
  return Array.from(text.matchAll(targetPattern), (match) => match[1]);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] || char);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Serialize a Compiler/Linker entry for the webview (offsets are positional). */
function serializeClEntry(entry: CompilerLinkerEntry) {
  return { kind: entry.kind, value: entry.value, offset: entry.offset };
}

function renderTreeNode(node: UnitTreeNode, depth: number, parentKey = ""): string {
  if (node.path !== undefined) {
    return `<li class="file-row" data-file="${escapeHtml(node.path)}" data-search="${escapeHtml(`${node.path} ${node.displayPath || node.path}`.toLocaleLowerCase())}" title="${escapeHtml(node.path)}" tabindex="0"><span class="file-icon">$(file)</span><span>${escapeHtml(node.name)}</span></li>`;
  }
  const folderKey = parentKey ? `${parentKey}/${node.name}` : node.name;
  const children = node.children.map((child) => renderTreeNode(child, depth + 1, folderKey)).join("");
  return `<li class="folder-row" data-folder="${escapeHtml(folderKey)}"><details ${depth === 0 ? "open" : ""}><summary><span class="folder-icon">$(folder)</span>${escapeHtml(node.name)}</summary><ul>${children}</ul></details></li>`;
}

export class CbpEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "cbp-build-manager.cbpEditor";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: CbpDataManager,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };

    const model = () => ({
      targets: getTargets(document.getText()),
      units: getUnits(document.getText()),
    });
    const postModel = () => {
      const currentModel = model();
      webviewPanel.webview.postMessage({
        command: "updateModel",
        model: currentModel,
        treeHtml: buildUnitTree(currentModel.units, path.dirname(document.uri.fsPath))
          .map((node) => renderTreeNode(node, 0))
          .join(""),
        selectedTarget: this.manager.getTargetSelection(document.uri.fsPath),
        buildAll: this.manager.getBuildAllTargets(document.uri.fsPath),
        clSections: serializeSections(),
      });
    };

    const serializeSections = () =>
      extractCompilerLinkerSections(document.getText()).map((section) => ({
        projectLevel: section.projectLevel,
        target: section.target,
        compiler: section.compiler.map(serializeClEntry),
        linker: section.linker.map(serializeClEntry),
      }));

    webviewPanel.webview.html = this.getHtml(document.uri, model(), serializeSections());
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        postModel();
      }
    });
    const treeSubscription = this.manager.onDidChangeTreeData(postModel);
    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      treeSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === "webviewReady") {
        postModel();
        return;
      }
      if (message.command === "openText") {
        await vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
        return;
      }
      if (message.command === "removeUnit" && typeof message.filename === "string") {
        const choice = await vscode.window.showWarningMessage(
          `确认从工程中移出 ${message.filename}？（不会删除磁盘文件）`,
          { modal: true },
          "移出工程",
        );
        if (choice === "移出工程") {
          await this.removeUnit(document, message.filename);
        }
        return;
      }
      if (message.command === "addUnit") {
        await this.addUnit(document);
        return;
      }
      if (message.command === "selectTarget" && typeof message.target === "string") {
        this.manager.setTargetSelection(document.uri.fsPath, message.target);
        return;
      }
      if (message.command === "toggleBuildAll" && typeof message.enabled === "boolean") {
        this.manager.setBuildAllTargets(document.uri.fsPath, message.enabled);
      }
      if (message.command === "clUpdate" && this.isValidClUpdate(message)) {
        await this.applyClUpdate(document, message);
      }
    });
  }

  private isValidClUpdate(message: {
    scope: unknown;
    target: unknown;
    section: unknown;
    removed: unknown;
    updated: unknown;
    added: unknown;
  }): boolean {
    if ((message.scope !== "project" && message.scope !== "target") || typeof message.target !== "string") {
      return false;
    }
    if (message.section !== "compiler" && message.section !== "linker") {
      return false;
    }
    if (!Array.isArray(message.removed) || message.removed.some((value) => typeof value !== "number")) {
      return false;
    }
    if (
      !Array.isArray(message.added) ||
      message.added.some(
        (item) =>
          !item ||
          (item.kind !== "option" && item.kind !== "library" && item.kind !== "directory") ||
          typeof item.value !== "string"
      )
    ) {
      return false;
    }
    if (
      message.updated === null ||
      typeof message.updated !== "object" ||
      Object.entries(message.updated).some(
        ([key, value]) => !/^\d+$/.test(key) || typeof value !== "string",
      )
    ) {
      return false;
    }
    return true;
  }

  /**
   * Apply add/remove/edit changes to a project-level or target-level
   * Compiler/Linker section in one text edit, reusing the section's own
   * indentation and newline style.
   */
  private async applyClUpdate(
    document: vscode.TextDocument,
    message: {
      scope: "project" | "target";
      target: string;
      section: "compiler" | "linker";
      removed: number[];
      updated: Record<string, string>;
      added: Array<{ kind: CompilerLinkerEntry["kind"]; value: string }>;
    },
  ): Promise<void> {
    const text = document.getText();
    const sections = extractCompilerLinkerSections(text);
    const scope = message.scope === "project" ? undefined : message.target;
    const match = sections.find(
      (section) =>
        section.projectLevel === (scope === undefined) &&
        (scope === undefined || section.target === scope),
    );
    if (!match) {
      vscode.window.showErrorMessage("未找到对应的 Compiler/Linker 配置段");
      return;
    }
    const sectionName = message.section === "compiler" ? "Compiler" : "Linker";
    const scopePattern = message.scope === "project"
      ? /<Project\b[^>]*>/i
      : new RegExp(`<Target\\b[^>]*\\btitle\\s*=\\s*["']${escapeRegExp(message.target)}["'][^>]*>`, "i");
    const scopeMatch = scopePattern.exec(text);
    if (!scopeMatch) {
      vscode.window.showErrorMessage("未找到对应的配置段位置");
      return;
    }
    const sectionPattern = new RegExp(
      `<${sectionName}\\b[^>]*>([\\s\\S]*?)</${sectionName}\\s*>`,
      "i",
    );
    const searchStart = scopeMatch.index;
    const sectionMatch = sectionPattern.exec(text.slice(searchStart));
    if (!sectionMatch) {
      vscode.window.showErrorMessage("未找到对应的 Compiler/Linker 配置段");
      return;
    }
    const tagStart = searchStart + sectionMatch.index;
    const openTagEnd = tagStart + sectionMatch[0].indexOf(">") + 1;
    const closeTagStart = tagStart + sectionMatch[0].lastIndexOf("</");
    const sectionStart = openTagEnd;
    const sectionEnd = closeTagStart;
    const entries = message.section === "compiler" ? match.compiler : match.linker;
    const sectionText = text.slice(sectionStart, sectionEnd);
    const newline = sectionText.includes("\r\n") ? "\r\n" : text.includes("\r\n") ? "\r\n" : "\n";
    const anyEntry = entries[0];
    const indentMatch = sectionText.match(/\r?\n([ \t]*)<Add\b/i);
    const indent = indentMatch?.[1] || anyEntry?.indent || "        ";
    const body = rewriteSectionBody(
      sectionText,
      sectionStart,
      entries,
      message.removed,
      new Map(Object.entries(message.updated).map(([key, value]) => [Number(key), value])),
      message.added,
      indent,
      newline,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(sectionStart), document.positionAt(sectionEnd)),
      body,
    );
    await vscode.workspace.applyEdit(edit);
  }

  private getHtml(
    uri: vscode.Uri,
    initialModel: { targets: string[]; units: string[] },
    clSections: Array<{
      projectLevel: boolean;
      target?: string;
      compiler: Array<{ kind: string; value: string; offset: number }>;
      linker: Array<{ kind: string; value: string; offset: number }>;
    }>,
  ): string {
    const nonce = Math.random().toString(36).slice(2);
    const fsPath = uri.fsPath;
    const selected = this.manager.getTargetSelection(fsPath) || initialModel.targets[0] || "";
    const buildAll = this.manager.getBuildAllTargets(fsPath);
    const tree = buildUnitTree(initialModel.units, path.dirname(uri.fsPath));
    const treeHtml = tree.map((node) => renderTreeNode(node, 0)).join("");
    const targetOptions = initialModel.targets
      .map((target) => `<option value="${escapeHtml(target)}" ${target === selected ? "selected" : ""}>${escapeHtml(target)}</option>`)
      .join("");
    const allTargetText = initialModel.targets.map(escapeHtml).join(" → ");
    const initialCl = JSON.stringify(clSections).replace(/</g, "\\u003c");

    return `<!doctype html><html><head><meta charset="utf-8"><meta
      http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
      <style>
      body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)}
      button,input,select{font:inherit}.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      label{display:flex;align-items:center;gap:5px}.mode{display:flex;flex-direction:column;gap:5px;padding:8px 12px;border:1px solid var(--vscode-panel-border);border-radius:4px}
      .mode-line{display:flex;align-items:center;gap:6px}.mode-detail{color:var(--vscode-descriptionForeground);font-size:.9em;margin-left:22px}
      .files-toolbar{display:flex;gap:8px;align-items:center;margin:12px 0}.search{flex:1;min-width:180px;padding:4px 7px}
      .tree{list-style:none;margin:0;padding:0}.tree ul{list-style:none;margin:0;padding-left:18px}.tree li{margin:2px 0}
      summary{cursor:pointer;padding:3px 4px;border-radius:3px;list-style:none}.file-row{display:flex;gap:6px;align-items:center;cursor:context-menu;padding:3px 4px;border-radius:3px}
      .search-hit{background:var(--vscode-editor-findMatchHighlightBackground);outline:1px solid var(--vscode-focusBorder)}
      .file-row[hidden],.folder-row[hidden]{display:none}
      #result-status{min-height:1.3em;color:var(--vscode-descriptionForeground);font-size:.9em}
      #context-menu{position:fixed;display:none;z-index:10;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);box-shadow:0 2px 8px #0005;padding:4px 0}
      #context-menu button{display:block;width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:6px 18px;cursor:pointer}#context-menu button:hover{background:var(--vscode-menu-selectionBackground)}
      .cl{margin-top:18px;border-top:1px solid var(--vscode-panel-border);padding-top:10px}
      .cl h3{margin:8px 0 6px;font-size:1em}.cl .cl-body{display:flex;flex-direction:column;gap:14px}
      .cl-group{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:8px 10px}
      .cl-group summary{font-weight:600;cursor:pointer}.cl-group .cl-table{margin-top:6px}
      .cl-row{display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap}
      .cl-row select,.cl-row input{padding:3px 6px}.cl-row input.cl-value{flex:1;min-width:160px}
      .cl-row .cl-del{cursor:pointer}.cl-empty{color:var(--vscode-descriptionForeground);margin:4px 0}
      .cl-add{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.cl-add input{flex:1;min-width:160px;padding:3px 6px}
      .cl-hint{color:var(--vscode-descriptionForeground);font-size:.9em;margin:6px 0 0}
      .tabs{display:flex;gap:2px;margin:18px 0 0;border-bottom:1px solid var(--vscode-panel-border)}
      .tab{border:1px solid transparent;border-bottom:none;background:transparent;color:var(--vscode-descriptionForeground);padding:6px 14px;cursor:pointer;border-radius:4px 4px 0 0}
      .tab.active{background:var(--vscode-editor-background);color:var(--vscode-foreground);border-color:var(--vscode-panel-border);font-weight:600}
      .tab-page[hidden]{display:none}.tab-page{padding-top:12px}
      </style></head><body>
      <h2>${escapeHtml(uri.path.split(/[\\/]/).pop() || "CBP 工程")}</h2>
      <div class="bar">
        <div class="mode">
          <strong>构建模式</strong>
          <label class="mode-line"><input type="radio" name="target-mode" id="current-mode" ${buildAll ? "" : "checked"}/>当前 Target</label>
          <label class="mode-line"><input type="radio" name="target-mode" id="all-mode" ${buildAll ? "checked" : ""}/>全部 Target</label>
          <div class="mode-detail" id="mode-detail">${buildAll ? allTargetText || "无 Target" : `当前：${escapeHtml(selected || "无 Target")}`}</div>
        </div>
        <label>Target <select id="target" ${buildAll ? "disabled" : ""}>${targetOptions || "<option>无 Target</option>"}</select></label>
        <button id="text">以文本方式打开</button>
      </div>
      <div class="tabs">
        <button class="tab active" id="tab-files" role="tab">工程文件</button>
        <button class="tab" id="tab-compiler" role="tab">Compiler 配置</button>
        <button class="tab" id="tab-linker" role="tab">Linker 配置</button>
      </div>
      <div class="tab-page" id="page-files">
      <div class="files-toolbar"><input id="search" class="search" type="search" placeholder="搜索工程文件..." aria-label="搜索工程文件"/><button id="add">添加已有文件...</button></div>
      <p>文件对所有 Target 共享。右键文件可移出工程，不会删除磁盘文件。</p>
      <ul id="tree" class="tree">${treeHtml || "<li class=\"empty\">暂无工程文件</li>"}</ul><div id="no-match" class="empty" hidden>没有找到匹配的工程文件</div><div id="result-status" aria-live="polite"></div>
      </div>
      <div class="tab-page" id="page-compiler" hidden>
        <p class="cl-hint">编辑编译器配置：全局对所有 Target 生效；Target 级覆盖合并到全局之后。支持 option（命令行选项）、library、directory 三种属性，留空值后保存会删除该行。</p>
        <div class="cl-body" data-section="compiler"></div>
      </div>
      <div class="tab-page" id="page-linker" hidden>
        <p class="cl-hint">编辑链接器配置：全局对所有 Target 生效；Target 级覆盖合并到全局之后。支持 option（链接选项，如 -T$(TARGET_OBJECT_DIR)ram.o）、library（链接库）、directory（库搜索目录），留空值后保存会删除该行。</p>
        <div class="cl-body" data-section="linker"></div>
      </div>
      <div id="context-menu"><button id="remove-action">移出工程</button></div>
      <script nonce="${nonce}">
      const api=acquireVsCodeApi(); let currentFile=null; const basePath=${JSON.stringify(path.dirname(uri.fsPath))};
      const initialClSections=${initialCl};
      const tree=document.getElementById('tree'), noMatch=document.getElementById('no-match'), resultStatus=document.getElementById('result-status'), search=document.getElementById('search'), menu=document.getElementById('context-menu');
      const target=document.getElementById('target'), detail=document.getElementById('mode-detail');
      const clBodies={compiler:document.querySelector('.cl-body[data-section=\"compiler\"]'),linker:document.querySelector('.cl-body[data-section=\"linker\"]')};
      let clState=[];
      const CL_KINDS=[['option','option 选项'],['library','library 链接库'],['directory','directory 目录']];
      function hideMenu(){menu.style.display='none';currentFile=null;}
      function saveFolderState(){const state={};document.querySelectorAll('.folder-row details').forEach(d=>{const key=d.parentElement.dataset.folder;if(key)state[key]=d.open;});return state;}
      function restoreFolderState(state){document.querySelectorAll('.folder-row details').forEach(d=>{const key=d.parentElement.dataset.folder;if(key&&Object.prototype.hasOwnProperty.call(state,key))d.open=state[key];});}
      function applyFilter(){const q=search.value.trim().toLocaleLowerCase();let visible=0;document.querySelectorAll('.file-row').forEach(row=>{const ok=!q||row.dataset.search.includes(q);row.hidden=!ok;if(ok)visible++;});document.querySelectorAll('.folder-row').forEach(folder=>{const has=folder.querySelector('.file-row:not([hidden])');folder.hidden=!has;if(q&&has)folder.querySelector('details').open=true;});noMatch.hidden=visible!==0||!q;resultStatus.textContent=q?(visible?('找到 '+visible+' 个匹配文件'):'没有找到匹配的工程文件') : '';}
      function locateFirstMatch(){applyFilter();const row=document.querySelector('.file-row:not([hidden])');if(!row){resultStatus.textContent='没有找到匹配的工程文件';return;}row.closest('details')&& (row.closest('details').open=true);row.scrollIntoView({block:'nearest'});row.focus();row.classList.add('search-hit');setTimeout(()=>row.classList.remove('search-hit'),1200);resultStatus.textContent='已定位：'+row.dataset.file;}
      function bindRows(){document.querySelectorAll('.file-row').forEach(row=>row.addEventListener('contextmenu',e=>{e.preventDefault();currentFile=row.dataset.file;menu.style.left=Math.min(e.clientX,window.innerWidth-150)+'px';menu.style.top=Math.min(e.clientY,window.innerHeight-45)+'px';menu.style.display='block';}));applyFilter();}
      function updateMode(){const all=document.getElementById('all-mode').checked;target.disabled=all;detail.textContent=all?'${allTargetText}':('当前：'+(target.value||'无 Target'));}
      document.getElementById('text').onclick=()=>api.postMessage({command:'openText'});document.getElementById('add').onclick=()=>api.postMessage({command:'addUnit'});
      target.onchange=()=>{api.postMessage({command:'selectTarget',target:target.value});updateMode();};document.getElementById('current-mode').onchange=()=>{api.postMessage({command:'toggleBuildAll',enabled:false});updateMode();};document.getElementById('all-mode').onchange=()=>{api.postMessage({command:'toggleBuildAll',enabled:true});updateMode();};
      document.getElementById('remove-action').onclick=()=>{if(currentFile)api.postMessage({command:'removeUnit',filename:currentFile});hideMenu();};search.oninput=applyFilter;search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();locateFirstMatch();}else if(e.key==='Escape'){e.preventDefault();search.value='';applyFilter();search.focus();hideMenu();}};document.addEventListener('click',e=>{if(!menu.contains(e.target))hideMenu();});document.addEventListener('keydown',e=>{if(e.key==='Escape')hideMenu();});bindRows();
      function esc(value){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));}
      const tabPages={files:document.getElementById('page-files'),compiler:document.getElementById('page-compiler'),linker:document.getElementById('page-linker')};
      const tabButtons={files:document.getElementById('tab-files'),compiler:document.getElementById('tab-compiler'),linker:document.getElementById('tab-linker')};
      function selectTab(name){Object.keys(tabPages).forEach(key=>{tabPages[key].hidden=key!==name;tabButtons[key].classList.toggle('active',key===name);});}
      Object.entries(tabButtons).forEach(([name,button])=>{button.onclick=()=>selectTab(name);});
      function clSend(section,scope,target,removed,updated,added){api.postMessage({command:'clUpdate',scope,target,section,removed,updated,added});}
      function bindClGroup(container,scope,target,section,items){
        const table=document.createElement('div');table.className='cl-table';
        function send(removed,updated,added){clSend(section,scope,target,removed,updated,added);}
        function render(){
          table.innerHTML='';
          if(!items.length){const empty=document.createElement('div');empty.className='cl-empty';empty.textContent='暂无配置项';table.appendChild(empty);}
          items.forEach((item)=>{
            const row=document.createElement('div');row.className='cl-row';
            const kind=document.createElement('span');kind.textContent=item.kind;kind.className='cl-kind';row.appendChild(kind);
            const input=document.createElement('input');input.className='cl-value';input.value=item.value;input.spellcheck=false;
            input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(input.value!==item.value&&input.value.trim()!=='')send([],[{offset:item.offset,value:input.value}],[]);}};
            input.onchange=()=>{if(input.value.trim()===''){send([item.offset],[],[]);}else if(input.value!==item.value){send([],[{offset:item.offset,value:input.value}],[]);}};
            row.appendChild(input);
            const del=document.createElement('span');del.className='cl-del';del.textContent='✕';del.title='删除该配置项';del.onclick=()=>send([item.offset],[],[]);
            row.appendChild(del);
            table.appendChild(row);
          });
        }
        const addRow=document.createElement('div');addRow.className='cl-add';
        const kindSel=document.createElement('select');
        CL_KINDS.forEach(([value,label])=>{const opt=document.createElement('option');opt.value=value;opt.textContent=label;kindSel.appendChild(opt);});
        const addInput=document.createElement('input');addInput.placeholder='新增值，例如 -Os 或 m，回车添加';addInput.spellcheck=false;
        const addBtn=document.createElement('button');addBtn.textContent='添加';
        function addEntry(){const value=addInput.value.trim();if(!value)return;send([],[],[{kind:kindSel.value,value}]);addInput.value='';}
        addBtn.onclick=addEntry;addInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addEntry();}};
        addRow.appendChild(kindSel);addRow.appendChild(addInput);addRow.appendChild(addBtn);
        container.appendChild(table);container.appendChild(addRow);
        render();
      }
      function renderCl(sections){
        clState=sections||[];
        Object.entries(clBodies).forEach(([sectionKey,body])=>{
          body.innerHTML='';
          let any=false;
          clState.forEach(section=>{
            const scope=section.projectLevel?'project':'target';
            const scopeName=section.projectLevel?'全局（对所有 Target 生效）':('Target：'+section.target);
            const scopeTarget=section.projectLevel?'':(section.target||'');
            const items=sectionKey==='compiler'?section.compiler:section.linker;
            const group=document.createElement('details');group.className='cl-group';group.open=true;
            const summary=document.createElement('summary');summary.textContent=scopeName;group.appendChild(summary);
            bindClGroup(group,scope,scopeTarget,sectionKey,items);
            body.appendChild(group);
            if(items.length)any=true;
          });
          if(!any){const empty=document.createElement('div');empty.className='cl-empty';empty.textContent='CBP 中没有该类配置项';body.appendChild(empty);}
        });
      }
      function renderModel(m){const folderState=saveFolderState();const selected=m.selectedTarget||m.model.targets[0]||'';target.innerHTML=m.model.targets.map(t=>'<option value="'+esc(t)+'" '+(t===selected?'selected':'')+'>'+esc(t)+'</option>').join('')||'<option>无 Target</option>';document.getElementById('current-mode').checked=!m.buildAll;document.getElementById('all-mode').checked=m.buildAll;tree.innerHTML=m.treeHtml||'<li class="empty">暂无工程文件</li>';restoreFolderState(folderState);bindRows();updateMode();if(m.clSections)renderCl(m.clSections);}
      window.addEventListener('message',event=>{const m=event.data;if(m.command==='updateModel')renderModel(m);});
      renderCl(initialClSections);
      api.postMessage({command:'webviewReady'});
      </script></body></html>`;
  }

  private async addUnit(document: vscode.TextDocument): Promise<void> {
    const selected = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "添加到 CBP 工程" });
    if (!selected?.length) {
      return;
    }
    const text = document.getText();
    const projectDir = path.dirname(document.uri.fsPath);
    const existing = new Set(getUnits(text).map((unit) => unit.replace(/\\/g, "/")));
    const additions = selected
      .map((uri) => toCbpRelativePath(projectDir, uri.fsPath))
      .filter((file) => !existing.has(file));
    if (!additions.length) {
      return;
    }
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    // Match the official Code::Blocks layout: <Unit filename="..."> with an
    // <Option compilerVar="CC" /> child, reusing attribute styles already in the file.
    const indentMatch = text.match(/\r?\n([ \t]*)<Unit\b/i);
    const indent = indentMatch?.[1] || "    ";
    const optionAttrs = text.match(/<Unit\b[^>]*>\s*<Option\b([^>]*)\/>/i)?.[1]?.trim();
    const innerIndent = optionAttrs !== undefined ? `${indent}    ` : "";
    const optionLine =
      optionAttrs !== undefined ? `${newline}${innerIndent}<Option ${optionAttrs} />${newline}` : "";
    const projectClose = text.lastIndexOf("</Project>");
    if (projectClose < 0) {
      vscode.window.showErrorMessage("CBP 文件中未找到 </Project>");
      return;
    }
    // Keep <Unit> entries sorted in the file like official Code::Blocks does:
    // insert each new unit before the first existing unit that sorts after it.
    const edit = new vscode.WorkspaceEdit();
    for (const plan of planUnitInsertions(extractUnitEntries(text), additions, projectClose)) {
      const unitOpen = `<Unit filename="${plan.filename.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
      const block = optionLine !== "" ? `${indent}${unitOpen}>${optionLine}${indent}</Unit>${newline}` : `${indent}${unitOpen} />${newline}`;
      edit.insert(document.uri, document.positionAt(plan.offset), block);
    }
    await vscode.workspace.applyEdit(edit);
  }

  private async removeUnit(document: vscode.TextDocument, filename: string): Promise<void> {
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\s*<Unit\\b[^>]*\\bfilename\\s*=\\s*["']${escaped}["'][^>]*>(?:[\\s\\S]*?<\\/Unit>)?\\s*`, "i");
    const match = pattern.exec(document.getText());
    if (!match || match.index === undefined) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.delete(document.uri, new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length)));
    await vscode.workspace.applyEdit(edit);
  }
}
