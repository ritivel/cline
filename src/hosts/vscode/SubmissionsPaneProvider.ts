import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { SubmissionsTreeDataProvider } from "./SubmissionsTreeDataProvider"

interface SubmissionsFolderConfig {
	workspacePath: string
	submissionsPath: string
}

export class SubmissionsPaneProvider {
	public static readonly ID = "cline.SubmissionsPane"
	private static _instance: SubmissionsPaneProvider | undefined
	private _treeView?: vscode.TreeView<unknown>
	private _treeDataProvider: SubmissionsTreeDataProvider
	private _context: vscode.ExtensionContext

	constructor(context: vscode.ExtensionContext) {
		this._context = context
		this._treeDataProvider = new SubmissionsTreeDataProvider(context)

		// Create the tree view
		this._treeView = vscode.window.createTreeView(SubmissionsPaneProvider.ID, {
			treeDataProvider: this._treeDataProvider,
			showCollapseAll: true,
		})

		SubmissionsPaneProvider._instance = this

		// Listen for workspace folder changes
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			this._suggestSubmissionsFolder()
		})

		// Initialize with current workspace
		this._initializeView()
	}

	public static getInstance(): SubmissionsPaneProvider | undefined {
		return SubmissionsPaneProvider._instance
	}

	private async _initializeView() {
		// Try to restore previously set submissions folder
		const savedConfig = await this._getSavedConfig()
		if (savedConfig && fs.existsSync(savedConfig.submissionsPath)) {
			this._treeDataProvider.setSubmissionsFolder(savedConfig.submissionsPath)
			this._updateTreeMessage()
		} else {
			// Show welcome message
			this._updateTreeMessage("No submissions folder set. Use the folder icon to select or create one.")
			// Suggest a submissions folder based on current workspace
			await this._suggestSubmissionsFolder()
		}
	}

	private async _getSavedConfig(): Promise<SubmissionsFolderConfig | undefined> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			return undefined
		}

		// Use VS Code's workspaceState to store config (not visible to users)
		const configKey = `submissions.config.${workspaceFolder.uri.fsPath}`
		const config = this._context.workspaceState.get<SubmissionsFolderConfig>(configKey)
		return config
	}

	private async _saveConfig(config: SubmissionsFolderConfig) {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			return
		}

		// Use VS Code's workspaceState to store config (not visible to users)
		const configKey = `submissions.config.${workspaceFolder.uri.fsPath}`
		await this._context.workspaceState.update(configKey, config)
	}

	private async _suggestSubmissionsFolder() {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			this._updateTreeMessage("No project open. Open a project folder to get started.")
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

		const suggestedFolderName = path.basename(suggestedPath)
		const exists = fs.existsSync(suggestedPath)

		this._updateTreeMessage(
			exists
				? `Recommended folder: ${suggestedFolderName} (in ${workspaceName})`
				: `Recommended folder: ${suggestedFolderName} (will be created in ${workspaceName})`,
		)
	}

	private _updateTreeMessage(message?: string) {
		if (this._treeView) {
			this._treeView.message = message
		}
	}

	public async openFolder() {
		const result = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: "Select Submissions Folder",
			title: "Select Submissions Folder",
		})

		if (result && result[0]) {
			await this._setSubmissionsFolder(result[0].fsPath)
		}
	}

	public async createFolder(): Promise<void> {
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
					await this._setSubmissionsFolder(newFolderPath)
				} else {
					return this.createFolder()
				}
			} else {
				try {
					fs.mkdirSync(newFolderPath, { recursive: true })
					await this._setSubmissionsFolder(newFolderPath)
					vscode.window.showInformationMessage(`Created submissions folder: ${folderName}`)
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to create folder: ${error}`)
				}
			}
		}
	}

	private async _setSubmissionsFolder(folderPath: string) {
		if (!fs.existsSync(folderPath)) {
			try {
				fs.mkdirSync(folderPath, { recursive: true })
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create folder: ${error}`)
				return
			}
		}

		this._treeDataProvider.setSubmissionsFolder(folderPath)
		this._updateTreeMessage()

		// Save the config
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (workspaceFolder) {
			await this._saveConfig({
				workspacePath: workspaceFolder.uri.fsPath,
				submissionsPath: folderPath,
			})
		}
	}

	public async useSuggestedFolder() {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
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

		await this._setSubmissionsFolder(suggestedPath)
	}

	public async refresh() {
		this._treeDataProvider.refresh()
	}

	public getSubmissionsFolder(): string | undefined {
		return this._treeDataProvider.getSubmissionsFolder()
	}

	public async setSubmissionsFolder(folderPath: string) {
		await this._setSubmissionsFolder(folderPath)
	}

	dispose() {
		this._treeDataProvider.dispose()
		this._treeView?.dispose()
	}
}
