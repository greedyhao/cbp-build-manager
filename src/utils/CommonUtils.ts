// 1. 更加健壮的解码函数
export function decodeBuffer(buffer: Buffer): string {
  try {
    const iconv = require("iconv-lite");

    // 许多现代工具(Clang/Ninja)在Windows上也输出UTF-8
    // 但CMD默认环境经常是GBK。
    // 策略：尝试用 UTF-8 解码，如果发现乱码字符（），则判定为 GBK。
    const strUtf8 = iconv.decode(buffer, "utf8");

    // 检查是否存在"替换字符" (U+FFFD)，这通常意味着UTF-8解码失败
    if (strUtf8.includes("\uFFFD")) {
      // 如果UTF-8解码看起来不对，尝试GBK
      try {
        return iconv.decode(buffer, "gbk");
      } catch {
        return strUtf8; // 尽力而为
      }
    }
    return strUtf8;
  } catch (error) {
    // 如果iconv-lite不可用，直接使用UTF-8解码
    return buffer.toString("utf8");
  }
}

// 2. 格式化输出：解决阶梯状换行问题
export function formatOutput(text: string): string {
  // 核心修复：Pseudoterminal 需要 \r\n 才能正确换行并回到行首
  // 但要避免重复的 \r 字符导致格式错乱

  // 1. 先将所有的 \r\n 替换为 \n，避免重复处理
  let normalized = text.replace(/\r\n/g, "\n");

  // 2. 再将单独的 \r 替换为 \n，确保只有 \n 作为换行符
  normalized = normalized.replace(/\r/g, "\n");

  // 3. 最后将所有的 \n 替换为 \r\n，确保终端正确显示
  normalized = normalized.replace(/\n/g, "\r\n");

  return normalized;
}

// 为 Windows cmd 命令行参数加引号：路径中含有空格时（如 "xxx (3)\yyy"），
// 不加引号会在空格处被拆成多个参数；已整体带引号或不含空白时保持原样
export function quoteCmdArg(arg: string): string {
  if (arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"')) {
    return arg;
  }
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

// 比较两个版本字符串，返回 true 如果 version1 >= version2
export function compareVersions(version1: string, version2: string): boolean {
  const v1Parts = version1.split(".").map(Number);
  const v2Parts = version2.split(".").map(Number);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1 = v1Parts[i] || 0;
    const v2 = v2Parts[i] || 0;

    if (v1 > v2) {
      return true;
    }
    if (v1 < v2) {
      return false;
    }
  }

  return true; // 版本相同
}

// --- 辅助类：行缓冲处理器 ---
// 用于解决流式数据可能将一行日志切断的问题，确保每次 callback 都是完整的一行
//
// 换行符：构建工具用三种方式结束一行，三者都要当行结束符处理
//   \n    普通输出
//   \r\n  Windows CRLF（可能刚好被数据块从中间切断）
//   \r    “原地刷新”的进度行，如 build 脚本输出的 xxx.g.bin" successful\r
// 若只认 \n，\r 结尾的半行会一直留在缓冲区里，直到后面某条毫不相关的
// 输出带来 \n，两条内容被拼成一行（"xxx.g.bin\" successful" 就是这么粘上
// 编译器报错的）。
export class OutputLineBuffer {
  private buffer = "";
  // 上一块数据以裸 \r 结尾：本块开头的 \n 属于同一个 CRLF，需要吃掉
  private skipLeadingLf = false;

  constructor(private onLine: (line: string) => void) {}

  append(chunk: string) {
    let text = chunk;
    if (this.skipLeadingLf) {
      this.skipLeadingLf = false;
      if (text.startsWith("\n")) {
        text = text.slice(1);
      }
    }
    this.buffer += text;

    // lineStart 之后的内容尚未成行，循环结束后要留在缓冲区里
    let lineStart = 0;
    let index = 0;
    while (index < this.buffer.length) {
      const ch = this.buffer[index];
      if (ch === "\n") {
        this.onLine(this.buffer.substring(lineStart, index));
        index += 1;
        lineStart = index;
      } else if (ch === "\r") {
        this.onLine(this.buffer.substring(lineStart, index));
        if (index + 1 === this.buffer.length) {
          // \r 正好是最后一块的最后一个字符，无法判断它是不是 CRLF 的
          // 前半截：先标记，交给下一块数据（或 flush）确认
          this.skipLeadingLf = true;
          index += 1;
        } else {
          index += this.buffer[index + 1] === "\n" ? 2 : 1;
        }
        lineStart = index;
      } else {
        index += 1;
      }
    }
    this.buffer = this.buffer.substring(lineStart);
  }

  // 处理流结束后的剩余数据
  flush() {
    if (this.buffer.trim().length > 0) {
      this.onLine(this.buffer);
      this.buffer = "";
    }
    this.skipLeadingLf = false;
  }

  // Get current buffer state (for testing)
  getBuffer(): string {
    return this.buffer;
  }
}

/**
 * 构建输出的按流分离行缓冲。
 *
 * stdout 与 stderr 是两条独立的管道，数据块边界互不相干。共用一个
 * OutputLineBuffer 时，一条流的半行会被拼到另一条流的半行前面，产出
 * 一条在两个流里都不存在的“假行”，例如：
 *     sw a4, s9(a0)g.bin" successful
 *              ^\Users\...\xcfg.h" successful
 * 这种假行不仅没法看，还会被当成错误信息收集进诊断汇总。因此每条流
 * 各持有一个 OutputLineBuffer，只在整行层面交错。
 */
