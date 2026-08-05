import * as path from "path";
import * as vscode from "vscode";
import { CbpDataManager } from "../services/DataManager";
import { buildUnitTree, filterUnitTree, UnitTreeNode } from "./cbpEditorUtils";

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
      });
    };

    webviewPanel.webview.html = this.getHtml(document.uri, model());
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
    });
  }

  private getHtml(uri: vscode.Uri, initialModel: { targets: string[]; units: string[] }): string {
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
      <div class="files-toolbar"><input id="search" class="search" type="search" placeholder="搜索工程文件..." aria-label="搜索工程文件"/><button id="add">添加已有文件...</button></div>
      <p>文件对所有 Target 共享。右键文件可移出工程，不会删除磁盘文件。</p>
      <ul id="tree" class="tree">${treeHtml || "<li class=\"empty\">暂无工程文件</li>"}</ul><div id="no-match" class="empty" hidden>没有找到匹配的工程文件</div><div id="result-status" aria-live="polite"></div>
      <div id="context-menu"><button id="remove-action">移出工程</button></div>
      <script nonce="${nonce}">
      const api=acquireVsCodeApi(); let currentFile=null; const basePath=${JSON.stringify(path.dirname(uri.fsPath))};
      const tree=document.getElementById('tree'), noMatch=document.getElementById('no-match'), resultStatus=document.getElementById('result-status'), search=document.getElementById('search'), menu=document.getElementById('context-menu');
      const target=document.getElementById('target'), detail=document.getElementById('mode-detail');
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
      function renderModel(m){const folderState=saveFolderState();const selected=m.selectedTarget||m.model.targets[0]||'';target.innerHTML=m.model.targets.map(t=>'<option value="'+esc(t)+'" '+(t===selected?'selected':'')+'>'+esc(t)+'</option>').join('')||'<option>无 Target</option>';document.getElementById('current-mode').checked=!m.buildAll;document.getElementById('all-mode').checked=m.buildAll;tree.innerHTML=m.treeHtml||'<li class="empty">暂无工程文件</li>';restoreFolderState(folderState);bindRows();updateMode();}
      window.addEventListener('message',event=>{const m=event.data;if(m.command==='updateModel')renderModel(m);});
      </script></body></html>`;
  }

  private async addUnit(document: vscode.TextDocument): Promise<void> {
    const selected = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "添加到 CBP 工程" });
    if (!selected?.length) {
      return;
    }
    const projectDir = vscode.Uri.file(document.uri.fsPath.replace(/[\\/][^\\/]+$/, "")).fsPath;
    const projectPrefix = `${projectDir}${process.platform === "win32" ? "\\" : "/"}`;
    const existing = new Set(getUnits(document.getText()).map((unit) => unit.replace(/\\/g, "/")));
    const additions = selected
      .map((uri) => vscode.Uri.file(uri.fsPath).fsPath)
      .map((file) => file.startsWith(projectPrefix) ? file.slice(projectPrefix.length).replace(/\\/g, "/") : file.replace(/\\/g, "/"))
      .filter((file) => !existing.has(file));
    if (!additions.length) {
      return;
    }
    const newline = document.getText().includes("\r\n") ? "\r\n" : "\n";
    const indentMatch = document.getText().match(/\r?\n(\s*)<Unit\b/);
    const indent = indentMatch?.[1] || "    ";
    const insertion = additions.map((file) => `${indent}<Unit filename="${file.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" />`).join(newline) + newline;
    const projectClose = document.getText().lastIndexOf("</Project>");
    if (projectClose < 0) {
      vscode.window.showErrorMessage("CBP 文件中未找到 </Project>");
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, document.positionAt(projectClose), insertion);
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
