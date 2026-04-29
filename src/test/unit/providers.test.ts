import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
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
    let tempDir: string;

    function getWorkspaceRoot(): string {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
    }

    setup(() => {
        manager = new CbpDataManager();
        mockContext = createMockContext();
        // Create temp dir under workspace root so buildTreeLevel can resolve relative paths
        tempDir = fs.mkdtempSync(path.join(getWorkspaceRoot(), '.cbp-test-'));
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // ==================== BuildQueueProvider ====================

    test('BuildQueueProvider: should return queue items', async () => {
        manager.setContext(mockContext);
        const p1 = path.join(tempDir, 'test.cbp');
        manager.setAllDetectedProjects([p1]);
        manager.addToQueue([p1]);

        const provider = new BuildQueueProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        assert.strictEqual(children!.length, 1);
        assert.strictEqual(children![0].fsPath, p1);
    });

    test('BuildQueueProvider: should return empty for nested children', async () => {
        manager.setContext(mockContext);
        const p1 = path.join(tempDir, 'test.cbp');
        manager.setAllDetectedProjects([p1]);
        manager.addToQueue([p1]);

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
        const p1 = path.join(tempDir, 'test1.cbp');
        const p2 = path.join(tempDir, 'test2.cbp');
        manager.setAllDetectedProjects([p1, p2]);
        manager.addToQueue([p1]);

        const provider = new ProjectLibraryProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        assert.strictEqual(children!.length, 1);
        assert.strictEqual(children![0].fsPath, p2);
    });

    test('ProjectLibraryProvider: should return empty when all items in queue', async () => {
        manager.setContext(mockContext);
        const p = path.join(tempDir, 'test.cbp');
        manager.setAllDetectedProjects([p]);
        manager.addToQueue([p]);

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
        const subDir = path.join(tempDir, 'subfolder');
        fs.mkdirSync(subDir);
        manager.setAllDetectedProjects([
            path.join(subDir, 'project1.cbp'),
            path.join(subDir, 'project2.cbp')
        ]);

        const provider = new ProjectLibraryProvider(manager);
        const children = await provider.getChildren();

        assert.ok(children, 'Children should not be null');
        assert.ok(children!.length > 0, 'Should have at least one child');
    });
});
