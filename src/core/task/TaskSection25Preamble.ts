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
 * Parameters for creating a TaskSection25Preamble instance
 */
export interface TaskSection25PreambleParams {
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
	ichInstructions?: string // ICH instructions for writing section 2.5
	onProgress?: (status: string) => void
}

/**
 * Result of task completion
 */
export interface TaskSection25PreambleResult {
	success: boolean
	error?: string
}

/**
 * ICH Instructions for Clinical Overview (Section 2.5)
 */
const ICH_CLINICAL_OVERVIEW_INSTRUCTIONS = `The Clinical Overview is intended to provide a critical analysis of the clinical data in the
Common Technical Document. The Clinical Overview will necessarily refer to application
data provided in the comprehensive Clinical Summary, the individual clinical study reports
(ICH E3), and other relevant reports; but it should primarily present the conclusions and
implications of those data, and should not recapitulate them. Specifically, the Clinical
Summary should provide a detailed factual summarisation of the clinical information in the
CTD, and the Clinical Overview should provide a succinct discussion and interpretation of
these findings together with any other relevant information (e.g., pertinent animal data or
product quality issues that may have clinical implications).
The Clinical Overview is primarily intended for use by regulatory agencies in the review of
the clinical section of a marketing application. It should also be a useful reference to the
overall clinical findings for regulatory agency staff involved in the review of other sections of
the marketing application. The Clinical Overview should present the strengths and limitations
of the development program and study results, analyse the benefits and risks of the medicinal
product in its intended use, and describe how the study results support critical parts of the
prescribing information.
In order to achieve these objectives the Clinical Overview should:
• describe and explain the overall approach to the clinical development of a medicinal
product, including critical study design decisions.
• assess the quality of the design and performance of the studies, and include a statement
regarding GCP compliance.
• provide a brief overview of the clinical findings, including important limitations (e.g., lack
of comparisons with an especially relevant active comparator, or absence of information
on some patient populations, on pertinent endpoints, or on use in combination therapy).
• provide an evaluation of benefits and risks based upon the conclusions of the relevant
clinical studies, including interpretation of how the efficacy and safety findings support
the proposed dose and target indication and an evaluation of how prescribing information
and other approaches will optimise benefits and manage risks.
• address particular efficacy or safety issues encountered in development, and how they
have been evaluated and resolved.
• explore unresolved issues, explain why they should not be considered as barriers to
approval, and describe plans to resolve them.
• explain the basis for important or unusual aspects of the prescribing information.
The Clinical Overview should generally be a relatively short document (about 30 pages). The
length, however, will depend on the complexity of the application. The use of graphs and
concise tables in the body of the text is encouraged for brevity and to facilitate understanding.
It is not intended that material presented fully elsewhere be repeated in the Clinical Overview;
cross-referencing to more detailed presentations provided in the Clinical Summary or in
Module 5 is encouraged.`

/**
 * TaskSection25Preamble extends Task to generate only the preamble for section 2.5
 * It uses Module 5 section tags.md files to gather context for writing the preamble
 */
export class TaskSection25Preamble extends Task {
	private sectionFolderPath: string
	private expectedOutputFile: string
	private tagsPath: string
	private ichInstructions: string
	private onProgress?: (status: string) => void

	// Completion monitoring
	private completionCheckInterval?: NodeJS.Timeout
	private isCompleted: boolean = false

	constructor(params: TaskSection25PreambleParams) {
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
		this.ichInstructions = params.ichInstructions || ICH_CLINICAL_OVERVIEW_INSTRUCTIONS
		this.onProgress = params.onProgress
	}

