import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CbpDataManager } from '../../services';

suite('DataManager Test Suite', () => {
    let manager: CbpDataManager;
    let tempDir: string;

    setup(() => {
        manager = new CbpDataManager();
        // Create temp directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-test-'));
    });

    teardown(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
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

    test('updateCheckState: should update checkbox state', () => {
        manager.setAllDetectedProjects(['C:/project/test.cbp']);
        manager.addToQueue(['C:/project/test.cbp']);

        const queueItem = manager.getQueueItems()[0];
        manager.updateCheckState(queueItem, vscode.TreeItemCheckboxState.Unchecked);

        assert.strictEqual(queueItem.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
        assert.strictEqual(queueItem.isChecked, false);
    });

    // ==================== persistence ====================

    test('should persist queue order to file', () => {
        const stateFile = path.join(tempDir, '.cbp-build', 'queue.json');
        manager.setStateFilePath(stateFile);
        manager.setAllDetectedProjects(['C:/project/test1.cbp', 'C:/project/test2.cbp']);
        manager.addToQueue(['C:/project/test1.cbp', 'C:/project/test2.cbp']);

        // Reorder
        const queueItems = manager.getQueueItems();
        manager.moveQueueItem([queueItems[0]], queueItems[1]);

        // Verify file was created
        assert.ok(fs.existsSync(stateFile));

        // Verify file content
        const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        assert.strictEqual(savedState.queuePaths.length, 2);
        assert.strictEqual(savedState.queuePaths[0], 'C:/project/test2.cbp');
    });

    test('should load state from file', () => {
        // Create state file with pre-existing data
        const stateDir = path.join(tempDir, '.cbp-build');
        fs.mkdirSync(stateDir, { recursive: true });
        const stateFile = path.join(stateDir, 'queue.json');

        // Create a .cbp file in temp dir so it passes existsSync check
        const projectPath = path.join(tempDir, 'project.cbp');
        fs.writeFileSync(projectPath, '');
        fs.writeFileSync(stateFile, JSON.stringify({
            queuePaths: [projectPath],
            checkState: { [projectPath]: false }
        }), 'utf-8');

        // Create new manager to test loading
        const manager2 = new CbpDataManager();
        manager2.setStateFilePath(stateFile);

        const queue = manager2.getQueueItems();
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, projectPath);
    });

    // ==================== scanWorkspace ====================

    test('loadState: should filter out non-existent projects', () => {
        // Create state file with a non-existent project
        const stateDir = path.join(tempDir, '.cbp-build');
        fs.mkdirSync(stateDir, { recursive: true });
        const stateFile = path.join(stateDir, 'queue.json');

        // Create an existing .cbp file
        const existingPath = path.join(tempDir, 'existing.cbp');
        fs.writeFileSync(existingPath, '');

        // Create state with one existing and one non-existent file
        fs.writeFileSync(stateFile, JSON.stringify({
            queuePaths: [existingPath, 'C:/nonexistent/project2.cbp'],
            checkState: {}
        }), 'utf-8');

        // Create new manager to test loading
        const manager2 = new CbpDataManager();
        manager2.setStateFilePath(stateFile);

        const queue = manager2.getQueueItems();
        // Should only have the existing file
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].fsPath, existingPath);
    });
});
