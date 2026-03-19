import * as vscode from 'vscode';
import * as path from 'path';
import { CbpProjectItem } from '../models/items';

// --- 数据管理器 (核心逻辑) ---

export class CbpDataManager {
    // 上方：有序的构建队列
    private buildQueue: CbpProjectItem[] = [];
    // 下方：所有的项目缓存 (用于计算差异)
    private allDetectedProjects: string[] = []; // 存 fsPath

    // 芯片系列筛选
    private chipFilter: string | null = null; // null 表示显示全部

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

        // 加载芯片筛选状态（工作区级别）
        this.chipFilter = this.context.workspaceState.get<string | null>('chipFilter') || null;

        // 重建对象
        this.buildQueue = savedQueuePaths.map(fsPath => {
            const name = path.basename(fsPath, '.cbp');
            const isChecked = savedCheckState[fsPath] ?? true;
            const item = new CbpProjectItem(name, fsPath, isChecked, vscode.TreeItemCollapsibleState.None, true);
            return item;
        });
    }

    protected saveState() {
        if (!this.context) {return;}

        // 1. 保存队列顺序
        const queuePaths = this.buildQueue.map(p => p.fsPath);
        this.context.globalState.update('buildQueueOrder', queuePaths);

        // 2. 保存勾选状态
        const checkState: Record<string, boolean> = {};
        this.buildQueue.forEach(p => checkState[p.fsPath] = (p.checkboxState === vscode.TreeItemCheckboxState.Checked));
        this.context.globalState.update('projectCheckState', checkState);

        // 3. 保存芯片筛选状态（工作区级别）
        this.context.workspaceState.update('chipFilter', this.chipFilter);
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
}
