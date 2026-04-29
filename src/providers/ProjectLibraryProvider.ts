import * as vscode from 'vscode';
import * as path from 'path';
import { CbpDataManager } from '../services';
import { CbpProjectItem, DirectoryItem } from '../models/items';

// --- 下方视图 Provider: 资源库 (树形结构) ---

export class ProjectLibraryProvider implements vscode.TreeDataProvider<CbpProjectItem | DirectoryItem> {
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

        // 当 currentDir 为空时，计算所有文件的公共父目录作为根目录
        let effectiveDir = currentDir;
        if (!effectiveDir && allFilePaths.length > 0) {
            effectiveDir = allFilePaths.reduce((prefix, p) => {
                while (prefix && !p.startsWith(prefix)) {
                    const parent = path.dirname(prefix);
                    if (parent === prefix) { return ''; }
                    prefix = parent;
                }
                return prefix;
            }, allFilePaths[0]);
            // 公共前缀是文件路径本身（所有文件相同），取其父目录
            if (effectiveDir === allFilePaths[0]) {
                effectiveDir = path.dirname(effectiveDir);
            }
        }

        if (!effectiveDir) {
            for (const filePath of allFilePaths) {
                const name = path.basename(filePath, '.cbp');
                result.push(new CbpProjectItem(name, filePath, false, vscode.TreeItemCollapsibleState.None, false));
            }
            return result.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
        }

        const processedFolders = new Set<string>();

        for (const filePath of allFilePaths) {
            // 检查文件是否在当前目录下
            // 使用 relative 检查层级关系
            const relative = path.relative(effectiveDir, filePath);

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
                const folderPath = path.join(effectiveDir, folderName);

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
