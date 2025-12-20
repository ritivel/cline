/**
 * TaskSection23xy - Generalized agent for generating any CTD Section 2.3 subsection
 *
 * This agent can generate content for any subsection of CTD 2.3 (Quality Overall Summary):
 * - 2.3.S.1 through 2.3.S.7 (Drug Substance)
 * - 2.3.P.1 through 2.3.P.8 (Drug Product)
 * - 2.3.A.1 through 2.3.A.3 (Appendices)
 * - 2.3.R (Regional Information)
 *
 * It uses ICH guidelines from ich-guidelines-for-2.3.xy.ts to determine:
 * - What content to include
 * - Which Module 3 sections to reference
 * - Section-specific requirements
 */

import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { showSystemNotification } from "@integrations/notifications"
import { McpHub } from "@services/mcp/McpHub"
import { ClineSay } from "@shared/ExtensionMessage"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import * as fs from "fs"
import { Controller } from "../controller"
import { StateManager } from "../storage/StateManager"
import {
	getSectionGuidelines,
	getSectionTimeout,
	getSectionTitle,
	// isValidSectionId,
	type Section23Guidelines,
} from "./ich-guidelines-for-2.3.xy"
import { Task } from "./index"

/**
 * Parameters for creating a TaskSection23xy instance
 */
export interface TaskSection23xyParams {
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
	sectionId: string // e.g., "2.3.S.2", "2.3.P.1"
	sectionFolderPath: string
	expectedOutputFile: string
	tagsPath: string
	ichInstructionsOverride?: string // Optional override for ICH instructions
	onProgress?: (status: string) => void
}

/**
 * Result of task completion
 */
export interface TaskSection23xyResult {
	success: boolean
	error?: string
	sectionId?: string
}

/**
 * LaTeX formatting guidelines shared across all sections
 * Generates COMPLETE STANDALONE documents that compile independently
 */
