import * as assert from "assert";
import { OutputLineBuffer, StreamOutputBuffer } from "../../utils";

// 截图里的乱码：stderr 的汇编器诊断分多次写入（caret 行没有换行符），
// stdout 的构建脚本进度文本以裸 \r 结尾。两条流若共用一个
// OutputLineBuffer，就会拼出一条在两个流里都不存在的“假行”，例如：
//     d:\...\s_dnn.S:452:14: error: unexpected token|| goto err
//         sw a4, s9(a0)g.bin" successful
//                  ^\Users\...\xcfg.h" successful
// 本文件锁定修复后的行为：每条流各持一个行缓冲，只在整行层面交错。
const PROJECT = "d:\\Users\\hao_zhu\\Desktop\\svn\\GIANT\\masklib";
const OBJ = `${PROJECT}\\Output\\obj`;
const BIN = `${PROJECT}\\Output\\bin`;

// 只属于某一条流的特征串，用来判定一条输出是否混了两个流的内容
const STDERR_MARKERS = [
  "s_dnn.S",
  "error: unexpected token",
  "sw a4, s9(a0)",
  "sw a2, t5(t0)",
  "             ^",
];
const STDOUT_MARKERS = [
  "|| goto err",
  ".g.bin",
  "xcfg.h",
  "successful",
  "exit /b 0",
];

function touchesBothStreams(line: string): boolean {
  const fromStderr = STDERR_MARKERS.some((marker) => line.includes(marker));
  const fromStdout = STDOUT_MARKERS.some((marker) => line.includes(marker));
  return fromStderr && fromStdout;
}

function assertNoFusedLine(lines: string[]): void {
  for (const line of lines) {
    assert.ok(
      !touchesBothStreams(line),
      `line fused text from two streams: ${JSON.stringify(line)}`,
    );
  }
}

suite("Stream interleaving (stdout/stderr) Test Suite", () => {
  test("interleaved stdout/stderr chunks never fuse into one line", () => {
    const lines: string[] = [];
    const buffer = new StreamOutputBuffer((line) => lines.push(line));

    // stderr：诊断分多次写入，最后是只有 ^ 的 caret 行，没有换行符
    buffer.appendStderr(`${OBJ}\\s_dnn.S:452:14: error: unexpected token`);
    // stdout：进度文本以裸 \r 结尾
    buffer.appendStdout("if errorlevel 1 || goto err\r");
    buffer.appendStderr("\n");
    buffer.appendStderr("    sw a4, s9(a0)\n");
    buffer.appendStdout(`"${BIN}\\app.g.bin" successful\r`);
    buffer.appendStderr("             ^");
    buffer.appendStdout(`"${PROJECT}\\xcfg.h" successful\r`);
    buffer.flush();

    assert.deepStrictEqual(lines, [
      "if errorlevel 1 || goto err",
      `${OBJ}\\s_dnn.S:452:14: error: unexpected token`,
      "    sw a4, s9(a0)",
      `"${BIN}\\app.g.bin" successful`,
      `"${PROJECT}\\xcfg.h" successful`,
      "             ^",
    ]);
    assertNoFusedLine(lines);
  });

  test("bare \\r terminates a line without waiting for \\n", () => {
    const lines: string[] = [];
    const buffer = new StreamOutputBuffer((line) => lines.push(line));

    buffer.appendStdout("xxx.g.bin\" successful\r");
    assert.deepStrictEqual(lines, ["xxx.g.bin\" successful"]);

    // 第二条进度行同样立刻成行，中间没有任何 \n
    buffer.appendStdout("xcfg.h\" successful\r");
    assert.deepStrictEqual(lines, [
      "xxx.g.bin\" successful",
      "xcfg.h\" successful",
    ]);

    // 已经成行的内容不会被 flush 重复输出
    buffer.flush();
    assert.deepStrictEqual(lines, [
      "xxx.g.bin\" successful",
      "xcfg.h\" successful",
    ]);
  });

  test("CRLF split across two chunks yields no spurious empty line", () => {
    const lines: string[] = [];
    const buffer = new StreamOutputBuffer((line) => lines.push(line));

    buffer.appendStdout("a\r");
    buffer.appendStdout("\nb\n");

    assert.deepStrictEqual(lines, ["a", "b"]);
  });

  test("CRLF inside one chunk and a trailing bare \\r", () => {
    const lines: string[] = [];
    const buffer = new StreamOutputBuffer((line) => lines.push(line));

    buffer.appendStdout("a\r\nb\nc\r");
    assert.deepStrictEqual(lines, ["a", "b", "c"]);

    buffer.appendStdout("d");
    buffer.flush();
    assert.deepStrictEqual(lines, ["a", "b", "c", "d"]);
  });

  test("flush emits both streams' residual half-lines exactly once", () => {
    const lines: string[] = [];
    const buffer = new StreamOutputBuffer((line) => lines.push(line));

    buffer.appendStdout("stdout tail");
    buffer.appendStderr("stderr tail");
    assert.deepStrictEqual(lines, []);

    buffer.flush();
    assert.deepStrictEqual(lines, ["stdout tail", "stderr tail"]);

    buffer.flush();
    assert.deepStrictEqual(lines, ["stdout tail", "stderr tail"]);
  });

  test("mid-token chunk splits keep every line complete", () => {
    const lines: string[] = [];
    const buffer = new StreamOutputBuffer((line) => lines.push(line));
    const chunks: Array<[string, string]> = [
      ["stderr", `${OBJ}\\s_dnn.S:562:14: error: unexpected `],
      ["stdout", `"${BIN}\\app.g.bi`],
      ["stderr", "token"],
      ["stdout", "n\" successful\r"],
      // 诊断行自己的换行符到来之前，stderr 的半行留在 stderr 缓冲里；
      // 它只会和 stderr 后续内容相连，不会碰到 stdout
      ["stderr", "\n"],
      ["stdout", `${BIN}>exit /b 0\r\n`],
      ["stderr", "    sw a2, t5(t0)"],
    ];

    for (const [stream, text] of chunks) {
      if (stream === "stdout") {
        buffer.appendStdout(text);
      } else {
        buffer.appendStderr(text);
      }
    }
    buffer.flush();

    assert.deepStrictEqual(lines, [
      `"${BIN}\\app.g.bin" successful`,
      `${OBJ}\\s_dnn.S:562:14: error: unexpected token`,
      `${BIN}>exit /b 0`,
      "    sw a2, t5(t0)",
    ]);
    assertNoFusedLine(lines);
  });

  // 机制说明：只让 \r 也能断行是不够的。若两条流仍然共用一个
  // OutputLineBuffer，一条流的半行照样会和另一条流的输出拼在一起
  // （只有 ^ 的 caret 行没有换行符，正好接住 stdout 的进度文本）。
  // 这条测试锁定“必须按流分离缓冲”这一因果关系。
  test("sharing one OutputLineBuffer still fuses the two streams", () => {
    const shared: string[] = [];
    const single = new OutputLineBuffer((line) => shared.push(line));

    single.append(`${OBJ}\\s_dnn.S:452:14: error: unexpected token`);
    single.append(`"${PROJECT}\\xcfg.h" successful\r`);
    single.append("\n");

    assert.deepStrictEqual(shared, [
      `${OBJ}\\s_dnn.S:452:14: error: unexpected token` +
        `"${PROJECT}\\xcfg.h" successful`,
    ]);
    assert.strictEqual(touchesBothStreams(shared[0]), true);
  });
});
