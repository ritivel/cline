import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { showSystemNotification } from "@integrations/notifications"
import { McpHub } from "@services/mcp/McpHub"
import { ClineSay } from "@shared/ExtensionMessage"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import * as fs from "fs"
import { Controller } from "../controller"
import { StateManager } from "../storage/StateManager"
import { Task } from "./index"

/**
 * Parameters for creating a TaskSection252OverviewOfBiopharmaceutics instance
 */
export interface TaskSection252OverviewOfBiopharmaceuticsParams {
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
	ichInstructions?: string // ICH instructions for writing section 2.5.2
	onProgress?: (status: string) => void
}

/**
 * Result of task completion
 */
export interface TaskSection252OverviewOfBiopharmaceuticsResult {
	success: boolean
	error?: string
}

/**
 * ICH Instructions for Overview of Bio-pharmaceutics (Section 2.5.2)
 */
const ICH_OVERVIEW_OF_BIOPHARMACEUTICS_INSTRUCTIONS = `2.5.2 Overview of Bio-pharmaceutics
The purpose of this section is to present a critical analysis of any important issues related to
bioavailability that might affect efficacy and/or safety of the to-be-marketed formulation(s)
(e.g., dosage form/strength proportionality, differences between the to-be-marketed
formulation and the formulation(s) used in clinical trials, and influence of food on exposure).`

/**
 * TaskSection252OverviewOfBiopharmaceutics extends Task to generate section 2.5.2
 * It uses Module 5 section tags.md files to gather context for writing the section
 */
export class TaskSection252OverviewOfBiopharmaceutics extends Task {
	private sectionFolderPath: string
	private expectedOutputFile: string
	private tagsPath: string
	private ichInstructions: string
	private onProgress?: (status: string) => void

	// Completion monitoring
	private completionCheckInterval?: NodeJS.Timeout
	private isCompleted: boolean = false

	constructor(params: TaskSection252OverviewOfBiopharmaceuticsParams) {
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
		this.ichInstructions = params.ichInstructions || ICH_OVERVIEW_OF_BIOPHARMACEUTICS_INSTRUCTIONS
		this.onProgress = params.onProgress
	}

