import { buildApiHandler } from "@core/api"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { McpHub } from "@services/mcp/McpHub"
import { ClineSay } from "@shared/ExtensionMessage"
import { ClineContent } from "@shared/messages/content"
import { Controller } from "../controller"
import { StateManager } from "../storage/StateManager"
import { Task } from "./index"
import { ChecklistEntry, ChecklistService, ParsedChecklist } from "./services/ChecklistService"
import { DocumentContent, DocumentProcessingService, ParsedTagsFile } from "./services/DocumentProcessingService"
import { ErrorHandlerService } from "./services/ErrorHandlerService"

/**
 * Parameters for creating an InputChecklistUpdation instance
 */
export interface InputChecklistUpdationParams {
	// Base Task params
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
	sectionId: string
	sectionFolderPath: string
	tagsPath: string
	checklistPath: string
	onProgress?: (sectionId: string, status: string) => void
}

/**
 * Result of checklist updation
 */
export interface InputChecklistUpdationResult {
	success: boolean
	sectionId: string
	newlyCheckedCount: number
	error?: string
}

/**
 * InputChecklistUpdation extends Task to provide specialized behavior for updating input checklist features.
 *
 * Key features:
 * - Loads checklist data from the bundled CTD_CHECKLISTS for a section
 * - Reads tags.md to get document list
 * - For each document, reads info.json and uses LLM to check if unchecked input features are satisfied
 * - Updates checklist.md with newly checked features
 */
export class InputChecklistUpdation extends Task {
	// Section-specific properties
	private sectionId: string
	private sectionFolderPath: string
	private tagsPath: string
	private checklistPath: string
	private onProgress?: (sectionId: string, status: string) => void

	// Services
	private documentProcessor: DocumentProcessingService
	private errorHandler: ErrorHandlerService

	// Processed data cache
	private parsedTags?: ParsedTagsFile
	private checklistEntry: ChecklistEntry | null = null
	private parsedChecklist?: ParsedChecklist | null

	constructor(params: InputChecklistUpdationParams) {
		// Build base TaskParams
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

		// Store section-specific properties
		this.sectionId = params.sectionId
		this.sectionFolderPath = params.sectionFolderPath
		this.tagsPath = params.tagsPath
		this.checklistPath = params.checklistPath
		this.onProgress = params.onProgress

		// Initialize services
		this.documentProcessor = new DocumentProcessingService(params.cwd)
		this.errorHandler = new ErrorHandlerService({
			maxRetries: 5,
			baseDelay: 2000,
			maxDelay: 60000,
		})
	}

	/**
	 * Reports progress via the callback if provided
	 */
	private reportProgress(status: string): void {
		console.log(`[InputChecklistUpdation ${this.sectionId}] ${status}`)
		if (this.onProgress) {
			try {
				this.onProgress(this.sectionId, status)
			} catch (error) {
				console.error(`[InputChecklistUpdation] Error in progress callback:`, error)
			}
		}
	}

