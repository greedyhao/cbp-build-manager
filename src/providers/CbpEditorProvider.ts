import * as vscode from "vscode";
import { CbpDataManager } from "../services/DataManager";

const unitPattern = /<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>\s*<\/Unit>|<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*\/>/gi;
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

    const render = () => {
      const text = document.getText();
      webviewPanel.webview.html = this.getHtml(
        document.uri,
        getTargets(text),
        getUnits(text),
      );
    };
    render();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        render();
      }
    });
    // Target 状态变化时也要刷新下拉框
    const treeSubscription = this.manager.onDidChangeTreeData(render);
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
        await this.removeUnit(document, message.filename);
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
        return;
      }
    });
  }

  private getHtml(uri: vscode.Uri, targets: string[], units: string[]): string {
    const nonce = Math.random().toString(36).slice(2);
    const fsPath = uri.fsPath;
    const selected = this.manager.getTargetSelection(fsPath) || targets[0] || "";
    const buildAll = this.manager.getBuildAllTargets(fsPath);
    const targetOptions = targets
      .map((target) => `<option value="${escapeHtml(target)}" ${target === selected ? "selected" : ""}>${escapeHtml(target)}</option>`)
      .join("");
    const rows = units.map((unit) =>
      `<li><code>${escapeHtml(unit)}</code><button data-file="${escapeHtml(unit)}">移出工程</button></li>`,
    ).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><meta
      http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
      <style>
      body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)}
      button{margin-left:12px}
      li{margin:8px 0}
      .bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
      label{display:flex;align-items:center;gap:6px}
      </style></head><body>
      <h2>${escapeHtml(uri.path.split(/[\\/]/).pop() || "CBP 工程")}</h2>
      <div class="bar">
        <label>当前 Target <select id="target">${targetOptions || "<option>无 Target</option>"}</select></label>
        <label><input type="checkbox" id="all" ${buildAll ? "checked" : ""}/>构建全部 Target</label>
        <button id="add">添加已有文件...</button>
        <button id="text">以文本方式打开</button>
      </div>
      <p>文件对所有 Target 共享。移出工程不会删除磁盘文件。</p>
      <ul>${rows || "<li>暂无工程文件</li>"}</ul>
      <script nonce="${nonce}">
      const api = acquireVsCodeApi();
      document.getElementById('text').onclick=()=>api.postMessage({command:'openText'});
      document.getElementById('add').onclick=()=>api.postMessage({command:'addUnit'});
      document.getElementById('target').onchange=(e)=>api.postMessage({command:'selectTarget',target:e.target.value});
      document.getElementById('all').onchange=(e)=>api.postMessage({command:'toggleBuildAll',enabled:e.target.checked});
      document.querySelectorAll('button[data-file]').forEach(b=>b.onclick=()=>api.postMessage({command:'removeUnit',filename:b.dataset.file}));
      </script></body></html>`;
  }

  private async addUnit(document: vscode.TextDocument): Promise<void> {
    const selected = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "添加到 CBP 工程" });
    if (!selected?.length) {
      return;
    }
    const projectDir = vscode.Uri.file(document.uri.fsPath.replace(/[\\/][^\\/]+$/, "")).fsPath;
    const existing = new Set(getUnits(document.getText()).map((unit) => unit.replace(/\\/g, "/")));
    const additions = selected
      .map((uri) => vscode.Uri.file(uri.fsPath).fsPath)
      .map((file) => (file.startsWith(projectDir) ? file.slice(projectDir.length + 1).replace(/\\/g, "/") : file.replace(/\\/g, "/")))
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
