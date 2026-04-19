import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CbpProjectItem } from '../models/items';

// --- 数据管理器 (核心逻辑) ---

export class CbpDataManager {
    // 上方：有序的构建队列
    private buildQueue: CbpProjectItem[] = [];
    // 下方：所有的项目缓存 (用于计算差异)
    private allDetectedProjects: string[] = []; // 存 fsPath

    // 芯片系列筛选
    private chipFilter: string | null = null; // null 表示显示全部

    // 持久化文件路径
    private stateFilePath: string | null = null;

    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {}

    setContext(context: vscode.ExtensionContext) {
        // 设置工作区状态文件路径
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspacePath) {
            this.stateFilePath = path.join(workspacePath, '.cbp-build', 'queue.json');
        }
        this.loadState();
    }

    // 获取持久化文件目录
    private getStateDir(): string | null {
        if (!this.stateFilePath) {return null;}
        return path.dirname(this.stateFilePath);
    }

    // 加载状态
    private loadState() {
        if (!this.stateFilePath) {return;}

        try {
            if (!fs.existsSync(this.stateFilePath)) {return;}

            const content = fs.readFileSync(this.stateFilePath, 'utf-8');
            const state = JSON.parse(content);

            // 加载构建队列
            const savedQueuePaths: string[] = state.queuePaths || [];
            const savedCheckState: Record<string, boolean> = state.checkState || {};

            // 重建对象
            this.buildQueue = savedQueuePaths.map(fsPath => {
                // 检查文件是否仍存在
                if (!fs.existsSync(fsPath)) {return null;}
                const name = path.basename(fsPath, '.cbp');
                const isChecked = savedCheckState[fsPath] ?? true;
                return new CbpProjectItem(name, fsPath, isChecked, vscode.TreeItemCollapsibleState.None, true);
            }).filter((item): item is CbpProjectItem => item !== null);

            // 加载芯片筛选状态
            this.chipFilter = state.chipFilter ?? null;
        } catch (error) {
            // 读取失败时使用空状态
            console.error('[CbpDataManager] Failed to load state:', error);
        }
    }

    protected saveState() {
        if (!this.stateFilePath) {return;}

        try {
            // 确保目录存在
            const dir = this.getStateDir();
            if (dir && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // 保存队列顺序和勾选状态
            const queuePaths = this.buildQueue.map(p => p.fsPath);
            const checkState: Record<string, boolean> = {};
            this.buildQueue.forEach(p => checkState[p.fsPath] = (p.checkboxState === vscode.TreeItemCheckboxState.Checked));

            const state = {
                queuePaths,
                checkState,
                chipFilter: this.chipFilter
            };

            fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
        } catch (error) {
            console.error('[CbpDataManager] Failed to save state:', error);
        }
    }

    // --- 业务逻辑 ---

    // 扫描工作区
    async scanWorkspace() {
        const cbpFiles = await vscode.workspace.findFiles('**/*.cbp');
        this.allDetectedProjects = cbpFiles.map(f => f.fsPath);
        this._onDidChangeTreeData.fire();
    }

    // 获取构建队列 (上方列表)
    getQueueItems(): CbpProjectItem[] {
        return this.buildQueue;
    }

    // 获取资源库 (下方列表) - 自动排除已在队列中的项目
    getAvailableItems(): string[] {
        const queuedPaths = new Set(this.buildQueue.map(p => p.fsPath));
        let available = this.allDetectedProjects.filter(p => !queuedPaths.has(p));

        // 应用芯片筛选
        if (this.chipFilter) {
            available = available.filter(p => this.matchesChipFilter(p));
        }

        return available;
    }

    // 检查项目路径是否匹配芯片筛选
    private matchesChipFilter(projectPath: string): boolean {
        if (!this.chipFilter) {return true;}

        const chipName = this.extractChipName(projectPath);
        // 如果项目没有芯片名称，则显示（没有相同芯片名的工程）
        // 如果项目有芯片名称，则必须匹配筛选器
        return !chipName || chipName === this.chipFilter;
    }

    // 从项目路径中提取芯片名称
    private extractChipName(projectPath: string): string | null {
        const parts = projectPath.split(path.sep);
        // 查找 project 文件夹后的第一个文件夹名
        const projectIndex = parts.findIndex(p => p === 'project');
        if (projectIndex !== -1 && projectIndex < parts.length - 1) {
            return parts[projectIndex + 1];
        }
        return null;
    }

    // 获取所有可用的芯片系列
    getAvailableChips(): string[] {
        const chips = new Set<string>();
        this.allDetectedProjects.forEach(p => {
            const chip = this.extractChipName(p);
            if (chip) {
                chips.add(chip);
            }
        });
        return Array.from(chips).sort();
    }

    // 设置芯片筛选
    setChipFilter(chip: string | null) {
        this.chipFilter = chip;
        this.saveState();
        this._onDidChangeTreeData.fire();
    }

    // 获取当前芯片筛选
    getChipFilter(): string | null {
        return this.chipFilter;
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
    moveQueueItem(sourceItems: CbpProjectItem[], target?: CbpProjectItem) {
        // 提取需要移动的项目
        const itemsToMove = sourceItems.filter(s => this.buildQueue.some(inQ => inQ.fsPath === s.fsPath));

        // 从原数组中移除
        const newQueue = this.buildQueue.filter(p => !itemsToMove.some(m => m.fsPath === p.fsPath));

        if (target) {
            // 插入到目标位置
            let insertIndex = newQueue.findIndex(p => p.fsPath === target.fsPath);
            if (insertIndex === -1) {insertIndex = newQueue.length;}
            newQueue.splice(insertIndex, 0, ...itemsToMove);
        } else {
            // 无目标（拖到队尾），添加到末尾
            newQueue.push(...itemsToMove);
        }

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

    // 获取所有检测到的项目
    getAllDetectedProjects(): string[] {
        return this.allDetectedProjects;
    }

    // 设置所有检测到的项目（用于测试）
    setAllDetectedProjects(projects: string[]) {
        this.allDetectedProjects = projects;
    }

    // 设置构建队列（用于测试）
    setBuildQueue(queue: CbpProjectItem[]) {
        this.buildQueue = queue;
    }

    // 设置状态文件路径（用于测试）
    setStateFilePath(filePath: string) {
        this.stateFilePath = filePath;
    }
}
