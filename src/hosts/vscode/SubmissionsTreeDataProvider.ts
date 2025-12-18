import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

class FileItem {
	constructor(
		public readonly path: string,
		public readonly name: string,
		public readonly isDirectory: boolean,
	) {}
}

export class SubmissionsTreeDataProvider implements vscode.TreeDataProvider<FileItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null> = new vscode.EventEmitter<
		FileItem | undefined | null
	>()
	readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null> = this._onDidChangeTreeData.event

	private submissionsFolder?: string
	private _folderWatcher?: vscode.FileSystemWatcher
	private _retryTimeoutId?: NodeJS.Timeout

	constructor(_context: vscode.ExtensionContext) {
		// Watch for file system changes
		void this.setupWatcher()
	}

	setSubmissionsFolder(folderPath: string) {
		if (folderPath === "") {
			// Clear the folder
			this.submissionsFolder = undefined
			if (this._folderWatcher) {
				this._folderWatcher.dispose()
				this._folderWatcher = undefined
			}
			if (this._retryTimeoutId) {
				clearTimeout(this._retryTimeoutId)
				this._retryTimeoutId = undefined
			}
		} else {
			this.submissionsFolder = folderPath
			void this.setupWatcher()
		}
		this.refresh()
	}

	getSubmissionsFolder(): string | undefined {
		return this.submissionsFolder
	}

	private async setupWatcher(): Promise<void> {
		if (this._folderWatcher) {
			this._folderWatcher.dispose()
			this._folderWatcher = undefined
		}

		if (!this.submissionsFolder) {
			return
		}

		// Try to set up watcher with retry logic
		await this._retryWatcherSetup()
	}

	/**
	 * Retries watcher setup with exponential backoff if folder doesn't exist yet
	 */
	private async _retryWatcherSetup(attempt: number = 0): Promise<void> {
		if (!this.submissionsFolder) {
			return
		}

		const maxAttempts = 3
		const delays = [100, 200, 400] // Exponential backoff delays in ms

		if (fs.existsSync(this.submissionsFolder)) {
			// Folder exists, set up watcher
			try {
				const pattern = new vscode.RelativePattern(this.submissionsFolder, "**/*")
				this._folderWatcher = vscode.workspace.createFileSystemWatcher(pattern)

				this._folderWatcher.onDidCreate(() => this.refresh())
				this._folderWatcher.onDidDelete(() => this.refresh())
				this._folderWatcher.onDidChange(() => this.refresh())
			} catch (error) {
				console.error("[SubmissionsTreeDataProvider] Failed to create file watcher:", error)
			}
		} else if (attempt < maxAttempts) {
			// Folder doesn't exist yet, retry after delay
			const delay = delays[attempt]
			await new Promise((resolve) => setTimeout(resolve, delay))
			await this._retryWatcherSetup(attempt + 1)
		} else {
			// Max attempts reached, start periodic retry mechanism
			this._startPeriodicRetry()
		}
	}

	/**
	 * Periodically checks if folder exists and sets up watcher when it does
	 * This handles cases where folder is created externally after pane is loaded
	 */
	private _startPeriodicRetry(): void {
		if (this._retryTimeoutId) {
			clearTimeout(this._retryTimeoutId)
		}

		if (!this.submissionsFolder) {
			return
		}

		const maxDuration = 5000 // 5 seconds
		const checkInterval = 500 // Check every 500ms
		const startTime = Date.now()

		const checkFolder = () => {
			if (!this.submissionsFolder) {
				return
			}

			if (fs.existsSync(this.submissionsFolder)) {
				// Folder now exists, set up watcher
				void this._retryWatcherSetup(0)
				if (this._retryTimeoutId) {
					clearTimeout(this._retryTimeoutId)
					this._retryTimeoutId = undefined
				}
			} else if (Date.now() - startTime < maxDuration) {
				// Continue checking
				this._retryTimeoutId = setTimeout(checkFolder, checkInterval)
			} else {
				// Max duration reached, stop retrying
				this._retryTimeoutId = undefined
			}
		}

		this._retryTimeoutId = setTimeout(checkFolder, checkInterval)
	}

	/**
	 * Public method to ensure watcher is set up, with retry if needed
	 */
	public async ensureWatcherSetup(): Promise<void> {
		await this.setupWatcher()
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined)
	}

	getTreeItem(element: FileItem): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(
			element.name,
			element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
		)

		treeItem.resourceUri = vscode.Uri.file(element.path)

		if (element.isDirectory) {
			treeItem.contextValue = "submissionsFolder"
			treeItem.iconPath = vscode.ThemeIcon.Folder
		} else {
			treeItem.contextValue = "submissionsFile"
			treeItem.command = {
				command: "vscode.open",
				title: "Open File",
				arguments: [vscode.Uri.file(element.path)],
			}
		}

		return treeItem
	}

	getChildren(element?: FileItem): FileItem[] {
		if (!this.submissionsFolder || !fs.existsSync(this.submissionsFolder)) {
			return []
		}

		const targetPath = element ? element.path : this.submissionsFolder

		try {
			const entries = fs.readdirSync(targetPath, { withFileTypes: true })
			return entries
				.filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
				.map((entry) => new FileItem(path.join(targetPath, entry.name), entry.name, entry.isDirectory()))
				.sort((a, b) => {
					if (a.isDirectory && !b.isDirectory) {
						return -1
					}
					if (!a.isDirectory && b.isDirectory) {
						return 1
					}
					return a.name.localeCompare(b.name)
				})
		} catch {
			return []
		}
	}

	dispose() {
		if (this._folderWatcher) {
			this._folderWatcher.dispose()
		}
		if (this._retryTimeoutId) {
			clearTimeout(this._retryTimeoutId)
			this._retryTimeoutId = undefined
		}
		this._onDidChangeTreeData.dispose()
	}
}
