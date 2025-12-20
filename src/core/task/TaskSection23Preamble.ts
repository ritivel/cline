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
 * Parameters for creating a TaskSection23Preamble instance
 */
export interface TaskSection23PreambleParams {
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
	ichInstructions?: string // ICH instructions for writing section 2.3
	onProgress?: (status: string) => void
}

/**
 * Result of task completion
 */
export interface TaskSection23PreambleResult {
	success: boolean
	error?: string
}

/**
 * ICH Instructions for Quality Overall Summary (Section 2.3)
 */
const ICH_QOS_OVERVIEW_INSTRUCTIONS = `The Quality Overall Summary (QOS) is a summary that follows the scope and the outline of
the Body of Data in Module 3. The QOS should not include information, data or justification
that was not already included in Module 3 or in other parts of the CTD.

The QOS should include sufficient information from each section to provide the Quality
reviewer with an overview of Module 3. The QOS should also emphasise critical key
parameters of the product and provide, for instance, justification in cases where guidelines
were not followed. The QOS should include a discussion of key issues that integrates
information from sections in the Quality Module and supporting information from other
Modules (e.g. qualification of impurities via toxicological studies discussed under the CTD-S
module), including cross-referencing to volume and page number in other Modules.

This QOS normally should not exceed 40 pages of text, excluding tables and figures. For
biotech products and products manufactured using more complex processes, the document
could be longer but normally should not exceed 80 pages of text (excluding tables and
figures).

The italicised text below indicates where tables, figures, or other items can be imported
directly from Module 3.

INTRODUCTION

The introduction should include proprietary name, non-proprietary name or common name
of the drug substance, company name, dosage form(s), strength(s), route of administration,
and proposed indication(s).`

/**
 * TaskSection23Preamble extends Task to generate only the preamble for section 2.3
 * It uses Module 3 section tags.md files to gather context for writing the preamble
 */
export class TaskSection23Preamble extends Task {
	private sectionFolderPath: string
	private expectedOutputFile: string
	private tagsPath: string
	private ichInstructions: string
	private onProgress?: (status: string) => void

	// Completion monitoring
	private completionCheckInterval?: NodeJS.Timeout
	private isCompleted: boolean = false

	constructor(params: TaskSection23PreambleParams) {
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
		this.ichInstructions = params.ichInstructions || ICH_QOS_OVERVIEW_INSTRUCTIONS
		this.onProgress = params.onProgress
	}

