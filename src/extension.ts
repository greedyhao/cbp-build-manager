// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Define the CBP project item class
class CbpProjectItem extends vscode.TreeItem {
	// Add project-specific compile commands path
	public compileCommandsPath: string = '.';

	constructor(
		public readonly label: string,
		public readonly fsPath: string,
		public isCompiled: boolean, // 新增：传入当前状态
		public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
	) {
		super(label, collapsibleState);
		this.tooltip = `${this.label}\n${this.fsPath}\n编译命令路径: ${this.compileCommandsPath}`;
		this.description = path.basename(path.dirname(this.fsPath));
		// Set context value for menu contributions
		this.contextValue = 'cbpProject';
		
		// 设置复选框状态
		this.checkboxState = isCompiled
			? vscode.TreeItemCheckboxState.Checked
			: vscode.TreeItemCheckboxState.Unchecked;
		
		// 移除之前的图标设置，因为复选框已经提供了视觉反馈
	}
}

// 定义 MIME 类型常量，保持一致性
const CBP_MIME_TYPE = 'application/vnd.code.tree.cbpproject';

// Define the TreeDataProvider with drag and drop support
class CbpProjectsProvider implements vscode.TreeDataProvider<CbpProjectItem>, vscode.TreeDragAndDropController<CbpProjectItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<CbpProjectItem | undefined | void> = new vscode.EventEmitter<CbpProjectItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<CbpProjectItem | undefined | void> = this._onDidChangeTreeData.event;

	// Store projects in two separate arrays
	private compiledProjects: CbpProjectItem[] = [];
	private uncompiledProjects: CbpProjectItem[] = [];
	
	// Store compile commands paths persistently
	private compileCommandsPaths: Map<string, string> = new Map();
	
	// Store project allocation status persistently
	// Key: project fsPath, Value: true if compiled, false if uncompiled
	private projectAllocation: Map<string, boolean> = new Map();
	
	// Reference to extension context for saving state
	private context: vscode.ExtensionContext | null = null;
	
	// Set extension context for saving state
	setContext(context: vscode.ExtensionContext): void {
		this.context = context;
		// Load saved allocation status
		const savedAllocation = context.globalState.get<Record<string, boolean>>('projectAllocation');
		if (savedAllocation) {
			for (const [fsPath, isCompiled] of Object.entries(savedAllocation)) {
				this.projectAllocation.set(fsPath, isCompiled);
			}
		}
	}
	
	// Save allocation status to global state
	private saveAllocationStatus(): void {
		if (!this.context) {
			return;
		}
		// Convert Map to object for storage
		const allocationObject: Record<string, boolean> = {};
		for (const [fsPath, isCompiled] of this.projectAllocation.entries()) {
			allocationObject[fsPath] = isCompiled;
		}
		// Save to global state
		this.context.globalState.update('projectAllocation', allocationObject);
	}

	// Refresh the project list
	async refresh(): Promise<void> {
		await this.scanProjects();
		this._onDidChangeTreeData.fire();
	}

	// Scan workspace for .cbp files
	private async scanProjects(): Promise<void> {
		if (!vscode.workspace.workspaceFolders) {
			this.compiledProjects = [];
			this.uncompiledProjects = [];
			return;
		}

		const cbpFiles = await vscode.workspace.findFiles('**/*.cbp');
		const allProjects: CbpProjectItem[] = [];
		
		// Create new project items
		for (const file of cbpFiles) {
			const isCompiled = this.projectAllocation.get(file.fsPath) ?? false;
			const item = new CbpProjectItem(
				path.basename(file.fsPath, '.cbp'),
				file.fsPath,
				isCompiled, // 传递状态
				vscode.TreeItemCollapsibleState.None
			);
			// Restore saved compile commands path if exists
			if (this.compileCommandsPaths.has(file.fsPath)) {
				item.compileCommandsPath = this.compileCommandsPaths.get(file.fsPath)!;
				item.tooltip = `${item.label}\n${item.fsPath}\n编译命令路径: ${item.compileCommandsPath}`;
			}
			allProjects.push(item);
		}
		
		// Split projects into compiled and uncompiled lists based on allocation status
		this.compiledProjects = [];
		this.uncompiledProjects = [];
		
		for (const project of allProjects) {
			// Get allocation status, default to false (uncompiled) if not found
			const isCompiled = this.projectAllocation.get(project.fsPath) ?? false;
			if (isCompiled) {
				this.compiledProjects.push(project);
			} else {
				this.uncompiledProjects.push(project);
			}
		}
	}

	// Get tree item with enhanced visual style
	getTreeItem(element: CbpProjectItem): vscode.TreeItem {
		// Show compile commands path in description for better visibility
		element.description = `${path.basename(path.dirname(element.fsPath))} • ${element.compileCommandsPath}`;
		
		return element;
	}

	// Get children - returns all projects (for backward compatibility)
	getChildren(element?: CbpProjectItem): Thenable<CbpProjectItem[]> {
		if (!element) {
			return Promise.resolve([...this.compiledProjects, ...this.uncompiledProjects]);
		}
		return Promise.resolve([]);
	}

	// Get compiled projects
	getCompiledProjects(): CbpProjectItem[] {
		return this.compiledProjects;
	}

	// Get uncompiled projects
	getUncompiledProjects(): CbpProjectItem[] {
		return this.uncompiledProjects;
	}



	// Update compile commands path for a project
	updateCompileCommandsPath(element: CbpProjectItem, newPath: string): void {
		element.compileCommandsPath = newPath;
		// Save to persistent storage
		this.compileCommandsPaths.set(element.fsPath, newPath);
		// Update tooltip to show new compile commands path
		element.tooltip = `${element.label}\n${element.fsPath}\n编译命令路径: ${element.compileCommandsPath}`;
		this._onDidChangeTreeData.fire();
	}

	// Drag and drop configuration
    dropMimeTypes = [CBP_MIME_TYPE];
    dragMimeTypes = [CBP_MIME_TYPE];

    // Handle drag operation
    handleDrag(source: CbpProjectItem[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
        if (source.length > 0) {
            // 关键修复：传递项目的 fsPath 字符串，而不是整个对象
            // 这样在 handleDrop 中通过 fsPath 查找原始对象更可靠
            treeDataTransfer.set(CBP_MIME_TYPE, new vscode.DataTransferItem(source[0].fsPath));
        }
    }

	async handleDrop(target: CbpProjectItem | undefined, treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const transferItem = treeDataTransfer.get(CBP_MIME_TYPE);
        if (!transferItem) {
            return;
        }

        const draggedFsPath = transferItem.value as string;
        const allProjects = [...this.compiledProjects, ...this.uncompiledProjects];
        const draggedItem = allProjects.find(p => p.fsPath === draggedFsPath);
        
        if (!draggedItem) {
            return;
        }

        // 确定来源
        const isFromCompiled = this.compiledProjects.some(p => p.fsPath === draggedFsPath);

        // --- 核心修复逻辑开始 ---
        let targetIsCompiled: boolean;

        if (target) {
            // 如果落点在具体项目上，则目标列表由该项目决定
            targetIsCompiled = this.compiledProjects.some(p => p.fsPath === target.fsPath);
        } else {
            // 【修改点】：如果落点在空白处，保持它原来的归属状态，这样它就会飞到当前表的末尾
            // 而不是取反 (!isFromCompiled)
            targetIsCompiled = isFromCompiled; 
        }
        // --- 核心修复逻辑结束 ---

        // 从旧列表中移除
        this.compiledProjects = this.compiledProjects.filter(p => p.fsPath !== draggedFsPath);
        this.uncompiledProjects = this.uncompiledProjects.filter(p => p.fsPath !== draggedFsPath);

        // 插入到新列表
        if (targetIsCompiled) {
            const index = target ? this.compiledProjects.findIndex(p => p.fsPath === target.fsPath) : -1;
            if (index !== -1) {
                this.compiledProjects.splice(index, 0, draggedItem);
            } else {
                this.compiledProjects.push(draggedItem);
            }
            this.projectAllocation.set(draggedFsPath, true);
            draggedItem.checkboxState = vscode.TreeItemCheckboxState.Checked; // 同步复选框
        } else {
            const index = target ? this.uncompiledProjects.findIndex(p => p.fsPath === target.fsPath) : -1;
            if (index !== -1) {
                this.uncompiledProjects.splice(index, 0, draggedItem);
            } else {
                this.uncompiledProjects.push(draggedItem);
            }
            this.projectAllocation.set(draggedFsPath, false);
            draggedItem.checkboxState = vscode.TreeItemCheckboxState.Unchecked; // 同步复选框
        }

        this.saveAllocationStatus();
        this._onDidChangeTreeData.fire();
    }

	// Get selected projects in order - returns compiled projects
	getSelectedProjects(): CbpProjectItem[] {
		return this.compiledProjects;
	}

	// Get all projects (for debugging)
	getProjects(): CbpProjectItem[] {
		return [...this.compiledProjects, ...this.uncompiledProjects];
	}

	// Move project between lists
	moveProject(item: CbpProjectItem, toCompiled: boolean): void {
		// Remove from current list
		this.compiledProjects = this.compiledProjects.filter(p => p !== item);
		this.uncompiledProjects = this.uncompiledProjects.filter(p => p !== item);
		
		// Add to target list
		if (toCompiled) {
			this.compiledProjects.push(item);
		} else {
			this.uncompiledProjects.push(item);
		}
		
		this._onDidChangeTreeData.fire();
	}
}

