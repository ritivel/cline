import { buildApiHandler } from "@core/api"
import type { ToolUse } from "@core/assistant-message"
import { resolveWorkspacePath } from "@core/workspace"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { showSystemNotification } from "@integrations/notifications"
import { McpHub } from "@services/mcp/McpHub"
import { ClineSay } from "@shared/ExtensionMessage"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { getCwd } from "@utils/path"
import * as fs from "fs"
import * as path from "path"
import { ClineDefaultTool } from "@/shared/tools"
import { Controller } from "../controller"
import { StateManager } from "../storage/StateManager"
import { Task } from "./index"
import { AutoApprove } from "./tools/autoApprove"
import { WriteTexToolHandler } from "./tools/handlers/WriteTexToolHandler"
import { ToolExecutorCoordinator } from "./tools/ToolExecutorCoordinator"
import { ToolValidator } from "./tools/ToolValidator"
import type { TaskConfig } from "./tools/types/TaskConfig"

/**
 * Parameters for creating a TaskSection23 instance
 */
export interface TaskSection23Params {
	controller: Controller
	mcpHub: McpHub
	shellIntegrationTimeout: number
	terminalReuseEnabled: boolean
	terminalOutputLineLimit: number
	subagentTerminalOutputLineLimit: number
	defaultTerminalProfile: string
	vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	cwd: string
	stateManager: StateManager
	workspaceManager?: WorkspaceRootManager
	task: string
	taskId: string
	taskLockAcquired: boolean

	// Section-specific params
	sectionFolderPath: string
	expectedOutputFile: string
	tagsPath: string
	onProgress?: (status: string) => void
}

/**
 * Result of task completion
 */
export interface TaskSection23Result {
	success: boolean
	error?: string
	qosPdPath?: string
}

/**
 * Represents a document folder with its metadata
 */
interface DocumentInfo {
	folderName: string
	folderPath: string
	pdfPath: string | null
	infoJson: {
		source_of_file?: string
		dossier_summary?: string
		summary?: string
		[key: string]: any
	} | null
}

/**
 * TaskSection23 extends Task to find and import the compiled QOS-PD PDF.
 * It searches through all documents in the submissions folder, uses LLM to identify
 * the "Quality Overall Summary - Product Dossier (QOS-PD)", and generates a LaTeX
 * file that imports that PDF using the pdfpages package.
 */
export class TaskSection23 extends Task {
	private sectionFolderPath: string
	private expectedOutputFile: string
	private tagsPath: string
	private onProgress?: (status: string) => void

	// Completion monitoring
	private completionCheckInterval?: NodeJS.Timeout
	private isCompleted: boolean = false

	constructor(params: TaskSection23Params) {
		super({
			controller: params.controller,
			mcpHub: params.mcpHub,
			updateTaskHistory: async () => [],
			postStateToWebview: async () => {},
			reinitExistingTaskFromId: async () => {},
			cancelTask: async () => {},
			shellIntegrationTimeout: params.shellIntegrationTimeout,
			terminalReuseEnabled: params.terminalReuseEnabled,
			terminalOutputLineLimit: params.terminalOutputLineLimit,
			subagentTerminalOutputLineLimit: params.subagentTerminalOutputLineLimit,
			defaultTerminalProfile: params.defaultTerminalProfile,
			vscodeTerminalExecutionMode: params.vscodeTerminalExecutionMode,
			cwd: params.cwd,
			stateManager: params.stateManager,
			workspaceManager: params.workspaceManager,
			task: params.task,
			images: undefined,
			files: undefined,
			historyItem: undefined,
			taskId: params.taskId,
			taskLockAcquired: params.taskLockAcquired,
		})

		this.sectionFolderPath = params.sectionFolderPath
		this.expectedOutputFile = params.expectedOutputFile
		this.tagsPath = params.tagsPath
		this.onProgress = params.onProgress
	}

	/**
	 * Reports progress via the callback if provided
	 */
	private reportProgress(status: string): void {
		if (this.onProgress) {
			this.onProgress(status)
		}
		console.log(`[TaskSection23] ${status}`)
	}

	/**
	 * Checks if the expected output file exists
	 */
	private async checkFileExists(): Promise<boolean> {
		try {
			await fs.promises.access(this.expectedOutputFile, fs.constants.F_OK)
			return true
		} catch {
			return false
		}
	}

