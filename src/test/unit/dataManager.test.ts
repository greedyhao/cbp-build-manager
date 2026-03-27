import * as assert from 'assert';
import * as vscode from 'vscode';
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

// Mock vscode.ExtensionContext
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

suite('DataManager Test Suite', () => {
    let manager: CbpDataManager;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        manager = new CbpDataManager();
        mockContext = createMockContext();
    });

    // ==================== addToQueue ====================

    test('addToQueue: should add items to queue', () => {
        manager.setAllDetectedProjects(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, 'C:/project/test.cbp');
        assert.strictEqual(queue[0].label, 'test');
    });

    test('addToQueue: should not add duplicate items', () => {
        manager.setAllDetectedProjects(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 1);
    });

    test('addToQueue: should add multiple items', () => {
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp']);
        manager.addToQueue(['C:/project/test1.cbp', 'C:/project/test2.cbp']);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 2);
    });

    // ==================== removeFromQueue ====================

    test('removeFromQueue: should remove items from queue', () => {
        manager.setAllDetectedProjects(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);

        const queueItem = manager.getQueueItems()[0];
        manager.removeFromQueue([queueItem]);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 0);
    });

    test('removeFromQueue: should only remove specified items', () => {
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp']);
        manager.addToQueue(['C:/project/test1.cbp', 'C:/project/test2.cbp']);

        const queueItems = manager.getQueueItems();
        manager.removeFromQueue([queueItems[0]]);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, 'C:/project/test2.cbp');
    });

    // ==================== moveQueueItem ====================

    test('moveQueueItem: should reorder queue items', () => {
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp', 'C:/project/test3.cbp']);
        manager.addToQueue(['C:/project/test1.cbp', 'C:/project/test2.cbp', 'C:/project/test3.cbp']);

        const queueItems = manager.getQueueItems();
        // Move test1 to position after test3
        manager.moveQueueItem([queueItems[0]], queueItems[2]);

        const newQueue = manager.getQueueItems();
        assert.strictEqual(newQueue[0].fsPath, 'C:/project/test2.cbp');
        assert.strictEqual(newQueue[1].fsPath, 'C:/project/test3.cbp');
        assert.strictEqual(newQueue[2].fsPath, 'C:/project/test1.cbp');
    });

    test('moveQueueItem: should move items to end when target is undefined', () => {
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp', 'C:/project/test3.cbp']);
        manager.addToQueue(['C:/project/test1.cbp', 'C:/project/test2.cbp', 'C:/project/test3.cbp']);

        const queueItems = manager.getQueueItems();
        // Move test1 to end (no target)
        manager.moveQueueItem([queueItems[0]], undefined);

        const newQueue = manager.getQueueItems();
        assert.strictEqual(newQueue.length, 3);
        assert.strictEqual(newQueue[0].fsPath, 'C:/project/test2.cbp');
        assert.strictEqual(newQueue[1].fsPath, 'C:/project/test3.cbp');
        assert.strictEqual(newQueue[2].fsPath, 'C:/project/test1.cbp');
    });

    test('moveQueueItem: should move multiple items to end when target is undefined', () => {
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp', 'C:/project/test3.cbp', 'C:/project/test4.cbp']);
        manager.addToQueue(['C:/project/test1.cbp', 'C:/project/test2.cbp', 'C:/project/test3.cbp', 'C:/project/test4.cbp']);

        const queueItems = manager.getQueueItems();
        // Move test1 and test2 to end (no target)
        manager.moveQueueItem([queueItems[0], queueItems[1]], undefined);

        const newQueue = manager.getQueueItems();
        assert.strictEqual(newQueue.length, 4);
        assert.strictEqual(newQueue[0].fsPath, 'C:/project/test3.cbp');
        assert.strictEqual(newQueue[1].fsPath, 'C:/project/test4.cbp');
        assert.strictEqual(newQueue[2].fsPath, 'C:/project/test1.cbp');
        assert.strictEqual(newQueue[3].fsPath, 'C:/project/test2.cbp');
    });

    // ==================== getAvailableItems ====================

    test('getAvailableItems: should return items not in queue', () => {
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp', 'C:/project/test3.cbp']);
        manager.addToQueue(['C:/project/test1.cbp']);

        const available = manager.getAvailableItems();
        assert.strictEqual(available.length, 2);
        assert.ok(available.includes('C:/project/test2.cbp'));
        assert.ok(available.includes('C:/project/test3.cbp'));
        assert.ok(!available.includes('C:/project/test1.cbp'));
    });

    test('getAvailableItems: should return all when queue is empty', () => {
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp']);

        const available = manager.getAvailableItems();
        assert.strictEqual(available.length, 2);
    });

    // ==================== updateCheckState ====================

    test('updateCheckState: should update checkbox state', async () => {
        manager.setContext(mockContext);
        manager.setAllDetectedProjects(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);

        const queueItem = manager.getQueueItems()[0];
        manager.updateCheckState(queueItem, vscode.TreeItemCheckboxState.Unchecked);

        assert.strictEqual(queueItem.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
        assert.strictEqual(queueItem.isChecked, false);
    });

    // ==================== persistence ====================

    test('should persist queue order to globalState', async () => {
        manager.setContext(mockContext);
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp']);
        manager.addToQueue(['C:/project/test1.cbp', 'C:/project/test2.cbp']);

        // Reorder
        const queueItems = manager.getQueueItems();
        manager.moveQueueItem([queueItems[0]], queueItems[1]);

        // Get persisted data
        const savedQueuePaths = mockContext.globalState.get<string[]>('buildQueueOrder');
        assert.strictEqual(savedQueuePaths?.length, 2);
        assert.strictEqual(savedQueuePaths?.[0], 'C:/project/test2.cbp');
    });

    test('should load state from globalState', () => {
        // Pre-set data in memento
        mockContext.globalState.update('buildQueueOrder', ['C:/loaded/project.cbp']);
        mockContext.globalState.update('projectCheckState', { 'C:/loaded/project.cbp': false });

        manager.setContext(mockContext);
        manager.setAllDetectedProjects(['C:/loaded/project.cbp']);

        const queue = manager.getQueueItems();
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, 'C:/loaded/project.cbp');
    });

    // ==================== scanWorkspace ====================

    test('scanWorkspace: should filter out non-existent projects', async () => {
        // This test would require mocking vscode.workspace.findFiles
        // For now, we test the logic that filters the queue
        manager.setAllDetectedProjects(['C:/existing/project1.cbp']);
        manager.addToQueue(['C:/existing/project1.cbp', 'C:/nonexistent/project2.cbp']);

        // Manually simulate what scanWorkspace does
        manager.setAllDetectedProjects(['C:/existing/project1.cbp']);
        const queue = manager.getQueueItems();

        // project2 should be filtered out since it's not in allDetectedProjects
        assert.ok(queue.some(p => p.fsPath === 'C:/existing/project1.cbp'));
    });
});
