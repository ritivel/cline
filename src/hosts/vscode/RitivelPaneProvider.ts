import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

interface FolderEntry {
	name: string
	path: string
	isDirectory: boolean
	children?: FolderEntry[]
}

interface SubmissionsFolderConfig {
	workspacePath: string
	submissionsPath: string
}

export class SubmissionsPaneProvider implements vscode.WebviewViewProvider {
	public static readonly ID = "cline.SubmissionsPane"
	private static _instance: SubmissionsPaneProvider | undefined
	private _view?: vscode.WebviewView
	private _currentSubmissionsFolder?: string
	private _folderWatcher?: vscode.FileSystemWatcher
	private _context?: vscode.ExtensionContext

	constructor(
		private readonly _extensionUri: vscode.Uri,
		context?: vscode.ExtensionContext,
	) {
		this._context = context
		SubmissionsPaneProvider._instance = this
	}

	public static getInstance(): SubmissionsPaneProvider | undefined {
		return SubmissionsPaneProvider._instance
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		}

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case "openFolder":
					await this._openFolder()
					break
				case "createFolder":
					await this._createFolder()
					break
				case "refresh":
					await this._refreshView()
					break
				case "openFile":
					await this._openFile(message.path)
					break
				case "revealInExplorer":
					await this._revealInExplorer(message.path)
					break
				case "deleteItem":
					await this._deleteItem(message.path, message.isDirectory)
					break
				case "createNewFile":
					await this._createNewFile(message.parentPath)
					break
				case "createNewFolder":
					await this._createNewFolder(message.parentPath)
					break
				case "ready":
					await this._initializeView()
					break
			}
		})

		// Listen for workspace folder changes
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			this._suggestSubmissionsFolder()
		})

		// Initialize with current workspace
		this._initializeView()
	}

	private async _initializeView() {
		// Try to restore previously set submissions folder
		const savedConfig = await this._getSavedConfig()
		if (savedConfig && fs.existsSync(savedConfig.submissionsPath)) {
			this._currentSubmissionsFolder = savedConfig.submissionsPath
			await this._refreshView()

			// Hide submissions folder from explorer
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (workspaceFolder) {
				await this._hideSubmissionsFolderFromExplorer(savedConfig.submissionsPath, workspaceFolder.uri.fsPath)
			}
		} else {
			// Suggest a submissions folder based on current workspace
			await this._suggestSubmissionsFolder()
		}
	}

	private async _getSavedConfig(): Promise<SubmissionsFolderConfig | undefined> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			return undefined
		}

		// Try to read from workspace state or a config file
		const configPath = path.join(workspaceFolder.uri.fsPath, ".vscode", "submissions-config.json")
		if (fs.existsSync(configPath)) {
			try {
				const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
				return config as SubmissionsFolderConfig
			} catch {
				return undefined
			}
		}
		return undefined
	}

	private async _saveConfig(config: SubmissionsFolderConfig) {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			return
		}

		const vscodeDir = path.join(workspaceFolder.uri.fsPath, ".vscode")
		if (!fs.existsSync(vscodeDir)) {
			fs.mkdirSync(vscodeDir, { recursive: true })
		}

		const configPath = path.join(vscodeDir, "submissions-config.json")
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
	}

	/**
	 * Hides the submissions folder from the VS Code explorer by updating files.exclude setting
	 * Also hides items/folders starting with "."
	 */
	private async _hideSubmissionsFolderFromExplorer(submissionsFolderPath: string, workspaceRoot: string): Promise<void> {
		try {
			// Calculate relative path from workspace root
			const relativePath = path.relative(workspaceRoot, submissionsFolderPath)

			// If the submissions folder is outside the workspace, we can't hide it via files.exclude
			if (relativePath.startsWith("..")) {
				return
			}

			// Normalize path separators for the pattern (use forward slashes for glob patterns)
			const excludePattern = relativePath.replace(/\\/g, "/") + "/**"

			// Get current files.exclude configuration
			const config = vscode.workspace.getConfiguration("files")
			const currentExclude: Record<string, boolean> = config.get("exclude") || {}

			// Add submissions folder to exclude if not already excluded
			if (!currentExclude[excludePattern]) {
				currentExclude[excludePattern] = true
			}

			// Also hide items/folders starting with "."
			if (!currentExclude["**/.*"]) {
				currentExclude["**/.*"] = true
			}
			if (!currentExclude["**/.*/**"]) {
				currentExclude["**/.*/**"] = true
			}

			// Update the workspace configuration
			await config.update("exclude", currentExclude, vscode.ConfigurationTarget.Workspace)
		} catch (error) {
			// Silently fail - hiding from explorer is not critical
			console.error("Failed to hide submissions folder from explorer:", error)
		}
	}

	private async _suggestSubmissionsFolder() {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			this._postMessage({
				type: "noWorkspace",
				message: "No workspace folder open. Open a folder to get started.",
			})
			return
		}

		const workspacePath = workspaceFolder.uri.fsPath
		const workspaceName = path.basename(workspacePath)

		// Check for common submissions folder patterns
		const possiblePaths = [
			path.join(workspacePath, "submissions"),
			path.join(workspacePath, ".submissions"),
			path.join(workspacePath, "output"),
			path.join(workspacePath, `${workspaceName}-submissions`),
		]

		let suggestedPath: string | undefined

		// Check if any of these folders exist
		for (const p of possiblePaths) {
			if (fs.existsSync(p)) {
				suggestedPath = p
				break
			}
		}

		// If no existing folder found, suggest creating one
		if (!suggestedPath) {
			suggestedPath = path.join(workspacePath, "submissions")
		}

		this._postMessage({
			type: "suggestFolder",
			workspaceName,
			suggestedPath,
			exists: fs.existsSync(suggestedPath),
		})
	}

	public async openFolder() {
		await this._openFolder()
	}

	private async _openFolder() {
		const result = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: "Select Submissions Folder",
			title: "Select Submissions Folder",
		})

		if (result && result[0]) {
			this._currentSubmissionsFolder = result[0].fsPath
			await this._setupFolderWatcher()
			await this._refreshView()

			// Save the config
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (workspaceFolder) {
				await this._saveConfig({
					workspacePath: workspaceFolder.uri.fsPath,
					submissionsPath: this._currentSubmissionsFolder,
				})
			}
		}
	}

	public async createFolder() {
		await this._createFolder()
	}

	private async _createFolder(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			vscode.window.showErrorMessage("No workspace folder open")
			return
		}

		const folderName = await vscode.window.showInputBox({
			prompt: "Enter the name for the submissions folder",
			value: "submissions",
			validateInput: (value) => {
				if (!value || value.trim() === "") {
					return "Folder name cannot be empty"
				}
				if (/[<>:"|?*]/.test(value)) {
					return "Folder name contains invalid characters"
				}
				return null
			},
		})

		if (folderName) {
			const newFolderPath = path.join(workspaceFolder.uri.fsPath, folderName)

			if (fs.existsSync(newFolderPath)) {
				const useExisting = await vscode.window.showQuickPick(
					["Yes, use existing folder", "No, choose a different name"],
					{
						placeHolder: "Folder already exists. Use it as submissions folder?",
					},
				)

				if (useExisting === "Yes, use existing folder") {
					this._currentSubmissionsFolder = newFolderPath
				} else {
					return this._createFolder()
				}
			} else {
				try {
					fs.mkdirSync(newFolderPath, { recursive: true })
					this._currentSubmissionsFolder = newFolderPath
					vscode.window.showInformationMessage(`Created submissions folder: ${folderName}`)
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to create folder: ${error}`)
					return
				}
			}

			await this._setupFolderWatcher()
			await this._refreshView()

			// Save the config
			await this._saveConfig({
				workspacePath: workspaceFolder.uri.fsPath,
				submissionsPath: this._currentSubmissionsFolder,
			})
		}
	}

	private async _setupFolderWatcher() {
		// Dispose existing watcher
		if (this._folderWatcher) {
			this._folderWatcher.dispose()
		}

		if (this._currentSubmissionsFolder) {
			const pattern = new vscode.RelativePattern(this._currentSubmissionsFolder, "**/*")
			this._folderWatcher = vscode.workspace.createFileSystemWatcher(pattern)

			this._folderWatcher.onDidCreate(() => this._refreshView())
			this._folderWatcher.onDidDelete(() => this._refreshView())
			this._folderWatcher.onDidChange(() => this._refreshView())
		}
	}

	public async refresh() {
		await this._refreshView()
	}

	private async _refreshView() {
		if (!this._currentSubmissionsFolder) {
			await this._suggestSubmissionsFolder()
			return
		}

		if (!fs.existsSync(this._currentSubmissionsFolder)) {
			this._postMessage({
				type: "folderNotFound",
				path: this._currentSubmissionsFolder,
			})
			return
		}

		const folderTree = this._buildFolderTree(this._currentSubmissionsFolder)
		const folderName = path.basename(this._currentSubmissionsFolder)

		this._postMessage({
			type: "updateTree",
			folderName,
			folderPath: this._currentSubmissionsFolder,
			tree: folderTree,
		})
	}

	private _buildFolderTree(dirPath: string): FolderEntry[] {
		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true })
			const result: FolderEntry[] = []

			// Sort: directories first, then files, both alphabetically
			const sorted = entries.sort((a, b) => {
				if (a.isDirectory() && !b.isDirectory()) return -1
				if (!a.isDirectory() && b.isDirectory()) return 1
				return a.name.localeCompare(b.name)
			})

			for (const entry of sorted) {
				// Skip hidden files and common non-essential files
				if (entry.name.startsWith(".") || entry.name === "node_modules") {
					continue
				}

				const fullPath = path.join(dirPath, entry.name)
				const folderEntry: FolderEntry = {
					name: entry.name,
					path: fullPath,
					isDirectory: entry.isDirectory(),
				}

				if (entry.isDirectory()) {
					folderEntry.children = this._buildFolderTree(fullPath)
				}

				result.push(folderEntry)
			}

			return result
		} catch (error) {
			console.error("Error reading directory:", error)
			return []
		}
	}

	private async _openFile(filePath: string) {
		try {
			const doc = await vscode.workspace.openTextDocument(filePath)
			await vscode.window.showTextDocument(doc)
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open file: ${error}`)
		}
	}

	private async _revealInExplorer(itemPath: string) {
		await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(itemPath))
	}

	private async _deleteItem(itemPath: string, isDirectory: boolean) {
		const itemName = path.basename(itemPath)
		const confirm = await vscode.window.showWarningMessage(
			`Are you sure you want to delete "${itemName}"?`,
			{ modal: true },
			"Delete",
		)

		if (confirm === "Delete") {
			try {
				if (isDirectory) {
					fs.rmSync(itemPath, { recursive: true })
				} else {
					fs.unlinkSync(itemPath)
				}
				await this._refreshView()
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to delete: ${error}`)
			}
		}
	}

	private async _createNewFile(parentPath: string) {
		const fileName = await vscode.window.showInputBox({
			prompt: "Enter file name",
			validateInput: (value) => {
				if (!value || value.trim() === "") {
					return "File name cannot be empty"
				}
				return null
			},
		})

		if (fileName) {
			const filePath = path.join(parentPath, fileName)
			try {
				fs.writeFileSync(filePath, "")
				await this._refreshView()
				await this._openFile(filePath)
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create file: ${error}`)
			}
		}
	}

	private async _createNewFolder(parentPath: string) {
		const folderName = await vscode.window.showInputBox({
			prompt: "Enter folder name",
			validateInput: (value) => {
				if (!value || value.trim() === "") {
					return "Folder name cannot be empty"
				}
				return null
			},
		})

		if (folderName) {
			const folderPath = path.join(parentPath, folderName)
			try {
				fs.mkdirSync(folderPath, { recursive: true })
				await this._refreshView()
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create folder: ${error}`)
			}
		}
	}

	private _postMessage(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message)
		}
	}

	public updateContent(content: string) {
		if (this._view) {
			this._view.webview.postMessage({ type: "updateContent", content })
		}
	}

	public getSubmissionsFolder(): string | undefined {
		return this._currentSubmissionsFolder
	}

	public async setSubmissionsFolder(folderPath: string) {
		if (fs.existsSync(folderPath)) {
			this._currentSubmissionsFolder = folderPath
			await this._setupFolderWatcher()
			await this._refreshView()

			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (workspaceFolder) {
				await this._saveConfig({
					workspacePath: workspaceFolder.uri.fsPath,
					submissionsPath: folderPath,
				})

				// Hide submissions folder from explorer
				await this._hideSubmissionsFolderFromExplorer(folderPath, workspaceFolder.uri.fsPath)
			}
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const nonce = getNonce()

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
			<title>Submissions</title>
			<style>
				* {
					box-sizing: border-box;
				}
				body {
					font-family: var(--vscode-font-family);
					font-size: var(--vscode-font-size);
					color: var(--vscode-foreground);
					padding: 0;
					margin: 0;
					height: 100vh;
					overflow: hidden;
				}
				.container {
					display: flex;
					flex-direction: column;
					height: 100%;
					padding: 8px;
				}
				.header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 4px 0 8px 0;
					border-bottom: 1px solid var(--vscode-panel-border);
					margin-bottom: 8px;
					flex-shrink: 0;
				}
				.header-title {
					font-weight: 600;
					font-size: 11px;
					text-transform: uppercase;
					letter-spacing: 0.5px;
					color: var(--vscode-foreground);
					opacity: 0.8;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
					flex: 1;
				}
				.header-actions {
					display: flex;
					gap: 4px;
				}
				.icon-btn {
					background: transparent;
					border: none;
					color: var(--vscode-foreground);
					cursor: pointer;
					padding: 4px;
					border-radius: 4px;
					display: flex;
					align-items: center;
					justify-content: center;
					opacity: 0.7;
				}
				.icon-btn:hover {
					background: var(--vscode-toolbar-hoverBackground);
					opacity: 1;
				}
				.tree-container {
					flex: 1;
					overflow-y: auto;
					overflow-x: hidden;
				}
				.tree-item {
					display: flex;
					align-items: center;
					padding: 3px 4px;
					cursor: pointer;
					border-radius: 4px;
					user-select: none;
				}
				.tree-item:hover {
					background: var(--vscode-list-hoverBackground);
				}
				.tree-item.selected {
					background: var(--vscode-list-activeSelectionBackground);
					color: var(--vscode-list-activeSelectionForeground);
				}
				.tree-item-icon {
					width: 16px;
					height: 16px;
					margin-right: 6px;
					flex-shrink: 0;
					display: flex;
					align-items: center;
					justify-content: center;
				}
				.tree-item-name {
					flex: 1;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
					font-size: 13px;
				}
				.tree-item-actions {
					display: none;
					gap: 2px;
				}
				.tree-item:hover .tree-item-actions {
					display: flex;
				}
				.tree-children {
					margin-left: 16px;
				}
				.chevron {
					width: 16px;
					height: 16px;
					display: flex;
					align-items: center;
					justify-content: center;
					margin-right: 2px;
					transition: transform 0.15s ease;
				}
				.chevron.collapsed {
					transform: rotate(-90deg);
				}
				.empty-state {
					display: flex;
					flex-direction: column;
					align-items: center;
					justify-content: center;
					height: 100%;
					text-align: center;
					padding: 20px;
					color: var(--vscode-descriptionForeground);
				}
				.empty-state-icon {
					font-size: 48px;
					margin-bottom: 16px;
					opacity: 0.5;
				}
				.empty-state-title {
					font-size: 14px;
					font-weight: 500;
					margin-bottom: 8px;
					color: var(--vscode-foreground);
				}
				.empty-state-desc {
					font-size: 12px;
					margin-bottom: 16px;
					line-height: 1.5;
				}
				.btn {
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 8px 16px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 13px;
					font-family: inherit;
					margin: 4px;
				}
				.btn:hover {
					background: var(--vscode-button-hoverBackground);
				}
				.btn-secondary {
					background: var(--vscode-button-secondaryBackground);
					color: var(--vscode-button-secondaryForeground);
				}
				.btn-secondary:hover {
					background: var(--vscode-button-secondaryHoverBackground);
				}
				.suggested-path {
					font-family: var(--vscode-editor-font-family);
					font-size: 11px;
					background: var(--vscode-textCodeBlock-background);
					padding: 4px 8px;
					border-radius: 4px;
					margin: 8px 0;
					word-break: break-all;
				}
				.context-menu {
					position: fixed;
					background: var(--vscode-menu-background);
					border: 1px solid var(--vscode-menu-border);
					border-radius: 4px;
					padding: 4px 0;
					min-width: 160px;
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
					z-index: 1000;
					display: none;
				}
				.context-menu.visible {
					display: block;
				}
				.context-menu-item {
					padding: 6px 12px;
					cursor: pointer;
					display: flex;
					align-items: center;
					gap: 8px;
					font-size: 13px;
				}
				.context-menu-item:hover {
					background: var(--vscode-menu-selectionBackground);
					color: var(--vscode-menu-selectionForeground);
				}
				.context-menu-separator {
					height: 1px;
					background: var(--vscode-menu-separatorBackground);
					margin: 4px 0;
				}
				.folder-path {
					font-size: 10px;
					color: var(--vscode-descriptionForeground);
					padding: 0 0 8px 0;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div id="content">
					<div class="empty-state">
						<div class="empty-state-icon">📁</div>
						<div class="empty-state-title">Loading...</div>
					</div>
				</div>
			</div>
			<div id="contextMenu" class="context-menu">
				<div class="context-menu-item" data-action="newFile">
					<span>📄</span> New File
				</div>
				<div class="context-menu-item" data-action="newFolder">
					<span>📁</span> New Folder
				</div>
				<div class="context-menu-separator"></div>
				<div class="context-menu-item" data-action="reveal">
					<span>🔍</span> Reveal in Finder
				</div>
				<div class="context-menu-separator"></div>
				<div class="context-menu-item" data-action="delete">
					<span>🗑️</span> Delete
				</div>
			</div>
			<script nonce="${nonce}">
				const vscode = acquireVsCodeApi();
				let currentContextItem = null;
				let expandedFolders = new Set();

				// Restore state
				const state = vscode.getState() || {};
				if (state.expandedFolders) {
					expandedFolders = new Set(state.expandedFolders);
				}

				function saveState() {
					vscode.setState({
						expandedFolders: Array.from(expandedFolders)
					});
				}

				function renderTree(tree, parentPath) {
					if (!tree || tree.length === 0) {
						return '<div style="padding: 8px; color: var(--vscode-descriptionForeground); font-size: 12px;">Empty folder</div>';
					}

					let html = '';
					for (const item of tree) {
						const isExpanded = expandedFolders.has(item.path);
						if (item.isDirectory) {
							html += \`
								<div class="tree-item" data-path="\${item.path}" data-is-dir="true" onclick="toggleFolder(event, '\${item.path}')">
									<div class="chevron \${isExpanded ? '' : 'collapsed'}">▼</div>
									<div class="tree-item-icon">📁</div>
									<div class="tree-item-name">\${item.name}</div>
									<div class="tree-item-actions">
										<button class="icon-btn" onclick="event.stopPropagation(); showContextMenu(event, '\${item.path}', true)" title="More actions">⋮</button>
									</div>
								</div>
								<div class="tree-children" style="display: \${isExpanded ? 'block' : 'none'}">
									\${renderTree(item.children, item.path)}
								</div>
							\`;
						} else {
							const ext = item.name.split('.').pop()?.toLowerCase() || '';
							const icon = getFileIcon(ext);
							html += \`
								<div class="tree-item" data-path="\${item.path}" data-is-dir="false" onclick="openFile('\${item.path}')" oncontextmenu="showContextMenu(event, '\${item.path}', false)">
									<div style="width: 18px;"></div>
									<div class="tree-item-icon">\${icon}</div>
									<div class="tree-item-name">\${item.name}</div>
									<div class="tree-item-actions">
										<button class="icon-btn" onclick="event.stopPropagation(); showContextMenu(event, '\${item.path}', false)" title="More actions">⋮</button>
									</div>
								</div>
							\`;
						}
					}
					return html;
				}

				function getFileIcon(ext) {
					const icons = {
						'md': '📝',
						'txt': '📄',
						'pdf': '📕',
						'doc': '📘',
						'docx': '📘',
						'xls': '📗',
						'xlsx': '📗',
						'json': '📋',
						'xml': '📋',
						'html': '🌐',
						'css': '🎨',
						'js': '⚡',
						'ts': '💠',
						'py': '🐍',
						'png': '🖼️',
						'jpg': '🖼️',
						'jpeg': '🖼️',
						'gif': '🖼️',
						'svg': '🖼️',
						'zip': '📦',
						'rar': '📦',
					};
					return icons[ext] || '📄';
				}

				function toggleFolder(event, path) {
					event.stopPropagation();
					if (expandedFolders.has(path)) {
						expandedFolders.delete(path);
					} else {
						expandedFolders.add(path);
					}
					saveState();
					// Re-render will happen on next message, but we can update locally
					const item = event.currentTarget;
					const chevron = item.querySelector('.chevron');
					const children = item.nextElementSibling;
					if (chevron && children) {
						chevron.classList.toggle('collapsed');
						children.style.display = children.style.display === 'none' ? 'block' : 'none';
					}
				}

				function openFile(path) {
					vscode.postMessage({ type: 'openFile', path });
				}

				function showContextMenu(event, path, isDirectory) {
					event.preventDefault();
					event.stopPropagation();
					currentContextItem = { path, isDirectory };
					const menu = document.getElementById('contextMenu');
					menu.style.left = event.clientX + 'px';
					menu.style.top = event.clientY + 'px';
					menu.classList.add('visible');
				}

				document.addEventListener('click', () => {
					document.getElementById('contextMenu').classList.remove('visible');
				});

				document.querySelectorAll('.context-menu-item').forEach(item => {
					item.addEventListener('click', (e) => {
						const action = e.currentTarget.dataset.action;
						if (!currentContextItem) return;

						switch (action) {
							case 'newFile':
								vscode.postMessage({
									type: 'createNewFile',
									parentPath: currentContextItem.isDirectory ? currentContextItem.path : getParentPath(currentContextItem.path)
								});
								break;
							case 'newFolder':
								vscode.postMessage({
									type: 'createNewFolder',
									parentPath: currentContextItem.isDirectory ? currentContextItem.path : getParentPath(currentContextItem.path)
								});
								break;
							case 'reveal':
								vscode.postMessage({ type: 'revealInExplorer', path: currentContextItem.path });
								break;
							case 'delete':
								vscode.postMessage({
									type: 'deleteItem',
									path: currentContextItem.path,
									isDirectory: currentContextItem.isDirectory
								});
								break;
						}
						document.getElementById('contextMenu').classList.remove('visible');
					});
				});

				function getParentPath(path) {
					const parts = path.split(/[\\/]/);
					parts.pop();
					return parts.join('/');
				}

				window.addEventListener('message', event => {
					const message = event.data;
					const content = document.getElementById('content');

					switch (message.type) {
						case 'updateTree':
							content.innerHTML = \`
								<div class="header">
									<div class="header-title">\${message.folderName}</div>
									<div class="header-actions">
										<button class="icon-btn" onclick="vscode.postMessage({type: 'createNewFile', parentPath: '\${message.folderPath}'})" title="New File">📄+</button>
										<button class="icon-btn" onclick="vscode.postMessage({type: 'createNewFolder', parentPath: '\${message.folderPath}'})" title="New Folder">📁+</button>
										<button class="icon-btn" onclick="vscode.postMessage({type: 'openFolder'})" title="Open Different Folder">📂</button>
										<button class="icon-btn" onclick="vscode.postMessage({type: 'refresh'})" title="Refresh">🔄</button>
									</div>
								</div>
								<div class="folder-path" title="\${message.folderPath}">\${message.folderPath}</div>
								<div class="tree-container">
									\${renderTree(message.tree, message.folderPath)}
								</div>
							\`;
							break;

						case 'suggestFolder':
							content.innerHTML = \`
								<div class="empty-state">
									<div class="empty-state-icon">📁</div>
									<div class="empty-state-title">Set Up Submissions Folder</div>
									<div class="empty-state-desc">
										Choose where generated files will be saved for <strong>\${message.workspaceName}</strong>
									</div>
									<div class="suggested-path">\${message.suggestedPath}</div>
									<div>
										\${message.exists
											? '<button class="btn" onclick="vscode.postMessage({type: \\'openFolder\\'})">Use Suggested Folder</button>'
											: '<button class="btn" onclick="vscode.postMessage({type: \\'createFolder\\'})">Create Submissions Folder</button>'
										}
										<button class="btn btn-secondary" onclick="vscode.postMessage({type: 'openFolder'})">Choose Different Folder</button>
									</div>
								</div>
							\`;
							break;

						case 'noWorkspace':
							content.innerHTML = \`
								<div class="empty-state">
									<div class="empty-state-icon">📂</div>
									<div class="empty-state-title">No Workspace Open</div>
									<div class="empty-state-desc">\${message.message}</div>
									<button class="btn" onclick="vscode.postMessage({type: 'openFolder'})">Open Folder</button>
								</div>
							\`;
							break;

						case 'folderNotFound':
							content.innerHTML = \`
								<div class="empty-state">
									<div class="empty-state-icon">⚠️</div>
									<div class="empty-state-title">Folder Not Found</div>
									<div class="empty-state-desc">The submissions folder no longer exists.</div>
									<div class="suggested-path">\${message.path}</div>
									<div>
										<button class="btn" onclick="vscode.postMessage({type: 'createFolder'})">Create New Folder</button>
										<button class="btn btn-secondary" onclick="vscode.postMessage({type: 'openFolder'})">Choose Different Folder</button>
									</div>
								</div>
							\`;
							break;

						case 'updateContent':
							content.innerHTML = message.content;
							break;
					}
				});

				// Signal that webview is ready
				vscode.postMessage({ type: 'ready' });
			</script>
		</body>
		</html>`
	}

	dispose() {
		if (this._folderWatcher) {
			this._folderWatcher.dispose()
		}
	}
}

function getNonce() {
	let text = ""
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}