	/**
	 * Starts monitoring for completion
	 */
	private startCompletionMonitoring(): void {
		if (this.completionCheckInterval) {
			clearInterval(this.completionCheckInterval)
		}

		this.completionCheckInterval = setInterval(async () => {
			if (this.isCompleted) {
				this.stopCompletionMonitoring()
				return
			}

			const fileExists = await this.checkFileExists()
			if (fileExists && !this.isCompleted) {
				console.log(`[TaskSection23] Output file found, marking as complete`)
				this.isCompleted = true
				this.stopCompletionMonitoring()
				this.reportProgress("Completed")
			}
		}, 3000)
	}

	/**
	 * Stops completion monitoring
	 */
	private stopCompletionMonitoring(): void {
		if (this.completionCheckInterval) {
			clearInterval(this.completionCheckInterval)
			this.completionCheckInterval = undefined
		}
	}

	/**
	 * Gets the submissions path from SubmissionsPaneProvider
	 */
	private getSubmissionsPath(): string | undefined {
		try {
			const { SubmissionsPaneProvider } = require("@/hosts/vscode/SubmissionsPaneProvider")
			const submissionsProvider = SubmissionsPaneProvider.getInstance()
			return submissionsProvider?.getSubmissionsFolder()
		} catch (error) {
			console.warn(`[TaskSection23] Failed to get submissions path: ${error}`)
			return undefined
		}
	}

