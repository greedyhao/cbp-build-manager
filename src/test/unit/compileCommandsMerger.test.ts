import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { mergeCompileCommands, checkMergeCommandSupport } from '../../services/CompileCommandsMerger';
import { CbpProjectItem } from '../../models/items';
import * as vscode from 'vscode';

// Mock vscode
const mockVscode = {
    TreeItemCheckboxState: {
        Checked: vscode.TreeItemCheckboxState.Checked,
        Unchecked: vscode.TreeItemCheckboxState.Unchecked
    }
};

suite('CompileCommandsMerger Test Suite', () => {
    let tempDir: string;

    setup(() => {
        // Create a temporary directory for tests
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-test-'));
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // Helper function to create mock CbpProjectItem
    function createMockProject(name: string, dir: string): CbpProjectItem {
        return new CbpProjectItem(
            name,
            path.join(dir, `${name}.cbp`),
            false,
            vscode.TreeItemCollapsibleState.None,
            false
        );
    }

    test('should skip merge when only one project', async () => {
        const projects = [createMockProject('project1', tempDir)];
        const logMessages: string[] = [];

        const result = await mergeCompileCommands(
            projects,
            'cbp2clang',
            tempDir,
            false,
            (msg: string) => logMessages.push(msg)
        );

        assert.strictEqual(result, true);
        assert.ok(logMessages.some(msg => msg.includes('项目数量少于2个')));
    });

    test('should skip merge when no projects', async () => {
        const projects: CbpProjectItem[] = [];
        const logMessages: string[] = [];

        const result = await mergeCompileCommands(
            projects,
            'cbp2clang',
            tempDir,
            false,
            (msg: string) => logMessages.push(msg)
        );

        assert.strictEqual(result, true);
    });

    test('should skip merge when less than 2 valid CBP files exist', async () => {
        // Create project directories and CBP files
        const dir1 = path.join(tempDir, 'project1');
        const dir2 = path.join(tempDir, 'project2');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);

        // Create only one CBP file, not two
        const cbpFile1 = path.join(dir1, 'project1.cbp');
        fs.writeFileSync(cbpFile1, '');

        const projects = [
            createMockProject('project1', dir1),
            createMockProject('project2', dir2)
        ];

        const logMessages: string[] = [];

        const result = await mergeCompileCommands(
            projects,
            'nonexistent-cbp2clang',
            tempDir,
            false,
            (msg: string) => logMessages.push(msg)
        );

        assert.strictEqual(result, true);
        assert.ok(logMessages.some(msg => msg.includes('有效的 CBP 项目数量少于2个')));
    });

    test('should attempt merge when multiple CBP files exist', async () => {
        // Create project directories and CBP files
        const dir1 = path.join(tempDir, 'project1');
        const dir2 = path.join(tempDir, 'project2');
        const dir3 = path.join(tempDir, 'project3');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);
        fs.mkdirSync(dir3);

        // Create CBP files so the function can find them
        fs.writeFileSync(path.join(dir1, 'project1.cbp'), '');
        fs.writeFileSync(path.join(dir2, 'project2.cbp'), '');
        fs.writeFileSync(path.join(dir3, 'project3.cbp'), '');

        const projects = [
            createMockProject('project1', dir1),
            createMockProject('project2', dir2),
            createMockProject('project3', dir3)
        ];

        const logMessages: string[] = [];

        // Use nonexistent cbp2clang - merge will fail but log messages should be correct
        await mergeCompileCommands(
            projects,
            'nonexistent-cbp2clang',
            tempDir,
            false,
            (msg: string) => logMessages.push(msg)
        );

        assert.ok(logMessages.some(msg => msg.includes('合并 compile_commands.json')));
        assert.ok(logMessages.some(msg => msg.includes('project3')));
    });

    test('should correctly identify target as last project', async () => {
        // Create project directories and CBP files
        const dir1 = path.join(tempDir, 'project1');
        const dir2 = path.join(tempDir, 'project2');
        const dir3 = path.join(tempDir, 'project3');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);
        fs.mkdirSync(dir3);

        // Create CBP files so the function can find them
        fs.writeFileSync(path.join(dir1, 'project1.cbp'), '');
        fs.writeFileSync(path.join(dir2, 'project2.cbp'), '');
        fs.writeFileSync(path.join(dir3, 'project3.cbp'), '');

        const projects = [
            createMockProject('project1', dir1),
            createMockProject('project2', dir2),
            createMockProject('project3', dir3)
        ];

        const logMessages: string[] = [];

        await mergeCompileCommands(
            projects,
            'nonexistent-cbp2clang',
            tempDir,
            false,
            (msg: string) => logMessages.push(msg)
        );

        // Verify target is project3 (the last one) using actual function output
        assert.ok(logMessages.some(msg => msg.includes('project3') && msg.includes('目标项目')));
    });
});
