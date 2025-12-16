import { buildApiHandler } from "@core/api"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { McpHub } from "@services/mcp/McpHub"
import { ClineSay } from "@shared/ExtensionMessage"
import { ClineContent } from "@shared/messages/content"
import * as fs from "fs/promises"
import * as path from "path"
import { Controller } from "../controller"
import { StateManager } from "../storage/StateManager"
import { Task } from "./index"
import { ChecklistEntry, ChecklistService, ParsedChecklist } from "./services/ChecklistService"
import { ErrorHandlerService } from "./services/ErrorHandlerService"

/**
 * Parameters for creating an OutputChecklistUpdation instance
 */
export interface OutputChecklistUpdationParams {
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
	checklistPath: string
	onProgress?: (sectionId: string, status: string) => void
}

/**
 * Result of output checklist updation
 */
export interface OutputChecklistUpdationResult {
	success: boolean
	sectionId: string
	newlyCheckedCount: number
	error?: string
}

/**
 * OutputChecklistUpdation extends Task to provide specialized behavior for updating output checklist features.
 *
 * Key features:
 * - Loads checklist data from the bundled CTD_CHECKLISTS for a section
 * - Reads content.tex from the section folder
 * - Uses LLM to check if unchecked output features are covered in content.tex
 * - Updates checklist.md with newly checked output features
 */
export class OutputChecklistUpdation extends Task {
	// Section-specific properties
	private sectionId: string
	private sectionFolderPath: string
	private checklistPath: string
	private onProgress?: (sectionId: string, status: string) => void

	// Services
	private errorHandler: ErrorHandlerService

	// Processed data cache
	private checklistEntry: ChecklistEntry | null = null
	private parsedChecklist?: ParsedChecklist | null
	private contentTexContent: string | null = null

	constructor(params: OutputChecklistUpdationParams) {
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
		this.checklistPath = params.checklistPath
		this.onProgress = params.onProgress

		// Initialize services
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
		console.log(`[OutputChecklistUpdation ${this.sectionId}] ${status}`)
		if (this.onProgress) {
			try {
				this.onProgress(this.sectionId, status)
			} catch (error) {
				console.error(`[OutputChecklistUpdation] Error in progress callback:`, error)
			}
		}
	}

