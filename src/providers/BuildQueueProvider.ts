import * as vscode from 'vscode';
import * as path from 'path';
import { CbpDataManager } from '../services';
import { CbpProjectItem, DirectoryItem } from '../models/items';

// --- 上方视图 Provider: 构建队列 (扁平列表 + 拖拽) ---

export class BuildQueueProvider implements vscode.TreeDataProvider<CbpProjectItem>, vscode.TreeDragAndDropController<CbpProjectItem> {
    dropMimeTypes = ['application/vnd.code.tree.cbpBuildQueue'];
    dragMimeTypes = ['application/vnd.code.tree.cbpBuildQueue'];

    constructor(private manager: CbpDataManager) {
        manager.onDidChangeTreeData(() => this._onDidChangeTreeData.fire());
    }

    private _onDidChangeTreeData = new vscode.EventEmitter<CbpProjectItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: CbpProjectItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CbpProjectItem): vscode.ProviderResult<CbpProjectItem[]> {
        // 扁平列表，没有子节点
        if (element) {return Promise.resolve([]);}
        return Promise.resolve(this.manager.getQueueItems());
    }

    // 拖拽处理
    handleDrag(source: readonly CbpProjectItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        const itemPaths = source.map(item => item.fsPath);
        dataTransfer.set('application/vnd.code.tree.cbpBuildQueue', new vscode.DataTransferItem(itemPaths));
    }

    handleDrop(target: CbpProjectItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        const transferItem = dataTransfer.get('application/vnd.code.tree.cbpBuildQueue');
        if (!transferItem) {return;}

        const sourcePaths: string[] = transferItem.value;
        const queue = this.manager.getQueueItems();
        const sourceItems = queue.filter(p => sourcePaths.includes(p.fsPath));

        this.manager.moveQueueItem(sourceItems, target);
    }
}