	/**
	 * Reports progress via the callback if provided
	 */
	private reportProgress(status: string): void {
		if (this.onProgress) {
			this.onProgress(status)
		}
		console.log(`[TaskSection252OverviewOfBiopharmaceutics] ${status}`)
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
				console.log(`[TaskSection252OverviewOfBiopharmaceutics] Output file found, marking as complete`)
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
	 * Main entry point: Generates section 2.5.2
	 */
	public async runSectionGeneration(): Promise<TaskSection252OverviewOfBiopharmaceuticsResult> {
		try {
			this.reportProgress("Starting section 2.5.2 generation")
			showSystemNotification({
				subtitle: "Section 2.5.2",
				message: "Starting Overview of Bio-pharmaceutics generation...",
			})
			this.startCompletionMonitoring()

			// Read section 2.5.2 tags.md to get drug name
			const section252Tags = await this.readTagsFile(this.tagsPath)
			if (!section252Tags.drugName) {
				return {
					success: false,
					error: "Could not determine drug name from section 2.5.2 tags.md",
				}
			}

			this.reportProgress(`Drug: ${section252Tags.drugName}`)

			// Build the user prompt
			const userPrompt = this.buildUserPrompt(section252Tags.drugName)

			// Run the task - this will use the Task's built-in execution with tools
			this.reportProgress("Generating section with AI agent...")
			await this.startTask(userPrompt)

			// Wait for completion (with timeout)
			const maxWaitTime = 300000 // 5 minutes
			const startTime = Date.now()
			while (!this.isCompleted && Date.now() - startTime < maxWaitTime) {
				await new Promise((resolve) => setTimeout(resolve, 2000))
			}

			// Check if output file was created
			if (await this.checkFileExists()) {
				this.isCompleted = true
				this.stopCompletionMonitoring()
				this.reportProgress("Section generated successfully")
				showSystemNotification({
					subtitle: "Section 2.5.2",
					message: "✓ Overview of Bio-pharmaceutics generated successfully!",
				})
				return { success: true }
			} else {
				this.stopCompletionMonitoring()
				return {
					success: false,
					error: "Output file was not created within timeout period",
				}
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
	 * Builds the user prompt for section 2.5.2 generation
	 */
	private buildUserPrompt(drugName: string): string {
		return `Generate CTD Section 2.5.2: Overview of Bio-pharmaceutics for ${drugName}.

## CRITICAL INSTRUCTION - READ THIS FIRST
**You MUST use the module5_tags_lookup tool EXACTLY 2-3 times maximum, then STOP and proceed to writing.**
**ONLY check LEAF sections (sections with no child sections) - these are where documents are actually placed.**
**DO NOT check parent sections that have children. DO NOT check more than 3 sections total.**
**Only search for information that is needed and write that information.**

## ICH Instructions for Overview of Bio-pharmaceutics

${this.ichInstructions}

## Workflow - FOLLOW THESE STEPS EXACTLY

1. Use the \`module5_tags_lookup\` tool to gather relevant Module 5 documents:
   - **CRITICAL LIMIT**: Use this tool EXACTLY 2-3 times maximum, then STOP
   - **ONLY check LEAF sections** (sections with no children) - these are where documents are actually placed
   - **DO NOT** check parent sections like "5.3" or "5.3.1" that have children
   - **DO NOT** check more than 3 leaf sections total - you will have enough information
   - The tool returns document NAMES and summaries (from info.json) only, NOT full content
   - After 2-3 tool calls, you MUST immediately proceed to step 2 - do NOT make more tool calls

   **Available Module 5 Leaf Sections (choose 2-3 most relevant for biopharmaceutics):**
   - **5.1**: Table of Contents of Module 5
   - **5.2**: Tabular Listing of All Clinical Studies
   - **5.3.1.1**: Bioavailability (BA) Study Reports
   - **5.3.1.2**: Comparative BA and Bioequivalence (BE) Study reports (most common for generics)
   - **5.3.1.3**: In vitro-In vivo Correlation Study Reports
   - **5.3.1.4**: Reports of Bioanalytical and Analytical Methods for Human Studies
   - **5.3.2.1**: Plasma Protein Binding Study Reports
   - **5.3.2.2**: Reports of Hepatic Metabolism and Drug Interaction Studies
   - **5.3.2.3**: Reports of Studies Using Other Human Biomaterials
   - **5.3.3.1**: Healthy Subject PK and Initial Tolerability Study Reports
   - **5.3.3.2**: Patient PK and Initial Tolerability Study Reports
   - **5.3.3.3**: Intrinsic Factor PK Study Reports
   - **5.3.3.4**: Extrinsic Factor PK Study Reports
   - **5.3.3.5**: Population PK Study Reports
   - **5.3.4.1**: Healthy Subject PD and PK/PD Study Reports
   - **5.3.4.2**: Patient PD and PK/PD Study Reports
   - **5.3.5.1**: Study Reports of Controlled Clinical Studies Pertinent to the Claimed Indication
   - **5.3.5.2**: Study Reports of Uncontrolled Clinical Studies
   - **5.3.5.3**: Reports of Analyses of Data from More than One Study
   - **5.3.5.4**: Other Clinical Study Reports
   - **5.3.6**: Reports of Post-Marketing Experience if Available
   - **5.3.7**: Case Reports Forms and Individual Patient Listings

   **Recommendation**: For Overview of Bio-pharmaceutics, prioritize sections like **5.3.1.1** (BA studies), **5.3.1.2** (BE studies), **5.3.1.3** (IVIVC studies), and **5.3.3.1** or **5.3.3.2** (PK studies) to understand bioavailability issues.

2. Based on document names and summaries from the 2-3 sections you checked, identify key information needed for the Overview of Bio-pharmaceutics:
   - Bioavailability issues that might affect efficacy and/or safety
   - Dosage form/strength proportionality data
   - Differences between to-be-marketed formulation and formulation(s) used in clinical trials
   - Influence of food on exposure (food effect studies)
   - Any other important biopharmaceutics-related issues

3. **OPTIONAL: Read specific .mmd files ONLY when there's a clear objective**

   **IMPORTANT**: You may read full .mmd file content ONLY in these specific cases:

   **When to read a .mmd file:**
   - When you need specific bioavailability data that aren't in the summary
   - When you need precise information about formulation differences between clinical and marketed products
   - When you need food effect study results or dosage form proportionality data
   - When you need specific PK parameters or bioavailability metrics
   - When the document summary is insufficient and you need specific data points to write an accurate section

   **How to read .mmd files:**
   - Use the \`file_read\` tool to read .mmd files from the documents folder
   - Path format: \`documents/{relativePath}/{filename}.mmd\` (use the relativePath from module5_tags_lookup results)
   - **CRITICAL**: Only read 1-2 .mmd files maximum, and ONLY if you have a specific objective
   - **DO NOT** read files just because they exist - only read if the summary is insufficient for your specific need
   - Before reading, state your objective: "I need to read [filename].mmd to [specific reason]"

   **Examples of valid objectives:**
   - "I need to read BE-Study-101.mmd to get the bioavailability ratio and food effect data for the biopharmaceutics overview"
   - "I need to read BA-Study-Phase1.mmd to get the specific bioavailability parameters and formulation comparison data"
   - "I need to read PK-Study-202.mmd to get the dosage form proportionality and exposure data"

   **Examples of invalid reasons (DO NOT read):**
   - "I'll read all documents to be thorough" ❌
   - "I want to see what's in the file" ❌
   - "The summary might not have everything" ❌

   **If summaries are sufficient, proceed directly to step 4 without reading any .mmd files.**

4. Write the Overview of Bio-pharmaceutics section that presents a critical analysis of:
   - Important issues related to bioavailability that might affect efficacy and/or safety
   - Dosage form/strength proportionality (if applicable)
   - Differences between the to-be-marketed formulation and the formulation(s) used in clinical trials
   - Influence of food on exposure (food effect studies, if applicable)
   - Any other relevant biopharmaceutics issues
   - Use professional regulatory language
   - Reference Module 5 documents by name when relevant

5. Use the \`write_tex\` tool to write the section to: ${this.expectedOutputFile}
   - The output should be LaTeX format
   - Include proper document structure with \\documentclass, \\begin{document}, etc.
   - The section content should be placed between \\begin{document} and \\end{document}

## Output Requirements

- Write the complete Overview of Bio-pharmaceutics section addressing all ICH requirements
- Use LaTeX format
- Use professional regulatory language
- Reference Module 5 documents by name when relevant
- Only include information that is needed - do not include unnecessary details
- If you read specific .mmd files, use only the relevant information needed for the section
- Focus on critical analysis of bioavailability issues that might affect efficacy and/or safety
- Follow ICH guidelines for Overview of Bio-pharmaceutics`
	}

	/**
	 * Reads and parses a tags.md file
	 */
	private async readTagsFile(tagsPath: string): Promise<{
		sectionId: string
		drugName: string
		apiName: string
	}> {
		try {
			const content = await fs.promises.readFile(tagsPath, "utf-8")
			const lines = content.split("\n")

			const result = {
				sectionId: "2.5.2",
				drugName: "",
				apiName: "",
			}

			for (const line of lines) {
				const trimmed = line.trim()
				const drugMatch = trimmed.match(/^Drug\s*Name:\s*(.+)$/i)
				if (drugMatch) {
					result.drugName = drugMatch[1].trim()
				}
				const apiMatch = trimmed.match(/^API\s*Name:\s*(.+)$/i)
				if (apiMatch) {
					result.apiName = apiMatch[1].trim()
				}
			}

			// If drug name not found in tags.md, try to get it from RegulatoryProductConfig
			if (!result.drugName) {
				try {
					const currentProduct = this.stateManager.getGlobalStateKey("currentRegulatoryProduct") as
						| RegulatoryProductConfig
						| undefined

					if (currentProduct?.drugName) {
						result.drugName = currentProduct.drugName
						result.apiName = currentProduct.drugName
						console.log(
							`[TaskSection252OverviewOfBiopharmaceutics] Using drug name from RegulatoryProductConfig: ${currentProduct.drugName}`,
						)
					}
				} catch (error) {
					console.warn(
						`[TaskSection252OverviewOfBiopharmaceutics] Failed to get drug name from RegulatoryProductConfig: ${error}`,
					)
				}
			}

			return result
		} catch (error) {
			console.error(`Failed to read tags file: ${error}`)

			// Try to get drug name from RegulatoryProductConfig as fallback
			try {
				const currentProduct = this.stateManager.getGlobalStateKey("currentRegulatoryProduct") as
					| RegulatoryProductConfig
					| undefined

				if (currentProduct?.drugName) {
					return {
						sectionId: "2.5.2",
						drugName: currentProduct.drugName,
						apiName: currentProduct.drugName,
					}
				}
			} catch (error) {
				console.warn(
					`[TaskSection252OverviewOfBiopharmaceutics] Failed to get drug name from RegulatoryProductConfig: ${error}`,
				)
			}

			return {
				sectionId: "2.5.2",
				drugName: "",
				apiName: "",
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
