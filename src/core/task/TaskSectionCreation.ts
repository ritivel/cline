import { buildApiHandler } from "@core/api"
import type { ToolUse } from "@core/assistant-message"
import { resolveWorkspacePath } from "@core/workspace"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { showSystemNotification } from "@integrations/notifications"
import { McpHub } from "@services/mcp/McpHub"
import { ClineSay } from "@shared/ExtensionMessage"
import { ClineContent } from "@shared/messages/content"
import { fileExistsAtPath } from "@utils/fs"
import { getCwd } from "@utils/path"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { ClineDefaultTool } from "@/shared/tools"
import { Controller } from "../controller"
import { EAC_NMRA_TEMPLATE } from "../ctd/templates/eac-nmra/definition"
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
	moduleNum?: number
	isTableOfContents?: boolean
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
 * Represents study metadata extracted from PDF/mmd for section 5.2 table
 */
interface Section52StudyInfo {
	serialNo: number
	studyOfDesign: string
	referenceDetails: string
	pdfName: string
	sectionId: string
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
	private moduleNum?: number
	private isTableOfContents: boolean
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
		this.moduleNum = params.moduleNum
		this.isTableOfContents = params.isTableOfContents ?? false
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

			// Check if this is a Table of Contents section - handle it specially
			if (this.isTableOfContents && this.moduleNum) {
				this.reportProgress("Generating Table of Contents...")
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: "Generating Table of Contents table...",
				})
				const tocContent = this.generateTOCTable()
				await this.writeOutputFile(tocContent)
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: `Written to: ${this.expectedOutputFile}`,
				})
				this.isCompleted = true
				this.stopCompletionMonitoring()
				this.reportProgress("Completed successfully")
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: "✓ Table of Contents generated!",
				})
				return {
					success: true,
					sectionId: this.sectionId,
				}
			}

			// Check if this is section 5.2 - special aggregation of 5.3 subsection placements
			if (this.sectionId === "5.2") {
				return await this.runSection52Generation()
			}

			// Check if this is a Module 5 section - handle it specially
			if (this.moduleNum === 5) {
				return await this.runModule5Generation()
			}

			// Check if this is a Module 3 section - handle it specially (similar to Module 5)
			if (this.moduleNum === 3) {
				return await this.runModule3Generation()
			}

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

			// Step 6.5: Attach the placement PDFs to the section as images
			this.reportProgress("Attaching placement PDFs to section as images...")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "Attaching placement PDFs to section as images...",
			})
			const contentWithPdfs = await this.attachPlacementPdfsAsImages(finalContent)

			// Step 6.6: Correct and improve LaTeX code
			this.reportProgress("Correcting LaTeX code...")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "Improving LaTeX code quality...",
			})
			const correctedContent = await this.correctLatexCode(contentWithPdfs)

			// Step 7: Write output file
			this.reportProgress("Writing output file...")
			await this.writeOutputFile(correctedContent)
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
	 * Special generation flow for Module 5 sections.
	 * Only reads tags file and attaches placements if present, otherwise writes "Not Applicable".
	 */
	private async runModule5Generation(): Promise<TaskSectionCreationResult> {
		try {
			this.reportProgress("Starting Module 5 special generation")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "Running Module 5 generation flow...",
			})
			this.startCompletionMonitoring()

			// Step 1: Parse tags file
			this.reportProgress("Parsing tags.md...")
			this.parsedTags = await this.parseTagsFile()

			let content: string
			if (this.parsedTags.placements && this.parsedTags.placements.length > 0) {
				this.reportProgress(`Found ${this.parsedTags.placements.length} placements, attaching...`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: `Found ${this.parsedTags.placements.length} placements, attaching...`,
				})

				// Create a basic LaTeX shell
				const shellContent = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\begin{document}
\\section*{${this.sectionId}. ${this.sectionTitle}}
\\end{document}`

				content = await this.attachPlacementPdfsAsImages(shellContent)
			} else {
				this.reportProgress("No placements found, writing 'Not Applicable'")
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: "No placements found, writing 'Not Applicable'",
				})
				content = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\begin{document}
\\section*{${this.sectionId}. ${this.sectionTitle}}
Not Applicable
\\end{document}`
			}

			// Step 7: Write output file
			this.reportProgress("Writing output file...")
			await this.writeOutputFile(content)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Written to: ${this.expectedOutputFile}`,
			})

			this.isCompleted = true
			this.stopCompletionMonitoring()
			this.reportProgress("Completed successfully")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "✓ Module 5 generation completed!",
			})

			return {
				success: true,
				sectionId: this.sectionId,
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.reportProgress(`Error in Module 5 flow: ${errorMsg}`)
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
	 * Special generation flow for Module 3 sections.
	 * Only reads tags file and attaches placements if present, otherwise writes "Not Applicable".
	 * Similar to Module 5 handling.
	 */
	private async runModule3Generation(): Promise<TaskSectionCreationResult> {
		try {
			this.reportProgress("Starting Module 3 special generation")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "Running Module 3 generation flow...",
			})
			this.startCompletionMonitoring()

			// Step 1: Parse tags file
			this.reportProgress("Parsing tags.md...")
			this.parsedTags = await this.parseTagsFile()

			let content: string
			if (this.parsedTags.placements && this.parsedTags.placements.length > 0) {
				this.reportProgress(`Found ${this.parsedTags.placements.length} placements, attaching...`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: `Found ${this.parsedTags.placements.length} placements, attaching...`,
				})

				// Create a basic LaTeX shell
				const shellContent = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\begin{document}
\\section*{${this.sectionId}. ${this.sectionTitle}}
\\end{document}`

				content = await this.attachPlacementPdfsAsImages(shellContent)
			} else {
				this.reportProgress("No placements found, writing 'Not Applicable'")
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: "No placements found, writing 'Not Applicable'",
				})
				content = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\begin{document}
\\section*{${this.sectionId}. ${this.sectionTitle}}
Not Applicable
\\end{document}`
			}

			// Write output file
			this.reportProgress("Writing output file...")
			await this.writeOutputFile(content)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Written to: ${this.expectedOutputFile}`,
			})

			this.isCompleted = true
			this.stopCompletionMonitoring()
			this.reportProgress("Completed successfully")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "✓ Module 3 generation completed!",
			})

			return {
				success: true,
				sectionId: this.sectionId,
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.reportProgress(`Error in Module 3 flow: ${errorMsg}`)
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
	 * Special generation flow for section 5.2 (Tabular Listing of All Clinical Studies).
	 * Aggregates placements from all 5.3 subsections and generates a summary table.
	 */
	private async runSection52Generation(): Promise<TaskSectionCreationResult> {
		try {
			this.reportProgress("Starting Section 5.2 special generation")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "Aggregating clinical studies from 5.3 subsections...",
			})
			this.startCompletionMonitoring()

			// Step 1: Collect all subsection IDs under 5.3
			const subsectionIds = this.collectSection53Subsections()
			this.reportProgress(`Found ${subsectionIds.length} subsections under 5.3`)

			// Step 2: Aggregate all placements from 5.3 subsections
			const allPlacements = await this.collectPlacementsFromSubsections(subsectionIds)
			this.reportProgress(`Found ${allPlacements.length} total placements`)

			let content: string
			if (allPlacements.length > 0) {
				// Step 3: Extract study metadata from each placement
				const studyInfos = await this.extractStudyMetadataFromPlacements(allPlacements)
				this.reportProgress(`Extracted metadata for ${studyInfos.length} studies`)

				// Step 4: Generate LaTeX table
				content = this.generateSection52Table(studyInfos)
			} else {
				this.reportProgress("No placements found in 5.3 subsections")
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: "No clinical studies found, writing 'Not Applicable'",
				})
				content = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\begin{document}
