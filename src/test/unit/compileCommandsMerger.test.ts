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

    test('should skip merge when less than 2 compile_commands.json exist', async () => {
        // Create project directories
        const dir1 = path.join(tempDir, 'project1');
        const dir2 = path.join(tempDir, 'project2');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);

        // Create only one compile_commands.json
        const compileCommands1 = path.join(dir1, 'compile_commands.json');
        fs.writeFileSync(compileCommands1, JSON.stringify([{ file: 'test.cpp' }]));

        const projects = [
            createMockProject('project1', dir1),
            createMockProject('project2', dir2)
        ];

        const logMessages: string[] = [];

        const result = await mergeCompileCommands(
            projects,
            'cbp2clang',
            tempDir,
            false,
            (msg: string) => logMessages.push(msg)
        );

        assert.strictEqual(result, true);
        assert.ok(logMessages.some(msg => msg.includes('compile_commands.json 数量少于2个')));
    });

    test('should attempt merge when multiple compile_commands.json exist', async () => {
        // Create project directories
        const dir1 = path.join(tempDir, 'project1');
        const dir2 = path.join(tempDir, 'project2');
        const dir3 = path.join(tempDir, 'project3');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);
        fs.mkdirSync(dir3);

        // Create compile_commands.json files
        const compileCommands1 = path.join(dir1, 'compile_commands.json');
        const compileCommands2 = path.join(dir2, 'compile_commands.json');
        const compileCommands3 = path.join(dir3, 'compile_commands.json');

        fs.writeFileSync(compileCommands1, JSON.stringify([{ file: 'test1.cpp' }]));
        fs.writeFileSync(compileCommands2, JSON.stringify([{ file: 'test2.cpp' }]));
        fs.writeFileSync(compileCommands3, JSON.stringify([{ file: 'test3.cpp' }]));

        const projects = [
            createMockProject('project1', dir1),
            createMockProject('project2', dir2),
            createMockProject('project3', dir3)
        ];

        const logMessages: string[] = [];

        // This will try to call cbp2clang which probably doesn't exist, so it will fail
        // But we can verify the log messages show the correct paths
        await mergeCompileCommands(
            projects,
            'nonexistent-cbp2clang',
            tempDir,
            false,
            (msg: string) => logMessages.push(msg)
        );

        // Verify that merge was attempted
        assert.ok(logMessages.some(msg => msg.includes('合并 compile_commands.json')));
        assert.ok(logMessages.some(msg => msg.includes('project3')));
    });

    test('should correctly identify target as last project', async () => {
        // Create project directories
        const dir1 = path.join(tempDir, 'project1');
        const dir2 = path.join(tempDir, 'project2');
        const dir3 = path.join(tempDir, 'project3');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);
        fs.mkdirSync(dir3);

        // Create compile_commands.json files in all directories
        [dir1, dir2, dir3].forEach(dir => {
            fs.writeFileSync(
                path.join(dir, 'compile_commands.json'),
                JSON.stringify([{ file: 'test.cpp' }])
            );
        });

        const projects = [
            createMockProject('project1', dir1),
            createMockProject('project2', dir2),
            createMockProject('project3', dir3)
        ];

        const logMessages: string[] = [];

        // Use a nonexistent cbp2clang to trigger the log but not actually merge
        await mergeCompileCommands(
            projects,
            'nonexistent-cbp2clang',
            tempDir,
            false,
            (msg: string) => logMessages.push(msg)
        );

        // Verify target is project3 (the last one)
        assert.ok(logMessages.some(msg => msg.includes('project3') && msg.includes('目标文件')));
    });
});
