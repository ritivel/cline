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
	private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> = new vscode.EventEmitter<
		FileItem | undefined | null | void
	>()
	readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> = this._onDidChangeTreeData.event

	private submissionsFolder?: string
	private _folderWatcher?: vscode.FileSystemWatcher

	constructor(private context: vscode.ExtensionContext) {
		// Watch for file system changes
		this.setupWatcher()
	}

	setSubmissionsFolder(folderPath: string) {
		if (folderPath === "") {
			// Clear the folder
			this.submissionsFolder = undefined
			if (this._folderWatcher) {
				this._folderWatcher.dispose()
				this._folderWatcher = undefined
			}
		} else {
			this.submissionsFolder = folderPath
			this.setupWatcher()
		}
		this.refresh()
	}

	getSubmissionsFolder(): string | undefined {
		return this.submissionsFolder
	}

	private setupWatcher() {
		if (this._folderWatcher) {
			this._folderWatcher.dispose()
		}

		if (this.submissionsFolder && fs.existsSync(this.submissionsFolder)) {
			const pattern = new vscode.RelativePattern(this.submissionsFolder, "**/*")
			this._folderWatcher = vscode.workspace.createFileSystemWatcher(pattern)

			this._folderWatcher.onDidCreate(() => this.refresh())
			this._folderWatcher.onDidDelete(() => this.refresh())
			this._folderWatcher.onDidChange(() => this.refresh())
		}
	}

	refresh(): void {
		this._onDidChangeTreeData.fire()
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
					if (a.isDirectory && !b.isDirectory) return -1
					if (!a.isDirectory && b.isDirectory) return 1
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
		this._onDidChangeTreeData.dispose()
	}
}