	/**
	 * Lists all document folders in the documents directory
	 */
	private async listAllDocuments(documentsPath: string): Promise<DocumentInfo[]> {
		const documents: DocumentInfo[] = []

		try {
			const entries = await fs.promises.readdir(documentsPath, { withFileTypes: true })

			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue
				}

				const folderPath = path.join(documentsPath, entry.name)

				// Read info.json if exists
				let infoJson: DocumentInfo["infoJson"] = null
				try {
					const infoPath = path.join(folderPath, "info.json")
					const infoContent = await fs.promises.readFile(infoPath, "utf-8")
					infoJson = JSON.parse(infoContent)
				} catch {
					// info.json doesn't exist or can't be parsed
				}

				// Find PDF file in folder
				let pdfPath: string | null = null
				try {
					const folderEntries = await fs.promises.readdir(folderPath, { withFileTypes: true })
					for (const folderEntry of folderEntries) {
						if (folderEntry.isFile() && folderEntry.name.toLowerCase().endsWith(".pdf")) {
							pdfPath = path.join(folderPath, folderEntry.name)
							break
						}
					}
				} catch {
					// Failed to read folder contents
				}

				documents.push({
					folderName: entry.name,
					folderPath,
					pdfPath,
					infoJson,
				})
			}
		} catch (error) {
			console.error(`[TaskSection23] Error listing documents: ${error}`)
		}

		return documents
	}

	/**
	 * Formats document information for LLM analysis
	 */
	private formatDocumentsForLLM(documents: DocumentInfo[]): string {
		const parts: string[] = []
		parts.push("Available documents in the submissions folder:\n")

		for (let i = 0; i < documents.length; i++) {
			const doc = documents[i]
			parts.push(`\n[Document ${i + 1}]`)
			parts.push(`Folder Name: ${doc.folderName}`)
			parts.push(`Has PDF: ${doc.pdfPath ? "Yes" : "No"}`)

			if (doc.infoJson) {
				if (doc.infoJson.source_of_file) {
					parts.push(`Source/Title: ${doc.infoJson.source_of_file}`)
				}
				if (doc.infoJson.dossier_summary) {
					parts.push(`Dossier Summary: ${doc.infoJson.dossier_summary}`)
				}
				if (doc.infoJson.summary) {
					parts.push(`Summary: ${doc.infoJson.summary}`)
				}
			} else {
				parts.push("(No metadata available)")
			}
		}

		return parts.join("\n")
	}

	/**
	 * Calls LLM to identify the QOS-PD document
	 */
	private async identifyQosPdDocument(documents: DocumentInfo[]): Promise<DocumentInfo | null> {
		const documentsInfo = this.formatDocumentsForLLM(documents)

		const prompt = `You are analyzing documents to find the "Quality Overall Summary - Product Dossier (QOS-PD)" document.

The QOS-PD is a regulatory document that provides a comprehensive quality overview summary of a pharmaceutical product. It is typically:
- Named something like "QOS", "Quality Overall Summary", "QOS-PD", "Product Dossier QOS", or similar
- Contains quality information about the drug substance and drug product
- May be labeled as a CTD Section 2.3 document
- Is a compiled/official quality summary document (not raw data or individual study reports)

${documentsInfo}

Based on the document names and metadata above, identify which document is most likely the "Quality Overall Summary - Product Dossier (QOS-PD)".

IMPORTANT: Return ONLY the document number (e.g., "1", "5", "12") of the QOS-PD document.
If no document appears to be a QOS-PD, return "NONE".
Do not include any explanation or additional text.`

		try {
			const stateManager = StateManager.get()
			const apiConfiguration = stateManager.getApiConfiguration()
			const currentMode = "act"
			const apiHandler = buildApiHandler(apiConfiguration, currentMode)

			const systemPrompt = `You are a regulatory document classifier. Your task is to identify the Quality Overall Summary - Product Dossier (QOS-PD) document from a list of available documents. Respond only with the document number or "NONE".`
			const messages = [{ role: "user" as const, content: prompt }]

			const stream = apiHandler.createMessage(systemPrompt, messages)

			let response = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					response += chunk.text
				}
			}

			// Parse the response
			const trimmedResponse = response.trim()
			console.log(`[TaskSection23] LLM response for QOS-PD identification: ${trimmedResponse}`)

			if (trimmedResponse.toUpperCase() === "NONE") {
				return null
			}

			// Extract document number
			const docNumberMatch = trimmedResponse.match(/(\d+)/)
			if (docNumberMatch) {
				const docIndex = parseInt(docNumberMatch[1], 10) - 1 // Convert to 0-based index
				if (docIndex >= 0 && docIndex < documents.length) {
					return documents[docIndex]
				}
			}

			return null
		} catch (error) {
			console.error(`[TaskSection23] LLM identification failed: ${error}`)
			return null
		}
	}

	/**
	 * Generates LaTeX content that imports the QOS-PD PDF
	 */
	private generateLatexWithPdfImport(pdfPath: string): string {
		// Convert Windows backslashes to forward slashes for LaTeX
		const latexPath = pdfPath.replace(/\\/g, "/")

		return `\\documentclass[12pt,a4paper]{article}

% Required packages
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{pdfpages}

\\begin{document}

\\section*{Quality Overall Summary - Product Dossier (QOS-PD)}
Please find enclosed.

% Import the Quality Overall Summary - Product Dossier (QOS-PD)
\\includepdf[pages=-,fitpaper=true]{${latexPath}}

\\end{document}
`
	}

	/**
	 * Writes the LaTeX content to the output file using the write_tex handler
	 */
	private async writeOutputFile(content: string): Promise<void> {
		try {
			// Strip markdown code block markers if present
			const cleanedContent = this.stripMarkdownCodeBlocks(content)

			// Create tool validator
			const validator = new ToolValidator(this.clineIgnoreController)

			// Create write_tex handler
			const handler = new WriteTexToolHandler(validator)

			// Get relative path from cwd
			const cwd = await getCwd()
			const pathResult = resolveWorkspacePath(cwd, this.expectedOutputFile, "TaskSection23.writeOutputFile")
			const resolvedPath =
				typeof pathResult === "string" ? path.relative(cwd, this.expectedOutputFile) : pathResult.resolvedPath

			// Create ToolUse block
			const toolUse: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.WRITE_TEX,
				params: {
					path: resolvedPath,
					content: cleanedContent,
				},
				partial: false,
			}

			// Create TaskConfig
			const config = this.createTaskConfigForTool()

			// Execute the handler
			await handler.execute(config, toolUse)
			console.log(`[TaskSection23] Successfully wrote output file using write_tex: ${this.expectedOutputFile}`)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to write output file using write_tex: ${errorMessage}`)
		}
	}

	/**
	 * Strips markdown code block markers from content
	 */
	private stripMarkdownCodeBlocks(content: string): string {
		let stripped = content.trim()

		// Remove opening code block (```latex, ```latex\n, or ```)
		const lines = stripped.split("\n")
		if (lines.length > 0 && lines[0].trim().startsWith("```")) {
			lines.shift() // Remove the opening line (e.g., "```latex" or "```")
			stripped = lines.join("\n")
		}

		// Remove closing code block (```)
		if (stripped.trim().endsWith("```")) {
			const remainingLines = stripped.split("\n")
			if (remainingLines.length > 0 && remainingLines[remainingLines.length - 1].trim() === "```") {
				remainingLines.pop() // Remove the closing line
				stripped = remainingLines.join("\n")
			}
		}

		return stripped.trim()
	}

	/**
	 * Creates a TaskConfig for tool execution
	 * This constructs the config using available properties from Task base class
	 */
	private createTaskConfigForTool(): TaskConfig {
		// Create coordinator
		const coordinator = new ToolExecutorCoordinator()

		// Register the write_tex handler
		const validator = new ToolValidator(this.clineIgnoreController)
		const writeTexHandler = new WriteTexToolHandler(validator)
		coordinator.register(writeTexHandler)

		// Create config using protected properties from Task base class
		const config: TaskConfig = {
			taskId: this.taskId,
			ulid: this.ulid,
			cwd: this.cwd,
			mode: this.stateManager.getGlobalSettingsKey("mode"),
			strictPlanModeEnabled: this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled"),
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			vscodeTerminalExecutionMode: this.terminalExecutionMode,
			context: this.controller.context,
			workspaceManager: this.workspaceManager,
			isMultiRootEnabled: this.workspaceManager !== undefined,
			taskState: this.taskState,
			messageState: this.messageStateHandler,
			api: this.api,
			autoApprovalSettings: this.stateManager.getGlobalSettingsKey("autoApprovalSettings"),
			autoApprover: new AutoApprove(this.stateManager),
			browserSettings: this.stateManager.getGlobalSettingsKey("browserSettings"),
			focusChainSettings: this.stateManager.getGlobalSettingsKey("focusChainSettings"),
			services: {
				mcpHub: this.mcpHub,
				browserSession: this.browserSession,
				urlContentFetcher: this.urlContentFetcher,
				diffViewProvider: this.diffViewProvider,
				fileContextTracker: this.fileContextTracker,
				clineIgnoreController: this.clineIgnoreController,
				contextManager: this.contextManager,
				stateManager: this.stateManager,
			},
			callbacks: {
				say: async (type, text, images, files, partial) => {
					return await this.say(type, text, images, files, partial)
				},
				ask: async (_type, _text, _partial) => {
					// For write_tex, we'll auto-approve
					return { response: "approved" as any }
				},
				saveCheckpoint: async () => {},
				sayAndCreateMissingParamError: async (toolName, paramName) => {
					throw new Error(`Missing parameter ${paramName} for tool ${toolName}`)
				},
				removeLastPartialMessageIfExistsWithType: async () => {},
				executeCommandTool: async () => [false, ""],
				doesLatestTaskCompletionHaveNewChanges: async () => false,
				updateFCListFromToolResponse: async () => {},
				switchToActMode: async () => false,
				cancelTask: async () => {},
				shouldAutoApproveTool: (toolName) => {
					const autoApprover = new AutoApprove(this.stateManager)
					return autoApprover.shouldAutoApproveTool(toolName)
				},
				shouldAutoApproveToolWithPath: async (toolName, filePath) => {
					const autoApprover = new AutoApprove(this.stateManager)
					return await autoApprover.shouldAutoApproveToolWithPath(toolName, filePath)
				},
				postStateToWebview: async () => {},
				reinitExistingTaskFromId: async () => {},
				updateTaskHistory: async () => [],
				applyLatestBrowserSettings: async () => {
					return this.browserSession
				},
				setActiveHookExecution: async (hookExecution) => {
					return await this.setActiveHookExecution(hookExecution)
				},
				clearActiveHookExecution: async () => {
					return await this.clearActiveHookExecution()
				},
				getActiveHookExecution: async () => {
					return await this.getActiveHookExecution()
				},
				runUserPromptSubmitHook: async () => {
					return { cancel: false }
				},
			},
			coordinator,
		}

		return config
	}

	/**
	 * Gets drug name from tags file or RegulatoryProductConfig
	 */
	private async getDrugName(): Promise<string> {
		// First try to read from tags.md
		try {
			const content = await fs.promises.readFile(this.tagsPath, "utf-8")
			const lines = content.split("\n")
			for (const line of lines) {
				const trimmed = line.trim()
				const drugMatch = trimmed.match(/^Drug\s*Name:\s*(.+)$/i)
				if (drugMatch) {
					return drugMatch[1].trim()
				}
			}
		} catch {
			// Tags file doesn't exist or can't be read
		}

		// Fall back to RegulatoryProductConfig
		try {
			const currentProduct = this.stateManager.getGlobalStateKey("currentRegulatoryProduct") as
				| RegulatoryProductConfig
				| undefined

			if (currentProduct?.drugName) {
				return currentProduct.drugName
			}
		} catch {
			// Failed to get from config
		}

		return "Unknown Drug"
	}

	/**
	 * Main entry point: Finds the QOS-PD and generates the LaTeX file
	 */
	public async runSection23Generation(): Promise<TaskSection23Result> {
		try {
			this.reportProgress("Starting section 2.3 QOS-PD import generation")
			showSystemNotification({
				subtitle: "Section 2.3",
				message: "Starting QOS-PD import generation...",
			})
			this.startCompletionMonitoring()

			// Get drug name for logging
			const drugName = await this.getDrugName()
			this.reportProgress(`Drug: ${drugName}`)

			// Get submissions path
			const submissionsPath = this.getSubmissionsPath()
			if (!submissionsPath) {
				return {
					success: false,
					error: "No submissions folder set. Please set a submissions folder in the left pane.",
				}
			}

			// Get documents path
			const documentsPath = path.join(submissionsPath, "documents")
			this.reportProgress(`Scanning documents in: ${documentsPath}`)

			// Check if documents folder exists
			try {
				await fs.promises.access(documentsPath, fs.constants.F_OK)
			} catch {
				return {
					success: false,
					error: `Documents folder not found: ${documentsPath}`,
				}
			}

			// List all documents
			this.reportProgress("Listing all documents...")
			const documents = await this.listAllDocuments(documentsPath)

			if (documents.length === 0) {
				return {
					success: false,
					error: "No documents found in the documents folder.",
				}
			}

			this.reportProgress(`Found ${documents.length} document(s), analyzing with LLM...`)
			showSystemNotification({
				subtitle: "Section 2.3",
				message: `Analyzing ${documents.length} documents to find QOS-PD...`,
			})

			// Use LLM to identify QOS-PD document
			const qosPdDocument = await this.identifyQosPdDocument(documents)

			if (!qosPdDocument) {
				return {
					success: false,
					error: "Could not identify the Quality Overall Summary - Product Dossier (QOS-PD) document. Please ensure a QOS-PD document exists in the documents folder.",
				}
			}

			if (!qosPdDocument.pdfPath) {
				return {
					success: false,
					error: `Found QOS-PD folder "${qosPdDocument.folderName}" but no PDF file exists in it.`,
				}
			}

			this.reportProgress(`Identified QOS-PD: ${qosPdDocument.folderName}`)
			showSystemNotification({
				subtitle: "Section 2.3",
				message: `Found QOS-PD: ${qosPdDocument.folderName}`,
			})

			// Generate LaTeX content
			this.reportProgress("Generating LaTeX file...")
			const latexContent = this.generateLatexWithPdfImport(qosPdDocument.pdfPath)

			// Write output file
			this.reportProgress("Writing output file...")
			await this.writeOutputFile(latexContent)

			// Mark as completed
			this.isCompleted = true
			this.stopCompletionMonitoring()
			this.reportProgress("QOS-PD import file generated successfully")
			showSystemNotification({
				subtitle: "Section 2.3",
				message: "✓ QOS-PD import file generated successfully!",
			})

			return {
				success: true,
				qosPdPath: qosPdDocument.pdfPath,
			}
		} catch (error) {
			this.stopCompletionMonitoring()
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.reportProgress(`Error: ${errorMsg}`)
			return {
				success: false,
				error: errorMsg,
			}
		}
	}

	/**
	 * Override say to convert messages to progress updates
	 */
	override async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
	): Promise<number | undefined> {
		switch (type) {
			case "command":
				this.reportProgress("Executing command...")
				break
			case "tool":
				this.reportProgress("Using tool...")
				break
			case "error":
				this.reportProgress(`Error: ${text?.substring(0, 50) || "Unknown error"}`)
				break
			case "api_req_started":
				this.reportProgress("Making API request...")
				break
			case "completion_result":
				this.reportProgress("Task completing...")
				break
		}

		return super.say(type, text, images, files, partial)
	}

	/**
	 * Override abortTask to stop completion monitoring
	 */
	override async abortTask(): Promise<void> {
		this.stopCompletionMonitoring()

		if (!this.isCompleted) {
			this.reportProgress("Aborted")
		}

		await super.abortTask()
	}
}
