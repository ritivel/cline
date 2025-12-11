import * as fs from "fs"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import { PdfProcessingService } from "./PdfProcessingService"

/**
 * Manages PDF processing lifecycle:
 * - Auto-starts processing when submissions folder is selected
 * - Watches for new PDFs and processes them automatically
 * - Only processes unprocessed files
 */
export interface FileSystemWatcher {
	onDidCreate(listener: (uri: { fsPath: string }) => void): { dispose(): void }
	onDidChange(listener: (uri: { fsPath: string }) => void): { dispose(): void }
	dispose(): void
}

export interface ProgressReporter {
	report(value: { message?: string; increment?: number }): void
}

export type ProgressUIStarter = () => Promise<ProgressReporter | undefined>

export class PdfProcessingManager {
	private static _instance: PdfProcessingManager | undefined
	private _pdfWatcher?: FileSystemWatcher
	private _currentSubmissionsFolder?: string
	private _pdfProcessingService: PdfProcessingService | null = null
	private _isProcessing: boolean = false
	private _processingQueue: Set<string> = new Set()
	private _debounceTimer?: NodeJS.Timeout
	private _createFileWatcher?: (pattern: { base: string; pattern: string }) => FileSystemWatcher | null
	private _progressReporter?: ProgressReporter
	private _startProgressUI?: ProgressUIStarter

	private constructor() {
		PdfProcessingManager._instance = this
	}

	public static getInstance(): PdfProcessingManager {
		if (!PdfProcessingManager._instance) {
			PdfProcessingManager._instance = new PdfProcessingManager()
		}
		return PdfProcessingManager._instance
	}

	/**
	 * Sets the file watcher factory (called from host layer)
	 */
	public setFileWatcherFactory(createWatcher: (pattern: { base: string; pattern: string }) => FileSystemWatcher | null): void {
		this._createFileWatcher = createWatcher
	}

	/**
	 * Sets the progress reporter (called from host layer)
	 */
	public setProgressReporter(reporter: ProgressReporter): void {
		this._progressReporter = reporter
	}

	/**
	 * Sets a callback to start progress UI when processing new files (called from host layer)
	 */
	public setProgressUIStarter(starter: ProgressUIStarter): void {
		this._startProgressUI = starter
	}

	/**
	 * Sets the submissions folder and starts processing
	 * Scans workspace root for PDFs and saves processed documents to submissions folder
	 */
	public async setSubmissionsFolder(submissionsFolder: string): Promise<void> {
		// Dispose existing watcher
		this._pdfWatcher?.dispose()

		this._currentSubmissionsFolder = submissionsFolder

		// Get workspace root using HostProvider
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const workspaceRoot = workspacePaths.paths?.[0] || path.dirname(submissionsFolder)

		// Set up file watcher for new PDFs in workspace root
		this._setupPdfWatcher(workspaceRoot)

		// Start processing all PDFs from workspace root (only unprocessed ones)
		await this._processAllPdfs(workspaceRoot, submissionsFolder)
	}

	/**
	 * Sets up a file watcher to detect new PDFs in workspace root
	 */
	private _setupPdfWatcher(workspaceRoot: string): void {
		if (!this._createFileWatcher) {
			// File watcher factory not set, skip watching
			return
		}

		// Watch for new PDF files in workspace root (not submissions folder)
		const watcher = this._createFileWatcher?.({ base: workspaceRoot, pattern: "**/*.pdf" })
		if (!watcher) {
			return
		}
		this._pdfWatcher = watcher

		// Handle new PDF files
		this._pdfWatcher.onDidCreate(async (uri: { fsPath: string }) => {
			const pdfPath = uri.fsPath
			// Debounce to handle rapid file additions
			if (this._debounceTimer) {
				clearTimeout(this._debounceTimer)
			}
			this._debounceTimer = setTimeout(() => {
				this._processNewPdf(pdfPath)
			}, 1000) // 1 second debounce
		})

		// Handle PDF file changes (in case file is overwritten)
		this._pdfWatcher.onDidChange(async (uri: { fsPath: string }) => {
			const pdfPath = uri.fsPath
			if (this._debounceTimer) {
				clearTimeout(this._debounceTimer)
			}
			this._debounceTimer = setTimeout(() => {
				this._processNewPdf(pdfPath)
			}, 1000)
		})
	}