// Helper function to decode buffer with multiple encoding attempts
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

// Run command with real-time output to channel
function runCommand(cmd: string, output: vscode.OutputChannel): Promise<void> {
	return new Promise((resolve, reject) => {
		const options: cp.SpawnOptions = {
			windowsHide: true,
			shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
			stdio: ['pipe', 'pipe', 'pipe'], // 确保使用管道模式，支持实时输出
			env: { ...process.env, PYTHONUNBUFFERED: '1' } // 添加环境变量禁用缓冲
		};

		// 使用spawn执行命令，支持实时输出
		// 在Windows上，使用/c选项并添加@echo off和其他命令来确保实时输出
		const child = cp.spawn(
			process.platform === 'win32' ? 'cmd.exe' : cmd,
			process.platform === 'win32' ? ['/c', 'echo off && ' + cmd] : [],
			options
		);

		// 实时处理标准输出（添加null检查）
		if (child.stdout) {
			child.stdout.on('data', (data: Buffer) => {
				const decodedOutput = decodeBuffer(data);
				output.append(decodedOutput);
			});
		}

		// 实时处理错误输出（添加null检查）
		if (child.stderr) {
			child.stderr.on('data', (data: Buffer) => {
				const decodedError = decodeBuffer(data);
				output.append(decodedError);
			});
		}

		// 处理命令完成
		child.on('close', (code: number) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Command failed with exit code ${code}`));
			}
		});

		// 处理命令错误
		child.on('error', (err: Error) => {
			reject(err);
		});
	});
}

// Run command in specific directory with real-time output to channel
function runCommandInDirectory(cmd: string, cwd: string, output: vscode.OutputChannel): Promise<void> {
	return new Promise((resolve, reject) => {
		// 仅转换路径格式
		let actualCmd = cmd;
		if (process.platform === 'win32') {
			if (cmd.startsWith('./')) {
				actualCmd = cmd.replace('./', '.\\');
			}
		}

		const options: cp.SpawnOptions = {
			cwd,
			windowsHide: true,
			shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
			stdio: ['pipe', 'pipe', 'pipe'], // 确保使用管道模式，支持实时输出
			env: { ...process.env, PYTHONUNBUFFERED: '1' } // 添加环境变量禁用缓冲
		};

		// 使用spawn执行命令，支持实时输出
		// 在Windows上，使用/c选项并添加@echo off和其他命令来确保实时输出
		const child = cp.spawn(
			process.platform === 'win32' ? 'cmd.exe' : actualCmd,
			process.platform === 'win32' ? ['/c', 'echo off && ' + actualCmd] : [],
			options
		);

		// 实时处理标准输出（添加null检查）
		if (child.stdout) {
			child.stdout.on('data', (data: Buffer) => {
				const decodedOutput = decodeBuffer(data);
				output.append(decodedOutput);
			});
		}

		// 实时处理错误输出（添加null检查）
		if (child.stderr) {
			child.stderr.on('data', (data: Buffer) => {
				const decodedError = decodeBuffer(data);
				output.append(decodedError);
			});
		}

		// 处理命令完成
		child.on('close', (code: number) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Command failed with exit code ${code}`));
			}
		});

		// 处理命令错误
		child.on('error', (err: Error) => {
			reject(err);
		});
	});
}

