import * as vscode from 'vscode';
import * as path from 'path';

// 2. CBP 项目节点 (通用于上下视图)
export class CbpProjectItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly fsPath: string,
        public isChecked: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        public readonly showCheckbox: boolean = true
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label}\n${this.fsPath}`;
        this.description = path.basename(path.dirname(this.fsPath));
        this.contextValue = 'cbpProject';
        this.resourceUri = vscode.Uri.file(fsPath);
        this.command = {
            command: 'vscode.open',
            title: 'Open',
            arguments: [this.resourceUri]
        };

        // 设置复选框状态（仅当需要显示复选框时）
        if (showCheckbox) {
            this.checkboxState = isChecked
                ? vscode.TreeItemCheckboxState.Checked
                : vscode.TreeItemCheckboxState.Unchecked;
        }
    }
}

// 1. 普通文件夹节点 (用于下方树视图)
export class DirectoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly fsPath: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'directory';
        this.iconPath = vscode.ThemeIcon.Folder;
        this.resourceUri = vscode.Uri.file(fsPath);
    }
}