	/**
	 * Main entry point: Runs the complete output checklist updation flow
	 */
	public async runChecklistUpdation(): Promise<OutputChecklistUpdationResult> {
		try {
			this.reportProgress("Starting output checklist updation")

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

			if (!this.checklistEntry.output || this.checklistEntry.output.length === 0) {
				const errorMsg = `No output features found for section ${this.sectionId}`
				this.reportProgress(`Error: ${errorMsg}`)
				return {
					success: false,
					sectionId: this.sectionId,
					newlyCheckedCount: 0,
					error: errorMsg,
				}
			}

			// Report successful loading with details
			const loadedMessage = `Loaded checklist: ${this.checklistEntry.title} (${this.checklistEntry.output.length} output features)`
			this.reportProgress(loadedMessage)

			// Small delay to ensure notification is visible
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Step 2: Parse existing checklist.md (if exists)
			this.reportProgress("Parsing existing checklist...")
			this.parsedChecklist = await ChecklistService.parseChecklistMd(this.checklistPath)
			const existingCheckedOutputFeatures = ChecklistService.getCheckedOutputFeatures(this.parsedChecklist)
			const existingCheckedInputFeatures = ChecklistService.getCheckedFeatures(this.parsedChecklist)

			// Step 3: Read content.tex file
			this.reportProgress("Reading content.tex...")
			const contentTexPath = path.join(this.sectionFolderPath, "content.tex")
			try {
				this.contentTexContent = await fs.readFile(contentTexPath, "utf-8")
				if (!this.contentTexContent || this.contentTexContent.trim().length === 0) {
					const errorMsg = `content.tex is empty for section ${this.sectionId}`
					this.reportProgress(`Error: ${errorMsg}`)
					return {
						success: false,
						sectionId: this.sectionId,
						newlyCheckedCount: 0,
						error: errorMsg,
					}
				}
				this.reportProgress(`Read content.tex (${this.contentTexContent.length} characters)`)
			} catch (error) {
				const errorMsg = `Failed to read content.tex: ${error instanceof Error ? error.message : String(error)}`
				this.reportProgress(`Error: ${errorMsg}`)
				return {
					success: false,
					sectionId: this.sectionId,
					newlyCheckedCount: 0,
					error: errorMsg,
				}
			}

			// Step 4: Check unchecked output features against content.tex
			const uncheckedFeatures = this.checklistEntry.output.filter((feature) => !existingCheckedOutputFeatures.has(feature))
			this.reportProgress(`Checking ${uncheckedFeatures.length} unchecked output features...`)

			const newlyCheckedFeatures = new Set<string>()

			for (let i = 0; i < uncheckedFeatures.length; i++) {
				const feature = uncheckedFeatures[i]
				this.reportProgress(`Checking feature ${i + 1}/${uncheckedFeatures.length}...`)

				const isSatisfied = await this.checkFeatureSatisfied(feature, this.contentTexContent)
				if (isSatisfied) {
					newlyCheckedFeatures.add(feature)
					this.reportProgress(`✓ Feature satisfied: ${feature.substring(0, 60)}...`)
				}
			}

			// Step 5: Update checklist.md with both input and output features
			if (newlyCheckedFeatures.size > 0 || this.parsedChecklist) {
				this.reportProgress(`Updating checklist with ${newlyCheckedFeatures.size} newly checked output features...`)

				// Get input features from existing checklist or use empty array
				const inputFeatures = this.parsedChecklist?.features.map((f) => f.text) || this.checklistEntry.input || []

				await ChecklistService.updateChecklistMdWithOutput(
					this.checklistPath,
					this.sectionId,
					inputFeatures,
					this.checklistEntry.output,
					new Set<string>(), // No new input features to add
					newlyCheckedFeatures,
					existingCheckedInputFeatures,
					existingCheckedOutputFeatures,
				)
			} else {
				this.reportProgress("No new features to check")
			}

			this.reportProgress(`Completed successfully: ${newlyCheckedFeatures.size} output features checked`)

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
	 * Checks if an output feature is satisfied by the content.tex content
	 */
	private async checkFeatureSatisfied(feature: string, contentTex: string): Promise<boolean> {
		if (!contentTex || contentTex.trim().length === 0) {
			return false
		}

		// Truncate content if too long (to avoid token limits)
		const maxContentLength = 50000 // ~12k tokens
		const truncatedContent =
			contentTex.length > maxContentLength ? contentTex.substring(0, maxContentLength) + "..." : contentTex

		const prompt = `Does the following LaTeX content satisfy this output requirement: "${feature}"?

LaTeX content:
${truncatedContent}

Answer only "yes" or "no".`

		const result = await this.errorHandler.executeWithRetry(async () => {
			return this.callLLM(prompt)
		})

		if (!result.success || !result.result) {
			console.warn(`[OutputChecklistUpdation] Failed to check feature: ${result.error?.message}`)
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

		const systemPrompt = `You are a regulatory compliance checker. Your task is to determine if LaTeX content satisfies specific regulatory output requirements. Be precise and only answer "yes" or "no".`

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
	public async runAndWaitForCompletion(prompt: string): Promise<OutputChecklistUpdationResult> {
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

		contextParts.push(`<output_checklist_updation_context>`)
		contextParts.push(`Section ID: ${this.sectionId}`)
		contextParts.push(`Section Folder: ${this.sectionFolderPath}`)
		contextParts.push(`Checklist File: ${this.checklistPath}`)
		contextParts.push(`</output_checklist_updation_context>`)

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
	 * Gets the checklist entry
	 */
	public getChecklistEntry(): ChecklistEntry | null {
		return this.checklistEntry
	}
}