// Define a TreeDataProvider for compiled projects
class CompiledProjectsProvider implements vscode.TreeDataProvider<CbpProjectItem> {
	private parentProvider: CbpProjectsProvider;
	
	constructor(parentProvider: CbpProjectsProvider) {
		this.parentProvider = parentProvider;
		// Listen to parent provider's change events
		parentProvider.onDidChangeTreeData(() => {
			this._onDidChangeTreeData.fire();
		});
	}
	
	private _onDidChangeTreeData: vscode.EventEmitter<CbpProjectItem | undefined | void> = new vscode.EventEmitter<CbpProjectItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<CbpProjectItem | undefined | void> = this._onDidChangeTreeData.event;

	getTreeItem(element: CbpProjectItem): vscode.TreeItem {
		return this.parentProvider.getTreeItem(element);
	}

	getChildren(element?: CbpProjectItem | undefined): Thenable<CbpProjectItem[]> {
		if (!element) {
			return Promise.resolve(this.parentProvider.getCompiledProjects());
		}
		return Promise.resolve([]);
	}
}

// Define a TreeDataProvider for uncompiled projects
class UncompiledProjectsProvider implements vscode.TreeDataProvider<CbpProjectItem> {
	private parentProvider: CbpProjectsProvider;
	
	constructor(parentProvider: CbpProjectsProvider) {
		this.parentProvider = parentProvider;
		// Listen to parent provider's change events
		parentProvider.onDidChangeTreeData(() => {
			this._onDidChangeTreeData.fire();
		});
	}
	
