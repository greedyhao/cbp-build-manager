import * as vscode from 'vscode';
import { CbpDataManager } from '../services';
import { CompileCommandsItem } from '../models/CompileCommandsItem';

export class CompileCommandsProvider implements vscode.TreeDataProvider<CompileCommandsItem>, vscode.TreeDragAndDropController<CompileCommandsItem> {
    dropMimeTypes = ['application/vnd.code.tree.cbpCompileCommands'];
    dragMimeTypes = ['application/vnd.code.tree.cbpCompileCommands'];

    constructor(private manager: CbpDataManager) {
        manager.onDidChangeTreeData(() => this._onDidChangeTreeData.fire());
    }

    private _onDidChangeTreeData = new vscode.EventEmitter<CompileCommandsItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: CompileCommandsItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CompileCommandsItem): vscode.ProviderResult<CompileCommandsItem[]> {
        if (element) { return Promise.resolve([]); }
        return Promise.resolve(this.manager.getCompileCommandsItems());
    }

    handleDrag(source: readonly CompileCommandsItem[], dataTransfer: vscode.DataTransfer): void {
        const itemPaths = source.map(item => item.fsPath);
        dataTransfer.set('application/vnd.code.tree.cbpCompileCommands', new vscode.DataTransferItem(itemPaths));
    }

    handleDrop(target: CompileCommandsItem | undefined, dataTransfer: vscode.DataTransfer): void {
        const transferItem = dataTransfer.get('application/vnd.code.tree.cbpCompileCommands');
        if (!transferItem) { return; }

        const sourcePaths: string[] = transferItem.value;
        const items = this.manager.getCompileCommandsItems();
        const sourceItems = items.filter(p => sourcePaths.includes(p.fsPath));

        this.manager.moveCompileCommandsItem(sourceItems, target);
    }
}
