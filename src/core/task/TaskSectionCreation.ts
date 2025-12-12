import { buildApiHandler } from "@core/api"
import type { ToolUse } from "@core/assistant-message"
import { resolveWorkspacePath } from "@core/workspace"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { showSystemNotification } from "@integrations/notifications"
import { McpHub } from "@services/mcp/McpHub"
import { ClineSay } from "@shared/ExtensionMessage"
import { ClineContent } from "@shared/messages/content"
import { getCwd } from "@utils/path"
import * as fs from "fs"
import * as path from "path"
import { ClineDefaultTool } from "@/shared/tools"
import { Controller } from "../controller"
import { StateManager } from "../storage/StateManager"
import { Task } from "./index"
import { DocumentChunk, DocumentContent, DocumentProcessingService, ParsedTagsFile } from "./services/DocumentProcessingService"
import { ErrorHandlerService } from "./services/ErrorHandlerService"
import { PharmaDataResult, PharmaDataService } from "./services/PharmaDataService"
import { RAGGuidelinesResult, RAGGuidelinesService } from "./services/RAGGuidelinesService"
import { AutoApprove } from "./tools/autoApprove"
import { WriteTexToolHandler } from "./tools/handlers/WriteTexToolHandler"
import { ToolExecutorCoordinator } from "./tools/ToolExecutorCoordinator"
import { ToolValidator } from "./tools/ToolValidator"
import type { TaskConfig } from "./tools/types/TaskConfig"

/**
 * Parameters for creating a TaskSectionCreation instance
 */
export interface TaskSectionCreationParams {
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
	sectionTitle: string
	sectionFolderPath: string
	expectedOutputFile: string
	tagsPath: string
	onProgress?: (sectionId: string, status: string) => void
}

/**
 * Result of task completion
 */
export interface TaskSectionCreationResult {
	success: boolean
	sectionId: string
	error?: string
}

/**
 * Partial draft from processing a document chunk
 */
interface PartialDraft {
	chunkIndex: number
	content: string
	documentCount: number
}

/**
 * TaskSectionCreation extends Task to provide specialized behavior for dossier section generation.
 *
 * Key features:
 * - Parses tags.md to get document list and drug name
 * - Processes documents in chunks to manage context
 * - Uses Function1-5 handlers for supplemental pharma data
 * - Integrates RAG for section writing guidelines
 * - Generates formal regulatory submission content in LaTeX format
 * - Handles errors (429, context window) gracefully
 */
export class TaskSectionCreation extends Task {
	// Section-specific properties
	private sectionId: string
	private sectionTitle: string
	private sectionFolderPath: string
	private expectedOutputFile: string
	private tagsPath: string
	private onProgress?: (sectionId: string, status: string) => void

	// Services
	private documentProcessor: DocumentProcessingService
	private pharmaDataService: PharmaDataService
	private ragService: RAGGuidelinesService
	private errorHandler: ErrorHandlerService

	// Completion monitoring
	private completionCheckInterval?: NodeJS.Timeout
	private isCompleted: boolean = false
	private completionResolve?: (result: TaskSectionCreationResult) => void

	// Processed data cache
	private parsedTags?: ParsedTagsFile
	private documentContents?: DocumentContent[]
	private pharmaData?: PharmaDataResult
	private ragGuidelines?: RAGGuidelinesResult