	/**
	 * Reports progress via the callback if provided
	 */
	private reportProgress(status: string): void {
		if (this.onProgress) {
			this.onProgress(status)
		}
		console.log(`[TaskSection23Preamble] ${status}`)
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
				console.log(`[TaskSection23Preamble] Output file found, marking as complete`)
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
	 * Main entry point: Generates the preamble for section 2.3
	 */
	public async runPreambleGeneration(): Promise<TaskSection23PreambleResult> {
		try {
			this.reportProgress("Starting section 2.3 preamble generation")
			showSystemNotification({
				subtitle: "Section 2.3",
				message: "Starting QOS preamble generation...",
			})
			this.startCompletionMonitoring()

			// Read section 2.3 tags.md to get drug name
			const section23Tags = await this.readTagsFile(this.tagsPath)
			if (!section23Tags.drugName) {
				return {
					success: false,
					error: "Could not determine drug name from section 2.3 tags.md",
				}
			}

			this.reportProgress(`Drug: ${section23Tags.drugName}`)

			// Build the user prompt
			const userPrompt = this.buildUserPrompt(section23Tags.drugName)

			// Run the task - this will use the Task's built-in execution with tools
			this.reportProgress("Generating QOS preamble with AI agent...")
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
				this.reportProgress("QOS preamble generated successfully")
				showSystemNotification({
					subtitle: "Section 2.3",
					message: "✓ QOS preamble generated successfully!",
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
	 * Builds the user prompt for section 2.3 preamble generation
	 */
	private buildUserPrompt(drugName: string): string {
		return `Generate the preamble (introductory section) for CTD Section 2.3: Quality Overall Summary (QOS) for ${drugName}.

## CRITICAL INSTRUCTION - READ THIS FIRST
**You MUST use the module3_tags_lookup tool EXACTLY 3-5 times maximum, then STOP and proceed to writing.**
**ONLY check LEAF sections (sections with no child sections) - these are where documents are actually placed.**
**DO NOT check parent sections that have children. DO NOT check more than 5 sections total.**

## Important: You are writing ONLY the preamble, not the entire QOS

The preamble should be a concise introduction that:
1. States the proprietary name and non-proprietary name (INN) of the drug substance
2. Identifies the company name
3. Describes the dosage form(s) and strength(s)
4. States the route of administration
5. Lists the proposed indication(s)
6. Provides a brief overview of the quality aspects

## ICH Instructions for Quality Overall Summary

${this.ichInstructions}

## Workflow - FOLLOW THESE STEPS EXACTLY

1. Use the \`module3_tags_lookup\` tool to gather relevant Module 3 documents:
   - **CRITICAL LIMIT**: Use this tool EXACTLY 3-5 times maximum, then STOP
   - **ONLY check LEAF sections** (sections with no children) - these are where documents are actually placed
   - **DO NOT** check parent sections like "3.2.S" or "3.2.P" that have children
   - **DO NOT** check more than 5 leaf sections total - you will have enough information
   - The tool returns document NAMES and summaries (from info.json) only, NOT full content
   - After 3-5 tool calls, you MUST immediately proceed to step 2 - do NOT make more tool calls

   **Available Module 3 Leaf Sections - Drug Substance (3.2.S) (choose most relevant):**
   - **3.2.S.1.1**: Nomenclature (INN, chemical name, CAS number)
   - **3.2.S.1.2**: Structure (molecular structure, stereochemistry)
   - **3.2.S.1.3**: General Properties (physicochemical properties, solubility)
   - **3.2.S.2.1**: Manufacturer(s) (API manufacturer information)
   - **3.2.S.2.2**: Description of Manufacturing Process and Process Controls
   - **3.2.S.2.3**: Control of Materials (starting materials, reagents)
   - **3.2.S.2.4**: Controls of Critical Steps and Intermediates
   - **3.2.S.2.5**: Process Validation and/or Evaluation
   - **3.2.S.3.1**: Elucidation of Structure and Other Characteristics
   - **3.2.S.3.2**: Impurities (API impurity profile)
   - **3.2.S.4.1**: Specifications (API specifications)
   - **3.2.S.4.2**: Analytical Procedures (API test methods)
   - **3.2.S.4.3**: Validation of Analytical Procedures (API)
   - **3.2.S.4.4**: Batch Analyses (API batch data)
   - **3.2.S.4.5**: Justification of Specification (API)
   - **3.2.S.5**: Reference Standards or Materials (API)
   - **3.2.S.6**: Container Closure Systems (API packaging)
   - **3.2.S.7**: Stability (API stability data)

   **Available Module 3 Leaf Sections - Drug Product (3.2.P) (choose most relevant):**
   - **3.2.P.1**: Description and Composition of the FPP
   - **3.2.P.2.1**: Components of the FPP (excipient selection rationale)
   - **3.2.P.2.2**: Finished Pharmaceutical Product (formulation development)
   - **3.2.P.2.3**: Manufacturing Process Development
   - **3.2.P.2.4**: Container Closure System (development)
   - **3.2.P.2.5**: Microbiological Attributes
   - **3.2.P.2.6**: Compatibility
   - **3.2.P.3.1**: Manufacturer(s) (FPP manufacturer)
   - **3.2.P.3.2**: Batch Formula
   - **3.2.P.3.3**: Description of Manufacturing Process and Process Controls
   - **3.2.P.3.4**: Controls of Critical Steps and Intermediates (FPP)
   - **3.2.P.3.5**: Process Validation and/or Evaluation (FPP)
   - **3.2.P.4.1**: Specifications (excipients)
   - **3.2.P.4.5**: Excipients of Human or Animal Origin
   - **3.2.P.5.1**: Specifications (FPP release/shelf-life specifications)
   - **3.2.P.5.2**: Analytical Procedures (FPP test methods)
   - **3.2.P.5.3**: Validation of Analytical Procedures (FPP)
   - **3.2.P.5.4**: Batch Analyses (FPP batch data)
   - **3.2.P.5.5**: Characterization of Impurities (FPP degradation products)
   - **3.2.P.5.6**: Justification of Specifications (FPP)
   - **3.2.P.6**: Reference Standards or Materials (FPP)
   - **3.2.P.7**: Container Closure System (FPP packaging)
   - **3.2.P.8**: Stability (FPP stability data, shelf life)

   **Recommendation**: For a QOS preamble, prioritize:
   - **3.2.S.1.1** (Nomenclature) - for drug substance name and identification
   - **3.2.P.1** (Description and Composition) - for dosage form and strength
   - **3.2.S.4.1** or **3.2.P.5.1** (Specifications) - for key quality attributes
   - **3.2.P.3.1** (Manufacturer) - for company information

2. Based on document names and summaries from the 3-5 sections you checked, identify key quality information:
   - Drug substance name (INN, chemical name)
   - Dosage form and strength
   - Route of administration
   - Manufacturer information
   - Key quality attributes

3. **OPTIONAL: Read specific .mmd files ONLY when there's a clear objective**

   **IMPORTANT**: You may read full .mmd file content ONLY in these specific cases:

   **When to read a .mmd file:**
   - When you need the exact INN or chemical name that isn't in the summary
   - When you need precise dosage form description or strength information
   - When you need manufacturer name and address details
   - When the document summary is insufficient and you need specific data points

   **How to read .mmd files:**
   - Use the \`file_read\` tool to read .mmd files from the documents folder
   - **Use the \`mmdFilePath\` field** from module3_tags_lookup results - this is the exact path to use
   - Example: If mmdFilePath is "documents/submission/output.mmd", use exactly that path with file_read
   - **CRITICAL**: Only read 1-2 .mmd files maximum, and ONLY if you have a specific objective
   - **DO NOT** read files just because they exist - only read if the summary is insufficient
   - Before reading, state your objective: "I need to read [filename] to [specific reason]"

   **Examples of valid objectives:**
   - "I need to read the mmd file at documents/api-spec/output.mmd to get the exact INN and CAS number"
   - "I need to read the mmd file at documents/fpp-composition/output.mmd to get the precise dosage form"
   - "I need to read the mmd file at documents/manufacturer/output.mmd to get the company name and site details"

   **Examples of invalid reasons (DO NOT read):**
   - "I'll read all documents to be thorough" ❌
   - "I want to see what's in the file" ❌
   - "The summary might not have everything" ❌

   **If summaries are sufficient, proceed directly to step 4 without reading any .mmd files.**

4. Write a VERY SHORT preamble (maximum 2-3 pages) that:
   - Introduces the Quality Overall Summary section
   - States proprietary name and non-proprietary name (INN)
   - Identifies the company/manufacturer
   - Describes the dosage form(s) and strength(s)
   - States the route of administration
   - Lists the proposed indication(s)
   - Is concise (typically 2-4 paragraphs, maximum 2-3 pages)
   - Uses professional regulatory language
   - References Module 3 documents by name when relevant

5. Use the \`write_tex\` tool to write the preamble to: ${this.expectedOutputFile}
   - Output in LaTeX format following the guidelines below

## LaTeX FORMATTING GUIDELINES - CRITICAL

Follow these LaTeX formatting rules exactly to produce valid, compilable LaTeX code:

### Document Structure
\`\`\`latex
\\documentclass[12pt,a4paper]{article}

% Required packages
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{geometry}
\\usepackage{setspace}
\\usepackage{parskip}
\\usepackage{booktabs}  % For professional tables

% Page setup
\\geometry{margin=1in}
\\onehalfspacing

\\begin{document}

% Your preamble content here

\\end{document}
\`\`\`

### Special Character Escaping - CRITICAL
You MUST escape these special characters in LaTeX:

| Character | Escape As | Example |
|-----------|-----------|---------|
| % | \\% | 50\\% |
| & | \\& | Smith \\& Co. |
| $ | \\$ | \\$100 |
| # | \\# | Item \\#1 |
| _ | \\_ | drug\\_name |
| { | \\{ | \\{value\\} |
| } | \\} | \\{value\\} |
| ~ | \\textasciitilde{} | ~10 becomes \\textasciitilde{}10 |
| ^ | \\textasciicircum{} | 10^3 becomes 10\\textasciicircum{}3 |

### Drug Names and Chemical Terms
- Use \\textit{} for genus/species names: \`\\textit{Staphylococcus aureus}\`
- Use \\textsuperscript{} for superscripts: \`Ca\\textsuperscript{2+}\`
- Use \\textsubscript{} for subscripts: \`H\\textsubscript{2}O\`
- Greek letters in math mode: \`$\\alpha$\`, \`$\\beta$\`, \`$\\gamma$\`

### Quotation Marks
- Use \`\`text'' for double quotes (two backticks and two single quotes)
- Use \`text' for single quotes
- Do NOT use straight quotes " or '

### Dashes
- Hyphen: - (compound words)
- En-dash: -- (ranges: "pages 1--10", "2020--2023")
- Em-dash: --- (parenthetical breaks)

### Tables (if needed)
\`\`\`latex
\\begin{table}[htbp]
\\centering
\\caption{Table Caption}
\\begin{tabular}{lcc}
\\toprule
Header 1 & Header 2 & Header 3 \\\\
\\midrule
Data 1 & Data 2 & Data 3 \\\\
Data 4 & Data 5 & Data 6 \\\\
\\bottomrule
\\end{tabular}
\\end{table}
\`\`\`

### Common Mistakes to AVOID
1. ❌ Unescaped special characters: %, &, $, #, _, {, }
2. ❌ Straight quotes: "text" (use \`\`text'' instead)
3. ❌ Undefined commands or packages
4. ❌ Unclosed environments
5. ❌ Raw Unicode characters that cause compilation errors

## Output Requirements

- Write ONLY the preamble/introduction, not the full QOS
- **Maximum length: 2-3 pages**
- **Format**: Valid, compilable LaTeX
- Be concise (2-4 paragraphs typically)
- Include: proprietary name, INN, company name, dosage form, strength, route, indication
- Reference Module 3 documents by name when relevant
- Follow ICH guidelines for Quality Overall Summary
- Use professional regulatory language
- All special characters must be properly escaped
- Do NOT include extensive technical data or full specifications - keep it introductory

## LaTeX Validation Checklist
- [ ] Document has \\documentclass, \\begin{document}, \\end{document}
- [ ] All special characters escaped: %, &, $, #, _, {, }
- [ ] Quotation marks use LaTeX style: \`\`text''
- [ ] Superscripts/subscripts properly formatted
- [ ] All environments properly closed`
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
				sectionId: "2.3",
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
							`[TaskSection23Preamble] Using drug name from RegulatoryProductConfig: ${currentProduct.drugName}`,
						)
					}
				} catch (error) {
					console.warn(`[TaskSection23Preamble] Failed to get drug name from RegulatoryProductConfig: ${error}`)
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
						sectionId: "2.3",
						drugName: currentProduct.drugName,
						apiName: currentProduct.drugName,
					}
				}
			} catch (error) {
				console.warn(`[TaskSection23Preamble] Failed to get drug name from RegulatoryProductConfig: ${error}`)
			}

			return {
				sectionId: "2.3",
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
