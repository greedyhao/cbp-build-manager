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
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
		this.tooltip = `${this.label}\n${this.fsPath}\n编译命令路径: ${this.compileCommandsPath}`;
		this.description = path.basename(path.dirname(this.fsPath));
		
		// Set initial checkbox state to unchecked
		this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
		
		// Remove command to fix drag and drop conflict
		// VS Code handles checkbox clicks automatically when checkboxState is set
	}

	// Add context value for menu contributions
	contextValue = 'cbpProject';
}

// Define the TreeDataProvider with drag and drop support
class CbpProjectsProvider implements vscode.TreeDataProvider<CbpProjectItem>, vscode.TreeDragAndDropController<CbpProjectItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<CbpProjectItem | undefined | void> = new vscode.EventEmitter<CbpProjectItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<CbpProjectItem | undefined | void> = this._onDidChangeTreeData.event;

	// Store projects array
	private projects: CbpProjectItem[] = [];
	
	// Store compile commands paths persistently
	private compileCommandsPaths: Map<string, string> = new Map();

	// Refresh the project list
	async refresh(): Promise<void> {
		await this.scanProjects();
		this._onDidChangeTreeData.fire();
	}

	// Scan workspace for .cbp files
	private async scanProjects(): Promise<void> {
		if (!vscode.workspace.workspaceFolders) {
			this.projects = [];
			return;
		}

		const cbpFiles = await vscode.workspace.findFiles('**/*.cbp');
		this.projects = cbpFiles.map(file => {
			const item = new CbpProjectItem(
				path.basename(file.fsPath, '.cbp'),
				file.fsPath,
				vscode.TreeItemCollapsibleState.None
			);
			// Restore saved compile commands path if exists
			if (this.compileCommandsPaths.has(file.fsPath)) {
				item.compileCommandsPath = this.compileCommandsPaths.get(file.fsPath)!;
				item.tooltip = `${item.label}\n${item.fsPath}\n编译命令路径: ${item.compileCommandsPath}`;
			}
			return item;
		});
	}

	// Get tree item with enhanced visual style
	getTreeItem(element: CbpProjectItem): vscode.TreeItem {
		// Create a copy of the element to enhance visual style
		const treeItem = element;
		
		// Add icon based on checkbox state
		treeItem.iconPath = treeItem.checkboxState === vscode.TreeItemCheckboxState.Checked 
			? new vscode.ThemeIcon('checklist-unchecked') 
			: new vscode.ThemeIcon('checklist');
		
		// Show compile commands path in description for better visibility
		treeItem.description = `${path.basename(path.dirname(treeItem.fsPath))} • ${treeItem.compileCommandsPath}`;
		
		return treeItem;
	}

	// Get children
	getChildren(element?: CbpProjectItem): Thenable<CbpProjectItem[]> {
		if (!element) {
			return Promise.resolve(this.projects);
		}
		return Promise.resolve([]);
	}

	// Handle checkbox state change - use native checkboxState
	toggleCheckbox(element: CbpProjectItem): void {
		// Toggle the native checkboxState
		if (element.checkboxState === vscode.TreeItemCheckboxState.Checked) {
			element.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
		} else {
			element.checkboxState = vscode.TreeItemCheckboxState.Checked;
		}
		
		// Debug: Log the change
		console.log(`${element.label}: checkboxState changed to ${element.checkboxState}`);
		
		// Notify the tree view to update
		this._onDidChangeTreeData.fire();
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

	// Drag and drop configuration - simplified for compatibility
	dropMimeTypes = ['application/vnd.code.tree.cbpProjects'];
	dragMimeTypes = ['application/vnd.code.tree.cbpProjects'];

	// Handle drag operation
	handleDrag?(source: CbpProjectItem[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
		treeDataTransfer.set('application/vnd.code.tree.cbpProjects', new vscode.DataTransferItem(source));
	}

	// Handle drop operation - main drop logic
	handleDrop?(target: CbpProjectItem | undefined, treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
		const sourceItems = treeDataTransfer.get('application/vnd.code.tree.cbpProjects')?.value as CbpProjectItem[];
		if (!sourceItems || sourceItems.length === 0) {
			return;
		}

		const draggedItem = sourceItems[0];
		const sourceIndex = this.projects.indexOf(draggedItem);
		if (sourceIndex === -1) {
			return;
		}

		// Remove the dragged item from current position
		this.projects.splice(sourceIndex, 1);

		// Calculate new position
		if (!target) {
			// Drop at the end
			this.projects.push(draggedItem);
		} else {
			const targetIndex = this.projects.indexOf(target);
			if (targetIndex !== -1) {
				// Insert before target
				this.projects.splice(targetIndex, 0, draggedItem);
			}
		}

		// Notify tree view to refresh
		this._onDidChangeTreeData.fire();
	}

	// Get selected projects in order - use checkboxState directly
	getSelectedProjects(): CbpProjectItem[] {
		return this.projects.filter(project => 
			project.checkboxState === vscode.TreeItemCheckboxState.Checked
		);
	}

	// Get all projects (for debugging)
	getProjects(): CbpProjectItem[] {
		return this.projects;
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

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	// Create output channel
	const outputChannel = vscode.window.createOutputChannel('CBP Build Manager');

	// Create tree data provider
	const projectsProvider = new CbpProjectsProvider();
	
	// Load saved compile commands paths from extension context
	const savedPaths = context.globalState.get<Record<string, string>>('compileCommandsPaths');
	if (savedPaths) {
		// Convert saved paths to Map
		for (const [fsPath, compilePath] of Object.entries(savedPaths)) {
			(projectsProvider as any).compileCommandsPaths.set(fsPath, compilePath);
		}
	}

	// Register tree view
	const treeView = vscode.window.createTreeView('cbpProjects', {
		treeDataProvider: projectsProvider,
		dragAndDropController: projectsProvider,
		canSelectMany: true
	});

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
		
		// Debug: Log all projects and their checkbox state
		outputChannel.appendLine('=== DEBUG: Project Checkbox State ===');
		// Use a public method to get projects for debugging
		const allProjects = projectsProvider.getProjects();
		allProjects.forEach(project => {
			outputChannel.appendLine(`${project.label}: checkboxState=${project.checkboxState}`);
		});
		
		const selectedProjects = projectsProvider.getSelectedProjects();
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
		projectsProvider.refresh();
	});

	// Toggle checkbox when item is clicked
	vscode.commands.registerCommand('cbpProjects.toggleCheckbox', (item: CbpProjectItem) => {
		projectsProvider.toggleCheckbox(item);
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
			projectsProvider.updateCompileCommandsPath(item, newPath);
			outputChannel.appendLine(`已更新项目 ${item.label} 的编译命令路径: ${newPath}`);
			vscode.window.showInformationMessage(`已更新项目 ${item.label} 的编译命令路径`);
			
			// Save to extension context for persistence
			const currentPaths = (projectsProvider as any).compileCommandsPaths;
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
		treeView,
		outputChannel
	);

	// Initial scan
	projectsProvider.refresh();
}

// This method is called when your extension is deactivated
export function deactivate() {}