	/**
	 * Reports progress via the callback if provided
	 */
	private reportProgress(status: string): void {
		if (this.onProgress) {
			this.onProgress(status)
		}
		console.log(`[TaskSection25Preamble] ${status}`)
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
				console.log(`[TaskSection25Preamble] Output file found, marking as complete`)
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
	 * Main entry point: Generates the preamble for section 2.5
	 */
	public async runPreambleGeneration(): Promise<TaskSection25PreambleResult> {
		try {
			this.reportProgress("Starting section 2.5 preamble generation")
			showSystemNotification({
				subtitle: "Section 2.5",
				message: "Starting preamble generation...",
			})
			this.startCompletionMonitoring()

			// Read section 2.5 tags.md to get drug name
			const section25Tags = await this.readTagsFile(this.tagsPath)
			if (!section25Tags.drugName) {
				return {
					success: false,
					error: "Could not determine drug name from section 2.5 tags.md",
				}
			}

			this.reportProgress(`Drug: ${section25Tags.drugName}`)

			// Build the user prompt
			const userPrompt = this.buildUserPrompt(section25Tags.drugName)

			// Run the task - this will use the Task's built-in execution with tools
			this.reportProgress("Generating preamble with AI agent...")
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
				this.reportProgress("Preamble generated successfully")
				showSystemNotification({
					subtitle: "Section 2.5",
					message: "✓ Preamble generated successfully!",
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
	 * Builds the user prompt for section 2.5 preamble generation
	 */
	private buildUserPrompt(drugName: string): string {
		return `Generate the preamble (introductory section) for CTD Section 2.5: Clinical Overview for ${drugName}.

## CRITICAL INSTRUCTION - READ THIS FIRST
**You MUST use the module5_tags_lookup tool EXACTLY 2-3 times maximum, then STOP and proceed to writing.**
**ONLY check LEAF sections (sections with no child sections) - these are where documents are actually placed.**
**DO NOT check parent sections that have children. DO NOT check more than 3 sections total.**

## Important: You are writing ONLY the preamble, not the entire section

The preamble should be a concise introduction that:
1. Provides a brief introduction to the drug product
2. Describes the drug's classification and mechanism of action
3. Lists the main indications
4. Provides context for the clinical data that follows

## ICH Instructions for Clinical Overview

${this.ichInstructions}

## Workflow - FOLLOW THESE STEPS EXACTLY

1. Use the \`module5_tags_lookup\` tool to gather relevant Module 5 documents:
   - **CRITICAL LIMIT**: Use this tool EXACTLY 2-3 times maximum, then STOP
   - **ONLY check LEAF sections** (sections with no children) - these are where documents are actually placed
   - **DO NOT** check parent sections like "5.3" or "5.3.1" that have children
   - **DO NOT** check more than 3 leaf sections total - you will have enough information
   - The tool returns document NAMES and summaries (from info.json) only, NOT full content
   - After 2-3 tool calls, you MUST immediately proceed to step 2 - do NOT make more tool calls

   **Available Module 5 Leaf Sections (choose 2-3 most relevant):**
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

   **Recommendation**: For a generic drug preamble, prioritize sections like **5.3.1.2** (BE studies), **5.3.3.1** or **5.3.3.2** (PK studies), and **5.3.5.1** (efficacy studies) if available.

2. Based on document names and summaries from the 2-3 sections you checked, identify key clinical information:
   - Clinical study types (e.g., bioequivalence, efficacy, safety)
   - Main indications studied
   - Key findings that support the drug's use

3. **OPTIONAL: Read specific .mmd files ONLY when there's a clear objective**

   **IMPORTANT**: You may read full .mmd file content ONLY in these specific cases:

   **When to read a .mmd file:**
   - When you need specific details about mechanism of action that aren't in the summary
   - When you need precise indication information or dosing information for the preamble
   - When you need key efficacy endpoints or safety findings that are critical for the introduction
   - When the document summary is insufficient and you need specific data points to write an accurate preamble

   **How to read .mmd files:**
   - Use the \`file_read\` tool to read .mmd files from the documents folder
   - **Use the \`mmdFilePath\` field** from module5_tags_lookup results - this is the exact path to use
   - Example: If mmdFilePath is "documents/study-101/output.mmd", use exactly that path with file_read
   - **CRITICAL**: Only read 1-2 .mmd files maximum, and ONLY if you have a specific objective
   - **DO NOT** read files just because they exist - only read if the summary is insufficient for your specific need
   - Before reading, state your objective: "I need to read [filename] to [specific reason]"

   **Examples of valid objectives:**
   - "I need to read the mmd file at documents/study-101-be/output.mmd to get the exact bioequivalence ratio"
   - "I need to read the mmd file at documents/pk-study-phase1/output.mmd to get the specific PK parameters"
   - "I need to read the mmd file at documents/efficacy-study-202/output.mmd to get the primary endpoint results"

   **Examples of invalid reasons (DO NOT read):**
   - "I'll read all documents to be thorough" ❌
   - "I want to see what's in the file" ❌
   - "The summary might not have everything" ❌

   **If summaries are sufficient, proceed directly to step 4 without reading any .mmd files.**

4. Write a VERY SHORT preamble (maximum 2 pages) that:
   - Introduces the Clinical Overview section
   - Briefly describes the drug (classification, mechanism of action)
   - Lists the main indications
   - Sets context for the detailed clinical data that follows
   - Is concise (typically 2-4 paragraphs, maximum 2 pages)
   - Uses professional regulatory language
   - References Module 5 documents by name when relevant

5. Use the \`write_tex\` tool to write the preamble to: ${this.expectedOutputFile}
   - The output should be LaTeX format
   - Include proper document structure with \\documentclass, \\begin{document}, etc.
   - The preamble content should be placed between \\begin{document} and \\end{document}

## Output Requirements

- Write ONLY the preamble, not the full Clinical Overview
- **Maximum length: 2 pages**
- Use LaTeX format
- Be concise (2-4 paragraphs typically)
- Reference Module 5 documents by name when relevant
- Follow ICH guidelines for Clinical Overview
- Use professional regulatory language
- Use document names and summaries to inform your writing
- If you read specific .mmd files, use only the relevant information needed for the preamble introduction
- Do NOT include extensive data or full study details - keep it concise and introductory`
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
				sectionId: "2.5",
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
							`[TaskSection25Preamble] Using drug name from RegulatoryProductConfig: ${currentProduct.drugName}`,
						)
					}
				} catch (error) {
					console.warn(`[TaskSection25Preamble] Failed to get drug name from RegulatoryProductConfig: ${error}`)
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
						sectionId: "2.5",
						drugName: currentProduct.drugName,
						apiName: currentProduct.drugName,
					}
				}
			} catch (error) {
				console.warn(`[TaskSection25Preamble] Failed to get drug name from RegulatoryProductConfig: ${error}`)
			}

			return {
				sectionId: "2.5",
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