	/**
	 * Main entry point: Runs the complete checklist updation flow
	 */
	public async runChecklistUpdation(): Promise<InputChecklistUpdationResult> {
		try {
			this.reportProgress("Starting checklist updation")

			// Step 1: Load checklist data for section
			this.reportProgress("Loading checklist data...")
			this.checklistEntry = await ChecklistService.loadChecklistForSection(this.sectionId)

			if (!this.checklistEntry) {
				const errorMsg = `No checklist found for section ${this.sectionId}`
				this.reportProgress(`Error: ${errorMsg}`)
				return {
					success: false,
					sectionId: this.sectionId,
					newlyCheckedCount: 0,
					error: errorMsg,
				}
			}

			// Report successful loading with details
			const loadedMessage = `Loaded checklist: ${this.checklistEntry.title} (${this.checklistEntry.input.length} input features)`
			this.reportProgress(loadedMessage)

			// Small delay to ensure notification is visible
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Step 2: Parse existing checklist.md (if exists)
			this.reportProgress("Parsing existing checklist...")
			this.parsedChecklist = await ChecklistService.parseChecklistMd(this.checklistPath)
			const existingCheckedFeatures = ChecklistService.getCheckedFeatures(this.parsedChecklist)

			// Step 3: Parse tags.md to get document list
			this.reportProgress("Parsing tags.md...")
			this.parsedTags = await this.parseTagsFile()

			const docCount = this.parsedTags.placements.length + this.parsedTags.references.length
			this.reportProgress(`Found ${docCount} documents to check`)

			// Step 4: Read all documents and check features
			this.reportProgress("Reading documents and checking features...")
			const documentContents = await this.readAllDocuments()

			if (documentContents.length === 0) {
				this.reportProgress("Warning: No documents found")
			}

			// Step 5: Check unchecked features against documents
			const uncheckedFeatures = this.checklistEntry.input.filter((feature) => !existingCheckedFeatures.has(feature))
			this.reportProgress(`Checking ${uncheckedFeatures.length} unchecked features...`)

			const newlyCheckedFeatures = new Set<string>()

			for (let i = 0; i < documentContents.length; i++) {
				const doc = documentContents[i]
				this.reportProgress(`Processing document ${i + 1}/${documentContents.length}: ${doc.entry.pdfName}`)

				// Read info.json
				const infoJson = doc.infoJson
				if (!infoJson || (!infoJson.source_of_file && !infoJson.dossier_summary)) {
					this.reportProgress(`Skipping ${doc.entry.pdfName}: missing info.json data`)
					continue
				}

				// Check each unchecked feature
				for (const feature of uncheckedFeatures) {
					if (newlyCheckedFeatures.has(feature)) {
						continue // Already checked
					}

					const isSatisfied = await this.checkFeatureSatisfied(feature, infoJson)
					if (isSatisfied) {
						newlyCheckedFeatures.add(feature)
						this.reportProgress(`✓ Feature satisfied: ${feature.substring(0, 60)}...`)
					}
				}
			}

			// Step 6: Update checklist.md
			if (newlyCheckedFeatures.size > 0) {
				this.reportProgress(`Updating checklist with ${newlyCheckedFeatures.size} newly checked features...`)

				await ChecklistService.updateChecklistMd(
					this.checklistPath,
					this.sectionId,
					this.checklistEntry.input,
					newlyCheckedFeatures,
					existingCheckedFeatures,
				)
			} else {
				this.reportProgress("No new features to check")
			}

			this.reportProgress(`Completed successfully: ${newlyCheckedFeatures.size} features checked`)

			return {
				success: true,
				sectionId: this.sectionId,
				newlyCheckedCount: newlyCheckedFeatures.size,
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.reportProgress(`Error: ${errorMsg}`)

			return {
				success: false,
				sectionId: this.sectionId,
				newlyCheckedCount: 0,
				error: errorMsg,
			}
		}
	}

	/**
	 * Parses the tags.md file
	 */
	private async parseTagsFile(): Promise<ParsedTagsFile> {
		const result = await this.errorHandler.executeWithRetry(() => this.documentProcessor.parseTagsFile(this.tagsPath))

		if (!result.success || !result.result) {
			throw new Error(`Failed to parse tags file: ${result.error?.message}`)
		}

		return result.result
	}

	/**
	 * Reads all documents from the tags file
	 */
	private async readAllDocuments(): Promise<DocumentContent[]> {
		if (!this.parsedTags) {
			throw new Error("Tags file not parsed")
		}

		return this.documentProcessor.readAllDocuments(this.parsedTags)
	}

	/**
	 * Checks if a feature is satisfied by the document info.json content
	 */
	private async checkFeatureSatisfied(
		feature: string,
		infoJson: { source_of_file?: string; dossier_summary?: string },
	): Promise<boolean> {
		const sourceOfFile = infoJson.source_of_file || ""
		const dossierSummary = infoJson.dossier_summary || ""

		if (!sourceOfFile && !dossierSummary) {
			return false
		}

		const documentInfo = `${sourceOfFile} ${dossierSummary}`.trim()

		const prompt = `Does the following document information satisfy this requirement: "${feature}"?

Document information:
${documentInfo}

Answer only "yes" or "no".`

		const result = await this.errorHandler.executeWithRetry(async () => {
			return this.callLLM(prompt)
		})

		if (!result.success || !result.result) {
			console.warn(`[InputChecklistUpdation] Failed to check feature: ${result.error?.message}`)
			return false
		}

		const response = result.result.trim().toLowerCase()
		return response.startsWith("yes")
	}

	/**
	 * Calls the LLM with the given prompt
	 */
	private async callLLM(prompt: string): Promise<string> {
		const stateManager = StateManager.get()
		const apiConfiguration = stateManager.getApiConfiguration()
		const currentMode = "act"
		const apiHandler = buildApiHandler(apiConfiguration, currentMode)

		const systemPrompt = `You are a regulatory compliance checker. Your task is to determine if document information satisfies specific regulatory requirements. Be precise and only answer "yes" or "no".`

		const messages = [{ role: "user" as const, content: prompt }]

		const stream = apiHandler.createMessage(systemPrompt, messages)

		let response = ""
		for await (const chunk of stream) {
			if (chunk.type === "text") {
				response += chunk.text
			}
		}

		return response
	}

	// =========================================================================
	// LEGACY COMPATIBILITY METHODS
	// =========================================================================

	/**
	 * Override startTask for legacy compatibility
	 */
	public override async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
		this.reportProgress("Starting")
		try {
			await super.startTask(task, images, files)
		} catch (error) {
			this.reportProgress("Error occurred")
			throw error
		}
	}

