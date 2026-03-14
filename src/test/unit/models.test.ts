import * as assert from 'assert';
import * as vscode from 'vscode';
import { CbpProjectItem, DirectoryItem } from '../../models/items';

suite('Models Test Suite', () => {
    // ==================== CbpProjectItem ====================

    test('CbpProjectItem: should create with required properties', () => {
        const item = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', true);

        assert.strictEqual(item.label, 'TestProject');
        assert.strictEqual(item.fsPath, 'C:/projects/test.cbp');
        assert.strictEqual(item.isChecked, true);
    });

    test('CbpProjectItem: should set tooltip', () => {
        const item = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', true);

        // tooltip can be string or MarkdownString
        const tooltipText = typeof item.tooltip === 'string' ? item.tooltip : item.tooltip?.value;
        assert.ok(tooltipText?.includes('TestProject'));
        assert.ok(tooltipText?.includes('C:/projects/test.cbp'));
    });

    test('CbpProjectItem: should set description to parent folder name', () => {
        const item = new CbpProjectItem('TestProject', 'C:/projects/myproject/test.cbp', true);

        assert.strictEqual(item.description, 'myproject');
    });

    test('CbpProjectItem: should set contextValue', () => {
        const item = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', true);

        assert.strictEqual(item.contextValue, 'cbpProject');
    });

    test('CbpProjectItem: should set checkbox state when showCheckbox is true', () => {
        const checkedItem = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', true, vscode.TreeItemCollapsibleState.None, true);
        const uncheckedItem = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', false, vscode.TreeItemCollapsibleState.None, true);

        assert.strictEqual(checkedItem.checkboxState, vscode.TreeItemCheckboxState.Checked);
        assert.strictEqual(uncheckedItem.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
    });

    test('CbpProjectItem: should not set checkbox state when showCheckbox is false', () => {
        const item = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', true, vscode.TreeItemCollapsibleState.None, false);

        assert.strictEqual(item.checkboxState, undefined);
    });

    test('CbpProjectItem: should set resourceUri', () => {
        const item = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', true);

        assert.ok(item.resourceUri);
        assert.strictEqual(item.resourceUri?.fsPath, 'C:/projects/test.cbp');
    });

    test('CbpProjectItem: should handle different collapsible states', () => {
        const noneItem = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', true, vscode.TreeItemCollapsibleState.None);
        const collapsedItem = new CbpProjectItem('TestProject', 'C:/projects/test.cbp', true, vscode.TreeItemCollapsibleState.Collapsed);

        assert.strictEqual(noneItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
        assert.strictEqual(collapsedItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });

    // ==================== DirectoryItem ====================

    test('DirectoryItem: should create with required properties', () => {
        const item = new DirectoryItem('MyFolder', 'C:/projects/myfolder');

        assert.strictEqual(item.label, 'MyFolder');
        assert.strictEqual(item.fsPath, 'C:/projects/myfolder');
    });

    test('DirectoryItem: should default to collapsed state', () => {
        const item = new DirectoryItem('MyFolder', 'C:/projects/myfolder');

        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('DirectoryItem: should set contextValue', () => {
        const item = new DirectoryItem('MyFolder', 'C:/projects/myfolder');

        assert.strictEqual(item.contextValue, 'directory');
    });

    test('DirectoryItem: should set folder icon', () => {
        const item = new DirectoryItem('MyFolder', 'C:/projects/myfolder');

        assert.ok(item.iconPath);
    });

    test('DirectoryItem: should set resourceUri', () => {
        const item = new DirectoryItem('MyFolder', 'C:/projects/myfolder');

        assert.ok(item.resourceUri);
        assert.strictEqual(item.resourceUri?.fsPath, 'C:/projects/myfolder');
    });
});
