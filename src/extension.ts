// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- 常量定义 ---
// cbp2clangd 最小要求版本
const MIN_REQUIRED_CBP2CLANG_VERSION = '1.2.7';

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
        
        // 加载构建队列 (保存的是 fsPath 的有序数组)
        const savedQueuePaths = this.context.globalState.get<string[]>('buildQueueOrder') || [];
        const savedCheckState = this.context.globalState.get<Record<string, boolean>>('projectCheckState') || {};

        // 重建对象
        this.buildQueue = savedQueuePaths.map(fsPath => {
            const name = path.basename(fsPath, '.cbp');
            const isChecked = savedCheckState[fsPath] ?? true;
            const item = new CbpProjectItem(name, fsPath, isChecked, vscode.TreeItemCollapsibleState.None, true);
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

// 1. 更加健壮的解码函数
function decodeBuffer(buffer: Buffer): string {
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
function formatOutput(text: string): string {
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

// --- Pseudoterminal 实现 ---

class BuildTerminal implements vscode.Pseudoterminal {
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
}

// --- 全局终端管理 (核心修复：复用逻辑) ---

// 我们需要同时持有 VS Code 的 Terminal 对象(用于 show) 和 我们的 PTY 对象(用于 write)
let g_terminal: vscode.Terminal | null = null;
let g_pty: BuildTerminal | null = null;

function createOrShowTerminal(): BuildTerminal {
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

// --- 命令执行 ---

function runCommand(cmd: string): Promise<void> {
    return runCommandInDirectory(cmd, undefined);
}
// --- 辅助类：行缓冲处理器 ---
// 用于解决流式数据可能将一行日志切断的问题，确保每次 callback 都是完整的一行
class OutputLineBuffer {
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
}

// --- 命令执行函数 (核心修改) ---

function runCommandInDirectory(cmd: string, cwd: string | undefined): Promise<void> {
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
                    const fileMatch = rest.match(/([^\s"]+\.(c|cpp|cc|cxx|S|s|ld|xm))\b/i);
                    if (fileMatch) {
                        const fileName = path.basename(fileMatch[1]); // 只取文件名，不带长路径
                        shortMsg = `Building ${fileName}`;
                    } else {
                        // 如果提取不到文件名，且命令太长，可以截断 (可选)
                        // shortMsg = rest.length > 80 ? rest.substring(0, 77) + '...' : rest;
                    }

                    // 关键点：
                    // \r      -> 回到行首
                    // \x1b[K  -> 清除当前行内容 (防止旧的长文字残留在后面)
                    // 不加 \n -> 保持在同一行
                    pty.writeRaw(`\r\x1b[K\x1b[32m${prefix}\x1b[0m ${shortMsg}`);
                } else {
                    // 非进度条信息（如错误、警告、CMake输出），正常换行打印
                    
                    // 处理错误和警告信息，将相对路径转换为完整路径
                    let processedLine = line;
                    if (cwd) {
                        // 支持源文件和头文件
                        // 注意：这里加了 \\. 确保后缀名前的点被正确转义
                        const fileExtensionPattern = '\\.(c|cpp|cc|cxx|h|hpp|hh|hxx)';
                        
                        // --- 修改开始 ---
                        // 修改点：
                        // 1. 在字符集 [] 中增加了 \\. 以支持相对路径中的点 (如 ../)
                        // 2. 增加了 \\\\ 以更稳健地支持 Windows 反斜杠
                        // 3. 增加了 :? 放在盘符位置，虽然通常不放在字符集里，但为了简单匹配路径体，
                        //    我们主要扩充允许的字符：字母、数字、下划线、减号、点、斜杠、反斜杠
                        const validPathChars = '[a-zA-Z0-9_\\-\\.\\/\\\\]';
                        
                        // 正则表达式：匹配文件路径 + 行号
                        // 匹配模式：[路径] : [行号] [分隔符]
                        const filePathPattern = new RegExp(`(${validPathChars}+${fileExtensionPattern}):(\\d+)(:|,)`, 'g');
                        // --- 修改结束 ---
                        
                        processedLine = processedLine.replace(filePathPattern, (match, relPath, ext, lineNum, separator) => {
                            try {
                                // 将相对路径转换为完整路径
                                // path.resolve 会自动处理 .. 和 .
                                const fullPath = path.resolve(cwd, relPath);
                                return `${fullPath}:${lineNum}${separator}`;
                            } catch (e) {
                                return match; // 如果解析失败，返回原样
                            }
                        });
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



// --- 扩展激活入口 ---

export function activate(context: vscode.ExtensionContext) {
    const manager = new CbpDataManager();
    manager.setContext(context);

    // 监听终端关闭，清理全局变量引用
    context.subscriptions.push(vscode.window.onDidCloseTerminal((terminal) => {
        if (terminal.name === 'CBP Build Manager') {
            g_terminal = null;
            g_pty = null;
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
        terminal.write(`noHeaderInsertion 配置值 (cbpBuildManager.noHeaderInsertion): ${noHeaderInsertion}\n`);
        
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

                terminal.write(`执行的转换命令: ${convertCommand}\n`);
                terminal.write(`\x1b[32m[1/2] 生成 Compile Commands...\x1b[0m\n`);
                await runCommand(convertCommand);
                    
                terminal.write(`\x1b[32m[2/2] 执行构建脚本...\x1b[0m\n`);
                await runCommandInDirectory(buildScript, projectDir);
                
                terminal.write(`\x1b[32m>>> 项目 ${project.label} 完成.\x1b[0m\n`);
            } catch (error) {
                terminal.write(`\x1b[31m!!! 项目 ${project.label} 失败: ${error}\x1b[0m\n`);
                // 可以选择是否 continue，这里默认继续下一个
            }
        }
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
        terminal.write(`noHeaderInsertion 配置值 (cbpBuildManager.noHeaderInsertion): ${noHeaderInsertion}\n`);
        
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

                terminal.write(`执行的转换命令: ${convertCommand}\n`);
                terminal.write(`\x1b[32m[1/3] 生成 Compile Commands...\x1b[0m\n`);
                await runCommand(convertCommand);
                    
                terminal.write(`\x1b[32m[2/3] 执行构建脚本...\x1b[0m\n`);
                await runCommandInDirectory(buildScript, projectDir);
                
                terminal.write(`\x1b[32m>>> 项目 ${project.label} 重新编译完成.\x1b[0m\n`);
            } catch (error) {
                terminal.write(`\x1b[31m!!! 项目 ${project.label} 重新编译失败: ${error}\x1b[0m\n`);
                // 可以选择是否 continue，这里默认继续下一个
            }
        }
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