export class StreamOutputBuffer {
  private readonly stdoutBuffer: OutputLineBuffer;
  private readonly stderrBuffer: OutputLineBuffer;

  constructor(onLine: (line: string) => void) {
    this.stdoutBuffer = new OutputLineBuffer(onLine);
    this.stderrBuffer = new OutputLineBuffer(onLine);
  }

  appendStdout(chunk: string): void {
    this.stdoutBuffer.append(chunk);
  }

  appendStderr(chunk: string): void {
    this.stderrBuffer.append(chunk);
  }

  // 进程结束后，把两条流残留的半行都吐出来
  flush(): void {
    this.stdoutBuffer.flush();
    this.stderrBuffer.flush();
  }
}

// 处理构建命令中的路径
export function processBuildCommandPath(line: string, cwd: string): string {
  // 支持源文件、头文件和目标文件（链接器报错会指向 .o/.obj/.a）
  // 注意：这里加了 \\. 确保后缀名前的点被正确转义；扩展名用 (?:...)
  // 非捕获组，避免占用 replace 回调的参数位
  const fileExtensionPattern =
    "\\.(?:c|cpp|cc|cxx|h|hpp|hh|hxx|s|S|asm|o|obj|a|lib)";

  // 修改点：
  // 1. 在字符集 [] 中增加了 \\. 以支持相对路径中的点 (如 ../)
  // 2. 增加了 \\\\ 以更稳健地支持 Windows 反斜杠
  // 3. 增加了 :? 放在盘符位置，虽然通常不放在字符集里，但为了简单匹配路径体，
  //    我们主要扩充允许的字符：字母、数字、下划线、减号、点、斜杠、反斜杠
  const validPathChars = "[a-zA-Z0-9_\\-\\.\\/\\\\]";

  // 正则表达式：匹配文件路径 + 可选行号
  // 匹配模式：[路径] [: 行号]
  // 1. 行号设为可选：链接器的错误形如 "Output\obj\ram.o: cannot move
  //    location counter backwards"，没有行号，也要转换出完整路径方便跳转
  // 2. 不再强制要求行号后跟 ":"：部分链接器输出 "ram.o:454 cannot move
  //    ..."，行号后直接是空格；行号后的冒号留在未匹配的剩余文本里，
  //    替换结果不变
  const filePathPattern = new RegExp(
    `(${validPathChars}+${fileExtensionPattern})(?::(\\d+))?`,
    "g",
  );

  return line.replace(
    filePathPattern,
    (match, relPath: string, lineNum?: string) => {
      try {
        const pathModule = require("path");

        // 检查路径是否已经是绝对路径（Windows 盘符格式如 D:\\ 或 D:/）
        const isWindowsAbsolute = /^[a-zA-Z]:[\\\/]/.test(relPath);
        const isUnixAbsolute = relPath.startsWith("/");

        let fullPath: string;
        if (isWindowsAbsolute || isUnixAbsolute) {
          // 如果已经是绝对路径，直接使用，避免与 cwd 拼接导致双重盘符
          fullPath = relPath;
        } else {
          // 将相对路径转换为完整路径
          // path.resolve 会自动处理 .. 和 .
          fullPath = pathModule.resolve(cwd, relPath);
        }

        // 有行号保留行号，没有行号只输出完整路径，保持 VS Code 可点击
        return lineNum !== undefined
          ? `${fullPath}:${lineNum}`
          : fullPath;
      } catch (e) {
        return match; // 如果解析失败，返回原样
      }
    },
  );
}

// 解析 Ninja 进度条
export interface ProgressMatchResult {
  isProgress: boolean;
  prefix?: string;
  shortMsg?: string;
  originalLine?: string;
}

export function parseNinjaProgress(line: string): ProgressMatchResult {
  // Ninja 进度条特征： [1/10] ...
  // 正则说明：匹配行首的 [数字/数字]
  const progressMatch = line.match(/^(\[\d+\/\d+\])\s+(.*)/);

  if (progressMatch) {
    const prefix = progressMatch[1]; // [1/10]
    const rest = progressMatch[2]; // 剩余的命令内容

    // 尝试从冗长的命令中提取文件名，模拟 "Building file.c" 的简洁效果
    // 逻辑：查找 .c, .cpp, .S 等源文件结尾的词
    // 这是一个简单的启发式处理，如果没匹配到就显示原命令，但保持单行刷新
    let shortMsg = rest;

    // 常见的编译命令结构匹配
    const pathModule = require("path");
    const fileMatch = rest.match(/([^\s"]+\.(c|cpp|cc|cxx|S|s|ld|xm))\b/i);
    if (fileMatch) {
      const fileName = pathModule.basename(fileMatch[1]); // 只取文件名，不带长路径
      shortMsg = `Building ${fileName}`;
    }

    return {
      isProgress: true,
      prefix,
      shortMsg,
      originalLine: line,
    };
  }

  return {
    isProgress: false,
    originalLine: line,
  };
}
