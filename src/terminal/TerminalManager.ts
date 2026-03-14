import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { decodeBuffer, formatOutput, OutputLineBuffer, processBuildCommandPath, parseNinjaProgress } from '../utils';

// --- Pseudoterminal 实现 ---

export class BuildTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    private closeEmitter = new vscode.EventEmitter<number>();
    onDidClose: vscode.Event<number> = this.closeEmitter.event;

    // 保持一个内部状态，防止多次 dispose
    private isClosed = false;

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire('\x1b[36mCBP Build Manager Terminal Ready.\x1b[0m\r\n\r\n');
    }

    close(): void {
        if (!this.isClosed) {
            this.isClosed = true;
            this.closeEmitter.fire(0);
        }
    }

    write(data: string): void {
        if (!this.isClosed) {
            this.writeEmitter.fire(formatOutput(data));
        }
    }

    // 提供一个方法来发送原始 ANSI 序列（不进行换行处理）
    writeRaw(data: string): void {
         if (!this.isClosed) {
            this.writeEmitter.fire(data);
        }
    }

    // 获取终端关闭状态（用于测试）
    getIsClosed(): boolean {
        return this.isClosed;
    }

    // 模拟终端关闭（用于测试）
    simulateClose(): void {
        this.close();
    }
}

// --- 全局终端管理 (核心修复：复用逻辑) ---

// 我们需要同时持有 VS Code 的 Terminal 对象(用于 show) 和 我们的 PTY 对象(用于 write)
let g_terminal: vscode.Terminal | null = null;
let g_pty: BuildTerminal | null = null;

export function createOrShowTerminal(): BuildTerminal {
    const TERMINAL_NAME = 'CBP Build Manager';

    // 1. 检查当前保存的实例是否有效
    // 这里的关键是：必须同时检查 变量是否非空 AND VS Code 的终端列表里是否真的有它
    // (因为用户可能直接点击垃圾桶关掉了终端，但变量还没来得及清空)
    const existingTerminal = vscode.window.terminals.find(t => t.name === TERMINAL_NAME);

    if (g_terminal && g_pty && existingTerminal && existingTerminal === g_terminal) {
        // 完美匹配，复用
        g_terminal.show();
        return g_pty;
    }

    // 2. 如果状态不一致（例如 UI 上有这个终端，但我们丢失了 PTY 句柄，通常发生在重载窗口后），
    // 必须销毁旧的，因为我们无法连接到旧终端的输入流
    if (existingTerminal) {
        existingTerminal.dispose();
    }

    // 3. 创建全新实例
    g_pty = new BuildTerminal();
    g_terminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        pty: g_pty,
        isTransient: false
    });

    g_terminal.show();
    return g_pty;
}

// 获取全局终端实例（用于测试）
export function getGlobalTerminal(): vscode.Terminal | null {
    return g_terminal;
}

// 获取全局 PTY 实例（用于测试）
export function getGlobalPty(): BuildTerminal | null {
    return g_pty;
}

// 重置全局终端状态（用于测试）
export function resetGlobalTerminal(): void {
    g_terminal = null;
    g_pty = null;
}

// 设置全局终端（用于测试）
export function setGlobalTerminal(terminal: vscode.Terminal | null, pty: BuildTerminal | null): void {
    g_terminal = terminal;
    g_pty = pty;
}

// --- 命令执行 ---

export function runCommand(cmd: string): Promise<void> {
    return runCommandInDirectory(cmd, undefined);
}

// --- 命令执行函数 (核心修改) ---

export function runCommandInDirectory(cmd: string, cwd: string | undefined): Promise<void> {
    const pty = createOrShowTerminal();

    return new Promise((resolve, reject) => {
        let actualCmd = cmd.replace(/\u00A0/g, ' ').trim();

        // 构造 Windows 兼容的 Spawn 参数
        let spawnCmd = actualCmd;
        let spawnArgs: string[] = [];
        let spawnOptions: cp.SpawnOptions = {
            cwd,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                CLICOLOR_FORCE: '1',
                FORCE_COLOR: '1',
                ANSICON: '1'
            },
            stdio: ['pipe', 'pipe', 'pipe']
        };

        if (process.platform === 'win32') {
            if (actualCmd.startsWith('./')) {
                actualCmd = actualCmd.replace('./', '.\\');
            }
            if (actualCmd.includes('"')) {
                actualCmd = `"${actualCmd}"`;
            }

            spawnCmd = 'cmd.exe';
            spawnArgs = ['/d', '/c', actualCmd];

            spawnOptions.shell = false;
            spawnOptions.windowsVerbatimArguments = true;
            spawnOptions.windowsHide = true;
        } else {
            spawnOptions.shell = true;
            spawnOptions.windowsHide = true;
        }

        // 显示启动命令
        let displayCmd = actualCmd;
        if (process.platform === 'win32' && displayCmd.length > 2 && displayCmd.startsWith('"') && displayCmd.endsWith('"')) {
             displayCmd = displayCmd.slice(1, -1);
        }
        pty.write(`\x1b[33m$ ${displayCmd}\x1b[0m\r\n`);

        try {
            const child = cp.spawn(spawnCmd, spawnArgs, spawnOptions);

            // 定义行处理逻辑：模拟 Ninja 的 TTY 行为
            const handleLineOutput = (line: string) => {
                const progressResult = parseNinjaProgress(line);

                if (progressResult.isProgress) {
                    // 关键点：
                    // \r      -> 回到行首
                    // \x1b[K  -> 清除当前行内容 (防止旧的长文字残留在后面)
                    // 不加 \n -> 保持在同一行
                    pty.writeRaw(`\r\x1b[K\x1b[32m${progressResult.prefix}\x1b[0m ${progressResult.shortMsg}`);
                } else {
                    // 非进度条信息（如错误、警告、CMake输出），正常换行打印

                    // 处理错误和警告信息，将相对路径转换为完整路径
                    let processedLine = line;
                    if (cwd) {
                        processedLine = processBuildCommandPath(processedLine, cwd);
                    }

                    pty.write(`\r\n${processedLine}`);
                }
            };

            // 使用 OutputLineBuffer 来处理 stdout 和 stderr
            const lineBuffer = new OutputLineBuffer(handleLineOutput);

            if (child.stdout) {
                child.stdout.on('data', (data: Buffer) => {
                    lineBuffer.append(decodeBuffer(data));
                });
            }

            if (child.stderr) {
                child.stderr.on('data', (data: Buffer) => {
                    // stderr 也走同样的 buffer 逻辑，防止切断
                    // 通常 Ninja 的错误信息也是正常文本，不需要特殊红色处理，
                    // 因为 Clang/GCC 自身带有颜色代码。
                    lineBuffer.append(decodeBuffer(data));
                });
            }

            child.on('close', (code: number) => {
                // 确保缓冲区最后的内容被打印
                lineBuffer.flush();
                // 最后换个行，结束进度条状态
                pty.write('\r\n');

                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Exit code ${code}`));
                }
            });

            child.on('error', (err: Error) => {
                pty.write(`\x1b[31mSpawn Error: ${err.message}\x1b[0m\r\n`);
                reject(err);
            });
        } catch (error) {
            pty.write(`\x1b[31mExecution Error: ${(error as Error).message}\x1b[0m\r\n`);
            reject(error);
        }
    });
}
