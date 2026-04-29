import * as vscode from 'vscode';
import * as path from 'path';

export class CompileCommandsItem extends vscode.TreeItem {
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
        this.contextValue = 'compileCommands';
        this.resourceUri = vscode.Uri.file(fsPath);
        this.command = {
            command: 'vscode.open',
            title: 'Open',
            arguments: [this.resourceUri]
        };

        if (showCheckbox) {
            this.checkboxState = isChecked
                ? vscode.TreeItemCheckboxState.Checked
                : vscode.TreeItemCheckboxState.Unchecked;
        }
    }
}