	/**
	 * Runs the task using the checklist updation flow
	 */
	public async runAndWaitForCompletion(prompt: string): Promise<InputChecklistUpdationResult> {
		return this.runChecklistUpdation()
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
	 * Override postStateToWebview as no-op for subagents
	 */
	protected async postStateToWebviewOverride(): Promise<void> {
		// No-op for subagents
	}

	/**
	 * Override abortTask
	 */
	override async abortTask(): Promise<void> {
		this.reportProgress("Aborted")
		await super.abortTask()
	}

	/**
	 * Override loadContext to add checklist-specific context
	 */
	override async loadContext(
		userContent: ClineContent[],
		includeFileDetails: boolean = false,
		useCompactPrompt = false,
	): Promise<[ClineContent[], string, boolean]> {
		const [processedUserContent, environmentDetails, clinerulesError] = await super.loadContext(
			userContent,
			includeFileDetails,
			useCompactPrompt,
		)

		const checklistContext = this.buildChecklistContext()
		if (checklistContext) {
			processedUserContent.push({
				type: "text",
				text: checklistContext,
			})
		}

		return [processedUserContent, environmentDetails, clinerulesError]
	}

	/**
	 * Builds checklist-specific context
	 */
	private buildChecklistContext(): string {
		const contextParts: string[] = []

		contextParts.push(`<checklist_updation_context>`)
		contextParts.push(`Section ID: ${this.sectionId}`)
		contextParts.push(`Section Folder: ${this.sectionFolderPath}`)
		contextParts.push(`Tags File: ${this.tagsPath}`)
		contextParts.push(`Checklist File: ${this.checklistPath}`)
		contextParts.push(`</checklist_updation_context>`)

		return contextParts.join("\n")
	}

	// =========================================================================
	// UTILITY METHODS
	// =========================================================================

	/**
	 * Gets the section ID
	 */
	public getSectionId(): string {
		return this.sectionId
	}

	/**
	 * Gets the checklist path
	 */
	public getChecklistPath(): string {
		return this.checklistPath
	}

	/**
	 * Gets the tags path
	 */
	public getTagsPath(): string {
		return this.tagsPath
	}

	/**
	 * Gets the parsed tags data
	 */
	public getParsedTags(): ParsedTagsFile | undefined {
		return this.parsedTags
	}

	/**
	 * Gets the checklist entry
	 */
	public getChecklistEntry(): ChecklistEntry | null {
		return this.checklistEntry
	}
}
