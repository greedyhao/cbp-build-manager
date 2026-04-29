import * as vscode from 'vscode';
import { CbpDataManager } from '../services';
import { CompileCommandsItem } from '../models/CompileCommandsItem';

export class CompileCommandsProvider implements vscode.TreeDataProvider<CompileCommandsItem> {
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
}