const LATEX_FORMATTING_GUIDELINES = `## LaTeX FORMATTING GUIDELINES - CRITICAL

### ⚠️ MANDATORY: COMPLETE STANDALONE DOCUMENT

**Your output MUST be a complete, standalone LaTeX document that can compile independently.**

**REQUIRED STRUCTURE - FOLLOW THIS EXACTLY:**
\`\`\`latex
\\documentclass[11pt,a4paper]{article}

% ===== REQUIRED PACKAGES - INCLUDE ALL OF THESE =====
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\usepackage{setspace}
\\usepackage{parskip}
\\usepackage{booktabs}      % For professional tables (\\toprule, \\midrule, \\bottomrule)
\\usepackage{longtable}     % For tables spanning multiple pages
\\usepackage{array}         % Enhanced table formatting
\\usepackage{graphicx}      % For images if needed
\\usepackage{hyperref}      % For clickable links
\\usepackage{amsmath}       % For mathematical notation
\\usepackage{siunitx}       % For units (\\SI{500}{\\mg})
\\usepackage{enumitem}      % For customized lists
\\usepackage{fancyhdr}      % For headers/footers
\\usepackage{textcomp}      % For \\textdegree and other symbols

% ===== PAGE SETUP =====
\\geometry{margin=2.5cm}
\\onehalfspacing

% ===== HEADER/FOOTER =====
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[C]{CTD Section X.X: Title}
\\fancyfoot[C]{\\thepage}

% ===== HYPERLINK SETUP =====
\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    urlcolor=blue
}

\\begin{document}

\\section{Section Title}

% Your section content here...

\\subsection{First Subsection}
Content...

\\subsection{Second Subsection}
Content with tables, lists, etc.

\\end{document}
\`\`\`

### ❌ NEVER START WITH JUST \\section{} - ALWAYS INCLUDE FULL PREAMBLE!

### Special Character Escaping - CRITICAL
You MUST escape these special characters in LaTeX:

| Character | Escape As | Example |
|-----------|-----------|---------|
| % | \\% | 50\\% purity |
| & | \\& | Smith \\& Co. |
| $ | \\$ | \\$100 |
| # | \\# | Batch \\#1 |
| _ | \\_ | process\\_step |
| { | \\{ | \\{range\\} |
| } | \\} | \\{range\\} |
| ~ | \\textasciitilde{} | approximately\\textasciitilde{}10 |
| ^ | \\textasciicircum{} | 10\\textasciicircum{}3 |

### Tables for Information
\`\`\`latex
\\begin{table}[htbp]
\\centering
\\caption{Table Caption}
\\begin{tabular}{p{4cm}p{8cm}}
\\toprule
\\textbf{Attribute} & \\textbf{Details} \\\\
\\midrule
Item 1 & Description 1 \\\\
Item 2 & Description 2 \\\\
\\bottomrule
\\end{tabular}
\\end{table}
\`\`\`

### Chemical and Scientific Notation
- Temperatures: \`20\\textdegree{}C\` or \`20~\\textdegree{}C\`
- Percentages: Always escape: \`50\\%\`
- Ranges: Use en-dash: \`20--25\\textdegree{}C\`
- Less than/equal: \`$\\leq$\` or \`$<$\`
- Greater than/equal: \`$\\geq$\` or \`$>$\`
- Plus/minus: \`$\\pm$\` for ±
- Greek letters: \`$\\alpha$\`, \`$\\beta$\`, \`$\\mu$\` (in math mode)
- Superscripts: \`\\textsuperscript{2}\` or \`$^{2}$\`
- Subscripts: \`\\textsubscript{2}\` or \`$_{2}$\`
- Units: Use siunitx: \`\\SI{500}{\\mg}\`, \`\\SI{25}{\\celsius}\`

### Quotation Marks
- Use \`\`text'' for double quotes
- Use \`text' for single quotes
- Do NOT use straight quotes " or '

### Lists
\`\`\`latex
\\begin{itemize}
    \\item First item
    \\item Second item
\\end{itemize}

\\begin{enumerate}
    \\item First numbered item
    \\item Second numbered item
\\end{enumerate}
\`\`\`

### Cross-References
\`\`\`latex
As detailed in Section X.X.X, the...
The diagram (see Section~X.X.X) illustrates...
\`\`\`

### Common Mistakes to AVOID
1. ❌ Starting with \\section{} without document preamble
2. ❌ Missing \\documentclass, \\begin{document}, or \\end{document}
3. ❌ Unescaped special characters: %, &, $, #, _, {, }
4. ❌ Straight quotes: "text" (use \`\`text'' instead)
5. ❌ Degree symbol: ° (use \\textdegree{} instead)
6. ❌ Unclosed environments (tables, itemize, etc.)
7. ❌ Missing \\\\  at end of table rows

### LaTeX Validation Checklist
- [ ] Document STARTS with \\documentclass[11pt,a4paper]{article}
- [ ] All required \\usepackage commands included
- [ ] Has \\begin{document} after packages
- [ ] Has \\end{document} at the very end
- [ ] All special characters escaped: %, &, $, #, _, {, }
- [ ] Quotation marks use LaTeX style: \`\`text''
- [ ] Tables have proper structure with \\\\  at row ends
- [ ] All \\begin{} have matching \\end{}`

/**
 * TaskSection23xy extends Task to generate any CTD Section 2.3 subsection content
 * It uses ICH guidelines from ich-guidelines-for-2.3.xy.ts
 */
export class TaskSection23xy extends Task {
	private sectionId: string
	private sectionFolderPath: string
	private expectedOutputFile: string
	private tagsPath: string
	private sectionGuidelines: Section23Guidelines
	private ichInstructionsOverride?: string
	private onProgress?: (status: string) => void

	// Completion monitoring
	private completionCheckInterval?: NodeJS.Timeout
	private isCompleted: boolean = false
	private apiCallCount: number = 0

	constructor(params: TaskSection23xyParams) {
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

		this.sectionId = params.sectionId
		this.sectionFolderPath = params.sectionFolderPath
		this.expectedOutputFile = params.expectedOutputFile
		this.tagsPath = params.tagsPath
		this.ichInstructionsOverride = params.ichInstructionsOverride
		this.onProgress = params.onProgress

		// Get guidelines for this section
		const guidelines = getSectionGuidelines(params.sectionId)
		if (!guidelines) {
			throw new Error(
				`Unknown section ID: ${params.sectionId}. Valid sections are 2.3.S.1-S.7, 2.3.P.1-P.8, 2.3.A.1-A.3, 2.3.R`,
			)
		}
		this.sectionGuidelines = guidelines
	}

	/**
	 * Reports progress via the callback if provided
	 */
	private reportProgress(status: string): void {
		if (this.onProgress) {
			this.onProgress(status)
		}
		console.log(`[TaskSection23xy:${this.sectionId}] ${status}`)
	}

