import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CbpDataManager } from '../../services';

// Mock vscode.Memento
class MockMemento {
    private data: Record<string, unknown> = {};

    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.data[key] as T) ?? defaultValue;
    }

    update(key: string, value: unknown): Thenable<void> {
        this.data[key] = value;
        return Promise.resolve();
    }
}

function createMockContext(): vscode.ExtensionContext {
    const mockMemento = new MockMemento();
    return {
        globalState: mockMemento,
        subscriptions: [],
        workspaceState: mockMemento,
        extensionPath: '',
        asAbsolutePath: (relativePath: string) => relativePath,
    } as unknown as vscode.ExtensionContext;
}

function getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
}

suite('DataManager Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(getWorkspaceRoot(), '.cbp-test-'));
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    function makePath(name: string): string {
        return path.join(tempDir, name);
    }

    // ==================== addToQueue ====================

    test('addToQueue: should add items to queue', () => {
        const manager = new CbpDataManager();
        const p = makePath('test.cbp');
        manager.setAllDetectedProjects([p]);
        manager.addToQueue([p]);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, p);
        assert.strictEqual(queue[0].label, 'test');
    });

    test('addToQueue: should not add duplicate items', () => {
        const manager = new CbpDataManager();
        const p = makePath('test.cbp');
        manager.setAllDetectedProjects([p]);
        manager.addToQueue([p]);
        manager.addToQueue([p]);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 1);
    });

    test('addToQueue: should add multiple items', () => {
        const manager = new CbpDataManager();
        const p1 = makePath('test1.cbp');
        const p2 = makePath('test2.cbp');
        manager.setAllDetectedProjects([p1, p2]);
        manager.addToQueue([p1, p2]);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 2);
    });

    // ==================== removeFromQueue ====================

    test('removeFromQueue: should remove items from queue', () => {
        const manager = new CbpDataManager();
        const p = makePath('test.cbp');
        manager.setAllDetectedProjects([p]);
        manager.addToQueue([p]);

        const queueItem = manager.getQueueItems()[0];
        manager.removeFromQueue([queueItem]);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 0);
    });

    test('removeFromQueue: should only remove specified items', () => {
        const manager = new CbpDataManager();
        const p1 = makePath('test1.cbp');
        const p2 = makePath('test2.cbp');
        manager.setAllDetectedProjects([p1, p2]);
        manager.addToQueue([p1, p2]);

        const queueItems = manager.getQueueItems();
        manager.removeFromQueue([queueItems[0]]);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, p2);
    });

    // ==================== moveQueueItem ====================

    test('moveQueueItem: should reorder queue items', () => {
        const manager = new CbpDataManager();
        const p1 = makePath('test1.cbp');
        const p2 = makePath('test2.cbp');
        const p3 = makePath('test3.cbp');
        manager.setAllDetectedProjects([p1, p2, p3]);
        manager.addToQueue([p1, p2, p3]);

        const queueItems = manager.getQueueItems();
        // Move test1 to end (no target = append)
        manager.moveQueueItem([queueItems[0]], undefined);

        const newQueue = manager.getQueueItems();
        assert.strictEqual(newQueue[0].fsPath, p2);
        assert.strictEqual(newQueue[1].fsPath, p3);
        assert.strictEqual(newQueue[2].fsPath, p1);
    });

    test('moveQueueItem: should move items to end when target is undefined', () => {
        const manager = new CbpDataManager();
        const p1 = makePath('test1.cbp');
        const p2 = makePath('test2.cbp');
        const p3 = makePath('test3.cbp');
        manager.setAllDetectedProjects([p1, p2, p3]);
        manager.addToQueue([p1, p2, p3]);

        const queueItems = manager.getQueueItems();
        manager.moveQueueItem([queueItems[0]], undefined);

        const newQueue = manager.getQueueItems();
        assert.strictEqual(newQueue.length, 3);
        assert.strictEqual(newQueue[0].fsPath, p2);
        assert.strictEqual(newQueue[1].fsPath, p3);
        assert.strictEqual(newQueue[2].fsPath, p1);
    });

    test('moveQueueItem: should move multiple items to end when target is undefined', () => {
        const manager = new CbpDataManager();
        const p1 = makePath('test1.cbp');
        const p2 = makePath('test2.cbp');
        const p3 = makePath('test3.cbp');
        const p4 = makePath('test4.cbp');
        manager.setAllDetectedProjects([p1, p2, p3, p4]);
        manager.addToQueue([p1, p2, p3, p4]);

        const queueItems = manager.getQueueItems();
        manager.moveQueueItem([queueItems[0], queueItems[1]], undefined);

        const newQueue = manager.getQueueItems();
        assert.strictEqual(newQueue.length, 4);
        assert.strictEqual(newQueue[0].fsPath, p3);
        assert.strictEqual(newQueue[1].fsPath, p4);
        assert.strictEqual(newQueue[2].fsPath, p1);
        assert.strictEqual(newQueue[3].fsPath, p2);
    });

    // ==================== getAvailableItems ====================

    test('getAvailableItems: should return items not in queue', () => {
        const manager = new CbpDataManager();
        const p1 = makePath('test1.cbp');
        const p2 = makePath('test2.cbp');
        const p3 = makePath('test3.cbp');
        manager.setAllDetectedProjects([p1, p2, p3]);
        manager.addToQueue([p1]);

        const available = manager.getAvailableItems();
        assert.strictEqual(available.length, 2);
        assert.ok(available.includes(p2));
        assert.ok(available.includes(p3));
        assert.ok(!available.includes(p1));
    });

    test('getAvailableItems: should return all when queue is empty', () => {
        const manager = new CbpDataManager();
        const p1 = makePath('test1.cbp');
        const p2 = makePath('test2.cbp');
        manager.setAllDetectedProjects([p1, p2]);

        const available = manager.getAvailableItems();
        assert.strictEqual(available.length, 2);
    });

    // ==================== updateCheckState ====================

    test('updateCheckState: should update checkbox state', () => {
        const manager = new CbpDataManager();
        const p = makePath('test.cbp');
        manager.setAllDetectedProjects([p]);
        manager.addToQueue([p]);

        const queueItem = manager.getQueueItems()[0];
        manager.updateCheckState(queueItem, vscode.TreeItemCheckboxState.Unchecked);

        assert.strictEqual(queueItem.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
        assert.strictEqual(queueItem.isChecked, false);
    });

    // ==================== persistence ====================

    test('should persist queue order to file', () => {
        const manager = new CbpDataManager();
        const stateFile = path.join(tempDir, '.cbp-build', 'queue.json');
        manager.setStateFilePath(stateFile);

        const p1 = makePath('test1.cbp');
        const p2 = makePath('test2.cbp');
        manager.setAllDetectedProjects([p1, p2]);
        manager.addToQueue([p1, p2]);

        // Reorder: move p1 to end
        const queueItems = manager.getQueueItems();
        manager.moveQueueItem([queueItems[0]], undefined);

        // Verify file was created
        assert.ok(fs.existsSync(stateFile));

        // Verify file content
        const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        assert.strictEqual(savedState.queuePaths.length, 2);
        assert.strictEqual(savedState.queuePaths[0], p2);
    });

    test('should load state from file', () => {
        // Create state file with pre-existing data
        const stateDir = path.join(tempDir, '.cbp-build');
        fs.mkdirSync(stateDir, { recursive: true });
        const stateFile = path.join(stateDir, 'queue.json');

        // Create a .cbp file in temp dir so it passes existsSync check
        const projectPath = makePath('project.cbp');
        fs.writeFileSync(projectPath, '');
        fs.writeFileSync(stateFile, JSON.stringify({
            queuePaths: [projectPath],
            checkState: { [projectPath]: false }
        }), 'utf-8');

        // Create new manager to test loading
        const manager2 = new CbpDataManager();
        manager2.setStateFilePath(stateFile);
        manager2.reloadState();

        const queue = manager2.getQueueItems();
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, projectPath);
    });

    test('loadState: should filter out non-existent projects', () => {
        // Create state file with a non-existent project
        const stateDir = path.join(tempDir, '.cbp-build');
        fs.mkdirSync(stateDir, { recursive: true });
        const stateFile = path.join(stateDir, 'queue.json');

        // Create an existing .cbp file
        const existingPath = makePath('existing.cbp');
        fs.writeFileSync(existingPath, '');

        // Create state with one existing and one non-existent file
        fs.writeFileSync(stateFile, JSON.stringify({
            queuePaths: [existingPath, makePath('nonexistent.cbp')],
            checkState: {}
        }), 'utf-8');

        // Create new manager to test loading
        const manager2 = new CbpDataManager();
        manager2.setStateFilePath(stateFile);
        manager2.reloadState();

        const queue = manager2.getQueueItems();
        // Should only have the existing file
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, existingPath);
    });
});
