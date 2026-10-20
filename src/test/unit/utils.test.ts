import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import {
  compareVersions,
  formatOutput,
  decodeBuffer,
  OutputLineBuffer,
  processBuildCommandPath,
  parseNinjaProgress,
} from "../../utils";

suite("Utils Test Suite", () => {
  const baseDir = path.join(os.tmpdir(), "test-project");
  // ==================== compareVersions ====================

  test("compareVersions: version1 > version2", () => {
    assert.strictEqual(compareVersions("2.0.0", "1.0.0"), true);
    assert.strictEqual(compareVersions("1.10.0", "1.9.0"), true);
    assert.strictEqual(compareVersions("1.1.5", "1.1.4"), true);
  });

  test("compareVersions: version1 < version2", () => {
    assert.strictEqual(compareVersions("1.0.0", "2.0.0"), false);
    assert.strictEqual(compareVersions("1.9.0", "1.10.0"), false);
  });

  test("compareVersions: version1 === version2", () => {
    assert.strictEqual(compareVersions("1.0.0", "1.0.0"), true);
    assert.strictEqual(compareVersions("1.0", "1.0.0"), true);
  });

  test("compareVersions: different length version strings", () => {
    assert.strictEqual(compareVersions("1.0", "1.0.0"), true);
    assert.strictEqual(compareVersions("1.0.0.0", "1.0"), true);
    assert.strictEqual(compareVersions("1.0.0", "1.0.1"), false);
  });

  test("compareVersions: edge cases - empty or invalid", () => {
    assert.strictEqual(compareVersions("", "1.0.0"), false); // empty → [0], 0 < 1
    assert.strictEqual(compareVersions("1.0.0", ""), true); // 1 > 0
  });

  // ==================== formatOutput ====================

  test("formatOutput: normalize line endings", () => {
    // Test basic line ending conversion
    assert.strictEqual(formatOutput("hello\nworld"), "hello\r\nworld");
    assert.strictEqual(formatOutput("hello\r\nworld"), "hello\r\nworld");
    assert.strictEqual(formatOutput("hello\rworld"), "hello\r\nworld");
  });

  test("formatOutput: multiple line endings", () => {
    assert.strictEqual(
      formatOutput("line1\nline2\nline3"),
      "line1\r\nline2\r\nline3",
    );
    assert.strictEqual(
      formatOutput("line1\r\nline2\r\nline3"),
      "line1\r\nline2\r\nline3",
    );
    assert.strictEqual(
      formatOutput("line1\rline2\rline3"),
      "line1\r\nline2\r\nline3",
    );
  });

  test("formatOutput: mixed line endings", () => {
    assert.strictEqual(
      formatOutput("line1\r\nline2\rline3\nline4"),
      "line1\r\nline2\r\nline3\r\nline4",
    );
  });

  test("formatOutput: empty string", () => {
    assert.strictEqual(formatOutput(""), "");
  });

  test("formatOutput: no line endings", () => {
    assert.strictEqual(formatOutput("hello world"), "hello world");
  });

  // ==================== OutputLineBuffer ====================

  test("OutputLineBuffer: basic line splitting", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) =>
      lines.push(buffer.getBuffer() ? line : ""),
    );

    buffer.append("line1\n");
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], "line1");
  });

  test("OutputLineBuffer: multiple lines", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) => lines.push(line));

    buffer.append("line1\nline2\n");
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0], "line1");
    assert.strictEqual(lines[1], "line2");
  });

  test("OutputLineBuffer: incomplete line", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) => lines.push(line));

    buffer.append("line1");
    assert.strictEqual(lines.length, 0);
    assert.strictEqual(buffer.getBuffer(), "line1");
  });

  test("OutputLineBuffer: flush incomplete line", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) => lines.push(line));

    buffer.append("line1");
    buffer.flush();
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], "line1");
  });

  test("OutputLineBuffer: split on newline in middle of data", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) => lines.push(line));

    buffer.append("hello world\n");
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], "hello world");
  });

  test("OutputLineBuffer: handle carriage return at end of line", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) => lines.push(line));

    buffer.append("line1\r\n");
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], "line1");
  });

  test("OutputLineBuffer: bare \\r ends a line immediately", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) => lines.push(line));

    // 构建脚本用 \r 原地刷新进度（如 xxx.g.bin" successful\r），
    // 不能等到后面某条无关输出带来 \n 才成行
    buffer.append('xxx.g.bin" successful\r');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], 'xxx.g.bin" successful');
    assert.strictEqual(buffer.getBuffer(), "");
  });

  test("OutputLineBuffer: bare \\r splits within one chunk", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) => lines.push(line));

    buffer.append("progress 50%\rprogress 100%\n");
    assert.deepStrictEqual(lines, ["progress 50%", "progress 100%"]);
  });

  test("OutputLineBuffer: CRLF split across chunks emits no empty line", () => {
    const lines: string[] = [];
    const buffer = new OutputLineBuffer((line) => lines.push(line));

    buffer.append("a\r");
    assert.deepStrictEqual(lines, ["a"]);
    buffer.append("\nb\n");
    assert.deepStrictEqual(lines, ["a", "b"]);
    assert.strictEqual(buffer.getBuffer(), "");
  });

  // ==================== processBuildCommandPath ====================

  test("processBuildCommandPath: basic relative path conversion", () => {
    const line = "src/main.cpp:10: error: undefined reference";
    const result = processBuildCommandPath(line, baseDir);
    const expected = path.normalize(path.join(baseDir, "src/main.cpp:10"));
    assert.ok(
      result.includes(expected),
      `Expected "${result}" to include "${expected}"`,
    );
  });

  test("processBuildCommandPath: multiple paths in line", () => {
    const line =
      "src/main.cpp:10: error: undefined reference to func in lib/helper.cpp:5";
    const result = processBuildCommandPath(line, baseDir);
    const expected = path.normalize(path.join(baseDir, "src/main.cpp:10"));
    assert.ok(
      result.includes(expected),
      `Expected "${result}" to include "${expected}"`,
    );
  });

  test("processBuildCommandPath: different file extensions", () => {
    const cFile = "src/main.c:10: error";
    assert.ok(
      processBuildCommandPath(cFile, baseDir).includes(
        path.normalize(path.join(baseDir, "src/main.c:10")),
      ),
    );

    const hFile = "include/header.h:5: note";
    assert.ok(
      processBuildCommandPath(hFile, baseDir).includes(
        path.normalize(path.join(baseDir, "include/header.h:5")),
      ),
    );
  });

  test("processBuildCommandPath: Windows absolute path should not double prefix", () => {
    // 使用当前项目路径作为 cwd
    const cwd = path.join(baseDir, "platform");
    // 构造一个 cwd 子目录下的绝对路径
    const absPath = path.join(cwd, "modules", "lwip", "src", "core", "dns.c");
    const line = `${absPath}:10: error`;
    const result = processBuildCommandPath(line, cwd);
    // 绝对路径不应该被拼接为 cwd + absPath
    assert.ok(
      result.includes(absPath),
      `Expected "${result}" to include "${absPath}"`,
    );
  });

  test("processBuildCommandPath: Windows backslash absolute path", () => {
    const cwd = path.join(baseDir, "platform");
    const absPath = path.join(cwd, "app", "test.cpp");
    const line = `${absPath}:20: warning`;
    const result = processBuildCommandPath(line, cwd);
    assert.ok(
      result.includes(absPath),
      `Expected "${result}" to include "${absPath}"`,
    );
  });

  test("processBuildCommandPath: Unix absolute path should not be prefixed", () => {
    const cwd = "/home/user/project";

    // Unix 绝对路径
    const line = "/usr/include/stdio.h:15: note";
    const result = processBuildCommandPath(line, cwd);
    // 不应该与 cwd 拼接
    assert.ok(result.includes("/usr/include/stdio.h:15"));
    assert.ok(!result.includes("/home/user/project/usr/include"));
  });

  test("processBuildCommandPath: object file without line number gets full path", () => {
    // 链接器报错没有行号，如 ram.o 位置计数器回退错误
    const line =
      "Output\\obj\\ram.o: cannot move location counter backwards (from 00097000 to 00078000)";
    const result = processBuildCommandPath(line, baseDir);
    const expected = path.normalize(path.join(baseDir, "Output/obj/ram.o"));
    assert.ok(
      result.includes(expected),
      `Expected "${result}" to include "${expected}"`,
    );
    // 没有行号时不应该拼出 "路径:undefined" 之类的内容
    assert.ok(
      !result.includes("undefined"),
      `Expected "${result}" not to contain "undefined"`,
    );
  });

  test("processBuildCommandPath: object file keeps error message tail", () => {
    const line = "Output\\obj\\ram.o: cannot move location counter backwards";
    const result = processBuildCommandPath(line, baseDir);
    assert.ok(
      result.includes("cannot move location counter backwards"),
      `Expected "${result}" to keep the error message`,
    );
  });

  test("processBuildCommandPath: object file with line number still works", () => {
    const line = "Output\\obj\\ram.o:454 cannot move location counter backwards";
    const result = processBuildCommandPath(line, baseDir);
    const expected = path.normalize(
      path.join(baseDir, "Output/obj/ram.o:454"),
    );
    assert.ok(
      result.includes(expected),
      `Expected "${result}" to include "${expected}"`,
    );
  });

  // ==================== parseNinjaProgress ====================

  test("parseNinjaProgress: progress line", () => {
    const result = parseNinjaProgress("[1/10] Building file.c");
    assert.strictEqual(result.isProgress, true);
    assert.strictEqual(result.prefix, "[1/10]");
    assert.strictEqual(result.shortMsg, "Building file.c");
  });

  test("parseNinjaProgress: non-progress line", () => {
    const result = parseNinjaProgress("error: undefined reference");
    assert.strictEqual(result.isProgress, false);
    assert.strictEqual(result.originalLine, "error: undefined reference");
  });

  test("parseNinjaProgress: progress with long path", () => {
    const result = parseNinjaProgress(
      "[5/100] /very/long/path/to/source/file.cpp something",
    );
    assert.strictEqual(result.isProgress, true);
    assert.ok(result.shortMsg?.includes("Building file.cpp"));
  });
});