	private _onDidChangeTreeData: vscode.EventEmitter<CbpProjectItem | undefined | void> = new vscode.EventEmitter<CbpProjectItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<CbpProjectItem | undefined | void> = this._onDidChangeTreeData.event;

	getTreeItem(element: CbpProjectItem): vscode.TreeItem {
		return this.parentProvider.getTreeItem(element);
	}

	getChildren(element?: CbpProjectItem | undefined): Thenable<CbpProjectItem[]> {
		if (!element) {
			return Promise.resolve(this.parentProvider.getUncompiledProjects());
		}
		return Promise.resolve([]);
	}
}

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	// Create output channel
	const outputChannel = vscode.window.createOutputChannel('CBP Build Manager');

	// Create main tree data provider
	const mainProvider = new CbpProjectsProvider();
	
	// Set extension context for saving state
	mainProvider.setContext(context);
	
	// Load saved compile commands paths from extension context
	const savedPaths = context.globalState.get<Record<string, string>>('compileCommandsPaths');
	if (savedPaths) {
		// Convert saved paths to Map
		for (const [fsPath, compilePath] of Object.entries(savedPaths)) {
			(mainProvider as any).compileCommandsPaths.set(fsPath, compilePath);
		}
	}

	// Create separate providers for each view
	const compiledProvider = new CompiledProjectsProvider(mainProvider);
	const uncompiledProvider = new UncompiledProjectsProvider(mainProvider);

	// Register compiled projects tree view
	const compiledTreeView = vscode.window.createTreeView('cbpCompiledProjects', {
		treeDataProvider: compiledProvider,
		dragAndDropController: mainProvider,
		canSelectMany: true
	});

	// Register uncompiled projects tree view  
	const uncompiledTreeView = vscode.window.createTreeView('cbpUncompiledProjects', {
		treeDataProvider: uncompiledProvider,
		dragAndDropController: mainProvider,
		canSelectMany: true
	});

	// 处理复选框改变的逻辑
	const handleCheckboxChange = (event: vscode.TreeCheckboxChangeEvent<CbpProjectItem>) => {
		event.items.forEach(([item, newState]) => {
			const isCompiled = newState === vscode.TreeItemCheckboxState.Checked;
			
			// 更新内存中的状态
			(mainProvider as any).projectAllocation.set(item.fsPath, isCompiled);
			
			// 更新项目自身的属性（防止刷新前的视觉闪烁）
			item.checkboxState = newState;
		});

		// 保存并刷新
		(mainProvider as any).saveAllocationStatus();
		mainProvider.refresh();
	};

	// 为两个 TreeView 都绑定监听器
	compiledTreeView.onDidChangeCheckboxState(handleCheckboxChange);
	uncompiledTreeView.onDidChangeCheckboxState(handleCheckboxChange);

	// Function to get configuration settings
	function getConfig() {
		return vscode.workspace.getConfiguration('cbpBuildManager');
	}

	// Function to substitute variables in command templates
	function substituteVariables(command: string, substitutions: Record<string, string>): string {
		return command.replace(/\{([^}]+)\}/g, (match, key) => {
			return substitutions[key] || match;
		});
	}

	// Register commands
	const buildCommand = vscode.commands.registerCommand('cbp-build-manager.buildSelected', async () => {
		outputChannel.clear();
		outputChannel.show();
		
		// Debug: Log all projects
		outputChannel.appendLine('=== DEBUG: All Projects ===');
		// Use a public method to get projects for debugging
		const allProjects = mainProvider.getProjects();
		allProjects.forEach(project => {
			const isCompiled = mainProvider.getCompiledProjects().includes(project);
			outputChannel.appendLine(`${project.label}: isCompiled=${isCompiled}`);
		});
		
		const selectedProjects = mainProvider.getSelectedProjects();
		outputChannel.appendLine(`=== 调试: 选中项目数量 ===`);
		outputChannel.appendLine(`找到 ${selectedProjects.length} 个选中项目`);
		
		if (selectedProjects.length === 0) {
			vscode.window.showInformationMessage('没有选中要构建的项目。');
			return;
		}

		// Get global configuration
		const config = getConfig();
		const cbp2clangPath = config.get<string>('cbp2clangPath', 'cbp2clang');
		const convertCommandTemplate = config.get<string>('convertCommand', '{cbp2clang} {cbpFile} {compileCommands} -l ld');
		const buildCommand = config.get<string>('buildCommand', './build.bat');
		const ninjaPath = config.get<string>('ninjaPath', '');


		for (const project of selectedProjects) {
			outputChannel.appendLine(`=== 正在处理项目: ${project.label} ===`);
			
			try {
				const projectDir = path.dirname(project.fsPath);
				
				// 步骤 1: 将 CBP 转换为 compile_commands.json
				outputChannel.appendLine('步骤 1: 正在将 CBP 转换为 compile_commands.json...');
				
				// 准备替换变量 - 使用项目特定的 compileCommandsPath
				const substitutions = {
					cbp2clang: cbp2clangPath,
					cbpFile: project.fsPath,
					compileCommands: project.compileCommandsPath
				};
				
				// 生成实际的转换命令
			let convertCommand = substituteVariables(convertCommandTemplate, substitutions);
			
			// 如果配置了ninja路径，添加--ninja参数
			if (ninjaPath) {
				convertCommand += ` --ninja "${ninjaPath}"`;
				outputChannel.appendLine(`使用自定义ninja路径: ${ninjaPath}`);
			}
			
			outputChannel.appendLine(`正在运行: ${convertCommand}`);
			outputChannel.appendLine(`编译命令路径: ${project.compileCommandsPath}`);
			
			// 运行转换命令
			await runCommand(convertCommand, outputChannel);
				
				// 步骤 2: 运行构建脚本
				outputChannel.appendLine('步骤 2: 正在运行构建脚本...');
				outputChannel.appendLine(`正在项目目录中运行构建脚本: ${buildCommand}`);

				// 使用 child_process.exec 在项目目录下运行构建命令
				await runCommandInDirectory(buildCommand, projectDir, outputChannel);
				
			} catch (error) {
				outputChannel.appendLine(`处理项目 ${project.label} 时出错: ${error}`);
				continue;
			}
		}
	});

	const refreshCommand = vscode.commands.registerCommand('cbp-build-manager.refreshProjects', () => {
		mainProvider.refresh();
	});



	// Set compile commands path for a project
	const setCompileCommandsPathCommand = vscode.commands.registerCommand('cbp-build-manager.setCompileCommandsPath', async (item: CbpProjectItem) => {
		// Get current value as default
		const currentPath = item.compileCommandsPath;
		// Get global default from config
		const config = getConfig();
		const globalDefault = config.get<string>('compileCommandsPath', '.');
		
		// Show input box for new path with better UI
		const newPath = await vscode.window.showInputBox({
			title: `设置项目 ${item.label} 的编译命令路径`,
			value: currentPath,
			placeHolder: globalDefault,
			prompt: `输入 compile_commands.json 的相对输出路径（相对于 .cbp 文件）\n全局默认值: ${globalDefault}\n当前值: ${currentPath}`,
			validateInput: (value) => {
				if (!value) {
					return '路径不能为空';
				}
				return null;
			}
		});
		
		if (newPath) {
			mainProvider.updateCompileCommandsPath(item, newPath);
			outputChannel.appendLine(`已更新项目 ${item.label} 的编译命令路径: ${newPath}`);
			vscode.window.showInformationMessage(`已更新项目 ${item.label} 的编译命令路径`);
			
			// Save to extension context for persistence
			const currentPaths = (mainProvider as any).compileCommandsPaths;
			// Convert Map to object for storage
			const pathsObject: Record<string, string> = {};
			currentPaths.forEach((path: string, fsPath: string) => {
				pathsObject[fsPath] = path;
			});
			// Save to global state
			context.globalState.update('compileCommandsPaths', pathsObject);
		}
	});

	// Add subscriptions
	context.subscriptions.push(
		buildCommand,
		refreshCommand,
		setCompileCommandsPathCommand,
		compiledTreeView,
		uncompiledTreeView,
		outputChannel
	);

	// Initial scan
	mainProvider.refresh();
}

// This method is called when your extension is deactivated
export function deactivate() {}
