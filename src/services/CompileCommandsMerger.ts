import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { CbpProjectItem } from '../models/items';
import { decodeBuffer } from '../utils';

/**
 * 检查 cbp2clangd 是否支持 merge-compile-commands 命令
 * @param cbp2clangPath cbp2clangd 可执行文件路径
 * @returns 是否支持 merge-compile-commands 命令
 */
export async function checkMergeCommandSupport(cbp2clangPath: string): Promise<boolean> {
    return new Promise((resolve) => {
        const options: cp.SpawnOptions = {
            windowsHide: true,
            shell: process.platform === 'win32' ? 'cmd.exe' : undefined
        };

        const child = cp.spawn(
            process.platform === 'win32' ? 'cmd.exe' : cbp2clangPath,
            process.platform === 'win32' ? ['/c', `${cbp2clangPath} --help`] : ['--help'],
            options
        );

        let output = '';

        if (child.stdout) {
            child.stdout.on('data', (data: Buffer) => {
                output += decodeBuffer(data);
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => {
                output += decodeBuffer(data);
            });
        }

        child.on('close', () => {
            resolve(output.includes('merge-compile-commands'));
        });

        child.on('error', () => {
            resolve(false);
        });

        // 超时保护
        setTimeout(() => {
            child.kill();
            resolve(false);
        }, 5000);
    });
}

/**
 * 合并多个项目的 compile_commands.json
 * 通过传递 CBP 项目路径，让 cbp2clangd 自动查找对应的 compile_commands.json
 * @param projects 项目列表（CbpProjectItem）
 * @param cbp2clangPath cbp2clangd 可执行文件路径
 * @param workspacePath 工作区根目录路径（备用）
 * @param debug 是否启用调试模式
 * @param terminalWrite 可选的终端写入函数，用于输出日志
 * @returns 是否成功合并
 */
export async function mergeCompileCommands(
    projects: CbpProjectItem[],
    cbp2clangPath: string,
    workspacePath: string,
    debug: boolean = false,
    terminalWrite?: (msg: string) => void
): Promise<boolean> {
    const log = (msg: string) => {
        if (terminalWrite) {
            terminalWrite(msg);
        }
    };

    const debugLog = (msg: string) => {
        if (debug && terminalWrite) {
            terminalWrite(msg);
        }
    };

    // 只有一个或没有项目，无需合并
    if (projects.length <= 1) {
        log('\x1b[33m跳过合并: 项目数量少于2个\x1b[0m\n');
        return true;
    }

    // 获取所有 CBP 项目路径
    const cbpPaths = projects.map(project => project.fsPath);

    // 调试信息：输出所有 CBP 路径
    debugLog('\x1b[36m[调试] 预期的 CBP 项目路径:\x1b[0m\n');
    cbpPaths.forEach((p, idx) => {
        debugLog(`  [${idx + 1}] ${p}\n`);
    });

    // 检查所有 CBP 文件是否存在
    const existingCbpPaths = cbpPaths.filter(p => {
        try {
            const exists = fs.existsSync(p);
            debugLog(`\x1b[36m[调试] 检查 CBP 文件 ${path.basename(p)}: ${exists ? '存在' : '不存在'}\x1b[0m\n`);
            return exists;
        } catch {
            return false;
        }
    });

    if (existingCbpPaths.length <= 1) {
        debugLog(`\x1b[36m[调试] 找到 ${existingCbpPaths.length} 个有效的 CBP 文件\x1b[0m\n`);
        log('\x1b[33m跳过合并: 有效的 CBP 项目数量少于2个\x1b[0m\n');
        return true;
    }

    // 合并目标：最后一个项目的 CBP 文件
    const targetCbpPath = existingCbpPaths[existingCbpPaths.length - 1];

    // 合并源：除了最后一个之外的所有 CBP 文件
    const sourceCbpPaths = existingCbpPaths.slice(0, -1);

    log(`\n\x1b[36m=== 合并 compile_commands.json ===\x1b[0m\n`);
    log(`目标项目: ${path.basename(targetCbpPath)}\n`);
    log(`源项目: ${sourceCbpPaths.map(p => path.basename(p)).join(', ')}\n`);

    try {
        // 构造合并命令
        // cbp2clang merge-compile-commands --output-dir <目标项目目录> <target_cbp> <source1_cbp> <source2_cbp> ...
        // cbp2clang 会自动从每个 CBP 项目中查找 compile_commands.json
        const allCbpPaths = [targetCbpPath, ...sourceCbpPaths];

        // 直接执行 cbp2clang 命令
        // 添加 --output-dir 参数指定输出目录
        const mergeArgs = ['merge-compile-commands', '--output-dir', workspacePath, ...allCbpPaths];

        debugLog(`\x1b[36m[调试] 完整命令: ${cbp2clangPath} ${mergeArgs.join(' ')}\x1b[0m\n`);

        const result = await new Promise<{ success: boolean; error?: string; stdout?: string }>((resolve, reject) => {
            const child = cp.spawn(cbp2clangPath, mergeArgs, {
                windowsHide: true,
                shell: true
            });

            let stderr = '';
            let stdout = '';

            // 设置超时
            const timeout = setTimeout(() => {
                child.kill();
                reject(new Error('合并命令执行超时'));
            }, 30000); // 30秒超时

            if (child.stdout) {
                child.stdout.on('data', (data: Buffer) => {
                    stdout += decodeBuffer(data);
                });
            }

            if (child.stderr) {
                child.stderr.on('data', (data: Buffer) => {
                    stderr += decodeBuffer(data);
                });
            }

            child.on('close', (code: number) => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve({ success: true, stdout });
                } else {
                    resolve({ success: false, error: stderr || `Exit code ${code}`, stdout });
                }
            });

            child.on('error', (err: Error) => {
                clearTimeout(timeout);
                debugLog(`\x1b[31m[调试] 命令执行错误: ${err.message}\x1b[0m\n`);
                resolve({ success: false, error: err.message });
            });
        });

        if (result.success) {
            if (result.stdout) {
                log(`\x1b[90m${result.stdout}\x1b[0m\n`);
            }
            log(`\x1b[32m合并完成: 已将 ${sourceCbpPaths.length} 个项目的 compile_commands.json 合并到 "${path.basename(targetCbpPath)}"\x1b[0m\n`);
            return true;
        } else {
            log(`\x1b[33m警告: 合并 compile_commands.json 失败: ${result.error}\x1b[0m\n`);
            if (result.stdout) {
                log(`\x1b[90m${result.stdout}\x1b[0m\n`);
            }
            return false;
        }
    } catch (error) {
        log(`\x1b[33m警告: 合并 compile_commands.json 时发生异常: ${(error as Error).message}\x1b[0m\n`);
        return false;
    }
}
