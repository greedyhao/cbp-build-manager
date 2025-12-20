// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- 常量定义 ---
// cbp2clangd 最小要求版本
const MIN_REQUIRED_CBP2CLANG_VERSION = '1.1.7';

// --- 基础数据类 ---

// 1. 普通文件夹节点 (用于下方树视图)
class DirectoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly fsPath: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'directory';
        this.iconPath = vscode.ThemeIcon.Folder;
        this.resourceUri = vscode.Uri.file(fsPath);
    }
}

// 2. CBP 项目节点 (通用于上下视图)
class CbpProjectItem extends vscode.TreeItem {
    public compileCommandsPath: string = '.';

    constructor(
        public readonly label: string,
        public readonly fsPath: string,
        public isChecked: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        public readonly showCheckbox: boolean = true
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label}\n${this.fsPath}`;
        this.description = path.basename(path.dirname(this.fsPath));
        this.contextValue = 'cbpProject';
        this.resourceUri = vscode.Uri.file(fsPath);
        
        // 设置复选框状态（仅当需要显示复选框时）
        if (showCheckbox) {
            this.checkboxState = isChecked
                ? vscode.TreeItemCheckboxState.Checked
                : vscode.TreeItemCheckboxState.Unchecked;
        }
    }
}

// --- 数据管理器 (核心逻辑) ---

class CbpDataManager {
    // 上方：有序的构建队列
    private buildQueue: CbpProjectItem[] = [];
    // 下方：所有的项目缓存 (用于计算差异)
    private allDetectedProjects: string[] = []; // 存 fsPath
    
    // 状态持久化
    private context: vscode.ExtensionContext | null = null;
    private compileCommandsPaths: Map<string, string> = new Map();

    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {}

    setContext(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadState();
    }

    // 加载状态
    private loadState() {
        if (!this.context) {return;}
        
        // 1. 加载 Compile Commands 路径配置
        const savedPaths = this.context.globalState.get<Record<string, string>>('compileCommandsPaths');
        if (savedPaths) {
            for (const [fsPath, compilePath] of Object.entries(savedPaths)) {
                this.compileCommandsPaths.set(fsPath, compilePath);
            }
        }

        // 2. 加载构建队列 (保存的是 fsPath 的有序数组)
        const savedQueuePaths = this.context.globalState.get<string[]>('buildQueueOrder') || [];
        const savedCheckState = this.context.globalState.get<Record<string, boolean>>('projectCheckState') || {};

        // 重建对象
        this.buildQueue = savedQueuePaths.map(fsPath => {
            const name = path.basename(fsPath, '.cbp');
            const isChecked = savedCheckState[fsPath] ?? true;
            const item = new CbpProjectItem(name, fsPath, isChecked, vscode.TreeItemCollapsibleState.None, true);
            this.restoreItemData(item);
            return item;
        });
    }

    private saveState() {
        if (!this.context) {return;}

        // 1. 保存队列顺序
        const queuePaths = this.buildQueue.map(p => p.fsPath);
        this.context.globalState.update('buildQueueOrder', queuePaths);

        // 2. 保存勾选状态
        const checkState: Record<string, boolean> = {};
        this.buildQueue.forEach(p => checkState[p.fsPath] = (p.checkboxState === vscode.TreeItemCheckboxState.Checked));
        this.context.globalState.update('projectCheckState', checkState);

        // 3. 保存 compile_commands 路径
        const pathsObject: Record<string, string> = {};
        this.compileCommandsPaths.forEach((val, key) => pathsObject[key] = val);
        this.context.globalState.update('compileCommandsPaths', pathsObject);
    }

    private restoreItemData(item: CbpProjectItem) {
        if (this.compileCommandsPaths.has(item.fsPath)) {
            item.compileCommandsPath = this.compileCommandsPaths.get(item.fsPath)!;
            item.tooltip = `${item.label}\n${item.fsPath}\n编译命令路径: ${item.compileCommandsPath}`;
            // 更新描述，使其在扁平列表中更清晰
            item.description = `${path.basename(path.dirname(item.fsPath))} • ${item.compileCommandsPath}`;
        }
    }

    // --- 业务逻辑 ---

    // 扫描工作区
    async scanWorkspace() {
        const cbpFiles = await vscode.workspace.findFiles('**/*.cbp');
        this.allDetectedProjects = cbpFiles.map(f => f.fsPath);
        
        // 清理构建队列中已经不存在的文件
        this.buildQueue = this.buildQueue.filter(item => 
            this.allDetectedProjects.includes(item.fsPath)
        );
        
        this._onDidChangeTreeData.fire();
    }

    // 获取构建队列 (上方列表)
    getQueueItems(): CbpProjectItem[] {
        return this.buildQueue;
    }

    // 获取资源库 (下方列表) - 自动排除已在队列中的项目
    getAvailableItems(): string[] {
        const queuedPaths = new Set(this.buildQueue.map(p => p.fsPath));
        return this.allDetectedProjects.filter(p => !queuedPaths.has(p));
    }

    // 添加到队列
    addToQueue(fsPaths: string[]) {
        let changed = false;
        fsPaths.forEach(fsPath => {
            // 防止重复
            if (!this.buildQueue.some(p => p.fsPath === fsPath)) {
                const name = path.basename(fsPath, '.cbp');
                const item = new CbpProjectItem(name, fsPath, true, vscode.TreeItemCollapsibleState.None, true);
                this.restoreItemData(item);
                this.buildQueue.push(item);
                changed = true;
            }
        });
        if (changed) {
            this.saveState();
            this._onDidChangeTreeData.fire();
        }
    }

    // 从队列移除
    removeFromQueue(items: readonly CbpProjectItem[]) {
        const pathsToRemove = new Set(items.map(i => i.fsPath));
        this.buildQueue = this.buildQueue.filter(p => !pathsToRemove.has(p.fsPath));
        this.saveState();
        this._onDidChangeTreeData.fire();
    }

    // 队列排序 (拖拽支持)
    moveQueueItem(sourceItems: CbpProjectItem[], target: CbpProjectItem) {
        const targetIndex = this.buildQueue.findIndex(p => p.fsPath === target.fsPath);
        if (targetIndex === -1) {return;}

        // 提取需要移动的项目
        const itemsToMove = sourceItems.filter(s => this.buildQueue.some(inQ => inQ.fsPath === s.fsPath));
        
        // 从原数组中移除
        const newQueue = this.buildQueue.filter(p => !itemsToMove.some(m => m.fsPath === p.fsPath));
        
        // 插入到新位置
        // 注意：如果要插入到 target 之后，需要自行调整 index逻辑，这里简单实现插入到 target 之前/位置
        // 为了更精准的拖拽体验，这里假设插入到 target 位置
        let insertIndex = newQueue.findIndex(p => p.fsPath === target.fsPath);
        if (insertIndex === -1) {insertIndex = newQueue.length;}

        newQueue.splice(insertIndex, 0, ...itemsToMove);
        
        this.buildQueue = newQueue;
        this.saveState();
        this._onDidChangeTreeData.fire();
    }

    // 更新 Checkbox
    updateCheckState(item: CbpProjectItem, state: vscode.TreeItemCheckboxState) {
        item.checkboxState = state;
        item.isChecked = (state === vscode.TreeItemCheckboxState.Checked);
        this.saveState();
    }

    // 更新 compile_commands 路径
    updateCompilePath(item: CbpProjectItem, newPath: string) {
        item.compileCommandsPath = newPath;
        this.compileCommandsPaths.set(item.fsPath, newPath);
        this.restoreItemData(item);
        this.saveState();
        this._onDidChangeTreeData.fire();
    }
}

// --- 上方视图 Provider: 构建队列 (扁平列表 + 拖拽) ---

class BuildQueueProvider implements vscode.TreeDataProvider<CbpProjectItem>, vscode.TreeDragAndDropController<CbpProjectItem> {
    dropMimeTypes = ['application/vnd.code.tree.cbpBuildQueue'];
    dragMimeTypes = ['application/vnd.code.tree.cbpBuildQueue'];

    constructor(private manager: CbpDataManager) {
        manager.onDidChangeTreeData(() => this._onDidChangeTreeData.fire());
    }

    private _onDidChangeTreeData = new vscode.EventEmitter<CbpProjectItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: CbpProjectItem): vscode.TreeItem {
        // 确保显示编译命令路径
        element.description = `${path.basename(path.dirname(element.fsPath))} • ${element.compileCommandsPath}`;
        return element;
    }

    getChildren(element?: CbpProjectItem): vscode.ProviderResult<CbpProjectItem[]> {
        // 扁平列表，没有子节点
        if (element) {return Promise.resolve([]);}
        return Promise.resolve(this.manager.getQueueItems());
    }

    // 拖拽处理
    handleDrag(source: readonly CbpProjectItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        const itemPaths = source.map(item => item.fsPath);
        dataTransfer.set('application/vnd.code.tree.cbpBuildQueue', new vscode.DataTransferItem(itemPaths));
    }

    handleDrop(target: CbpProjectItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        const transferItem = dataTransfer.get('application/vnd.code.tree.cbpBuildQueue');
        if (!transferItem || !target) {return;}

        const sourcePaths: string[] = transferItem.value;
        const queue = this.manager.getQueueItems();
        const sourceItems = queue.filter(p => sourcePaths.includes(p.fsPath));

        this.manager.moveQueueItem(sourceItems, target);
    }
}

// --- 下方视图 Provider: 资源库 (树形结构) ---

class ProjectLibraryProvider implements vscode.TreeDataProvider<CbpProjectItem | DirectoryItem> {
    constructor(private manager: CbpDataManager) {
        manager.onDidChangeTreeData(() => this._onDidChangeTreeData.fire());
    }

    private _onDidChangeTreeData = new vscode.EventEmitter<CbpProjectItem | DirectoryItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: CbpProjectItem | DirectoryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DirectoryItem): vscode.ProviderResult<(CbpProjectItem | DirectoryItem)[]> {
        const availablePaths = this.manager.getAvailableItems(); // 仅获取未添加的项目
        
        if (!element) {
            // 根目录：计算所有可用项目的顶层结构
            return this.buildTreeLevel(availablePaths, vscode.workspace.workspaceFolders?.[0].uri.fsPath || '');
        } else {
            // 子目录
            return this.buildTreeLevel(availablePaths, element.fsPath);
        }
    }

    // 动态构建文件树的核心算法
    private buildTreeLevel(allFilePaths: string[], currentDir: string): (CbpProjectItem | DirectoryItem)[] {
        const result: (CbpProjectItem | DirectoryItem)[] = [];
        const processedFolders = new Set<string>();

        for (const filePath of allFilePaths) {
            // 检查文件是否在当前目录下
            // 使用 relative 检查层级关系
            const relative = path.relative(currentDir, filePath);
            
            // 如果 relative 以 .. 开头，说明不在当前目录下
            // 如果 isAbsolute，说明跨盘符等
            if (relative.startsWith('..') || path.isAbsolute(relative)) {continue;}

            const parts = relative.split(path.sep);
            
            if (parts.length === 1) {
                // 直接是文件
                const name = path.basename(filePath, '.cbp');
                // 资源库中的项目不显示复选框
                result.push(new CbpProjectItem(name, filePath, false, vscode.TreeItemCollapsibleState.None, false));
            } else {
                // 是子文件夹
                const folderName = parts[0];
                const folderPath = path.join(currentDir, folderName);
                
                if (!processedFolders.has(folderName)) {
                    processedFolders.add(folderName);
                    result.push(new DirectoryItem(folderName, folderPath));
                }
            }
        }

        // 排序：文件夹在前，文件在后
        return result.sort((a, b) => {
            const aIsDir = a instanceof DirectoryItem;
            const bIsDir = b instanceof DirectoryItem;
            if (aIsDir === bIsDir) {return a.label!.toString().localeCompare(b.label!.toString());}
            return aIsDir ? -1 : 1;
        });
    }
}

// --- 辅助函数 ---

function decodeBuffer(buffer: Buffer): string {
    const iconv = require('iconv-lite');
    try {
        return iconv.decode(buffer, 'gbk');
    } catch {
        try {
            return iconv.decode(buffer, 'utf8');
        } catch {
            return buffer.toString('utf8');
        }
    }
}

function runCommand(cmd: string, output: vscode.OutputChannel): Promise<void> {
    return runCommandInDirectory(cmd, undefined, output);
}

function runCommandInDirectory(cmd: string, cwd: string | undefined, output: vscode.OutputChannel): Promise<void> {
    return new Promise((resolve, reject) => {
        let actualCmd = cmd;
        if (process.platform === 'win32' && cmd.startsWith('./')) {
            actualCmd = cmd.replace('./', '.\\');
        }

        const options: cp.SpawnOptions = {
            cwd,
            windowsHide: true,
            shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        };

        const child = cp.spawn(
            process.platform === 'win32' ? 'cmd.exe' : actualCmd,
            process.platform === 'win32' ? ['/c', 'echo off && ' + actualCmd] : [],
            options
        );

        if (child.stdout) {
            child.stdout.on('data', (data: Buffer) => output.append(decodeBuffer(data)));
        }
        if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => output.append(decodeBuffer(data)));
        }

        child.on('close', (code: number) => {
            if (code === 0) {resolve();}
            else {reject(new Error(`Exit code ${code}`));}
        });

        child.on('error', (err: Error) => reject(err));
    });
}

// 比较两个版本字符串，返回 true 如果 version1 >= version2
function compareVersions(version1: string, version2: string): boolean {
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

// 检查 cbp2clangd 版本
async function checkCbp2clangVersion(cbp2clangPath: string): Promise<string> {
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

// 检查并更新 ninja path 配置
function checkAndUpdateNinjaPath(config: vscode.WorkspaceConfiguration, outputChannel: vscode.OutputChannel) {
    const ninjaPath = config.get<string>('ninjaPath', '');
    outputChannel.appendLine(`开始检查 Ninja 路径: ${ninjaPath}`);
    
    if (!ninjaPath) {
        outputChannel.appendLine('Ninja 路径为空，使用系统默认 ninja 命令');
        return; // 空路径不处理
    }

    try {
        const stats = fs.statSync(ninjaPath);
        outputChannel.appendLine(`路径存在，类型: ${stats.isDirectory() ? '文件夹' : '文件'}`);
        
        if (stats.isDirectory()) {
            // 如果是文件夹，检查是否存在 ninja.exe
            const ninjaExePath = path.join(ninjaPath, 'ninja.exe');
            outputChannel.appendLine(`检查文件夹中是否存在 ninja.exe: ${ninjaExePath}`);
            
            if (fs.existsSync(ninjaExePath)) {
                // 更新配置为具体的可执行文件路径
                outputChannel.appendLine(`找到 ninja.exe，更新配置为: ${ninjaExePath}`);
                config.update('ninjaPath', ninjaExePath, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Ninja 路径已自动更新为: ${ninjaExePath}`);
            } else {
                // 文件夹中没有 ninja.exe，弹出警告
                const warningMessage = `Ninja 路径是文件夹，但未找到 ninja.exe: ${ninjaPath}`;
                outputChannel.appendLine(warningMessage);
                vscode.window.showWarningMessage(warningMessage);
            }
        } else {
            // 如果是文件，验证是否为可执行文件
            outputChannel.appendLine(`路径是文件，验证为可执行文件`);
            // 这里可以添加更多验证逻辑，比如检查文件扩展名等
        }
    } catch (error) {
        // 路径不存在，弹出错误消息
        const errorMessage = `Ninja 路径检查失败: ${(error as Error).message}`;
        outputChannel.appendLine(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
    }
    
    outputChannel.appendLine('Ninja 路径检查完成');
}



