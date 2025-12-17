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
			// If no submissions folder is set, show the welcome message
			if (!this._treeDataProvider.getSubmissionsFolder()) {
				this._updateTreeMessage(
					"No submissions folder set. Create a regulatory product to automatically create a submissions folder.",
				)
			}
		})

		// Don't show explorer by default when a new window opens
		// this._ensureViewVisible()

		// Initialize with current workspace
		this._initializeView()
	}

	public static getInstance(): SubmissionsPaneProvider | undefined {
		return SubmissionsPaneProvider._instance
	}

	private async _initializeView() {
		// Try to restore previously set submissions folder
		const savedConfig = await this._getSavedConfig()
		if (savedConfig) {
			// Check if folder exists, with retry logic in case it's being created
			const folderExists = await this._waitForFolderExists(savedConfig.submissionsPath, 1000)

			if (folderExists) {
				this._treeDataProvider.setSubmissionsFolder(savedConfig.submissionsPath)
				// Ensure watcher is set up (with retry if needed)
				await this._treeDataProvider.ensureWatcherSetup()
				this._updateTreeMessage()

				// Hide submissions folder from explorer
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
				if (workspaceFolder) {
					await this._hideSubmissionsFolderFromExplorer(savedConfig.submissionsPath, workspaceFolder.uri.fsPath)
				}

				// Start PDF processing for the restored folder
				const { PdfProcessingManager } = await import("@/services/pdf/PdfProcessingManager")
				const pdfManager = PdfProcessingManager.getInstance()
				this._setupPdfManager(pdfManager)

				// Show progress UI for restored folder processing
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "PDF Processing",
						cancellable: true,
					},
					async (progress, token) => {
						token.onCancellationRequested(() => {
							pdfManager.cancel()
						})

						// Set progress reporter so manager can update UI
						pdfManager.setProgressReporter({
							report: (value) => progress.report(value),
						})

						await pdfManager.setSubmissionsFolder(savedConfig.submissionsPath)
					},
				)
			} else {
				// Folder was deleted externally, clear invalid config
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
				if (workspaceFolder) {
					const configKey = `submissions.config.${workspaceFolder.uri.fsPath}`
					await this._context.workspaceState.update(configKey, undefined)
				}
				// Show welcome message
				this._updateTreeMessage(
					"No submissions folder set. Create a regulatory product to automatically create a submissions folder.",
				)
			}
		} else {
			// Show welcome message
			this._updateTreeMessage(
				"No submissions folder set. Create a regulatory product to automatically create a submissions folder.",
			)
		}
	}

	private _setupPdfManager(pdfManager: any): void {
		// Set up file watcher factory (platform-specific)
		pdfManager.setFileWatcherFactory((pattern: { base: string; pattern: string }) => {
			try {
				const vscodePattern = new vscode.RelativePattern(pattern.base, pattern.pattern)
				const watcher = vscode.workspace.createFileSystemWatcher(vscodePattern)
				return {
					onDidCreate: (listener: (uri: { fsPath: string }) => void) =>
						watcher.onDidCreate((uri) => listener({ fsPath: uri.fsPath })),
					onDidChange: (listener: (uri: { fsPath: string }) => void) =>
						watcher.onDidChange((uri) => listener({ fsPath: uri.fsPath })),
					dispose: () => watcher.dispose(),
				}
			} catch {
				return null
			}
		})

		// Set up progress UI starter for new files
		pdfManager.setProgressUIStarter(async () => {
			// This will be called when processing starts from a new file
			// We'll show progress UI and return the reporter
			return new Promise<{ report: (value: { message?: string; increment?: number }) => void }>((resolve, reject) => {
				// Start progress UI - the callback will be invoked asynchronously
				// We need to resolve the promise when the progress callback is actually called
				const progressPromise = vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "PDF Processing (New File)",
						cancellable: true,
					},
					async (progress, token) => {
						token.onCancellationRequested(() => {
							pdfManager.cancel()
						})

						// Create the progress reporter
						const progressReporter = {
							report: (value: { message?: string; increment?: number }) => {
								try {
									progress.report(value)
								} catch (error) {
									console.error("Error reporting progress:", error)
								}
							},
						}

						// Resolve the outer promise with the reporter
						// This happens when the progress UI is actually shown
						resolve(progressReporter)

						// Keep the progress UI open by waiting indefinitely
						// The UI will stay open until processing completes
						await new Promise<void>(() => {
							// Never resolve - keeps progress UI open during processing
						})
					},
				)

				// Handle any errors from withProgress
				progressPromise.then(
					() => {
						// Progress completed normally
					},
					(error: unknown) => {
						reject(error)
					},
				)
			})
		})
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

	/**
	 * Waits for a folder to exist, with retry logic
	 * @param folderPath Path to the folder
	 * @param maxWaitMs Maximum time to wait in milliseconds
	 * @returns true if folder exists, false if timeout
	 */
	private async _waitForFolderExists(folderPath: string, maxWaitMs: number = 2000): Promise<boolean> {
		if (fs.existsSync(folderPath)) {
			return true
		}

		const startTime = Date.now()
		const checkInterval = 100 // Check every 100ms

		while (Date.now() - startTime < maxWaitMs) {
			await new Promise((resolve) => setTimeout(resolve, checkInterval))
			if (fs.existsSync(folderPath)) {
				return true
			}
		}

		return false
	}

	private async _setSubmissionsFolder(folderPath: string) {
		// Create folder if it doesn't exist
		if (!fs.existsSync(folderPath)) {
			try {
				fs.mkdirSync(folderPath, { recursive: true })
				// Wait a bit for filesystem propagation (50-100ms)
				await new Promise((resolve) => setTimeout(resolve, 100))
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create folder: ${error}`)
				return
			}
		}

		// Verify folder exists before proceeding (with retry)
		const folderExists = await this._waitForFolderExists(folderPath, 1000)
		if (!folderExists) {
			vscode.window.showErrorMessage(`Folder does not exist and could not be created: ${folderPath}`)
			return
		}

		this._treeDataProvider.setSubmissionsFolder(folderPath)
		// Ensure watcher is set up (with retry if needed)
		await this._treeDataProvider.ensureWatcherSetup()
		this._updateTreeMessage()

		// Save the config
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (workspaceFolder) {
			await this._saveConfig({
				workspacePath: workspaceFolder.uri.fsPath,
				submissionsPath: folderPath,
			})

			// Hide submissions folder from explorer
			await this._hideSubmissionsFolderFromExplorer(folderPath, workspaceFolder.uri.fsPath)
		}

		// Start PDF processing for the selected folder
		const { PdfProcessingManager } = await import("@/services/pdf/PdfProcessingManager")
		const pdfManager = PdfProcessingManager.getInstance()
		this._setupPdfManager(pdfManager)

		// Show progress UI
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "PDF Processing",
				cancellable: true,
			},
			async (progress, token) => {
				token.onCancellationRequested(() => {
					pdfManager.cancel()
				})

				// Set progress reporter so manager can update UI
				pdfManager.setProgressReporter({
					report: (value) => progress.report(value),
				})

				// Set submissions folder and process PDFs
				await pdfManager.setSubmissionsFolder(folderPath)
			},
		)
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
		// First try to get from tree data provider
		const folder = this._treeDataProvider.getSubmissionsFolder()
		if (folder) {
			return folder
		}

		// Fallback: Try to get from saved config
		return this._getSavedConfigSync()
	}

	private _getSavedConfigSync(): string | undefined {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			return undefined
		}

		const configKey = `submissions.config.${workspaceFolder.uri.fsPath}`
		const config = this._context.workspaceState.get<SubmissionsFolderConfig>(configKey)
		return config?.submissionsPath
	}

	public async setSubmissionsFolder(folderPath: string) {
		await this._setSubmissionsFolder(folderPath)
	}

	public async clearSubmissionsFolder() {
		// Clear the folder from the tree data provider
		this._treeDataProvider.setSubmissionsFolder("")
		this._treeDataProvider.refresh()

		// Clear the saved config
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (workspaceFolder) {
			const configKey = `submissions.config.${workspaceFolder.uri.fsPath}`
			await this._context.workspaceState.update(configKey, undefined)
		}

		// Show welcome message
		this._updateTreeMessage(
			"No submissions folder set. Create a regulatory product to automatically create a submissions folder.",
		)
	}

	dispose() {
		this._treeDataProvider.dispose()
		this._treeView?.dispose()
		// Clean up PDF processing manager
		import("@/services/pdf/PdfProcessingManager").then(({ PdfProcessingManager }) => {
			PdfProcessingManager.getInstance()?.dispose()
		})
	}
}
