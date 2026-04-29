import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { CbpProjectItem, DirectoryItem } from '../../models/items';

function getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
}

suite('Models Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(getWorkspaceRoot(), '.cbp-test-'));
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    function p(...segments: string[]): string {
        return path.join(tempDir, ...segments);
    }

    // ==================== CbpProjectItem ====================

    test('CbpProjectItem: should create with required properties', () => {
        const filePath = p('test.cbp');
        const item = new CbpProjectItem('TestProject', filePath, true);

        assert.strictEqual(item.label, 'TestProject');
        assert.strictEqual(item.fsPath, filePath);
        assert.strictEqual(item.isChecked, true);
    });

    test('CbpProjectItem: should set tooltip', () => {
        const filePath = p('test.cbp');
        const item = new CbpProjectItem('TestProject', filePath, true);

        const tooltipText = typeof item.tooltip === 'string' ? item.tooltip : item.tooltip?.value;
        assert.ok(tooltipText?.includes('TestProject'));
        assert.ok(tooltipText?.includes(filePath));
    });

    test('CbpProjectItem: should set description to parent folder name', () => {
        const item = new CbpProjectItem('TestProject', p('myproject', 'test.cbp'), true);

        assert.strictEqual(item.description, 'myproject');
    });

    test('CbpProjectItem: should set contextValue', () => {
        const item = new CbpProjectItem('TestProject', p('test.cbp'), true);

        assert.strictEqual(item.contextValue, 'cbpProject');
    });

    test('CbpProjectItem: should set checkbox state when showCheckbox is true', () => {
        const filePath = p('test.cbp');
        const checkedItem = new CbpProjectItem('TestProject', filePath, true, vscode.TreeItemCollapsibleState.None, true);
        const uncheckedItem = new CbpProjectItem('TestProject', filePath, false, vscode.TreeItemCollapsibleState.None, true);

        assert.strictEqual(checkedItem.checkboxState, vscode.TreeItemCheckboxState.Checked);
        assert.strictEqual(uncheckedItem.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
    });

    test('CbpProjectItem: should not set checkbox state when showCheckbox is false', () => {
        const item = new CbpProjectItem('TestProject', p('test.cbp'), true, vscode.TreeItemCollapsibleState.None, false);

        assert.strictEqual(item.checkboxState, undefined);
    });

    test('CbpProjectItem: should set resourceUri', () => {
        const filePath = p('test.cbp');
        const item = new CbpProjectItem('TestProject', filePath, true);

        assert.ok(item.resourceUri);
        assert.strictEqual(path.normalize(item.resourceUri!.fsPath).toLowerCase(), path.normalize(filePath).toLowerCase());
    });

    test('CbpProjectItem: should handle different collapsible states', () => {
        const filePath = p('test.cbp');
        const noneItem = new CbpProjectItem('TestProject', filePath, true, vscode.TreeItemCollapsibleState.None);
        const collapsedItem = new CbpProjectItem('TestProject', filePath, true, vscode.TreeItemCollapsibleState.Collapsed);

        assert.strictEqual(noneItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
        assert.strictEqual(collapsedItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });

    // ==================== DirectoryItem ====================

    test('DirectoryItem: should create with required properties', () => {
        const folderPath = p('myfolder');
        const item = new DirectoryItem('MyFolder', folderPath);

        assert.strictEqual(item.label, 'MyFolder');
        assert.strictEqual(item.fsPath, folderPath);
    });

    test('DirectoryItem: should default to collapsed state', () => {
        const item = new DirectoryItem('MyFolder', p('myfolder'));

        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('DirectoryItem: should set contextValue', () => {
        const item = new DirectoryItem('MyFolder', p('myfolder'));

        assert.strictEqual(item.contextValue, 'directory');
    });

    test('DirectoryItem: should set folder icon', () => {
        const item = new DirectoryItem('MyFolder', p('myfolder'));

        assert.ok(item.iconPath);
    });

    test('DirectoryItem: should set resourceUri', () => {
        const folderPath = p('myfolder');
        const item = new DirectoryItem('MyFolder', folderPath);

        assert.ok(item.resourceUri);
        assert.strictEqual(path.normalize(item.resourceUri!.fsPath).toLowerCase(), path.normalize(folderPath).toLowerCase());
    });
});