// --- 扩展激活入口 ---

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('CBP Build Manager');
    const manager = new CbpDataManager();
    manager.setContext(context);
    
    // 监听 ninjaPath 配置变化
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('cbpBuildManager.ninjaPath')) {
            const config = vscode.workspace.getConfiguration('cbpBuildManager');
            checkAndUpdateNinjaPath(config, outputChannel);
        }
    });
    
    // 初始检查
    const initialConfig = vscode.workspace.getConfiguration('cbpBuildManager');
    checkAndUpdateNinjaPath(initialConfig, outputChannel);

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
            manager.updateCheckState(item, state);
        });
    });

    // 初始扫描
    manager.scanWorkspace();

    // --- 命令注册 ---

    // 1. 刷新
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.refreshProjects', () => {
        manager.scanWorkspace();
    }));

    // 2. 检查 cbp2clangd 版本
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.checkCbp2clangVersion', async () => {
        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const cbp2clangPath = config.get<string>('cbp2clangPath', 'cbp2clang');
        
        try {
            const version = await checkCbp2clangVersion(cbp2clangPath);
            const isCompatible = compareVersions(version, MIN_REQUIRED_CBP2CLANG_VERSION);
            
            if (isCompatible) {
                vscode.window.showInformationMessage(`cbp2clangd 版本: ${version} (满足要求)`);
                outputChannel.appendLine(`cbp2clangd 版本: ${version} (满足要求，最小要求版本: ${MIN_REQUIRED_CBP2CLANG_VERSION})`);
            } else {
                vscode.window.showWarningMessage(`cbp2clangd 版本: ${version} (低于最小要求版本 ${MIN_REQUIRED_CBP2CLANG_VERSION})`);
                outputChannel.appendLine(`cbp2clangd 版本: ${version} (警告: 低于最小要求版本 ${MIN_REQUIRED_CBP2CLANG_VERSION})`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`检查 cbp2clangd 版本失败: ${(error as Error).message}`);
            outputChannel.appendLine(`检查 cbp2clangd 版本失败: ${(error as Error).message}`);
        }
    }));

    // 2. 添加到构建列表 (从下方 + 号)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.addToBuild', () => {
        const selection = libraryTreeView.selection;
        // 过滤出文件节点，忽略文件夹节点
        const filesToAdd = selection
            .filter(item => item instanceof CbpProjectItem)
            .map(item => item.fsPath);
        
        if (filesToAdd.length > 0) {
            manager.addToQueue(filesToAdd);
        } else {
            vscode.window.showInformationMessage('请选择 .cbp 项目文件');
        }
    }));

    // 3. 从构建列表移除 (上方 Remove)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.removeFromBuild', (item?: CbpProjectItem) => {
        if (item) {
            // 如果右键点击单个项目，删除该项目
            manager.removeFromQueue([item]);
        } else {
            // 否则删除当前选中的项目
            const selection = queueTreeView.selection;
            if (selection.length > 0) {
                manager.removeFromQueue(selection);
            }
        }
    }));

    // 4. 设置编译路径
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.setCompileCommandsPath', async (item: CbpProjectItem) => {
        const currentPath = item.compileCommandsPath;
        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const globalDefault = config.get<string>('compileCommandsPath', '.');
        
        const newPath = await vscode.window.showInputBox({
            title: `设置项目 ${item.label} 的编译命令路径`,
            value: currentPath,
            placeHolder: globalDefault,
            prompt: `输入 compile_commands.json 的相对输出路径`
        });
        
        if (newPath) {
            manager.updateCompilePath(item, newPath);
        }
    }));

    // 5. 执行构建 (核心功能保留)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.buildSelected', async () => {
        outputChannel.clear();
        outputChannel.show();
        
        // 获取所有在队列中且被勾选的项目
        const queue = manager.getQueueItems();
        const selectedProjects = queue.filter(p => p.checkboxState === vscode.TreeItemCheckboxState.Checked);
        
        outputChannel.appendLine(`=== 开始构建流程 ===`);
        outputChannel.appendLine(`选中项目数: ${selectedProjects.length}`);

        if (selectedProjects.length === 0) {
            vscode.window.showInformationMessage('没有选中要构建的项目。');
            return;
        }

        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const cbp2clangPath = config.get<string>('cbp2clangPath', 'cbp2clang');
        const convertCommandTemplate = config.get<string>('convertCommand', '{cbp2clang} {cbpFile} {compileCommands} -l ld');
        const buildScript = config.get<string>('buildCommand', './build.bat');
        const ninjaPath = config.get<string>('ninjaPath', '');
        
        // 检查 cbp2clangd 版本
        try {
            outputChannel.appendLine(`\n=== 检查 cbp2clangd 版本 ===`);
            const version = await checkCbp2clangVersion(cbp2clangPath);
            const isCompatible = compareVersions(version, MIN_REQUIRED_CBP2CLANG_VERSION);
            
            if (isCompatible) {
                outputChannel.appendLine(`cbp2clangd 版本: ${version} (满足要求，最小要求版本: ${MIN_REQUIRED_CBP2CLANG_VERSION})`);
            } else {
                const errorMessage = `cbp2clangd 版本 ${version} 低于最小要求版本 ${MIN_REQUIRED_CBP2CLANG_VERSION}，请升级后再试。`;
                outputChannel.appendLine(`错误: ${errorMessage}`);
                vscode.window.showErrorMessage(errorMessage);
                return; // 禁止编译
            }
        } catch (error) {
            const errorMessage = `无法检查 cbp2clangd 版本: ${(error as Error).message}，请确保 cbp2clangd 已正确安装。`;
            outputChannel.appendLine(`错误: ${errorMessage}`);
            vscode.window.showErrorMessage(errorMessage);
            return; // 禁止编译
        }

        for (const project of selectedProjects) {
            outputChannel.appendLine(`>>> 处理项目: ${project.label}`);
            
            try {
                const projectDir = path.dirname(project.fsPath);
                
                // 变量替换
                let convertCommand = convertCommandTemplate
                    .replace('{cbp2clang}', cbp2clangPath)
                    .replace('{cbpFile}', project.fsPath)
                    .replace('{compileCommands}', project.compileCommandsPath);
                
                if (ninjaPath) {
                    convertCommand += ` --ninja "${ninjaPath}"`;
                }
                
                outputChannel.appendLine(`[1/2] 生成 Compile Commands...`);
                await runCommand(convertCommand, outputChannel);
                    
                outputChannel.appendLine(`[2/2] 执行构建脚本...`);
                await runCommandInDirectory(buildScript, projectDir, outputChannel);
                
                outputChannel.appendLine(`>>> 项目 ${project.label} 完成.\n`);
            } catch (error) {
                outputChannel.appendLine(`!!! 项目 ${project.label} 失败: ${error}\n`);
                // 可以选择是否 continue，这里默认继续下一个
            }
        }
        outputChannel.appendLine(`=== 构建流程结束 ===`);
    }));

    // 6. 执行重新编译 (先清理再构建)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.rebuildSelected', async () => {
        outputChannel.clear();
        outputChannel.show();
        
        // 获取所有在队列中且被勾选的项目
        const queue = manager.getQueueItems();
        const selectedProjects = queue.filter(p => p.checkboxState === vscode.TreeItemCheckboxState.Checked);
        
        outputChannel.appendLine(`=== 开始重新编译流程 ===`);
        outputChannel.appendLine(`选中项目数: ${selectedProjects.length}`);

        if (selectedProjects.length === 0) {
            vscode.window.showInformationMessage('没有选中要重新编译的项目。');
            return;
        }

        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const cbp2clangPath = config.get<string>('cbp2clangPath', 'cbp2clang');
        const convertCommandTemplate = config.get<string>('convertCommand', '{cbp2clang} {cbpFile} {compileCommands} -l ld');
        const buildScript = config.get<string>('buildCommand', './build.bat');
        const ninjaPath = config.get<string>('ninjaPath', '');
        
        // 检查 cbp2clangd 版本
        try {
            outputChannel.appendLine(`\n=== 检查 cbp2clangd 版本 ===`);
            const version = await checkCbp2clangVersion(cbp2clangPath);
            const isCompatible = compareVersions(version, MIN_REQUIRED_CBP2CLANG_VERSION);
            
            if (isCompatible) {
                outputChannel.appendLine(`cbp2clangd 版本: ${version} (满足要求，最小要求版本: ${MIN_REQUIRED_CBP2CLANG_VERSION})`);
            } else {
                const errorMessage = `cbp2clangd 版本 ${version} 低于最小要求版本 ${MIN_REQUIRED_CBP2CLANG_VERSION}，请升级后再试。`;
                outputChannel.appendLine(`错误: ${errorMessage}`);
                vscode.window.showErrorMessage(errorMessage);
                return; // 禁止编译
            }
        } catch (error) {
            const errorMessage = `无法检查 cbp2clangd 版本: ${(error as Error).message}，请确保 cbp2clangd 已正确安装。`;
            outputChannel.appendLine(`错误: ${errorMessage}`);
            vscode.window.showErrorMessage(errorMessage);
            return; // 禁止编译
        }

        for (const project of selectedProjects) {
            outputChannel.appendLine(`>>> 处理项目: ${project.label}`);
            
            try {
                const projectDir = path.dirname(project.fsPath);
                
                // 1. 运行 ninja -t clean 清理
                outputChannel.appendLine(`[0/3] 清理构建文件...`);
                const ninjaCommand = ninjaPath ? `${ninjaPath} -t clean` : `ninja -t clean`;
                await runCommandInDirectory(ninjaCommand, projectDir, outputChannel);
                
                // 2. 变量替换
                let convertCommand = convertCommandTemplate
                    .replace('{cbp2clang}', cbp2clangPath)
                    .replace('{cbpFile}', project.fsPath)
                    .replace('{compileCommands}', project.compileCommandsPath);
                
                if (ninjaPath) {
                    convertCommand += ` --ninja "${ninjaPath}"`;
                }
                
                outputChannel.appendLine(`[1/3] 生成 Compile Commands...`);
                await runCommand(convertCommand, outputChannel);
                    
                outputChannel.appendLine(`[2/3] 执行构建脚本...`);
                await runCommandInDirectory(buildScript, projectDir, outputChannel);
                
                outputChannel.appendLine(`>>> 项目 ${project.label} 重新编译完成.\n`);
            } catch (error) {
                outputChannel.appendLine(`!!! 项目 ${project.label} 重新编译失败: ${error}\n`);
                // 可以选择是否 continue，这里默认继续下一个
            }
        }
        outputChannel.appendLine(`=== 重新编译流程结束 ===`);
    }));

    // 7. 执行清理 (仅清理构建文件)
    context.subscriptions.push(vscode.commands.registerCommand('cbp-build-manager.cleanSelected', async () => {
        outputChannel.clear();
        outputChannel.show();
        
        // 获取所有在队列中且被勾选的项目
        const queue = manager.getQueueItems();
        const selectedProjects = queue.filter(p => p.checkboxState === vscode.TreeItemCheckboxState.Checked);
        
        outputChannel.appendLine(`=== 开始清理流程 ===`);
        outputChannel.appendLine(`选中项目数: ${selectedProjects.length}`);

        if (selectedProjects.length === 0) {
            vscode.window.showInformationMessage('没有选中要清理的项目。');
            return;
        }

        const config = vscode.workspace.getConfiguration('cbpBuildManager');
        const ninjaPath = config.get<string>('ninjaPath', '');

        for (const project of selectedProjects) {
            outputChannel.appendLine(`>>> 处理项目: ${project.label}`);
            
            try {
                const projectDir = path.dirname(project.fsPath);
                
                // 运行 ninja -t clean 清理
                outputChannel.appendLine(`[1/1] 清理构建文件...`);
                const ninjaCommand = ninjaPath ? `${ninjaPath} -t clean` : `ninja -t clean`;
                await runCommandInDirectory(ninjaCommand, projectDir, outputChannel);
                
                outputChannel.appendLine(`>>> 项目 ${project.label} 清理完成.\n`);
            } catch (error) {
                outputChannel.appendLine(`!!! 项目 ${project.label} 清理失败: ${error}\n`);
                // 可以选择是否 continue，这里默认继续下一个
            }
        }
        outputChannel.appendLine(`=== 清理流程结束 ===`);
    }));
}

// This method is called when your extension is deactivated
export function deactivate() {}
