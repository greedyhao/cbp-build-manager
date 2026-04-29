import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { compareVersions, formatOutput, decodeBuffer, OutputLineBuffer, processBuildCommandPath, parseNinjaProgress } from '../../utils';

suite('Utils Test Suite', () => {
    const baseDir = path.join(os.tmpdir(), 'test-project');
    // ==================== compareVersions ====================

    test('compareVersions: version1 > version2', () => {
        assert.strictEqual(compareVersions('2.0.0', '1.0.0'), true);
        assert.strictEqual(compareVersions('1.10.0', '1.9.0'), true);
        assert.strictEqual(compareVersions('1.1.5', '1.1.4'), true);
    });

    test('compareVersions: version1 < version2', () => {
        assert.strictEqual(compareVersions('1.0.0', '2.0.0'), false);
        assert.strictEqual(compareVersions('1.9.0', '1.10.0'), false);
    });

    test('compareVersions: version1 === version2', () => {
        assert.strictEqual(compareVersions('1.0.0', '1.0.0'), true);
        assert.strictEqual(compareVersions('1.0', '1.0.0'), true);
    });

    test('compareVersions: different length version strings', () => {
        assert.strictEqual(compareVersions('1.0', '1.0.0'), true);
        assert.strictEqual(compareVersions('1.0.0.0', '1.0'), true);
        assert.strictEqual(compareVersions('1.0.0', '1.0.1'), false);
    });

    test('compareVersions: edge cases - empty or invalid', () => {
        assert.strictEqual(compareVersions('', '1.0.0'), false); // empty → [0], 0 < 1
        assert.strictEqual(compareVersions('1.0.0', ''), true);  // 1 > 0
    });

    // ==================== formatOutput ====================

    test('formatOutput: normalize line endings', () => {
        // Test basic line ending conversion
        assert.strictEqual(formatOutput('hello\nworld'), 'hello\r\nworld');
        assert.strictEqual(formatOutput('hello\r\nworld'), 'hello\r\nworld');
        assert.strictEqual(formatOutput('hello\rworld'), 'hello\r\nworld');
    });

    test('formatOutput: multiple line endings', () => {
        assert.strictEqual(formatOutput('line1\nline2\nline3'), 'line1\r\nline2\r\nline3');
        assert.strictEqual(formatOutput('line1\r\nline2\r\nline3'), 'line1\r\nline2\r\nline3');
        assert.strictEqual(formatOutput('line1\rline2\rline3'), 'line1\r\nline2\r\nline3');
    });

    test('formatOutput: mixed line endings', () => {
        assert.strictEqual(formatOutput('line1\r\nline2\rline3\nline4'), 'line1\r\nline2\r\nline3\r\nline4');
    });

    test('formatOutput: empty string', () => {
        assert.strictEqual(formatOutput(''), '');
    });

    test('formatOutput: no line endings', () => {
        assert.strictEqual(formatOutput('hello world'), 'hello world');
    });

    // ==================== OutputLineBuffer ====================

    test('OutputLineBuffer: basic line splitting', () => {
        const lines: string[] = [];
        const buffer = new OutputLineBuffer((line) => lines.push(buffer.getBuffer() ? line : ''));

        buffer.append('line1\n');
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0], 'line1');
    });

    test('OutputLineBuffer: multiple lines', () => {
        const lines: string[] = [];
        const buffer = new OutputLineBuffer((line) => lines.push(line));

        buffer.append('line1\nline2\n');
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0], 'line1');
        assert.strictEqual(lines[1], 'line2');
    });

    test('OutputLineBuffer: incomplete line', () => {
        const lines: string[] = [];
        const buffer = new OutputLineBuffer((line) => lines.push(line));

        buffer.append('line1');
        assert.strictEqual(lines.length, 0);
        assert.strictEqual(buffer.getBuffer(), 'line1');
    });

    test('OutputLineBuffer: flush incomplete line', () => {
        const lines: string[] = [];
        const buffer = new OutputLineBuffer((line) => lines.push(line));

        buffer.append('line1');
        buffer.flush();
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0], 'line1');
    });

    test('OutputLineBuffer: split on newline in middle of data', () => {
        const lines: string[] = [];
        const buffer = new OutputLineBuffer((line) => lines.push(line));

        buffer.append('hello world\n');
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0], 'hello world');
    });

    test('OutputLineBuffer: handle carriage return at end of line', () => {
        const lines: string[] = [];
        const buffer = new OutputLineBuffer((line) => lines.push(line));

        buffer.append('line1\r\n');
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0], 'line1');
    });

    // ==================== processBuildCommandPath ====================

    test('processBuildCommandPath: basic relative path conversion', () => {
        const line = 'src/main.cpp:10: error: undefined reference';
        const result = processBuildCommandPath(line, baseDir);
        const expected = path.normalize(path.join(baseDir, 'src/main.cpp:10'));
        assert.ok(result.includes(expected), `Expected "${result}" to include "${expected}"`);
    });

    test('processBuildCommandPath: multiple paths in line', () => {
        const line = 'src/main.cpp:10: error: undefined reference to func in lib/helper.cpp:5';
        const result = processBuildCommandPath(line, baseDir);
        const expected = path.normalize(path.join(baseDir, 'src/main.cpp:10'));
        assert.ok(result.includes(expected), `Expected "${result}" to include "${expected}"`);
    });

    test('processBuildCommandPath: different file extensions', () => {
        const cFile = 'src/main.c:10: error';
        assert.ok(processBuildCommandPath(cFile, baseDir).includes(path.normalize(path.join(baseDir, 'src/main.c:10'))));

        const hFile = 'include/header.h:5: note';
        assert.ok(processBuildCommandPath(hFile, baseDir).includes(path.normalize(path.join(baseDir, 'include/header.h:5'))));
    });

    test('processBuildCommandPath: Windows absolute path should not double prefix', () => {
        // 使用当前项目路径作为 cwd
        const cwd = path.join(baseDir, 'platform');
        // 构造一个 cwd 子目录下的绝对路径
        const absPath = path.join(cwd, 'modules', 'lwip', 'src', 'core', 'dns.c');
        const line = `${absPath}:10: error`;
        const result = processBuildCommandPath(line, cwd);
        // 绝对路径不应该被拼接为 cwd + absPath
        assert.ok(result.includes(absPath), `Expected "${result}" to include "${absPath}"`);
    });

    test('processBuildCommandPath: Windows backslash absolute path', () => {
        const cwd = path.join(baseDir, 'platform');
        const absPath = path.join(cwd, 'app', 'test.cpp');
        const line = `${absPath}:20: warning`;
        const result = processBuildCommandPath(line, cwd);
        assert.ok(result.includes(absPath), `Expected "${result}" to include "${absPath}"`);
    });

    test('processBuildCommandPath: Unix absolute path should not be prefixed', () => {
        const cwd = '/home/user/project';

        // Unix 绝对路径
        const line = '/usr/include/stdio.h:15: note';
        const result = processBuildCommandPath(line, cwd);
        // 不应该与 cwd 拼接
        assert.ok(result.includes('/usr/include/stdio.h:15'));
        assert.ok(!result.includes('/home/user/project/usr/include'));
    });

    // ==================== parseNinjaProgress ====================

    test('parseNinjaProgress: progress line', () => {
        const result = parseNinjaProgress('[1/10] Building file.c');
        assert.strictEqual(result.isProgress, true);
        assert.strictEqual(result.prefix, '[1/10]');
        assert.strictEqual(result.shortMsg, 'Building file.c');
    });

    test('parseNinjaProgress: non-progress line', () => {
        const result = parseNinjaProgress('error: undefined reference');
        assert.strictEqual(result.isProgress, false);
        assert.strictEqual(result.originalLine, 'error: undefined reference');
    });

    test('parseNinjaProgress: progress with long path', () => {
        const result = parseNinjaProgress('[5/100] /very/long/path/to/source/file.cpp something');
        assert.strictEqual(result.isProgress, true);
        assert.ok(result.shortMsg?.includes('Building file.cpp'));
    });
});