	/**
	 * Logs and optionally notifies the key paths for this section
	 */
	private logPathInfo(stage: string): void {
		const msg = `${stage} | sectionFolderPath=${this.sectionFolderPath} | expectedOutputFile=${this.expectedOutputFile} | tagsPath=${this.tagsPath}`
		console.log(`[TaskSection23xy:${this.sectionId}] ${msg}`)
		showSystemNotification({
			subtitle: `Section ${this.sectionId}`,
			message: `${stage}: ${this.expectedOutputFile}`,
		})
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

		console.log(`[TaskSection23xy:${this.sectionId}] Starting completion monitoring for: ${this.expectedOutputFile}`)

		this.completionCheckInterval = setInterval(async () => {
			if (this.isCompleted) {
				this.stopCompletionMonitoring()
				return
			}

			const fileExists = await this.checkFileExists()
			if (fileExists && !this.isCompleted) {
				console.log(`[TaskSection23xy:${this.sectionId}] Output file found at: ${this.expectedOutputFile}`)
				this.isCompleted = true
				this.stopCompletionMonitoring()
				this.reportProgress("Completed - content.tex written")
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
	 * Main entry point: Generates the section content
	 */
	public async runSectionGeneration(): Promise<TaskSection23xyResult> {
		const generationStartTime = Date.now()
		console.log(`[TaskSection23xy:${this.sectionId}] ========== GENERATION STARTED ==========`)

		try {
			const sectionTitle = getSectionTitle(this.sectionId)
			this.reportProgress(`Starting section ${this.sectionId} (${sectionTitle}) generation`)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Starting ${sectionTitle} section generation...`,
			})
			this.logPathInfo("Paths initialized")
			this.startCompletionMonitoring()

			// Read section tags.md to get drug name
			const sectionTags = await this.readTagsFile(this.tagsPath)
			if (!sectionTags.drugName) {
				const error = `Could not determine drug name from section ${this.sectionId} tags.md`
				console.error(`[TaskSection23xy:${this.sectionId}] ${error}`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId} - Error`,
					message: error,
				})
				return {
					success: false,
					error,
					sectionId: this.sectionId,
				}
			}

			this.reportProgress(`Drug: ${sectionTags.drugName}`)
			console.log(`[TaskSection23xy:${this.sectionId}] Drug name: ${sectionTags.drugName}`)

			// Build the user prompt
			const userPrompt = this.buildUserPrompt(sectionTags.drugName)

			// Log prompt size for debugging context issues
			const promptSize = userPrompt.length
			console.log(
				`[TaskSection23xy:${this.sectionId}] Initial prompt size: ${promptSize} chars (~${Math.round(promptSize / 4)} tokens)`,
			)
			if (promptSize > 50000) {
				console.warn(`[TaskSection23xy:${this.sectionId}] ⚠️ Large prompt detected: ${promptSize} chars`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId} - Warning`,
					message: `Large prompt: ${Math.round(promptSize / 1000)}k chars. May cause timeouts.`,
				})
			}

			// Run the task - this will use the Task's built-in execution with tools
			this.reportProgress(`Generating section ${this.sectionId} content with AI agent...`)
			console.log(`[TaskSection23xy:${this.sectionId}] Starting task execution...`)

			try {
				await this.startTask(userPrompt)
			} catch (taskError) {
				const taskErrorMsg = taskError instanceof Error ? taskError.message : String(taskError)
				console.error(`[TaskSection23xy:${this.sectionId}] startTask ERROR: ${taskErrorMsg}`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId} - Task Error`,
					message: taskErrorMsg.substring(0, 100),
				})
				throw taskError
			}

			// Wait for completion (with timeout)
			const maxWaitTime = getSectionTimeout(this.sectionId)
			const startTime = Date.now()
			let lastProgressLog = startTime

			console.log(`[TaskSection23xy:${this.sectionId}] Waiting for completion (timeout: ${maxWaitTime / 1000}s)...`)

			while (!this.isCompleted && Date.now() - startTime < maxWaitTime) {
				await new Promise((resolve) => setTimeout(resolve, 2000))

				// Log progress every 30 seconds
				const now = Date.now()
				if (now - lastProgressLog >= 30000) {
					const elapsed = Math.round((now - startTime) / 1000)
					const remaining = Math.round((maxWaitTime - (now - startTime)) / 1000)
					console.log(
						`[TaskSection23xy:${this.sectionId}] Still waiting... ${elapsed}s elapsed, ${remaining}s remaining, API calls: ${this.apiCallCount}`,
					)
					lastProgressLog = now
				}
			}

			const totalDuration = Math.round((Date.now() - generationStartTime) / 1000)

			// Check if output file was created
			if (await this.checkFileExists()) {
				this.isCompleted = true
				this.stopCompletionMonitoring()
				this.stopApiRequestTimeoutChecker()
				const successMsg = `Section ${this.sectionId} generated in ${totalDuration}s with ${this.apiCallCount} API calls`
				console.log(`[TaskSection23xy:${this.sectionId}] ✓ ${successMsg}`)
				this.reportProgress(`✓ ${successMsg}`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId}`,
					message: `✓ ${sectionTitle} completed in ${totalDuration}s!`,
				})
				return { success: true, sectionId: this.sectionId }
			} else {
				this.stopCompletionMonitoring()
				this.stopApiRequestTimeoutChecker()
				const timeoutMsg = `Output file not created after ${totalDuration}s (${this.apiCallCount} API calls). Possible context overflow or timeout.`
				console.error(`[TaskSection23xy:${this.sectionId}] ✗ TIMEOUT: ${timeoutMsg}`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId} - Timeout`,
					message: `Failed after ${totalDuration}s. Context may be too large.`,
				})
				return {
					success: false,
					error: timeoutMsg,
					sectionId: this.sectionId,
				}
			}
		} catch (error) {
			this.stopCompletionMonitoring()
			this.stopApiRequestTimeoutChecker()
			const totalDuration = Math.round((Date.now() - generationStartTime) / 1000)
			const errorMsg = error instanceof Error ? error.message : String(error)

			console.error(`[TaskSection23xy:${this.sectionId}] ✗ EXCEPTION after ${totalDuration}s: ${errorMsg}`)
			console.error(`[TaskSection23xy:${this.sectionId}] Stack:`, error instanceof Error ? error.stack : "No stack")

			showSystemNotification({
				subtitle: `Section ${this.sectionId} - Exception`,
				message: `Error after ${totalDuration}s: ${errorMsg.substring(0, 80)}`,
			})

			this.reportProgress(`❌ Error: ${errorMsg}`)
			return {
				success: false,
				error: `${errorMsg} (after ${totalDuration}s, ${this.apiCallCount} API calls)`,
				sectionId: this.sectionId,
			}
		} finally {
			console.log(`[TaskSection23xy:${this.sectionId}] ========== GENERATION ENDED ==========`)
		}
	}

	/**
	 * Builds the user prompt for section generation
	 */
	private buildUserPrompt(drugName: string): string {
		const { sectionId, title, referenceModule3Pattern, ichInstructions, contentRequirements } = this.sectionGuidelines
		const effectiveIchInstructions = this.ichInstructionsOverride || ichInstructions

		// Build content requirements list for Step 2
		const contentRequirementsList = contentRequirements.map((req, idx) => `   ${idx + 1}. ${req}`).join("\n")

		return `Generate the complete CTD Section ${sectionId}: ${title} for ${drugName}.

## CRITICAL INSTRUCTION - READ THIS FIRST
**You MUST use the module3_tags_lookup tool to query the relevant Module 3 sections.**
**Focus on ${referenceModule3Pattern}.x leaf sections - these contain the source data.**
**Use the tool 4-8 times maximum to gather all necessary information, then proceed to writing.**

## Section Requirements

This section should provide a **comprehensive SUMMARY** of the information from Module ${referenceModule3Pattern}.

**KEY EXPECTATION:** This is a Quality Overall SUMMARY - it must contain **actual technical content** summarizing the source documents, NOT just references to where information can be found. Each subsection should:
1. Present key information, data, methods, or results
2. Then reference Module 3 sections for complete details

## ICH Instructions for Section ${sectionId}

${effectiveIchInstructions}

## Workflow - FOLLOW THESE STEPS EXACTLY

### Step 1: Gather Module 3 Documents

Use the \`module3_tags_lookup\` tool to gather relevant Module 3 documents:
- **Use this tool upto maximum 4-5 times** to query all relevant sections based on the ICH guidelines above
- **Primary sections to query**: ${referenceModule3Pattern}.x (e.g., ${referenceModule3Pattern}.1, ${referenceModule3Pattern}.2, etc.)
- **ONLY check LEAF sections** (sections with no children) - these are where documents are actually placed
- The tool returns document NAMES and summaries (from info.json) only, NOT full content
- After querying all necessary sections, proceed to step 2

**Guidance for selecting sections:**
Based on the ICH instructions above, identify which Module 3 subsections contain the data you need.
The primary reference pattern is "${referenceModule3Pattern}" - query its leaf subsections.
You may also query related sections if the ICH instructions reference them (e.g., other S.x or P.x sections).
DO NOT query for more than 4-5 times, so choose the sections wisely.

### Step 2: Analyze and Identify Information

Based on document names and summaries from the sections you checked, identify:
${contentRequirementsList}

Review what information is available and what is needed for comprehensive coverage.

### Step 3: Optional - Read Detailed Documents

**OPTIONAL: Read specific .mmd files when detailed information is needed**

**IMPORTANT**: You may read full .mmd file content when:
- The document summary is insufficient for writing comprehensive content
- You need exact details (names, addresses, specifications, values)
- You need specific data points that aren't in the summary
- You need to accurately describe processes, methods, or results
- DO NOT read more than 2-3 files, so choose the files wisely.

**How to read .mmd files:**
- Use the \`file_read\` tool to read .mmd files from the documents folder
- **Use the \`mmdFilePath\` field** from module3_tags_lookup results - this is the exact path to use
- Example: If mmdFilePath is "documents/submission/output.mmd", use exactly that path with file_read
- Read files as needed to gather comprehensive information
- DO NOT read any PDF files, only .mmd files.
- Before reading, state your objective: "I need to read [filename] to [specific reason]"

**Examples of valid objectives:**
- "I need to read the mmd file at documents/submission/output.mmd to get the exact specifications"
- "I need to read the mmd file to understand the detailed process"

### Step 4: Write the Section Content

Write the complete section ${sectionId} content following the ICH structure. Use a 'section' header for the section title.

**Content Requirements:**
${contentRequirementsList}

**⚠️ CRITICAL WRITING STYLE - READ THIS CAREFULLY:**

Each subsection MUST contain **ACTUAL INFORMATION**, not just references! Follow this pattern:

1. **First**: State the key information, findings, data, or summary from the source documents
2. **Then**: Reference Module 3 for detailed information

**❌ WRONG (too brief, just a reference):**
> "The manufacturing process is described in Section 3.2.S.2.2."

**✅ CORRECT (substantive content + reference):**
> "The drug substance is manufactured using a multi-step synthetic process involving [X] key stages: [stage 1], [stage 2], and [stage 3]. The process employs [specific technique/method] with critical controls at [specific points]. Process validation has demonstrated consistent quality with yields of [X-Y]%. Detailed manufacturing process information and flow diagrams are provided in Section 3.2.S.2.2."

**Writing Guidelines:**
- **Include substantive technical content** - summarize actual data, values, methods, results
- Follow the ICH instructions exactly
- Use appropriate subsections (\\subsection{}) for organization
- Include tables where the ICH instructions specify tabulated presentation (with actual data!)
- **After presenting the information**, reference Module 3 for more details (e.g., "For complete details, see Section ${referenceModule3Pattern}.x")
- DO NOT refer to file names explicitly - only use section numbers
- Use professional regulatory language
- Be comprehensive - this is a SUMMARY document, not just a table of contents

### Step 5: Output the LaTeX File

Use ONLY the \`write_tex\` tool to write the section content to: ${this.expectedOutputFile}

**⚠️ CRITICAL: Your output MUST be a COMPLETE STANDALONE LaTeX document!**

${LATEX_FORMATTING_GUIDELINES}

## Output Requirements - READ CAREFULLY

### ⚠️ MANDATORY DOCUMENT STRUCTURE:

Your LaTeX file MUST:
1. **START with \\documentclass[11pt,a4paper]{article}** - NOT with \\section{}!
2. **Include ALL required \\usepackage commands** (inputenc, fontenc, babel, geometry, booktabs, longtable, hyperref, etc.)
3. **Include \\begin{document}** before any content
4. **Include \\end{document}** at the very end

### Content Requirements:
- Write the COMPLETE section ${sectionId}, not just an introduction
- Use \\section{${title}} for the main section title
- Use \\subsection{} for sub-organization
- Follow the ICH guidelines for section organization exactly
- **Include ACTUAL technical content** - values, data, methods, results, specifications
- Include tables for structured information (with real data, properly formatted)
- Reference Module 3 for detailed information AFTER presenting the summary
- Use professional regulatory language
- All special characters must be properly escaped
- Ensure comprehensive coverage of all ICH requirements

### ❌ DO NOT:
- Start directly with \\section{} without the preamble
- Omit \\documentclass, \\usepackage, \\begin{document}, or \\end{document}
- Generate partial/incomplete LaTeX that cannot compile standalone
- Write sections that are ONLY references without substantive content
- Just say "see Section X.X.X" without providing summary information first`
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
				sectionId: this.sectionId,
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
							`[TaskSection23xy:${this.sectionId}] Using drug name from RegulatoryProductConfig: ${currentProduct.drugName}`,
						)
					}
				} catch (error) {
					console.warn(
						`[TaskSection23xy:${this.sectionId}] Failed to get drug name from RegulatoryProductConfig: ${error}`,
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
						sectionId: this.sectionId,
						drugName: currentProduct.drugName,
						apiName: currentProduct.drugName,
					}
				}
			} catch (error) {
				console.warn(`[TaskSection23xy:${this.sectionId}] Failed to get drug name from RegulatoryProductConfig: ${error}`)
			}

			return {
				sectionId: this.sectionId,
				drugName: "",
				apiName: "",
			}
		}
	}

	// Track API request timing for debugging
	private apiRequestStartTime?: number
	private apiRequestTimeoutChecker?: NodeJS.Timeout
	private static readonly API_REQUEST_HARD_TIMEOUT_SECONDS = 300 // 5 minutes hard timeout

	/**
	 * Starts a timeout checker for API requests to detect and kill stuck requests
	 */
	private startApiRequestTimeoutChecker(): void {
		this.stopApiRequestTimeoutChecker()
		this.apiRequestStartTime = Date.now()

		// Check every 15 seconds if the request is taking too long
		this.apiRequestTimeoutChecker = setInterval(async () => {
			if (this.apiRequestStartTime) {
				const elapsed = Math.round((Date.now() - this.apiRequestStartTime) / 1000)
				const message = `API request #${this.apiCallCount} running for ${elapsed}s...`
				console.warn(`[TaskSection23xy:${this.sectionId}] ${message}`)

				// Show warning notification after 60 seconds
				if (elapsed >= 60 && elapsed % 60 === 0 && elapsed < TaskSection23xy.API_REQUEST_HARD_TIMEOUT_SECONDS) {
					showSystemNotification({
						subtitle: `Section ${this.sectionId} - Warning`,
						message: `Request taking ${elapsed}s. May be stuck due to large context.`,
					})
					this.reportProgress(`⚠️ Request #${this.apiCallCount} taking ${elapsed}s (possible timeout)`)
				}

				// After 3 minutes, warn user about impending abort
				if (elapsed >= 180 && elapsed < TaskSection23xy.API_REQUEST_HARD_TIMEOUT_SECONDS && elapsed % 60 === 0) {
					const remaining = TaskSection23xy.API_REQUEST_HARD_TIMEOUT_SECONDS - elapsed
					showSystemNotification({
						subtitle: `Section ${this.sectionId} - Alert`,
						message: `Request stuck for ${elapsed}s. Will auto-abort in ${remaining}s.`,
					})
					this.reportProgress(`⚠️ Request #${this.apiCallCount} stuck for ${elapsed}s - auto-abort in ${remaining}s`)
				}

				// HARD TIMEOUT: Automatically abort after 300 seconds (5 minutes)
				if (elapsed >= TaskSection23xy.API_REQUEST_HARD_TIMEOUT_SECONDS) {
					console.error(
						`[TaskSection23xy:${this.sectionId}] ❌ HARD TIMEOUT: Request #${this.apiCallCount} exceeded ${TaskSection23xy.API_REQUEST_HARD_TIMEOUT_SECONDS}s - ABORTING`,
					)
					showSystemNotification({
						subtitle: `Section ${this.sectionId} - TIMEOUT`,
						message: `Request killed after ${elapsed}s. Context likely too large.`,
					})
					this.reportProgress(`❌ TIMEOUT: Request #${this.apiCallCount} killed after ${elapsed}s`)

					// Stop the checker first to prevent multiple aborts
					this.stopApiRequestTimeoutChecker()

					// Abort the task
					try {
						await this.abortTask()
					} catch (abortError) {
						console.error(`[TaskSection23xy:${this.sectionId}] Error aborting task:`, abortError)
					}
				}
			}
		}, 15000) // Check every 15 seconds for more responsive timeout detection
	}

	/**
	 * Stops the API request timeout checker
	 */
	private stopApiRequestTimeoutChecker(): void {
		if (this.apiRequestTimeoutChecker) {
			clearInterval(this.apiRequestTimeoutChecker)
			this.apiRequestTimeoutChecker = undefined
		}
		this.apiRequestStartTime = undefined
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
				// Extract tool name from text for better progress reporting
				if (text) {
					if (text.includes("module3_tags_lookup")) {
						this.reportProgress("Looking up Module 3 documents...")
					} else if (text.includes("write_tex")) {
						this.reportProgress("Writing LaTeX content...")
						this.logPathInfo("write_tex invoked")
					} else if (text.includes("read_file") || text.includes("file_read")) {
						this.reportProgress("Reading document content...")
					} else {
						this.reportProgress(`Using tool: ${text.substring(0, 40)}...`)
					}
				} else {
					this.reportProgress("Using tool...")
				}
				break
			case "error":
				// Log full error and show notification
				console.error(`[TaskSection23xy:${this.sectionId}] ERROR: ${text}`)
				showSystemNotification({
					subtitle: `Section ${this.sectionId} - Error`,
					message: text?.substring(0, 100) || "Unknown error occurred",
				})
				this.reportProgress(`❌ Error: ${text?.substring(0, 80) || "Unknown error"}`)
				this.stopApiRequestTimeoutChecker()
				break
			case "api_req_started":
				this.apiCallCount++
				this.startApiRequestTimeoutChecker()
				console.log(
					`[TaskSection23xy:${this.sectionId}] API request #${this.apiCallCount} STARTED at ${new Date().toISOString()}`,
				)
				this.reportProgress(`Making API request #${this.apiCallCount}...`)
				break
			case "api_req_finished":
				this.stopApiRequestTimeoutChecker()
				const duration = this.apiRequestStartTime ? Math.round((Date.now() - this.apiRequestStartTime) / 1000) : 0
				console.log(`[TaskSection23xy:${this.sectionId}] API request #${this.apiCallCount} FINISHED after ${duration}s`)
				this.reportProgress(`✓ Response #${this.apiCallCount} received (${duration}s)`)
				break
			case "error_retry":
				// Parse retry info from text
				try {
					const retryInfo = text ? JSON.parse(text) : {}
					const retryMsg = retryInfo.failed
						? `❌ All retries exhausted for request #${this.apiCallCount}`
						: `⚠️ Retry ${retryInfo.attempt}/${retryInfo.maxAttempts} in ${retryInfo.delaySeconds}s`
					console.warn(`[TaskSection23xy:${this.sectionId}] ${retryMsg}`)
					showSystemNotification({
						subtitle: `Section ${this.sectionId} - Retry`,
						message: retryMsg,
					})
					this.reportProgress(retryMsg)
				} catch {
					this.reportProgress(`⚠️ Retrying request #${this.apiCallCount}...`)
				}
				break
			case "completion_result":
				this.stopApiRequestTimeoutChecker()
				this.reportProgress("Task completing...")
				break
			case "text":
				// Show abbreviated AI response - indicates streaming is working
				if (text && text.length > 0) {
					// Only update periodically to avoid spam
					if (!partial || text.length % 500 === 0) {
						this.reportProgress(`AI generating content... (${text.length} chars)`)
					}
				}
				break
			case "reasoning":
				// Model is thinking - streaming is working
				this.reportProgress("AI reasoning...")
				break
		}

		return super.say(type, text, images, files, partial)
	}

	/**
	 * Override abortTask to stop completion monitoring and cleanup
	 */
	override async abortTask(): Promise<void> {
		this.stopCompletionMonitoring()
		this.stopApiRequestTimeoutChecker()

		if (!this.isCompleted) {
			console.log(`[TaskSection23xy:${this.sectionId}] Task ABORTED at API call #${this.apiCallCount}`)
			showSystemNotification({
				subtitle: `Section ${this.sectionId}`,
				message: `Task aborted after ${this.apiCallCount} API calls`,
			})
			this.reportProgress("Aborted")
		}

		await super.abortTask()
	}
}

// Re-export helpers for convenience
export { getSectionGuidelines, getSectionTimeout, getSectionTitle, isValidSectionId } from "./ich-guidelines-for-2.3.xy"