\\section*{${this.sectionId}. ${this.sectionTitle}}
Not Applicable
\\end{document}`
			}

			// Step 5: Write output file
			this.reportProgress("Writing output file...")
			await this.writeOutputFile(content)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Written to: ${this.expectedOutputFile}`,
			})

			this.isCompleted = true
			this.stopCompletionMonitoring()
			this.reportProgress("Completed successfully")
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: "✓ Section 5.2 generation completed!",
			})

			return {
				success: true,
				sectionId: this.sectionId,
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.reportProgress(`Error in Section 5.2 flow: ${errorMsg}`)
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
	 * Collects all subsection IDs under section 5.3 recursively
	 */
	private collectSection53Subsections(): string[] {
		const module5 = EAC_NMRA_TEMPLATE.modules.find((m) => m.moduleNumber === 5)
		if (!module5) {
			return []
		}

		const subsectionIds: string[] = []
		const collectChildren = (sectionId: string) => {
			const section = module5.sections[sectionId]
			if (!section) return

			// Add this section if it starts with 5.3 (but not 5.3 itself, we want children)
			if (sectionId.startsWith("5.3.")) {
				subsectionIds.push(sectionId)
			}

			// Recursively collect children
			if (section.children) {
				for (const childId of section.children) {
					collectChildren(childId)
				}
			}
		}

		// Start from 5.3
		const section53 = module5.sections["5.3"]
		if (section53?.children) {
			for (const childId of section53.children) {
				collectChildren(childId)
			}
		}

		return subsectionIds
	}

	/**
	 * Collects placements from tags.md files of all specified subsections
	 */
	private async collectPlacementsFromSubsections(
		subsectionIds: string[],
	): Promise<Array<{ placement: { pdfName: string; relativePath: string }; sectionId: string }>> {
		const allPlacements: Array<{ placement: { pdfName: string; relativePath: string }; sectionId: string }> = []

		// Get base path for sections (derive from current section's folder path)
		// sectionFolderPath is like: /path/to/dossier/module-5/section-5.2
		// We need to go up to /path/to/dossier/module-5/ and then into section-5.3.x folders
		const module5BasePath = path.dirname(this.sectionFolderPath)

		for (const sectionId of subsectionIds) {
			try {
				// Build path to this subsection's tags.md
				// Section IDs like "5.3.1.2" -> folder path "section-5.3/section-5.3.1/section-5.3.1.2"
				const sectionParts = sectionId.split(".")
				let sectionPath = module5BasePath
				let currentPrefix = sectionParts[0]
				for (let i = 1; i < sectionParts.length; i++) {
					currentPrefix = `${currentPrefix}.${sectionParts[i]}`
					sectionPath = path.join(sectionPath, `section-${currentPrefix}`)
				}
				const tagsPath = path.join(sectionPath, "tags.md")

				// Check if tags.md exists
				if (!(await fileExistsAtPath(tagsPath))) {
					console.log(`[TaskSectionCreation 5.2] No tags.md found for section ${sectionId} at ${tagsPath}`)
					continue
				}

				// Parse tags file
				const parsedTags = await this.documentProcessor.parseTagsFile(tagsPath)
				if (parsedTags.placements && parsedTags.placements.length > 0) {
					for (const placement of parsedTags.placements) {
						allPlacements.push({ placement, sectionId })
					}
					this.reportProgress(`Found ${parsedTags.placements.length} placements in section ${sectionId}`)
				}
			} catch (error) {
				console.warn(`[TaskSectionCreation 5.2] Error reading tags for section ${sectionId}: ${error}`)
				// Continue with next section
			}
		}

		return allPlacements
	}

	/**
	 * Extracts study metadata from placements by reading .mmd files and calling LLM
	 */
	private async extractStudyMetadataFromPlacements(
		placements: Array<{ placement: { pdfName: string; relativePath: string }; sectionId: string }>,
	): Promise<Array<{ serialNo: number; studyOfDesign: string; referenceDetails: string; pdfName: string; sectionId: string }>> {
		const studyInfos: Array<{
			serialNo: number
			studyOfDesign: string
			referenceDetails: string
			pdfName: string
			sectionId: string
		}> = []

		// Get base path for documents
		const submissionsPath = this.getSubmissionsPath()
		const workspaceRoot = this.cwd
		const basePath = submissionsPath || path.join(workspaceRoot, "documents")

		let serialNo = 1
		for (const { placement, sectionId } of placements) {
			try {
				this.reportProgress(`Processing placement ${serialNo}/${placements.length}: ${placement.pdfName}`)

				// Find the .mmd file (sibling to PDF with same basename)
				const folderPath = path.join(basePath, placement.relativePath)
				let mmdPath: string | null = null
				let pdfBasename: string | null = null

				// Find PDF and derive mmd path
				const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
				for (const entry of entries) {
					if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
						pdfBasename = entry.name.replace(/\.pdf$/i, "")
						mmdPath = path.join(folderPath, `${pdfBasename}.mmd`)
						break
					}
				}

				if (!mmdPath || !pdfBasename) {
					console.warn(`[TaskSectionCreation 5.2] No PDF found in ${folderPath}`)
					studyInfos.push({
						serialNo: serialNo++,
						studyOfDesign: "Unable to extract - PDF not found",
						referenceDetails: "N/A",
						pdfName: placement.pdfName,
						sectionId,
					})
					continue
				}

				// Check if .mmd exists
				if (!(await fileExistsAtPath(mmdPath))) {
					console.warn(`[TaskSectionCreation 5.2] No .mmd file found at ${mmdPath}`)
					studyInfos.push({
						serialNo: serialNo++,
						studyOfDesign: "Unable to extract - .mmd file not found",
						referenceDetails: "N/A",
						pdfName: placement.pdfName,
						sectionId,
					})
					continue
				}

				// Read .mmd content and extract first 3 pages
				const mmdContent = await fs.promises.readFile(mmdPath, "utf8")
				const first3Pages = this.extractFirst3Pages(mmdContent)

				// Call LLM to extract study metadata
				const metadata = await this.extractMetadataViaLLM(first3Pages, placement.pdfName)

				studyInfos.push({
					serialNo: serialNo++,
					studyOfDesign: metadata.studyOfDesign || "Not specified",
					referenceDetails: metadata.referenceDetails || "Not specified",
					pdfName: placement.pdfName,
					sectionId,
				})
			} catch (error) {
				console.warn(`[TaskSectionCreation 5.2] Error processing placement ${placement.pdfName}: ${error}`)
				studyInfos.push({
					serialNo: serialNo++,
					studyOfDesign: `Error: ${error instanceof Error ? error.message : String(error)}`,
					referenceDetails: "N/A",
					pdfName: placement.pdfName,
					sectionId,
				})
			}
		}

		return studyInfos
	}

	/**
	 * Extracts the first 3 pages from .mmd content (split on <--- Page Split ---> delimiter)
	 */
	private extractFirst3Pages(mmdContent: string): string {
		const delimiter = "<--- Page Split --->"
		const pages = mmdContent.split(delimiter)
		const first3 = pages.slice(0, 3)
		return first3.join("\n\n--- PAGE BREAK ---\n\n")
	}

	/**
	 * Calls LLM to extract study metadata from document text
	 */
	private async extractMetadataViaLLM(
		documentText: string,
		pdfName: string,
	): Promise<{ studyOfDesign: string; referenceDetails: string }> {
		const prompt = `Extract metadata from the following clinical study document.

Document name: ${pdfName}

Document content (first 3 pages):
${documentText}

Please extract and return a JSON object with exactly these two fields:
1. "studyOfDesign": A brief 1-2 sentence description of the study design/type (e.g., "Randomized, double-blind, placebo-controlled, parallel-group bioequivalence study comparing test and reference formulations in healthy volunteers under fasting conditions.")
2. "referenceDetails": Publication/reference information including journal/conference name, DOI/link if available, and author names (e.g., "Published in Journal of Clinical Pharmacology, 2023; DOI: 10.1234/jcp.2023.001; Authors: Smith J, Johnson A, Williams B")

If information is not available, use "Not specified" for that field.

Return ONLY the JSON object, no additional text.`

		try {
			const stateManager = StateManager.get()
			const apiConfiguration = stateManager.getApiConfiguration()
			const currentMode = "act"
			const apiHandler = buildApiHandler(apiConfiguration, currentMode)

			const systemPrompt = `You are a clinical study document analyzer. Extract study design and reference information from regulatory documents. Always respond with valid JSON containing "studyOfDesign" and "referenceDetails" fields.`
			const messages = [{ role: "user" as const, content: prompt }]

			// Use json_object response format if supported
			const stream = apiHandler.createMessage(systemPrompt, messages)

			let response = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					response += chunk.text
				}
			}

			// Parse JSON response
			const jsonMatch = response.match(/\{[\s\S]*\}/)
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0])
				return {
					studyOfDesign: parsed.studyOfDesign || "Not specified",
					referenceDetails: parsed.referenceDetails || "Not specified",
				}
			}

			return {
				studyOfDesign: "Unable to parse LLM response",
				referenceDetails: "Unable to parse LLM response",
			}
		} catch (error) {
			console.warn(`[TaskSectionCreation 5.2] LLM extraction failed: ${error}`)
			return {
				studyOfDesign: "LLM extraction failed",
				referenceDetails: "LLM extraction failed",
			}
		}
	}

	/**
	 * Generates LaTeX table for section 5.2
	 */
	private generateSection52Table(
		studyInfos: Array<{
			serialNo: number
			studyOfDesign: string
			referenceDetails: string
			pdfName: string
			sectionId: string
		}>,
	): string {
		// Helper function to escape LaTeX special characters
		const escapeLatex = (text: string): string => {
			return text
				.replace(/\\/g, "\\textbackslash{}")
				.replace(/{/g, "\\{")
				.replace(/}/g, "\\}")
				.replace(/#/g, "\\#")
				.replace(/\$/g, "\\$")
				.replace(/%/g, "\\%")
				.replace(/&/g, "\\&")
				.replace(/_/g, "\\_")
				.replace(/\^/g, "\\textasciicircum{}")
				.replace(/~/g, "\\textasciitilde{}")
		}

		// Generate table rows
		const tableRows = studyInfos
			.map((info) => {
				const escapedStudy = escapeLatex(info.studyOfDesign)
				const escapedRef = escapeLatex(info.referenceDetails)
				return `\t\t${info.serialNo} & ${escapedStudy} & ${escapedRef} \\\\
\t\t\\hline`
			})
			.join("\n")

		return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\usepackage{booktabs}
\\usepackage{longtable}
\\usepackage{array}
\\usepackage{hyperref}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    pdftitle={CTD Section 5.2: Tabular Listing of All Clinical Studies},
    pdfauthor={Regulatory Affairs}
}

\\begin{document}

\\section*{5.2. Tabular Listing of All Clinical Studies}

This table provides a comprehensive listing of all clinical studies included in Module 5.3 of this submission.

\\renewcommand{\\arraystretch}{1.5}
\\begin{longtable}{|p{1.2cm}|p{7cm}|p{7cm}|}
\\hline
\\textbf{S.No.} & \\textbf{Study of Design} & \\textbf{Reference Details} \\\\
\\hline
\\endfirsthead

\\multicolumn{3}{|c|}{\\textit{Continued from previous page}} \\\\
\\hline
\\textbf{S.No.} & \\textbf{Study of Design} & \\textbf{Reference Details} \\\\
\\hline
\\endhead

\\hline
\\multicolumn{3}{|r|}{\\textit{Continued on next page}} \\\\
\\endfoot

\\hline
\\endlastfoot

${tableRows}

\\end{longtable}

\\end{document}`
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

		const _prompt = this.buildChunkAnalysisPrompt(chunkContent)

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
		if (content.length <= targetLength) {
			return content
		}

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
	 * Corrects and improves LaTeX code without changing semantic content.
	 * Uses an iterative compilation loop to fix errors:
	 * 1. Write content to a temporary .tex file
	 * 2. Compile and capture any errors
	 * 3. If PDF is generated, return the corrected content
	 * 4. If errors exist, send them to LLM for correction
	 * 5. Repeat up to 3 times
	 *
	 * @param content The LaTeX content to correct
	 * @returns The corrected LaTeX content
	 */
	private async correctLatexCode(content: string): Promise<string> {
		const MAX_COMPILATION_ATTEMPTS = 3
		let currentContent = content
		let tempTexPath: string | null = null

		try {
			// Ensure section folder exists
			await fs.promises.mkdir(this.sectionFolderPath, { recursive: true })

			// Create temporary tex file for compilation testing
			tempTexPath = await this.createTempTexFile(currentContent)

			for (let attempt = 1; attempt <= MAX_COMPILATION_ATTEMPTS; attempt++) {
				this.reportProgress(`LaTeX correction attempt ${attempt}/${MAX_COMPILATION_ATTEMPTS}...`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: `LaTeX compilation attempt ${attempt}/${MAX_COMPILATION_ATTEMPTS}`,
				})

				// Compile the temporary file and extract errors
				const compilationResult = await this.compileTexAndExtractErrors(tempTexPath)

				// Check if PDF was generated successfully
				if (compilationResult.pdfPath) {
					console.log(`[TaskSectionCreation ${this.sectionId}] PDF generated successfully on attempt ${attempt}`)
					showSystemNotification({
						subtitle: `Section ${this.sectionId}`,
						message: `LaTeX compiled successfully on attempt ${attempt}`,
					})

					// Read the current content from temp file (in case LLM made changes)
					currentContent = await fs.promises.readFile(tempTexPath, "utf8")

					// Cleanup temp file and associated files
					await this.cleanupTempFile(tempTexPath)
					return currentContent
				}

				// If we have errors, ask LLM to fix them
				if (compilationResult.errors.length > 0) {
					console.log(
						`[TaskSectionCreation ${this.sectionId}] Found ${compilationResult.errors.length} compilation errors on attempt ${attempt}`,
					)

					// Log the errors for debugging
					compilationResult.errors.forEach((err, idx) => {
						console.log(`[TaskSectionCreation ${this.sectionId}] Error ${idx + 1}: ${err}`)
					})

					// Build prompt with errors, compile.log content, and current content
					const prompt = this.buildLatexCorrectionPrompt(
						currentContent,
						compilationResult.errors,
						compilationResult.fullOutput,
					)

					// Call LLM to fix the errors
					const result = await this.errorHandler.executeWithContextReduction(async (reductionFactor) => {
						const adjustedPrompt = reductionFactor < 1 ? this.reducePromptContent(prompt, reductionFactor) : prompt
						return this.callLLMWithLatexSystemPrompt(adjustedPrompt)
					})

					if (result.success && result.result) {
						// Strip markdown code blocks if present
						currentContent = this.stripMarkdownCodeBlocks(result.result)

						// Write the corrected content to the temp file for next compilation attempt
						await fs.promises.writeFile(tempTexPath, currentContent, "utf8")
						console.log(`[TaskSectionCreation ${this.sectionId}] Updated temp file with LLM corrections`)
					} else {
						console.warn(
							`[TaskSectionCreation ${this.sectionId}] LLM correction failed on attempt ${attempt}: ${result.error?.message}`,
						)
						// Continue with the current content
					}
				} else {
					// No PDF and no specific errors - this is unexpected
					console.warn(
						`[TaskSectionCreation ${this.sectionId}] Compilation failed without specific errors on attempt ${attempt}`,
					)

					// Try a general correction without specific errors, but include compile.log
					const prompt = this.buildLatexCorrectionPrompt(currentContent, undefined, compilationResult.fullOutput)
					const result = await this.errorHandler.executeWithContextReduction(async (reductionFactor) => {
						const adjustedPrompt = reductionFactor < 1 ? this.reducePromptContent(prompt, reductionFactor) : prompt
						return this.callLLMWithLatexSystemPrompt(adjustedPrompt)
					})

					if (result.success && result.result) {
						currentContent = this.stripMarkdownCodeBlocks(result.result)
						await fs.promises.writeFile(tempTexPath, currentContent, "utf8")
					}
				}
			}

			// Max attempts reached without successful PDF generation
			console.warn(
				`[TaskSectionCreation ${this.sectionId}] Max compilation attempts (${MAX_COMPILATION_ATTEMPTS}) reached without successful PDF generation`,
			)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `LaTeX compilation failed after ${MAX_COMPILATION_ATTEMPTS} attempts. Using last corrected version.`,
			})

			// Cleanup temp file
			if (tempTexPath) {
				await this.cleanupTempFile(tempTexPath)
			}

			// Return the last corrected content
			return currentContent
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			console.error(`[TaskSectionCreation ${this.sectionId}] Error in correctLatexCode: ${errorMsg}`)

			// Cleanup temp file on error
			if (tempTexPath) {
				await this.cleanupTempFile(tempTexPath)
			}

			// Fall back to original content
			return content
		}
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
		if (prompt.length <= targetLength) {
			return prompt
		}

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
	 * Generates a Table of Contents LaTeX document for the module
	 * Creates a fixed-format table listing all sections in the module
	 */
	private generateTOCTable(): string {
		if (!this.moduleNum) {
			throw new Error("Module number is required to generate Table of Contents")
		}

		// Find the module
		const module = EAC_NMRA_TEMPLATE.modules.find((m) => m.moduleNumber === this.moduleNum)
		if (!module) {
			throw new Error(`Module ${this.moduleNum} not found in template`)
		}

		// Build parent-child map to determine hierarchy
		const parentMap = new Map<string, string | null>()
		for (const [sectionId, _section] of Object.entries(module.sections)) {
			let parent: string | null = null
			for (const [potentialParentId, potentialParent] of Object.entries(module.sections)) {
				if (potentialParent.children?.includes(sectionId)) {
					parent = potentialParentId
					break
				}
			}
			parentMap.set(sectionId, parent)
		}

		// Get all sections in the module, sorted by section ID
		const allSections = Object.entries(module.sections)
			.map(([id, section]) => ({ id, section }))
			.sort((a, b) => {
				// Sort by section ID numerically (e.g., "5.1" < "5.2" < "5.3.1")
				const aParts = a.id.split(".").map(Number)
				const bParts = b.id.split(".").map(Number)
				for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
					const aVal = aParts[i] ?? 0
					const bVal = bParts[i] ?? 0
					if (aVal !== bVal) {
						return aVal - bVal
					}
				}
				return 0
			})

		// Helper function to calculate section depth
		const getDepth = (sectionId: string): number => {
			return sectionId.split(".").length - 1
		}

		// Helper function to escape LaTeX special characters
		const escapeLatex = (text: string): string => {
			return text
				.replace(/\\/g, "\\textbackslash{}")
				.replace(/{/g, "\\{")
				.replace(/}/g, "\\}")
				.replace(/#/g, "\\#")
				.replace(/\$/g, "\\$")
				.replace(/%/g, "\\%")
				.replace(/&/g, "\\&")
				.replace(/_/g, "\\_")
				.replace(/\^/g, "\\textasciicircum{}")
				.replace(/~/g, "\\textasciitilde{}")
		}

		// Escape section title for use in document
		const escapedSectionTitle = escapeLatex(this.sectionTitle)

		// Generate LaTeX table rows with hierarchical indentation
		const tableRows: string[] = []
		for (const { id, section } of allSections) {
			const depth = getDepth(id)
			const escapedTitle = escapeLatex(section.title)

			// Calculate indentation: 0.5cm per level for all levels
			const indentAmount = depth * 0.5

			// Apply bold formatting for top-level (depth 0) sections only
			const isBold = depth === 0
			const formattedSectionId = isBold ? `\\textbf{${id}}` : id
			const formattedTitle = isBold ? `\\textbf{${escapedTitle}}` : escapedTitle

			// Use parbox with hanging indent to maintain indentation on wrapped lines
			let formattedRequirement: string
			if (indentAmount > 0) {
				// Use hangindent to indent all lines, including wrapped text
				formattedRequirement = `\\hangindent=${indentAmount}cm \\hangafter=0 ${formattedTitle}`
			} else {
				formattedRequirement = formattedTitle
			}

			tableRows.push(`\t\t${formattedSectionId} & ${formattedRequirement} & \\\\[0.3em]`)
			tableRows.push(`\t\t\\hline`)
		}

		// Generate the complete LaTeX document
		const latexDocument = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\usepackage{booktabs}
\\usepackage{longtable}
\\usepackage{tabularx}
\\usepackage{array}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{siunitx}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage{fancyhdr}
\\usepackage{titlesec}
\\newcolumntype{L}[1]{>{\\raggedright\\arraybackslash}p{#1}}
\\newcolumntype{C}[1]{>{\\centering\\arraybackslash}p{#1}}
\\setlength{\\tabcolsep}{4pt}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    pdftitle={CTD Section ${this.sectionId}: ${escapedSectionTitle}},
    pdfauthor={Regulatory Affairs}
}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[C]{CTD Section ${this.sectionId}: ${escapedSectionTitle}}
\\fancyfoot[C]{\\thepage}

\\begin{document}

\\title{${this.sectionId}. ${escapedSectionTitle}}
\\author{Regulatory Affairs}
\\date{\\today}
\\maketitle

\\section*{${escapedSectionTitle}}

\\renewcommand{\\arraystretch}{1.5}
\\begin{longtable}{|p{2.2cm}|p{11.3cm}|p{1.4cm}|}
\\hline
\\textbf{Section} & \\textbf{Requirements} & \\textbf{Page No.} \\\\
\\hline
\\endfirsthead

\\multicolumn{3}{|c|}{\\textit{Continued from previous page}} \\\\
\\hline
\\textbf{Section} & \\textbf{Requirements} & \\textbf{Page No.} \\\\
\\hline
\\endhead

\\hline
\\multicolumn{3}{|r|}{\\textit{Continued on next page}} \\\\
\\endfoot

\\hline
\\endlastfoot

${tableRows.join("\n")}

\\end{longtable}

\\end{document}`

		return latexDocument
	}

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
	 * Calls the LLM with LaTeX correction system prompt
	 */
	private async callLLMWithLatexSystemPrompt(prompt: string): Promise<string> {
		const stateManager = StateManager.get()
		const apiConfiguration = stateManager.getApiConfiguration()
		const currentMode = "act"
		const apiHandler = buildApiHandler(apiConfiguration, currentMode)

		const systemPrompt = this.buildLatexCorrectionSystemPrompt()
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
	 * Builds the system prompt for LaTeX correction agent
	 */
	private buildLatexCorrectionSystemPrompt(): string {
		return `You are a LaTeX expert specializing in code quality and syntax correction.

Your task is to improve the LaTeX code quality of a regulatory document WITHOUT changing any semantic content.

## CRITICAL CONSTRAINTS:
1. **DO NOT** change any words, sentences, or semantic meaning
2. **DO NOT** modify data values, numbers, or technical content
3. **DO NOT** alter document structure or section organization
4. **ONLY** fix LaTeX syntax, code quality, and formatting

## What to Fix/Improve:
- LaTeX syntax errors (escaping, commands, environments)
- Package usage and imports
- Table formatting and alignment
- Proper use of LaTeX commands and environments
- Code organization and readability
- Ensure document compiles without errors
- Fix any LaTeX compilation issues
- Escape special characters properly (e.g., "%" must be escaped as "\\%", "&" as "\\&", "_" as "\\_", etc.). Be very careful about the usage of \\_ and \\% in the content, make sure they are used with a back-slash in the content.
- Use proper LaTeX math mode for superscripts and subscripts (e.g., "x^2" should be "$x^2$", "H2O" should be "H$_2$O", use braces for multi-character: "$x^{10}$", "$x_{max}$")

## Output:
Return the corrected LaTeX code with all semantic content preserved exactly as provided.`
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

	/**
	 * Builds the prompt for LaTeX correction
	 * @param content The LaTeX content to correct
	 * @param compilationErrors Optional array of compilation errors to include in the prompt
	 */
	private buildLatexCorrectionPrompt(content: string, compilationErrors?: string[], compileLogContent?: string): string {
		let errorSection = ""
		if (compilationErrors && compilationErrors.length > 0) {
			errorSection = `
<compilation_errors>
The following compilation errors were found when trying to compile this LaTeX document. Please fix these specific errors:

${compilationErrors.map((err, idx) => `${idx + 1}. ${err}`).join("\n")}
</compilation_errors>

`
		}

		let compileLogSection = ""
		if (compileLogContent && compileLogContent.trim().length > 0) {
			// Truncate very long logs to avoid context window issues (keep last 8000 chars)
			const logContent =
				compileLogContent.length > 8000
					? `... (log truncated, showing last 8000 characters)\n${compileLogContent.slice(-8000)}`
					: compileLogContent

			compileLogSection = `
<compile_log>
The following is the full compilation log from LaTeX Workshop (filename.compile.log). Use this to understand compilation errors and warnings:

${logContent}
</compile_log>

`
		}

		return `Review and correct the following LaTeX document. Improve its code quality, fix syntax errors, and ensure it follows LaTeX best practices.

IMPORTANT: You must preserve ALL semantic content, wording, and data values exactly as they are. Only fix LaTeX code structure, syntax, and formatting.
${errorSection}${compileLogSection}<latex_content>
${content}
</latex_content>

Return the corrected LaTeX code with improved syntax and code quality, but with all content and meaning preserved exactly.${compilationErrors && compilationErrors.length > 0 ? " Focus especially on fixing the compilation errors listed above." : ""}`
	}

	// =========================================================================
	// LATEX COMPILATION AND ERROR EXTRACTION METHODS
	// =========================================================================

	/**
	 * Creates a temporary .tex file in the section folder
	 * @param content The LaTeX content to write
	 * @returns The path to the created temporary file
	 */
	private async createTempTexFile(content: string): Promise<string> {
		const tempFileName = `_temp_compile_${Date.now()}.tex`
		const tempFilePath = path.join(this.sectionFolderPath, tempFileName)
		await fs.promises.writeFile(tempFilePath, content, "utf8")
		console.log(`[TaskSectionCreation ${this.sectionId}] Created temp tex file: ${tempFilePath}`)
		return tempFilePath
	}

	/**
	 * Cleans up a temporary file
	 * @param filePath The path to the file to delete
	 */
	private async cleanupTempFile(filePath: string): Promise<void> {
		try {
			await fs.promises.unlink(filePath)
			console.log(`[TaskSectionCreation ${this.sectionId}] Cleaned up temp file: ${filePath}`)

			// Also cleanup related auxiliary files
			const basePath = filePath.replace(/\.tex$/, "")
			const auxExtensions = [".aux", ".log", ".out", ".toc", ".pdf", ".compile.log"]
			for (const ext of auxExtensions) {
				const auxFile = basePath + ext
				try {
					if (await fileExistsAtPath(auxFile)) {
						await fs.promises.unlink(auxFile)
						console.log(`[TaskSectionCreation ${this.sectionId}] Cleaned up auxiliary file: ${auxFile}`)
					}
				} catch {
					// Ignore errors for auxiliary files
				}
			}
		} catch (error) {
			console.warn(`[TaskSectionCreation ${this.sectionId}] Failed to cleanup temp file: ${error}`)
		}
	}

	/**
	 * Extracts LaTeX errors from compilation log content
	 * Uses regex patterns inspired by LaTeX Workshop parser
	 * @param logContent The content from the .compile.log file generated by LaTeX Workshop
	 * @returns Array of formatted error strings
	 */
	private extractLatexErrors(logContent: string): string[] {
		const errors: string[] = []
		const combinedOutput = logContent

		// Regex patterns for LaTeX errors (inspired by LaTeX Workshop parser)
		const patterns = {
			// Fatal errors starting with !
			fatalError: /^!\s*(.+)$/gm,
			// File:line errors
			fileLineError: /^(.+):(\d+):\s*(?:(.+)\s+Error:)?\s*(.+)$/gm,
			// Error line context (l.<line number>)
			lineContext: /^l\.(\d+)\s*(\.\.\.)?(.*)$/gm,
			// Fatal compilation failure
			fatalCompilation: /Fatal error occurred, no output PDF file produced!/g,
			// Missing character errors
			missingChar: /^\s*(Missing character:.*?!)/gm,
			// Undefined control sequence
			undefinedControl: /^!\s*Undefined control sequence\./gm,
			// Missing package/file
			missingFile: /^!\s*LaTeX Error:\s*File [`'](.+)' not found\./gm,
			// Package errors
			packageError: /^!\s*Package\s+(\w+)\s+Error:\s*(.+)$/gm,
			// Environment errors
			environmentError: /^!\s*LaTeX Error:\s*Environment\s+(\w+)\s+undefined\./gm,
			// Missing \begin{document}
			missingBeginDoc: /^!\s*LaTeX Error:\s*Missing \\begin\{document\}\./gm,
			// Emergency stop
			emergencyStop: /^!\s*Emergency stop\./gm,
			// Runaway argument
			runawayArgument: /^Runaway argument\?/gm,
		}

		// Track seen errors to avoid duplicates
		const seenErrors = new Set<string>()

		// Helper to add error if not duplicate
		const addError = (error: string) => {
			const normalized = error.trim().toLowerCase()
			if (!seenErrors.has(normalized) && error.trim().length > 0) {
				seenErrors.add(normalized)
				errors.push(error.trim())
			}
		}

		// Extract fatal errors
		let match: RegExpExecArray | null
		match = patterns.fatalError.exec(combinedOutput)
		while (match !== null) {
			const errorMsg = match[1].trim()
			// Skip certain non-actionable messages
			if (!errorMsg.startsWith("==>") && !errorMsg.includes("Here is how much")) {
				addError(`Fatal Error: ${errorMsg}`)
			}
			match = patterns.fatalError.exec(combinedOutput)
		}

		// Extract file:line errors
		patterns.fileLineError.lastIndex = 0
		match = patterns.fileLineError.exec(combinedOutput)
		while (match !== null) {
			const file = path.basename(match[1])
			const line = match[2]
			const errorType = match[3] || "Error"
			const message = match[4]
			addError(`${file}:${line}: ${errorType}: ${message}`)
			match = patterns.fileLineError.exec(combinedOutput)
		}

		// Extract fatal compilation failures
		if (patterns.fatalCompilation.test(combinedOutput)) {
			addError("Fatal error occurred, no output PDF file produced!")
		}

		// Extract missing character errors
		patterns.missingChar.lastIndex = 0
		match = patterns.missingChar.exec(combinedOutput)
		while (match !== null) {
			addError(match[1])
			match = patterns.missingChar.exec(combinedOutput)
		}

		// Extract undefined control sequence with context
		const lines = combinedOutput.split("\n")
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			if (line.includes("Undefined control sequence")) {
				// Look for context in following lines
				let context = ""
				for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
					const contextMatch = lines[j].match(/^l\.(\d+)\s*(.*)$/)
					if (contextMatch) {
						context = ` at line ${contextMatch[1]}: ${contextMatch[2].trim()}`
						break
					}
				}
				addError(`Undefined control sequence${context}`)
			}
		}

		// Extract package errors
		patterns.packageError.lastIndex = 0
		match = patterns.packageError.exec(combinedOutput)
		while (match !== null) {
			addError(`Package ${match[1]} Error: ${match[2]}`)
			match = patterns.packageError.exec(combinedOutput)
		}

		// Extract missing file errors
		patterns.missingFile.lastIndex = 0
		match = patterns.missingFile.exec(combinedOutput)
		while (match !== null) {
			addError(`Missing file: ${match[1]}`)
			match = patterns.missingFile.exec(combinedOutput)
		}

		// Extract environment errors
		patterns.environmentError.lastIndex = 0
		match = patterns.environmentError.exec(combinedOutput)
		while (match !== null) {
			addError(`Environment undefined: ${match[1]}`)
			match = patterns.environmentError.exec(combinedOutput)
		}

		// Check for emergency stop
		if (patterns.emergencyStop.test(combinedOutput)) {
			addError("Emergency stop - LaTeX could not continue processing")
		}

		// Check for runaway argument
		if (patterns.runawayArgument.test(combinedOutput)) {
			addError("Runaway argument - possibly missing closing brace or end of environment")
		}

		return errors
	}

	/**
	 * Compiles a .tex file to PDF and extracts any compilation errors
	 * Uses LaTeX Workshop for compilation, which generates a .compile.log file
	 * @param texPath Path to the .tex file to compile
	 * @returns Object containing pdfPath (if successful), errors array, and full output from compile.log
	 */
	private async compileTexAndExtractErrors(
		texPath: string,
	): Promise<{ pdfPath: string | null; errors: string[]; fullOutput: string }> {
		const texDir = path.dirname(texPath)
		const texBasename = path.basename(texPath, ".tex")
		const compileLogPath = path.join(texDir, `${texBasename}.compile.log`)

		console.log(`[TaskSectionCreation ${this.sectionId}] Compiling LaTeX file with LaTeX Workshop: ${texPath}`)

		try {
			// Check if LaTeX Workshop extension is available
			// biome-ignore lint: LaTeX Workshop extension integration requires direct vscode API access
			const latexWorkshopExtension = vscode.extensions.getExtension("James-Yu.latex-workshop")
			if (!latexWorkshopExtension) {
				console.log(`[TaskSectionCreation ${this.sectionId}] LaTeX Workshop extension not found`)
				return {
					pdfPath: null,
					errors: ["LaTeX Workshop extension not found. Please install the LaTeX Workshop extension."],
					fullOutput: "LaTeX Workshop extension not available",
				}
			}

			// Ensure the extension is activated
			if (!latexWorkshopExtension.isActive) {
				await latexWorkshopExtension.activate()
			}

			// Open the document and save it so LaTeX Workshop can detect it
			const texUri = vscode.Uri.file(texPath)
			// biome-ignore lint: LaTeX Workshop integration requires opening document to trigger detection
			const document = await vscode.workspace.openTextDocument(texUri)
			await document.save()

			// Give LaTeX Workshop time to notice the file
			await new Promise((resolve) => setTimeout(resolve, 300))

			// Remove existing log files if they exist (to ensure we get fresh logs)
			const regularLogPath = path.join(texDir, `${texBasename}.log`)
			try {
				if (await fileExistsAtPath(compileLogPath)) {
					await fs.promises.unlink(compileLogPath)
				}
				// Also clean up regular .log file to avoid conflicts
				if (await fileExistsAtPath(regularLogPath)) {
					await fs.promises.unlink(regularLogPath)
				}
			} catch {
				// Ignore if deletion fails
			}

			// Trigger LaTeX Workshop build
			console.log(`[TaskSectionCreation ${this.sectionId}] Triggering LaTeX Workshop build for: ${texPath}`)
			// biome-ignore lint: LaTeX Workshop build command requires direct executeCommand access
			await vscode.commands.executeCommand("latex-workshop.build", false, texPath, "latex")

			// Wait for compilation to complete
			// LaTeX Workshop compiles asynchronously, so we need to poll for completion
			// We check for both PDF (success) and log files (to extract errors)
			const timeoutMs = 60_000
			const stepMs = 500
			const start = Date.now()
			let compileLogExists = false
			let regularLogExists = false

			// Determine PDF path early to check for it
			const texUriForConfig = vscode.Uri.file(texPath)
			const cfg = vscode.workspace.getConfiguration("latex-workshop", texUriForConfig)
			const outDirRaw = cfg.get("latex.outDir") as string | undefined

			let pdfPath = path.join(texDir, `${texBasename}.pdf`)
			if (outDirRaw && typeof outDirRaw === "string" && outDirRaw.trim()) {
				let outDir = outDirRaw
				if (outDir.includes("%DIR%")) {
					outDir = outDir.replaceAll("%DIR%", texDir)
				} else if (!path.isAbsolute(outDir)) {
					outDir = path.join(texDir, outDir)
				}
				pdfPath = path.join(outDir, `${texBasename}.pdf`)
			}

			// Wait for build to complete - check for PDF or log files
			while (Date.now() - start < timeoutMs) {
				// Check if PDF was created (build succeeded)
				const pdfExists = await fileExistsAtPath(pdfPath)
				if (pdfExists) {
					// Build succeeded, wait a bit for compile.log to be written
					await new Promise((resolve) => setTimeout(resolve, 1000))
					compileLogExists = await fileExistsAtPath(compileLogPath)
					break
				}

				// Check for log files (build may have failed)
				compileLogExists = await fileExistsAtPath(compileLogPath)
				regularLogExists = await fileExistsAtPath(regularLogPath)

				// If we have either log file, wait a bit more then check again
				if (compileLogExists || regularLogExists) {
					await new Promise((resolve) => setTimeout(resolve, 1000))
					// Re-check PDF one more time
					if (await fileExistsAtPath(pdfPath)) {
						compileLogExists = await fileExistsAtPath(compileLogPath)
						break
					}
					// If still no PDF, assume build failed and use available log
					break
				}

				await new Promise((resolve) => setTimeout(resolve, stepMs))
			}

			// Read log file - prefer compile.log, fall back to regular .log
			let fullOutput = ""
			let errors: string[] = []

			if (compileLogExists) {
				try {
					fullOutput = await fs.promises.readFile(compileLogPath, "utf8")
					errors = this.extractLatexErrors(fullOutput)

					console.log(`[TaskSectionCreation ${this.sectionId}] Read compile.log (${fullOutput.length} chars)`)
					console.log(`[TaskSectionCreation ${this.sectionId}] Extracted ${errors.length} error(s):`, errors)

					if (errors.length > 0) {
						console.log(`[TaskSectionCreation ${this.sectionId}] === COMPILE.LOG ERRORS START ===`)
						errors.forEach((err, idx) => {
							console.log(`[TaskSectionCreation ${this.sectionId}] Error ${idx + 1}: ${err}`)
						})
						console.log(`[TaskSectionCreation ${this.sectionId}] === COMPILE.LOG ERRORS END ===`)
					}
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err)
					console.error(`[TaskSectionCreation ${this.sectionId}] Failed to read compile.log: ${errorMsg}`)
					fullOutput = `Failed to read compile.log: ${errorMsg}`
					errors = [`Failed to read compile.log: ${errorMsg}`]
				}
			} else if (regularLogExists) {
				// Fall back to regular .log file if compile.log doesn't exist
				try {
					fullOutput = await fs.promises.readFile(regularLogPath, "utf8")
					errors = this.extractLatexErrors(fullOutput)

					console.log(`[TaskSectionCreation ${this.sectionId}] Read regular .log file (${fullOutput.length} chars)`)
					console.log(`[TaskSectionCreation ${this.sectionId}] Extracted ${errors.length} error(s):`, errors)

					if (errors.length > 0) {
						console.log(`[TaskSectionCreation ${this.sectionId}] === LOG ERRORS START ===`)
						errors.forEach((err, idx) => {
							console.log(`[TaskSectionCreation ${this.sectionId}] Error ${idx + 1}: ${err}`)
						})
						console.log(`[TaskSectionCreation ${this.sectionId}] === LOG ERRORS END ===`)
					}
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err)
					console.error(`[TaskSectionCreation ${this.sectionId}] Failed to read regular .log: ${errorMsg}`)
					fullOutput = `Failed to read regular .log: ${errorMsg}`
					errors = [`Failed to read regular .log: ${errorMsg}`]
				}
			} else {
				console.warn(`[TaskSectionCreation ${this.sectionId}] No log files found after compilation`)
				fullOutput = "No log files were generated by LaTeX Workshop - compilation may have failed silently"
				errors = ["No log files generated - compilation may have failed silently"]
			}

			// Check if PDF was created
			const pdfExists = await fileExistsAtPath(pdfPath)

			if (pdfExists) {
				console.log(`[TaskSectionCreation ${this.sectionId}] PDF created successfully: ${pdfPath}`)
				return { pdfPath, errors: [], fullOutput }
			} else {
				console.log(`[TaskSectionCreation ${this.sectionId}] PDF not created. Found ${errors.length} errors.`)
				return { pdfPath: null, errors, fullOutput }
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			console.error(`[TaskSectionCreation ${this.sectionId}] Error in compileTexAndExtractErrors: ${errorMsg}`)
			return {
				pdfPath: null,
				errors: [`Compilation failed: ${errorMsg}`],
				fullOutput: `Error: ${errorMsg}`,
			}
		}
	}

	// =========================================================================
	// PDF ATTACHMENT METHODS
	// =========================================================================

	/**
	 * Gets the submissions path from SubmissionsPaneProvider
	 */
	private getSubmissionsPath(): string | undefined {
		try {
			const { SubmissionsPaneProvider } = require("@/hosts/vscode/SubmissionsPaneProvider")
			const submissionsProvider = SubmissionsPaneProvider.getInstance()
			return submissionsProvider?.getSubmissionsFolder()
		} catch (error) {
			console.warn(`[TaskSectionCreation] Failed to get submissions path: ${error}`)
			return undefined
		}
	}

	/**
	 * Ensures the pdfpages package is included in the LaTeX preamble
	 */
	private ensurePdfPagesPackage(content: string): string {
		// Check if already present
		if (content.includes("\\usepackage{pdfpages}")) {
			return content
		}

		// Find insertion point: after last \usepackage, before \begin{document}
		const beginDocMatch = content.indexOf("\\begin{document}")
		if (beginDocMatch === -1) {
			return content
		}

		// Find last \usepackage before \begin{document}
		const preamble = content.substring(0, beginDocMatch)
		const lastUsepackageMatch = preamble.lastIndexOf("\\usepackage")

		if (lastUsepackageMatch !== -1) {
			// Find end of last \usepackage line
			const afterLastUsepackage = preamble.substring(lastUsepackageMatch)
			const lineEnd = afterLastUsepackage.indexOf("\n")
			const insertPos = lastUsepackageMatch + (lineEnd !== -1 ? lineEnd : afterLastUsepackage.length)
			return content.slice(0, insertPos) + "\n\\usepackage{pdfpages}" + content.slice(insertPos)
		} else {
			// No \usepackage found, insert after \documentclass
			const docClassMatch = preamble.indexOf("\\documentclass")
			if (docClassMatch !== -1) {
				const afterDocClass = preamble.substring(docClassMatch)
				const lineEnd = afterDocClass.indexOf("\n")
				const insertPos = docClassMatch + (lineEnd !== -1 ? lineEnd : afterDocClass.length)
				return content.slice(0, insertPos) + "\n\\usepackage{pdfpages}" + content.slice(insertPos)
			}
		}

		return content
	}

	/**
	 * Attaches placement PDF files to the LaTeX document using pdfpages package.
	 * Iterates through parsed placement entries, locates PDF files, and inserts
	 * \includepdf commands before \end{document}.
	 */
	private async attachPlacementPdfsAsImages(content: string): Promise<string> {
		// Early return if no placements
		if (!this.parsedTags || this.parsedTags.placements.length === 0) {
			console.log(`[TaskSectionCreation ${this.sectionId}] No placements to attach`)
			return content
		}

		// Ensure pdfpages package is included
		let modifiedContent = this.ensurePdfPagesPackage(content)

		// Get base path for documents
		const submissionsPath = this.getSubmissionsPath()
		const workspaceRoot = this.cwd
		const basePath = submissionsPath || path.join(workspaceRoot, "documents")

		console.log(`[TaskSectionCreation ${this.sectionId}] Attaching ${this.parsedTags.placements.length} placement PDFs`)
		console.log(`[TaskSectionCreation ${this.sectionId}] Base path: ${basePath}`)

		// Collect PDF inclusions
		const pdfInclusions: string[] = []

		for (const placement of this.parsedTags.placements) {
			// Get the folder path from relativePath
			const folderPath = path.join(basePath, placement.relativePath)

			console.log(`[TaskSectionCreation ${this.sectionId}] Processing placement: ${placement.pdfName}`)
			console.log(`[TaskSectionCreation ${this.sectionId}] Looking for PDF in folder: ${folderPath}`)

			// Find PDF file in the folder
			let pdfPath: string | null = null
			try {
				const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
				for (const entry of entries) {
					if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
						pdfPath = path.join(folderPath, entry.name)
						console.log(`[TaskSectionCreation ${this.sectionId}] Found PDF: ${pdfPath}`)
						break
					}
				}
			} catch (error) {
				console.warn(`[TaskSectionCreation ${this.sectionId}] Error reading folder ${folderPath}: ${error}`)
			}

			if (!pdfPath) {
				console.warn(`[TaskSectionCreation ${this.sectionId}] No PDF found in folder: ${folderPath}`)
				// Continue to next placement
				continue
			}

			// Use absolute path for LaTeX (convert Windows backslashes to forward slashes)
			const latexPath = pdfPath.replace(/\\/g, "/")

			console.log(`[TaskSectionCreation ${this.sectionId}] LaTeX absolute path: ${latexPath}`)

			// Add inclusion command
			pdfInclusions.push(`\\includepdf[pages=-,fitpaper=true]{${latexPath}}`)
		}

		// Insert PDF inclusions before \end{document}
		if (pdfInclusions.length > 0) {
			const endDocIndex = modifiedContent.lastIndexOf("\\end{document}")
			if (endDocIndex !== -1) {
				const beforeEndDoc = modifiedContent.substring(0, endDocIndex)
				const afterEndDoc = modifiedContent.substring(endDocIndex)

				// Add section header and PDF inclusions
				const inclusionSection =
					"\n\n\\section*{Please find the Documents Enclosed}\n" + pdfInclusions.join("\n") + "\n\n"
				modifiedContent = beforeEndDoc + inclusionSection + afterEndDoc

				console.log(`[TaskSectionCreation ${this.sectionId}] Added ${pdfInclusions.length} PDF inclusions`)
			} else {
				console.warn(`[TaskSectionCreation ${this.sectionId}] Could not find \\end{document} in LaTeX content`)
			}
		}

		return modifiedContent
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
	public async runAndWaitForCompletion(_prompt: string): Promise<TaskSectionCreationResult> {
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
