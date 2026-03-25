// 1. 更加健壮的解码函数
export function decodeBuffer(buffer: Buffer): string {
    try {
        const iconv = require('iconv-lite');

        // 许多现代工具(Clang/Ninja)在Windows上也输出UTF-8
        // 但CMD默认环境经常是GBK。
        // 策略：尝试用 UTF-8 解码，如果发现乱码字符（），则判定为 GBK。
        const strUtf8 = iconv.decode(buffer, 'utf8');

        // 检查是否存在"替换字符" (U+FFFD)，这通常意味着UTF-8解码失败
        if (strUtf8.includes('\uFFFD')) {
            // 如果UTF-8解码看起来不对，尝试GBK
            try {
                return iconv.decode(buffer, 'gbk');
            } catch {
                return strUtf8; // 尽力而为
            }
        }
        return strUtf8;
    } catch (error) {
        // 如果iconv-lite不可用，直接使用UTF-8解码
        return buffer.toString('utf8');
    }
}

// 2. 格式化输出：解决阶梯状换行问题
export function formatOutput(text: string): string {
    // 核心修复：Pseudoterminal 需要 \r\n 才能正确换行并回到行首
    // 但要避免重复的 \r 字符导致格式错乱

    // 1. 先将所有的 \r\n 替换为 \n，避免重复处理
    let normalized = text.replace(/\r\n/g, '\n');

    // 2. 再将单独的 \r 替换为 \n，确保只有 \n 作为换行符
    normalized = normalized.replace(/\r/g, '\n');

    // 3. 最后将所有的 \n 替换为 \r\n，确保终端正确显示
    normalized = normalized.replace(/\n/g, '\r\n');

    return normalized;
}

// 比较两个版本字符串，返回 true 如果 version1 >= version2
export function compareVersions(version1: string, version2: string): boolean {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1 = v1Parts[i] || 0;
        const v2 = v2Parts[i] || 0;

        if (v1 > v2) {return true;}
        if (v1 < v2) {return false;}
    }

    return true; // 版本相同
}

// --- 辅助类：行缓冲处理器 ---
// 用于解决流式数据可能将一行日志切断的问题，确保每次 callback 都是完整的一行
export class OutputLineBuffer {
    private buffer = '';

    constructor(private onLine: (line: string) => void) {}

    append(chunk: string) {
        this.buffer += chunk;
        let index;
        // 循环提取完整的行
        while ((index = this.buffer.indexOf('\n')) !== -1) {
            // 提取一行，去除末尾的回车符
            const line = this.buffer.substring(0, index).replace(/\r$/, '');
            this.onLine(line);
            // 移动缓冲区指针
            this.buffer = this.buffer.substring(index + 1);
        }
    }

    // 处理流结束后的剩余数据
    flush() {
        if (this.buffer.trim().length > 0) {
            this.onLine(this.buffer);
            this.buffer = '';
        }
    }

    // Get current buffer state (for testing)
    getBuffer(): string {
        return this.buffer;
    }
}

// 处理构建命令中的路径
export function processBuildCommandPath(line: string, cwd: string): string {
    // 支持源文件和头文件
    // 注意：这里加了 \\. 确保后缀名前的点被正确转义
    const fileExtensionPattern = '\\.(c|cpp|cc|cxx|h|hpp|hh|hxx)';

    // 修改点：
    // 1. 在字符集 [] 中增加了 \\. 以支持相对路径中的点 (如 ../)
    // 2. 增加了 \\\\ 以更稳健地支持 Windows 反斜杠
    // 3. 增加了 :? 放在盘符位置，虽然通常不放在字符集里，但为了简单匹配路径体，
    //    我们主要扩充允许的字符：字母、数字、下划线、减号、点、斜杠、反斜杠
    const validPathChars = '[a-zA-Z0-9_\\-\\.\\/\\\\]';

    // 正则表达式：匹配文件路径 + 行号
    // 匹配模式：[路径] : [行号] [分隔符]
    const filePathPattern = new RegExp(`(${validPathChars}+${fileExtensionPattern}):(\\d+)(:|,)`, 'g');

    return line.replace(filePathPattern, (match, relPath, ext, lineNum, separator) => {
        try {
            const pathModule = require('path');

            // 检查路径是否已经是绝对路径（Windows 盘符格式如 D:\\ 或 D:/）
            const isWindowsAbsolute = /^[a-zA-Z]:[\\\/]/.test(relPath);
            const isUnixAbsolute = relPath.startsWith('/');

            let fullPath: string;
            if (isWindowsAbsolute || isUnixAbsolute) {
                // 如果已经是绝对路径，直接使用，避免与 cwd 拼接导致双重盘符
                fullPath = relPath;
            } else {
                // 将相对路径转换为完整路径
                // path.resolve 会自动处理 .. 和 .
                fullPath = pathModule.resolve(cwd, relPath);
            }

            return `${fullPath}:${lineNum}${separator}`;
        } catch (e) {
            return match; // 如果解析失败，返回原样
        }
    });
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
        const rest = progressMatch[2];   // 剩余的命令内容

        // 尝试从冗长的命令中提取文件名，模拟 "Building file.c" 的简洁效果
        // 逻辑：查找 .c, .cpp, .S 等源文件结尾的词
        // 这是一个简单的启发式处理，如果没匹配到就显示原命令，但保持单行刷新
        let shortMsg = rest;

        // 常见的编译命令结构匹配
        const pathModule = require('path');
        const fileMatch = rest.match(/([^\s"]+\.(c|cpp|cc|cxx|S|s|ld|xm))\b/i);
        if (fileMatch) {
            const fileName = pathModule.basename(fileMatch[1]); // 只取文件名，不带长路径
            shortMsg = `Building ${fileName}`;
        }

        return {
            isProgress: true,
            prefix,
            shortMsg,
            originalLine: line
        };
    }

    return {
        isProgress: false,
        originalLine: line
    };
}