	constructor(params: TaskSectionCreationParams) {
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
		this.sectionTitle = params.sectionTitle
		this.sectionFolderPath = params.sectionFolderPath
		this.expectedOutputFile = params.expectedOutputFile
		this.tagsPath = params.tagsPath
		this.onProgress = params.onProgress

		// Initialize services
		this.documentProcessor = new DocumentProcessingService(params.cwd)
		this.pharmaDataService = new PharmaDataService()
		this.ragService = new RAGGuidelinesService()
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
		if (this.onProgress) {
			this.onProgress(this.sectionId, status)
		}
		console.log(`[TaskSectionCreation ${this.sectionId}] ${status}`)
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
				console.log(`[TaskSectionCreation ${this.sectionId}] Output file found, marking as complete`)
				this.isCompleted = true
				this.stopCompletionMonitoring()
				this.reportProgress("Completed")

				if (this.completionResolve) {
					this.completionResolve({
						success: true,
						sectionId: this.sectionId,
					})
				}
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

	// =========================================================================
	// CHUNKED PROCESSING FLOW
	// =========================================================================

	/**
	 * Main entry point: Runs the complete section generation flow
	 */
	public async runSectionGeneration(): Promise<TaskSectionCreationResult> {
		try {
			this.reportProgress("Starting section generation")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "Starting section generation...",
			})
			this.startCompletionMonitoring()

			// Step 1: Parse tags file
			this.reportProgress("Parsing tags.md...")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Parsing tags.md: ${this.tagsPath}`,
			})
			this.parsedTags = await this.parseTagsFile()

			if (!this.parsedTags.drugName) {
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: "ERROR: Could not determine drug name from tags.md",
				})
				return this.createErrorResult("Could not determine drug name from tags.md")
			}

			const docCount = this.parsedTags.placements.length + this.parsedTags.references.length
			this.reportProgress(`Drug: ${this.parsedTags.drugName}, Documents: ${docCount}`)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Found drug: ${this.parsedTags.drugName}, ${docCount} documents`,
			})

			// Step 2: Read all documents
			this.reportProgress("Reading document contents...")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Reading ${docCount} documents...`,
			})
			this.documentContents = await this.readAllDocuments()

			if (this.documentContents.length === 0) {
				this.reportProgress("Warning: No documents found, generating section with limited content")
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: "WARNING: No documents found!",
				})
			} else {
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: `Read ${this.documentContents.length} documents successfully`,
				})
			}

			// Step 3: Process documents in chunks
			this.reportProgress("Processing documents in chunks...")
			const partialDrafts = await this.processDocumentsInChunks()
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Processed ${partialDrafts.length} chunk(s)`,
			})

			// Step 4: Fetch supplemental pharma data
			this.reportProgress("Fetching pharmaceutical data...")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Fetching pharma data for ${this.parsedTags.drugName}...`,
			})
			this.pharmaData = await this.fetchSupplementalData()

			// Step 5: Get RAG guidelines
			this.reportProgress("Retrieving writing guidelines...")
			this.ragGuidelines = await this.getRAGGuidelines()

			// Step 6: Generate final section
			this.reportProgress("Generating final section content...")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "Generating final LaTeX content...",
			})
			const finalContent = await this.generateFinalSection(partialDrafts)

			// Step 7: Write output file
			this.reportProgress("Writing output file...")
			await this.writeOutputFile(finalContent)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Written to: ${this.expectedOutputFile}`,
			})

			this.isCompleted = true
			this.stopCompletionMonitoring()
			this.reportProgress("Completed successfully")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "✓ Section generation completed!",
			})

			return {
				success: true,
				sectionId: this.sectionId,
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.reportProgress(`Error: ${errorMsg}`)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `ERROR: ${errorMsg.substring(0, 100)}`,
			})
			this.isCompleted = true
			this.stopCompletionMonitoring()

			return {
				success: false,
				sectionId: this.sectionId,
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
	 * Note: Document paths in tags.md are relative to the workspace's documents folder
	 */
	private async readAllDocuments(): Promise<DocumentContent[]> {
		if (!this.parsedTags) {
			throw new Error("Tags file not parsed")
		}

		return this.documentProcessor.readAllDocuments(this.parsedTags)
	}

	/**
	 * Processes documents in chunks and generates partial drafts
	 */
	private async processDocumentsInChunks(): Promise<PartialDraft[]> {
		if (!this.documentContents || this.documentContents.length === 0) {
			return []
		}

		const chunks = this.documentProcessor.groupIntoChunks(this.documentContents)
		const partialDrafts: PartialDraft[] = []

		this.reportProgress(`Processing ${chunks.length} document chunk(s)...`)

		for (const chunk of chunks) {
			this.reportProgress(
				`Processing chunk ${chunk.chunkIndex + 1}/${chunks.length} (${chunk.documents.length} documents)...`,
			)

			const draft = await this.generatePartialDraft(chunk)
			partialDrafts.push(draft)
		}

		return partialDrafts
	}

	/**
	 * Generates a partial draft for a document chunk
	 */
	private async generatePartialDraft(chunk: DocumentChunk): Promise<PartialDraft> {
		const chunkContent = this.documentProcessor.formatChunkForLLM(chunk)

		const prompt = this.buildChunkAnalysisPrompt(chunkContent)

		// Use error handler with context reduction for potential context window issues
		const result = await this.errorHandler.executeWithContextReduction(async (reductionFactor) => {
			const adjustedContent = reductionFactor < 1 ? this.reduceChunkContent(chunkContent, reductionFactor) : chunkContent

			return this.callLLM(this.buildChunkAnalysisPrompt(adjustedContent))
		})

		if (!result.success || !result.result) {
			console.warn(`[TaskSectionCreation] Failed to process chunk ${chunk.chunkIndex}: ${result.error?.message}`)
			return {
				chunkIndex: chunk.chunkIndex,
				content: `[Error processing chunk ${chunk.chunkIndex}: ${result.error?.message}]`,
				documentCount: chunk.documents.length,
			}
		}

		return {
			chunkIndex: chunk.chunkIndex,
			content: result.result,
			documentCount: chunk.documents.length,
		}
	}

	/**
	 * Reduces chunk content by the given factor
	 */
	private reduceChunkContent(content: string, factor: number): string {
		const targetLength = Math.floor(content.length * factor)
		if (content.length <= targetLength) return content

		// Truncate while trying to preserve structure
		const truncated = content.substring(0, targetLength)
		const lastClosingTag = truncated.lastIndexOf("</")
		if (lastClosingTag > targetLength * 0.8) {
			return truncated.substring(0, lastClosingTag) + "\n... [content reduced due to context limits]"
		}
		return truncated + "\n... [content reduced due to context limits]"
	}

	/**
	 * Fetches supplemental pharmaceutical data
	 */
	private async fetchSupplementalData(): Promise<PharmaDataResult> {
		if (!this.parsedTags?.drugName) {
			return { errors: ["No drug name available"] }
		}

		try {
			return await this.pharmaDataService.fetchAllData(this.parsedTags.drugName)
		} catch (error) {
			console.warn(`[TaskSectionCreation] Failed to fetch pharma data: ${error}`)
			return { errors: [String(error)] }
		}
	}

	/**
	 * Gets RAG guidelines for section writing
	 */
	private async getRAGGuidelines(): Promise<RAGGuidelinesResult> {
		try {
			return await this.ragService.getWritingGuidelines({
				sectionId: this.sectionId,
				sectionTitle: this.sectionTitle,
				drugName: this.parsedTags?.drugName || "Unknown",
				apiName: this.parsedTags?.apiName,
			})
		} catch (error) {
			console.warn(`[TaskSectionCreation] Failed to get RAG guidelines: ${error}`)
			return { guidelines: [], ichReferences: [] }
		}
	}

	/**
	 * Generates the final section content
	 */
	private async generateFinalSection(partialDrafts: PartialDraft[]): Promise<string> {
		// Merge partial drafts
		const mergedDrafts = this.mergePartialDrafts(partialDrafts)

		// Build final generation prompt
		const prompt = this.buildFinalGenerationPrompt(mergedDrafts)

		// Generate with error handling
		const result = await this.errorHandler.executeWithContextReduction(async (reductionFactor) => {
			const adjustedPrompt = reductionFactor < 1 ? this.reducePromptContent(prompt, reductionFactor) : prompt

			return this.callLLM(adjustedPrompt)
		})

		if (!result.success || !result.result) {
			throw new Error(`Failed to generate final section: ${result.error?.message}`)
		}

		return result.result
	}

	/**
	 * Merges partial drafts into a combined summary
	 */
	private mergePartialDrafts(drafts: PartialDraft[]): string {
		if (drafts.length === 0) {
			return "<no_document_analysis>No documents were analyzed.</no_document_analysis>"
		}

		const parts: string[] = []
		parts.push(`<document_analysis total_chunks="${drafts.length}">`)

		for (const draft of drafts) {
			parts.push(`<chunk_${draft.chunkIndex + 1} documents="${draft.documentCount}">`)
			parts.push(draft.content)
			parts.push(`</chunk_${draft.chunkIndex + 1}>`)
		}

		parts.push(`</document_analysis>`)
		return parts.join("\n")
	}

	/**
	 * Reduces prompt content for context window management
	 */
	private reducePromptContent(prompt: string, factor: number): string {
		// Similar to reduceChunkContent but for the full prompt
		const targetLength = Math.floor(prompt.length * factor)
		if (prompt.length <= targetLength) return prompt

		return prompt.substring(0, targetLength) + "\n... [prompt reduced due to context limits]"
	}

	/**
	 * Strips markdown code block markers from content
	 * Removes ```latex or ``` at the beginning and ``` at the end
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
	 * Writes the final content to the output file using write_tex tool
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
			const pathResult = resolveWorkspacePath(cwd, this.expectedOutputFile, "TaskSectionCreation.writeOutputFile")
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
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to write output file using write_tex: ${errorMessage}`)
		}
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
				ask: async (type, text, partial) => {
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
				shouldAutoApproveToolWithPath: async (toolName, path) => {
					const autoApprover = new AutoApprove(this.stateManager)
					return await autoApprover.shouldAutoApproveToolWithPath(toolName, path)
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
			coordinator: coordinator,
		}

		return config
	}

	// =========================================================================
	// LLM INTERACTION
	// =========================================================================

	/**
	 * Calls the LLM with the given prompt
	 */
	private async callLLM(prompt: string): Promise<string> {
		const stateManager = StateManager.get()
		const apiConfiguration = stateManager.getApiConfiguration()
		const currentMode = "act"
		const apiHandler = buildApiHandler(apiConfiguration, currentMode)

		const systemPrompt = this.buildSystemPrompt()
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

	/**
	 * Builds the system prompt for LLM
	 */
	private buildSystemPrompt(): string {
		return `You are a Regulatory Affairs professional preparing a Common Technical Document (CTD) submission.

Your task is to write regulatory content for CTD Section ${this.sectionId}: ${this.sectionTitle}.

## Key Principles:
1. **Accuracy**: Only include information from provided source documents
2. **Completeness**: Include all relevant information from the documents
3. **Regulatory Tone**: Use formal, professional regulatory language
4. **Structure**: Follow ICH M4 CTD guidelines
5. **LaTeX Format**: Output must be valid LaTeX that compiles independently

## Writing Style:
- Use third person or passive voice
- Be precise and factual
- Include specific data values, specifications, and results
- Reference source documents appropriately
- Maintain consistency in terminology`
	}

	/**
	 * Builds the prompt for analyzing a document chunk
	 */
	private buildChunkAnalysisPrompt(chunkContent: string): string {
		return `Analyze the following documents and extract key regulatory information relevant to CTD Section ${this.sectionId}: ${this.sectionTitle}.

For each document, identify:
1. Key data points, specifications, and test results
2. Critical quality attributes and acceptance criteria
3. Process parameters and controls
4. Conclusions and significant findings

${chunkContent}

Provide a structured analysis that preserves all important details. Do NOT summarize at a high level - include specific values, numbers, and technical details.`
	}

	/**
	 * Builds the final generation prompt
	 */
	private buildFinalGenerationPrompt(mergedDrafts: string): string {
		const parts: string[] = []

		parts.push(`Generate a complete, standalone LaTeX document for CTD Section ${this.sectionId}: ${this.sectionTitle}.`)
		parts.push("")

		// Add drug information
		if (this.parsedTags) {
			parts.push(`<drug_information>`)
			parts.push(`Drug Name: ${this.parsedTags.drugName}`)
			if (this.parsedTags.apiName) {
				parts.push(`API Name: ${this.parsedTags.apiName}`)
			}
			parts.push(`</drug_information>`)
			parts.push("")
		}

		// Add document analysis
		parts.push(mergedDrafts)
		parts.push("")

		// Add pharma data if available
		if (this.pharmaData) {
			parts.push(this.pharmaDataService.formatAsContext(this.pharmaData))
			parts.push("")
		}

		// Add RAG guidelines if available
		if (this.ragGuidelines) {
			parts.push(this.ragService.formatAsContext(this.ragGuidelines))
			parts.push("")
		}

		// Add output requirements
		parts.push(`<output_requirements>
1. Generate a COMPLETE LaTeX document starting with \\documentclass
2. Include all required packages (booktabs, longtable, hyperref, etc.)
3. Include \\begin{document} and \\end{document}
4. Use proper LaTeX sectioning (\\section, \\subsection, etc.)
5. Include tables for data presentation using booktabs
6. The document must compile independently
7. Include a Document References section at the end
</output_requirements>`)

		return parts.join("\n")
	}

	// =========================================================================
	// LEGACY COMPATIBILITY METHODS
	// =========================================================================

	/**
	 * Override startTask for legacy compatibility
	 */
	public override async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
		this.reportProgress("Starting")
		this.startCompletionMonitoring()

		try {
			await super.startTask(task, images, files)
		} catch (error) {
			if (!this.isCompleted) {
				this.reportProgress("Error occurred")
				throw error
			}
		}
	}

	/**
	 * Runs the task using the new chunked processing flow
	 */
	public async runAndWaitForCompletion(prompt: string): Promise<TaskSectionCreationResult> {
		// Use the new section generation flow instead of legacy task execution
		return this.runSectionGeneration()
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
	 * Override abortTask to stop completion monitoring
	 */
	override async abortTask(): Promise<void> {
		this.stopCompletionMonitoring()

		if (!this.isCompleted) {
			this.reportProgress("Aborted")
		}

		await super.abortTask()
	}

	/**
	 * Override loadContext to add dossier-specific context
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

		const dossierContext = this.buildDossierContext()
		if (dossierContext) {
			processedUserContent.push({
				type: "text",
				text: dossierContext,
			})
		}

		return [processedUserContent, environmentDetails, clinerulesError]
	}

	/**
	 * Builds dossier-specific context
	 */
	private buildDossierContext(): string {
		const contextParts: string[] = []

		contextParts.push(`<dossier_section_context>`)
		contextParts.push(`Section ID: ${this.sectionId}`)
		contextParts.push(`Section Title: ${this.sectionTitle}`)
		contextParts.push(`Section Folder: ${this.sectionFolderPath}`)
		contextParts.push(`Expected Output: ${this.expectedOutputFile}`)
		contextParts.push(`Tags File: ${this.tagsPath}`)
		contextParts.push(`</dossier_section_context>`)

		return contextParts.join("\n")
	}

	// =========================================================================
	// UTILITY METHODS
	// =========================================================================

	/**
	 * Creates an error result
	 */
	private createErrorResult(message: string): TaskSectionCreationResult {
		this.isCompleted = true
		this.stopCompletionMonitoring()
		return {
			success: false,
			sectionId: this.sectionId,
			error: message,
		}
	}

	/**
	 * Gets the section ID
	 */
	public getSectionId(): string {
		return this.sectionId
	}

	/**
	 * Gets the expected output file path
	 */
	public getExpectedOutputFile(): string {
		return this.expectedOutputFile
	}

	/**
	 * Checks if the task has completed
	 */
	public hasCompleted(): boolean {
		return this.isCompleted
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
}
