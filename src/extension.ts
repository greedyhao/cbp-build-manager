// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

// Re-export from new modules for backward compatibility
export { CbpProjectItem, DirectoryItem } from './models/items';
export { CbpDataManager } from './services/DataManager';
export { BuildQueueProvider, ProjectLibraryProvider } from './providers';
export { BuildTerminal, createOrShowTerminal, runCommand, runCommandInDirectory } from './terminal/TerminalManager';
export { decodeBuffer, formatOutput, compareVersions, OutputLineBuffer } from './utils';
export { mergeCompileCommands, checkMergeCommandSupport, mergeCompileCommandsFiles } from './services/index';

// --- 常量定义 ---
// cbp2clangd 最小要求版本
const MIN_REQUIRED_CBP2CLANG_VERSION = '1.3.0';

// Import from modules
import { CbpDataManager } from './services/DataManager.js';
import { createOrShowTerminal, runCommand, runCommandInDirectory } from './terminal/TerminalManager.js';
import { compareVersions } from './utils/index.js';
import { mergeCompileCommandsFiles } from './services/index.js';
import { CompileCommandsProvider } from './providers/CompileCommandsProvider.js';

// --- 检查 cbp2clangd 版本 ---
async function checkCbp2clangVersion(cbp2clangPath: string): Promise<string> {
    const { decodeBuffer } = await import('./utils/index.js');
    return new Promise((resolve, reject) => {
        let version = '';
        let error = '';

        const options: cp.SpawnOptions = {
            windowsHide: true,
            shell: process.platform === 'win32' ? 'cmd.exe' : undefined
        };

        const child = cp.spawn(
            process.platform === 'win32' ? 'cmd.exe' : cbp2clangPath,
            process.platform === 'win32' ? ['/c', `${cbp2clangPath} -v`] : ['-v'],
            options
        );

        if (child.stdout) {
            child.stdout.on('data', (data: Buffer) => {
                version += decodeBuffer(data);
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => {
                error += decodeBuffer(data);
            });
        }

        child.on('close', (code: number) => {
            if (code === 0) {
                // 解析版本信息，格式：cbp2clangd v1.1.5
                const versionMatch = version.match(/v([0-9]+\.[0-9]+\.[0-9]+)/);
                if (versionMatch) {
                    resolve(versionMatch[1]);
                } else {
                    resolve(version.trim());
                }
            } else {
                reject(new Error(`Failed to check cbp2clangd version: ${error || `Exit code ${code}`}`));
            }
        });

        child.on('error', (err: Error) => {
            reject(new Error(`Failed to execute cbp2clangd: ${err.message}`));
        });
    });
}

// 检测未保存文件并提示保存
async function checkAndPromptSave(): Promise<boolean> {
    // 获取所有未保存的文档
    const unsavedDocs = vscode.workspace.textDocuments.filter(doc => doc.isDirty);

    if (unsavedDocs.length > 0) {
        // 弹窗提示用户是否保存所有未保存的文件
        const result = await vscode.window.showInformationMessage(
            `检测到 ${unsavedDocs.length} 个未保存的文件，是否全部保存？`,
            { modal: true },
            '全部保存',
            '不保存'
        );

        switch (result) {
            case '全部保存':
                // 保存所有未保存的文档
                await Promise.all(unsavedDocs.map(doc => doc.save()));
                return true;
            case '不保存':
                // 不保存，继续执行操作
                return true;
            default:
                // 用户取消操作 (点击取消按钮或关闭对话框)
                return false;
        }
    }

    // 没有未保存的文件，直接继续执行操作
    return true;
}

// 检查并更新 ninja path 配置
function checkAndUpdateNinjaPath(config: vscode.WorkspaceConfiguration) {
    const { createOrShowTerminal } = require('./terminal/TerminalManager');
    const ninjaPath = config.get<string>('ninjaPath', '');
    const terminal = createOrShowTerminal();
    terminal.write(`开始检查 Ninja 路径: ${ninjaPath}\n`);

    if (!ninjaPath) {
        terminal.write('Ninja 路径为空，使用系统默认 ninja 命令\n');
        return; // 空路径不处理
    }

    try {
        const stats = fs.statSync(ninjaPath);
        terminal.write(`路径存在，类型: ${stats.isDirectory() ? '文件夹' : '文件'}\n`);

        if (stats.isDirectory()) {
            // 如果是文件夹，检查是否存在 ninja.exe
            const ninjaExePath = path.join(ninjaPath, 'ninja.exe');
            terminal.write(`检查文件夹中是否存在 ninja.exe: ${ninjaExePath}\n`);

            if (fs.existsSync(ninjaExePath)) {
                // 更新配置为具体的可执行文件路径
                terminal.write(`找到 ninja.exe，更新配置为: ${ninjaExePath}\n`);
                config.update('ninjaPath', ninjaExePath, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Ninja 路径已自动更新为: ${ninjaExePath}`);
            } else {
                // 文件夹中没有 ninja.exe，弹出警告
                const warningMessage = `Ninja 路径是文件夹，但未找到 ninja.exe: ${ninjaPath}`;
                terminal.write(`${warningMessage}\n`);
                vscode.window.showWarningMessage(warningMessage);
            }
        } else {
            // 如果是文件，验证是否为可执行文件
            terminal.write(`路径是文件，验证为可执行文件\n`);
            // 这里可以添加更多验证逻辑，比如检查文件扩展名等
        }
    } catch (error) {
        // 路径不存在，弹出错误消息
        const errorMessage = `Ninja 路径检查失败: ${(error as Error).message}`;
        terminal.write(`${errorMessage}\n`);
        vscode.window.showErrorMessage(errorMessage);
    }

    terminal.write('Ninja 路径检查完成\n');
}

// --- 全局终端管理 (for cleanup) ---
import { getGlobalTerminal, getGlobalPty } from './terminal/TerminalManager';

// --- 扩展激活入口 ---

export function activate(context: vscode.ExtensionContext) {
    const manager = new CbpDataManager();
    manager.setContext(context);

    // 导入 Provider
    const { BuildQueueProvider, ProjectLibraryProvider } = require('./providers');

    // 监听终端关闭，清理全局变量引用
    context.subscriptions.push(vscode.window.onDidCloseTerminal((terminal) => {
        const g_terminal = getGlobalTerminal();
        if (terminal.name === 'CBP Build Manager' && g_terminal && terminal === g_terminal) {
            const { resetGlobalTerminal } = require('./terminal/TerminalManager');
            resetGlobalTerminal();
        }
    }));

    // 监听 ninjaPath 配置变化
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('cbpBuildManager.ninjaPath')) {
            const config = vscode.workspace.getConfiguration('cbpBuildManager');
            checkAndUpdateNinjaPath(config);
        }
    });

    // 初始检查
    const initialConfig = vscode.workspace.getConfiguration('cbpBuildManager');
    checkAndUpdateNinjaPath(initialConfig);

    const buildQueueProvider = new BuildQueueProvider(manager);
    const libraryProvider = new ProjectLibraryProvider(manager);

    // 注册上方视图 (支持拖拽)
    const queueTreeView = vscode.window.createTreeView('cbpBuildQueue', {
        treeDataProvider: buildQueueProvider,
        dragAndDropController: buildQueueProvider,
        canSelectMany: true
    });

    // 注册下方视图
    const libraryTreeView = vscode.window.createTreeView('cbpProjectLibrary', {
        treeDataProvider: libraryProvider,
        canSelectMany: true
    });

    // 监听 Checkbox 变化
    queueTreeView.onDidChangeCheckboxState(e => {
        e.items.forEach(([item, state]) => {
            manager.updateCheckState(item as any, state);
        });
    });

    // Compile Commands 视图
    const compileCommandsProvider = new CompileCommandsProvider(manager);

    const compileCommandsTreeView = vscode.window.createTreeView('cbpCompileCommands', {
        treeDataProvider: compileCommandsProvider,
        canSelectMany: true
    });

    compileCommandsTreeView.onDidChangeCheckboxState(e => {
        e.items.forEach(([item, state]) => {
            manager.updateCompileCommandsCheckState(item as any, state);
        });
    });

    // 初始扫描
    manager.scanWorkspace();
    manager.scanCompileCommands();

    // --- 命令注册 ---

    // 1. 刷新
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.refreshProjects', () => {
        manager.scanWorkspace();
    }));

    // 2. 检查 cbp2clangd 版本
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.checkCbp2clangVersion', async () => {
        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const cbp2clangPath = config.get<string>('cbp2clangPath', 'cbp2clang');
        const terminal = createOrShowTerminal();

        try {
            const version = await checkCbp2clangVersion(cbp2clangPath);
            const isCompatible = compareVersions(version, MIN_REQUIRED_CBP2CLANG_VERSION);

            if (isCompatible) {
                vscode.window.showInformationMessage(`cbp2clangd 版本: ${version} (满足要求)`);
                terminal.write(`cbp2clangd 版本: ${version} (满足要求，最小要求版本: ${MIN_REQUIRED_CBP2CLANG_VERSION})\n`);
            } else {
                vscode.window.showWarningMessage(`cbp2clangd 版本: ${version} (低于最小要求版本 ${MIN_REQUIRED_CBP2CLANG_VERSION})`);
                terminal.write(`cbp2clangd 版本: ${version} (警告: 低于最小要求版本 ${MIN_REQUIRED_CBP2CLANG_VERSION})\n`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`检查 cbp2clangd 版本失败: ${(error as Error).message}`);
            terminal.write(`检查 cbp2clangd 版本失败: ${(error as Error).message}\n`);
        }
    }));

    // 2. 添加到构建列表 (从下方 + 号)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.addToBuild', () => {
        // 动态导入避免循环依赖
        const { CbpProjectItem } = require('./models/items.js');
        const selection = libraryTreeView.selection;
        // 过滤出文件节点，忽略文件夹节点
        const filesToAdd = selection
            .filter((item: any) => item instanceof CbpProjectItem)
            .map((item: any) => item.fsPath);

        if (filesToAdd.length > 0) {
            manager.addToQueue(filesToAdd);
        } else {
            vscode.window.showInformationMessage('请选择 .cbp 项目文件');
        }
    }));

    // 按芯片系列筛选
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.filterByChip', async () => {
        const chips = manager.getAvailableChips();

        if (chips.length === 0) {
            vscode.window.showInformationMessage('未检测到芯片系列');
            return;
        }

        const currentFilter = manager.getChipFilter();
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(clear-all) 显示全部',
                description: currentFilter === null ? '当前选择' : '',
                detail: '显示所有项目'
            },
            ...chips.map(chip => ({
                label: `$(chip) ${chip}`,
                description: currentFilter === chip ? '当前选择' : '',
                detail: `只显示 ${chip} 系列的项目`
            }))
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要筛选的芯片系列'
        });

        if (selected) {
            if (selected.label.includes('显示全部')) {
                manager.setChipFilter(null);
            } else {
                const chipName = selected.label.replace('$(chip) ', '');
                manager.setChipFilter(chipName);
            }
        }
    }));

    // 刷新 Compile Commands 视图
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.refreshCompileCommands', () => {
        manager.scanCompileCommands();
    }));

    // 合并 Compile Commands
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.mergeCompileCommands', async () => {
        const terminal = createOrShowTerminal();
        const checkedItems = manager.getCompileCommandsItems()
            .filter(item => item.checkboxState === vscode.TreeItemCheckboxState.Checked);

        if (checkedItems.length === 0) {
            terminal.write('没有勾选需要合并的 compile_commands.json\r\n');
            vscode.window.showInformationMessage('没有勾选 compile_commands.json 文件，请先勾选后再合并');
            return;
        }

        // 构建队列最后一个 CBP 对应的 compile_commands.json 作为合并目标（第一个参数）
        const queueItems = manager.getQueueItems();
        const targetJsonPath = queueItems.length > 0
            ? path.join(path.dirname(queueItems[queueItems.length - 1].fsPath), 'compile_commands.json')
            : '';

        // 按目标在前、其余在后的顺序排列
        let files = checkedItems.map(item => item.fsPath);
        if (targetJsonPath) {
            const targetIndex = files.findIndex(f => path.normalize(f) === path.normalize(targetJsonPath));
            if (targetIndex > 0) {
                // 将目标 json 移到第一位
                files = [files[targetIndex], ...files.slice(0, targetIndex), ...files.slice(targetIndex + 1)];
            } else if (targetIndex === -1) {
                // 目标未勾选，强制插入到第一位
                terminal.write(`\x1b[33m构建队列最后一个项目的 compile_commands.json 未勾选，已自动加入合并目标\x1b[0m\r\n`);
                files = [targetJsonPath, ...files];
            }
            // targetIndex === 0: 已经在第一位，无需调整
        }

        if (files.length < 2) {
            terminal.write('至少需要 2 个 compile_commands.json 才能合并\r\n');
            vscode.window.showInformationMessage('至少需要 2 个 compile_commands.json 才能合并');
            return;
        }

        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const cbp2clangPath = config.get<string>('cbp2clangPath', 'cbp2clang');
        const debugMode = config.get<boolean>('debug', false);

        terminal.write(`\x1b[36m=== 合并 ${files.length} 个 compile_commands.json ===\x1b[0m\r\n`);
        const success = await mergeCompileCommandsFiles(files, cbp2clangPath, debugMode, (msg) => terminal.write(msg));
        if (success) {
            vscode.window.showInformationMessage(`成功合并 ${files.length} 个 compile_commands.json`);
        } else {
            terminal.write(`\x1b[31m合并失败\x1b[0m\r\n`);
            vscode.window.showErrorMessage('合并 compile_commands.json 失败，请检查终端输出');
        }
    }));

    // 3. 从构建列表移除 (上方 Remove)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.removeFromBuild', (item?: any) => {
        if (item) {
            // 如果右键点击单个项目，删除该项目
            manager.removeFromQueue([item]);
        } else {
            // 否则删除当前选中的项目
            const selection = queueTreeView.selection;
            if (selection.length > 0) {
                manager.removeFromQueue(selection as any);
            }
        }
    }));

    // 5. 执行构建 (核心功能保留)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.buildSelected', async () => {
        // 检测未保存文件并提示保存
        if (!(await checkAndPromptSave())) {
            return; // 用户取消操作
        }

        const terminal = createOrShowTerminal();
        terminal.write(`\x1b[36m=== 开始构建流程 ===\x1b[0m\n`);

        // 获取所有在队列中且被勾选的项目
        const queue = manager.getQueueItems();
        const selectedProjects = queue.filter(p => p.checkboxState === vscode.TreeItemCheckboxState.Checked);

        terminal.write(`选中项目数: ${selectedProjects.length}\n`);

        if (selectedProjects.length === 0) {
            vscode.window.showInformationMessage('没有选中要构建的项目。');
            return;
        }

        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const cbp2clangPath = config.get<string>('cbp2clangPath', 'cbp2clang');
        const convertCommandTemplate = config.get<string>('convertCommand', '{cbp2clang} {cbpFile} {compileCommands} -l ld');
        const buildScript = config.get<string>('buildCommand', './build.bat');
        const ninjaPath = config.get<string>('ninjaPath', '');
        const noHeaderInsertion = config.get<boolean>('noHeaderInsertion', false);
        const debugMode = config.get<boolean>('debug', false);
        const stopOnFailure = config.get<boolean>('stopOnFailure', false);

        if (debugMode) {
            terminal.write(`\x1b[36m[调试] 调试模式已开启\x1b[0m\n`);
        }

        // 检查 cbp2clangd 版本
        try {
            terminal.write(`\n\x1b[36m=== 检查 cbp2clangd 版本 ===\x1b[0m\n`);
            const version = await checkCbp2clangVersion(cbp2clangPath);
            const isCompatible = compareVersions(version, MIN_REQUIRED_CBP2CLANG_VERSION);

            if (isCompatible) {
                terminal.write(`cbp2clangd 版本: ${version} (满足要求，最小要求版本: ${MIN_REQUIRED_CBP2CLANG_VERSION})\n`);
            } else {
                const errorMessage = `cbp2clangd 版本 ${version} 低于最小要求版本 ${MIN_REQUIRED_CBP2CLANG_VERSION}，请升级后再试。`;
                terminal.write(`\x1b[31m错误: ${errorMessage}\x1b[0m\n`);
                vscode.window.showErrorMessage(errorMessage);
                return; // 禁止编译
            }
        } catch (error) {
            const errorMessage = `无法检查 cbp2clangd 版本: ${(error as Error).message}，请确保 cbp2clangd 已正确安装。`;
            terminal.write(`\x1b[31m错误: ${errorMessage}\x1b[0m\n`);
            vscode.window.showErrorMessage(errorMessage);
            return; // 禁止编译
        }

        for (const project of selectedProjects) {
            terminal.write(`\n\x1b[33m>>> 处理项目: ${project.label}\x1b[0m\n`);

            try {
                const projectDir = path.dirname(project.fsPath);

                // 获取 VSCode 工作区路径
                const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || projectDir;

                // 变量替换
                let convertCommand = convertCommandTemplate
                    .replace('{cbp2clang}', cbp2clangPath)
                    .replace('{cbpFile}', project.fsPath)
                    .replace('{compileCommands}', workspacePath);

                if (ninjaPath) {
                    convertCommand += ` --ninja "${ninjaPath}"`;
                }

                if (noHeaderInsertion) {
                    convertCommand += ` --no-header-insertion`;
                }

                if (debugMode) {
                    convertCommand += ` --debug`;
                }

                terminal.write(`执行的转换命令: ${convertCommand}\n`);
                terminal.write(`\x1b[32m[1/2] 生成 Compile Commands...\x1b[0m\n`);
                await runCommand(convertCommand);

                terminal.write(`\x1b[32m[2/2] 执行构建脚本...\x1b[0m\n`);
                await runCommandInDirectory(buildScript, projectDir);

                terminal.write(`\x1b[32m>>> 项目 ${project.label} 完成.\x1b[0m\n`);
            } catch (error) {
                terminal.write(`\x1b[31m!!! 项目 ${project.label} 失败: ${error}\x1b[0m\n`);
                if (stopOnFailure) {
                    terminal.write(`\x1b[31m>>> 编译失败，停止后续项目\x1b[0m\n`);
                    break;
                }
                // 继续下一个项目
            }
        }

        // 刷新 compile_commands.json 视图
        manager.scanCompileCommands();

        terminal.write(`\n\x1b[36m=== 构建流程结束 ===\x1b[0m\n`);
    }));

    // 6. 执行重新编译 (先清理再构建)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.rebuildSelected', async () => {
        // 检测未保存文件并提示保存
        if (!(await checkAndPromptSave())) {
            return; // 用户取消操作
        }

        const terminal = createOrShowTerminal();
        terminal.write(`\x1b[36m=== 开始重新编译流程 ===\x1b[0m\n`);

        // 获取所有在队列中且被勾选的项目
        const queue = manager.getQueueItems();
        const selectedProjects = queue.filter(p => p.checkboxState === vscode.TreeItemCheckboxState.Checked);

        terminal.write(`选中项目数: ${selectedProjects.length}\n`);

        if (selectedProjects.length === 0) {
            vscode.window.showInformationMessage('没有选中要重新编译的项目。');
            return;
        }

        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const cbp2clangPath = config.get<string>('cbp2clangPath', 'cbp2clang');
        const convertCommandTemplate = config.get<string>('convertCommand', '{cbp2clang} {cbpFile} {compileCommands} -l ld');
        const buildScript = config.get<string>('buildCommand', './build.bat');
        const ninjaPath = config.get<string>('ninjaPath', '');
        const noHeaderInsertion = config.get<boolean>('noHeaderInsertion', false);
        const debugMode = config.get<boolean>('debug', false);
        const stopOnFailure = config.get<boolean>('stopOnFailure', false);

        if (debugMode) {
            terminal.write(`\x1b[36m[调试] 调试模式已开启\x1b[0m\n`);
        }

        // 检查 cbp2clangd 版本
        try {
            terminal.write(`\n\x1b[36m=== 检查 cbp2clangd 版本 ===\x1b[0m\n`);
            const version = await checkCbp2clangVersion(cbp2clangPath);
            const isCompatible = compareVersions(version, MIN_REQUIRED_CBP2CLANG_VERSION);

            if (isCompatible) {
                terminal.write(`cbp2clangd 版本: ${version} (满足要求，最小要求版本: ${MIN_REQUIRED_CBP2CLANG_VERSION})\n`);
            } else {
                const errorMessage = `cbp2clangd 版本 ${version} 低于最小要求版本 ${MIN_REQUIRED_CBP2CLANG_VERSION}，请升级后再试。`;
                terminal.write(`\x1b[31m错误: ${errorMessage}\x1b[0m\n`);
                vscode.window.showErrorMessage(errorMessage);
                return; // 禁止编译
            }
        } catch (error) {
            const errorMessage = `无法检查 cbp2clangd 版本: ${(error as Error).message}，请确保 cbp2clangd 已正确安装。`;
            terminal.write(`\x1b[31m错误: ${errorMessage}\x1b[0m\n`);
            vscode.window.showErrorMessage(errorMessage);
            return; // 禁止编译
        }

        for (const project of selectedProjects) {
            terminal.write(`\n\x1b[33m>>> 处理项目: ${project.label}\x1b[0m\n`);

            try {
                const projectDir = path.dirname(project.fsPath);

                // 获取 VSCode 工作区路径
                const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || projectDir;

                // 1. 运行 ninja -t clean 清理
                terminal.write(`\x1b[32m[0/3] 清理构建文件...\x1b[0m\n`);
                const ninjaCommand = ninjaPath ? `${ninjaPath} -t clean` : `ninja -t clean`;
                await runCommandInDirectory(ninjaCommand, projectDir);

                // 2. 变量替换
                let convertCommand = convertCommandTemplate
                    .replace('{cbp2clang}', cbp2clangPath)
                    .replace('{cbpFile}', project.fsPath)
                    .replace('{compileCommands}', workspacePath);

                if (ninjaPath) {
                    convertCommand += ` --ninja "${ninjaPath}"`;
                }

                if (noHeaderInsertion) {
                    convertCommand += ` --no-header-insertion`;
                }

                if (debugMode) {
                    convertCommand += ` --debug`;
                }

                terminal.write(`执行的转换命令: ${convertCommand}\n`);
                terminal.write(`\x1b[32m[1/3] 生成 Compile Commands...\x1b[0m\n`);
                await runCommand(convertCommand);

                terminal.write(`\x1b[32m[2/3] 执行构建脚本...\x1b[0m\n`);
                await runCommandInDirectory(buildScript, projectDir);

                terminal.write(`\x1b[32m>>> 项目 ${project.label} 重新编译完成.\x1b[0m\n`);
            } catch (error) {
                terminal.write(`\x1b[31m!!! 项目 ${project.label} 重新编译失败: ${error}\x1b[0m\n`);
                if (stopOnFailure) {
                    terminal.write(`\x1b[31m>>> 编译失败，停止后续项目\x1b[0m\n`);
                    break;
                }
                // 继续下一个项目
            }
        }

        // 刷新 compile_commands.json 视图
        manager.scanCompileCommands();

        terminal.write(`\n\x1b[36m=== 重新编译流程结束 ===\x1b[0m\n`);
    }));

    // 7. 执行清理 (仅清理构建文件)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.cleanSelected', async () => {
        // 检测未保存文件并提示保存
        if (!(await checkAndPromptSave())) {
            return; // 用户取消操作
        }

        const terminal = createOrShowTerminal();
        terminal.write(`\x1b[36m=== 开始清理流程 ===\x1b[0m\n`);

        // 获取所有在队列中且被勾选的项目
        const queue = manager.getQueueItems();
        const selectedProjects = queue.filter(p => p.checkboxState === vscode.TreeItemCheckboxState.Checked);

        terminal.write(`选中项目数: ${selectedProjects.length}\n`);

        if (selectedProjects.length === 0) {
            vscode.window.showInformationMessage('没有选中要清理的项目。');
            return;
        }

        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const ninjaPath = config.get<string>('ninjaPath', '');

        for (const project of selectedProjects) {
            terminal.write(`\n\x1b[33m>>> 处理项目: ${project.label}\x1b[0m\n`);

            try {
                const projectDir = path.dirname(project.fsPath);

                // 运行 ninja -t clean 清理
                terminal.write(`\x1b[32m[1/1] 清理构建文件...\x1b[0m\n`);
                const ninjaCommand = ninjaPath ? `${ninjaPath} -t clean` : `ninja -t clean`;
                await runCommandInDirectory(ninjaCommand, projectDir);

                terminal.write(`\x1b[32m>>> 项目 ${project.label} 清理完成.\x1b[0m\n`);
            } catch (error) {
                terminal.write(`\x1b[31m!!! 项目 ${project.label} 清理失败: ${error}\x1b[0m\n`);
                // 可以选择是否 continue，这里默认继续下一个
            }
        }
        terminal.write(`\n\x1b[36m=== 清理流程结束 ===\x1b[0m\n`);
    }));
}

// This method is called when your extension is deactivated
export function deactivate() {}