	/**
	 * Processes all PDFs from workspace root (only unprocessed ones)
	 * Saves processed documents to submissions folder
	 */
	private async _processAllPdfs(workspaceRoot: string, submissionsFolder: string): Promise<void> {
		if (this._isProcessing) {
			console.log("PDF processing already in progress, skipping...")
			return
		}

		this._isProcessing = true

		try {
			// Cancel any existing processing
			if (this._pdfProcessingService) {
				this._pdfProcessingService.cancel()
				this._pdfProcessingService = null
			}

			this._pdfProcessingService = new PdfProcessingService(
				"https://isanthous-breccial-claire.ngrok-free.dev",
				"hellofromritivel",
			)

			// Process PDFs from workspace root, save to submissions folder
			if (this._pdfProcessingService) {
				await this._pdfProcessingService
					.processPdfs(workspaceRoot, submissionsFolder, (stage, details) => {
						const message = details || stage
						console.log(`[PDF Processing ${stage}] ${message}`)

						// Report progress to UI
						if (this._progressReporter) {
							try {
								this._progressReporter.report({ message })
							} catch (error) {
								console.error("Error reporting progress:", error)
							}
						} else {
							// If no progress reporter, at least log it
							console.log(`Progress: ${message}`)
						}
					})
					.catch((error) => {
						const errorMessage = error instanceof Error ? error.message : String(error)
						if (errorMessage !== "Operation cancelled by user") {
							console.error("Error processing PDFs:", error)
							HostProvider.get().hostBridge.windowClient.showMessage({
								message: `PDF Processing Error: ${errorMessage}`,
								type: ShowMessageType.ERROR,
							})
						}
					})
			}
		} finally {
			this._isProcessing = false
			this._pdfProcessingService = null
		}
	}

	/**
	 * Processes a single new PDF file
	 */
	private async _processNewPdf(pdfPath: string): Promise<void> {
		// Check if already in queue
		if (this._processingQueue.has(pdfPath)) {
			return
		}

		// Check if file still exists
		if (!fs.existsSync(pdfPath)) {
			return
		}

		// Get workspace root using HostProvider
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const workspaceRoot = workspacePaths.paths?.[0] || path.dirname(pdfPath)

		// Check if already processed using the tracker
		const { PdfProcessingTracker } = await import("./PdfProcessingTracker")
		const tracker = new PdfProcessingTracker(workspaceRoot)
		const isProcessed = await tracker.isProcessed(pdfPath, workspaceRoot)

		if (isProcessed) {
			console.log(`PDF already processed: ${pdfPath}`)
			return
		}

		this._processingQueue.add(pdfPath)

		try {
			// If not currently processing, start a new processing session
			if (!this._isProcessing && this._currentSubmissionsFolder) {
				const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
				const workspaceRoot = workspacePaths.paths?.[0] || path.dirname(pdfPath)

				// If no progress reporter is set, start progress UI for new file
				if (!this._progressReporter && this._startProgressUI) {
					console.log("Starting progress UI for new file processing...")
					try {
						const reporter = await this._startProgressUI()
						if (reporter) {
							this._progressReporter = reporter
							console.log("Progress UI started, reporter is ready")
							// Give the UI a moment to appear
							await new Promise((resolve) => setTimeout(resolve, 100))
						} else {
							console.warn("Progress UI starter returned undefined reporter")
						}
					} catch (error) {
						console.error("Failed to start progress UI:", error)
					}
				}

				await this._processAllPdfs(workspaceRoot, this._currentSubmissionsFolder)
			}
		} finally {
			this._processingQueue.delete(pdfPath)
		}
	}

	/**
	 * Cancels current processing
	 */
	public cancel(): void {
		this._pdfProcessingService?.cancel()
		this._isProcessing = false
	}

	/**
	 * Cleans up resources
	 */
	public dispose(): void {
		this._pdfWatcher?.dispose()
		this._pdfProcessingService?.cancel()
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer)
		}
	}
}
