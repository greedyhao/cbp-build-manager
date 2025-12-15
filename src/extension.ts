// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Define the CBP project item class
class CbpProjectItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly fsPath: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public checked: boolean = false
	) {
		super(label, collapsibleState);
		this.tooltip = this.fsPath;
		this.description = path.basename(path.dirname(this.fsPath));
		this.checkboxState = checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
		
		// Add command to handle checkbox clicks
		this.command = {
			command: 'cbpProjects.toggleCheckbox',
			title: 'Toggle Checkbox',
			arguments: [this]
		};
	}

	// Add context value for menu contributions
	contextValue = 'cbpProject';
}

// Define the TreeDataProvider
class CbpProjectsProvider implements vscode.TreeDataProvider<CbpProjectItem>, vscode.TreeDragAndDropController<CbpProjectItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<CbpProjectItem | undefined | void> = new vscode.EventEmitter<CbpProjectItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<CbpProjectItem | undefined | void> = this._onDidChangeTreeData.event;

	private projects: CbpProjectItem[] = [];

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
		this.projects = cbpFiles.map(file => new CbpProjectItem(
			path.basename(file.fsPath, '.cbp'),
			file.fsPath,
			vscode.TreeItemCollapsibleState.None
		));
	}

	// Get tree item
	getTreeItem(element: CbpProjectItem): vscode.TreeItem {
		return element;
	}

	// Get children
	getChildren(element?: CbpProjectItem): Thenable<CbpProjectItem[]> {
		if (!element) {
			return Promise.resolve(this.projects);
		}
		return Promise.resolve([]);
	}

	// Handle checkbox state change
	toggleCheckbox(element: CbpProjectItem): void {
		element.checked = !element.checked;
		element.checkboxState = element.checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
		this._onDidChangeTreeData.fire();
	}

	// Drag and drop functionality
	dropMimeTypes = ['application/vnd.code.tree.cbpProjects'];
	dragMimeTypes = ['application/vnd.code.tree.cbpProjects'];

	handleDrag?(source: CbpProjectItem[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
		treeDataTransfer.set('application/vnd.code.tree.cbpProjects', new vscode.DataTransferItem(source));
	}

	handleDrop?(target: CbpProjectItem | undefined, treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
		const source = treeDataTransfer.get('application/vnd.code.tree.cbpProjects')?.value as CbpProjectItem[];
		if (!source || source.length === 0) {
			return;
		}

		const draggedItem = source[0];
		const sourceIndex = this.projects.indexOf(draggedItem);
		if (sourceIndex === -1) {
			return;
		}

		// Remove the dragged item
		this.projects.splice(sourceIndex, 1);

		// Insert at the new position
		if (!target) {
			// Drop at the end
			this.projects.push(draggedItem);
		} else {
			const targetIndex = this.projects.indexOf(target);
			if (targetIndex !== -1) {
				this.projects.splice(targetIndex, 0, draggedItem);
			}
		}

		this._onDidChangeTreeData.fire();
	}

	// Get selected projects in order
	getSelectedProjects(): CbpProjectItem[] {
		return this.projects.filter(project => project.checked);
	}
}

// Run command with output to channel
function runCommand(cmd: string, output: vscode.OutputChannel): Promise<void> {
	return new Promise((resolve, reject) => {
		cp.exec(cmd, (err, stdout, stderr) => {
			if (err) {
				output.append(stderr);
				reject(err);
			} else {
				output.append(stdout);
				resolve();
			}
		});
	});
}

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	// Create output channel
	const outputChannel = vscode.window.createOutputChannel('CBP Build Manager');

	// Create tree data provider
	const projectsProvider = new CbpProjectsProvider();

	// Register tree view
	const treeView = vscode.window.createTreeView('cbpProjects', {
		treeDataProvider: projectsProvider,
		dragAndDropController: projectsProvider,
		canSelectMany: true
	});

	// Register commands
	const buildCommand = vscode.commands.registerCommand('cbp-build-manager.buildSelected', async () => {
		const selectedProjects = projectsProvider.getSelectedProjects();
		if (selectedProjects.length === 0) {
			vscode.window.showInformationMessage('No projects selected for building.');
			return;
		}

		outputChannel.clear();
		outputChannel.show();

		// Create terminal for Ninja output
		const terminal = vscode.window.createTerminal('CBP Build');
		terminal.show();

		for (const project of selectedProjects) {
			outputChannel.appendLine(`=== Processing project: ${project.label} ===`);
			
			try {
				// Step 1: Generate Ninja file (placeholder for actual converter call)
				const projectDir = path.dirname(project.fsPath);
				const ninjaPath = path.join(projectDir, 'build.ninja');
				
				// TODO: Replace with actual converter command
				// await runCommand(`cbp2ninja "${project.fsPath}" --out "${ninjaPath}"`, outputChannel);
				outputChannel.appendLine(`Generated Ninja file: ${ninjaPath}`);
				
				// Step 2: Run Ninja build
				terminal.sendText(`cd "${projectDir}" && ninja -f "${ninjaPath}"`);
				
			} catch (error) {
				outputChannel.appendLine(`Error processing project ${project.label}: ${error}`);
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

	// Add subscriptions
	context.subscriptions.push(
		buildCommand,
		refreshCommand,
		treeView,
		outputChannel
	);

	// Initial scan
	projectsProvider.refresh();
}

// This method is called when your extension is deactivated
export function deactivate() {}
