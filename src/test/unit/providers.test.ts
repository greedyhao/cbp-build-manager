import * as assert from 'assert';
import * as vscode from 'vscode';
import { CbpDataManager } from '../../services';
import { BuildQueueProvider } from '../../providers/BuildQueueProvider';
import { ProjectLibraryProvider } from '../../providers/ProjectLibraryProvider';

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

suite('Providers Test Suite', () => {
    let manager: CbpDataManager;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        manager = new CbpDataManager();
        mockContext = createMockContext();
    });

    // ==================== BuildQueueProvider ====================

    test('BuildQueueProvider: should return queue items', async () => {
        manager.setContext(mockContext);
        manager.setAllDetectedProjects(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);

        const provider = new BuildQueueProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        assert.strictEqual(children!.length, 1);
        assert.strictEqual(children![0].fsPath, 'C:/project/test.cbp');
    });

    test('BuildQueueProvider: should return empty for nested children', async () => {
        manager.setContext(mockContext);
        manager.setAllDetectedProjects(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);

        const provider = new BuildQueueProvider(manager);
        const queueItems = manager.getQueueItems();
        const children = await provider.getChildren(queueItems[0]);

        assert.ok(children, 'Children should not be null');
        assert.strictEqual(children!.length, 0);
    });

    test('BuildQueueProvider: should return empty when queue is empty', async () => {
        manager.setContext(mockContext);

        const provider = new BuildQueueProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        assert.strictEqual(children!.length, 0);
    });

    test('BuildQueueProvider: should have correct drag/drop mime types', () => {
        const provider = new BuildQueueProvider(manager);

        assert.strictEqual(provider.dropMimeTypes.length, 1);
        assert.strictEqual(provider.dragMimeTypes.length, 1);
    });

    // ==================== ProjectLibraryProvider ====================

    test('ProjectLibraryProvider: should return available items', async () => {
        manager.setContext(mockContext);
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp']);
        manager.addToQueue(['C:/project/test1.cbp']);

        const provider = new ProjectLibraryProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        // Should only show test2.cbp (test1.cbp is in queue)
        assert.strictEqual(children!.length, 1);
        assert.strictEqual(children![0].fsPath, 'C:/project/test2.cbp');
    });

    test('ProjectLibraryProvider: should return empty when all items in queue', async () => {
        manager.setContext(mockContext);
        manager.setAllDetectedProjects(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);

        const provider = new ProjectLibraryProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        assert.strictEqual(children!.length, 0);
    });

    test('ProjectLibraryProvider: should return empty when no projects', async () => {
        manager.setContext(mockContext);
        manager.setAllDetectedProjects([]);

        const provider = new ProjectLibraryProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        assert.strictEqual(children!.length, 0);
    });

    test('ProjectLibraryProvider: should return tree structure for nested projects', async () => {
        manager.setContext(mockContext);
        manager.setAllDetectedProjects([
            'C:/project/subfolder/project1.cbp',
            'C:/project/subfolder/project2.cbp'
        ]);
        // Don't add any to queue

        const provider = new ProjectLibraryProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        // Should show a folder node
        assert.ok(children!.length > 0);
        // First item should be a directory
        const firstChild = children![0] as any;
        assert.strictEqual(firstChild.contextValue, 'directory');
    });
});
