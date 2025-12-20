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
 * Parameters for creating a TaskSection23S2 instance
 */
export interface TaskSection23S2Params {
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
	ichInstructions?: string // ICH instructions for writing section 2.3.S.2
	onProgress?: (status: string) => void
}

/**
 * Result of task completion
 */
export interface TaskSection23S2Result {
	success: boolean
	error?: string
}

/**
 * ICH Instructions for Section 2.3.S.2 Manufacture
 */
const ICH_SECTION_23S2_INSTRUCTIONS = `2.3.S.2 Manufacture (name, manufacturer)

Information from 3.2.S.2 should be included:

Information on the manufacturer;

A brief description of the manufacturing process (including, for example, reference to
starting materials, critical steps, and reprocessing) and the controls that are intended to
result in the routine and consistent production of material(s) of appropriate quality;

A flow diagram, as provided in 3.2.S.2.2;

A description of the Source and Starting Material and raw materials of biological origin
used in the manufacture of the drug substance, as described in 3.2.S.2.3;

A discussion of the selection and justification of critical manufacturing steps, process
controls, and acceptance criteria. Highlight critical process intermediates, as described
in 3.2.S.2.4;

A description of process validation and/or evaluation, as described in 3.2.S.2.5.

A brief summary of major manufacturing changes made throughout development and
conclusions from the assessment used to evaluate product consistency, as described in
3.2.S.2.6. The QOS should also cross-refer to the non-clinical and clinical studies that
used batches affected by these manufacturing changes, as provided in the CTD-S and
CTD-E modules of the dossier.`

/**
 * TaskSection23S2 extends Task to generate the full section 2.3.S.2 (Manufacture) content
 * It uses Module 3 section 3.2.S.2.x tags.md files to gather context for writing the section
 */
export class TaskSection23S2 extends Task {
	private sectionFolderPath: string
	private expectedOutputFile: string
	private tagsPath: string
	private ichInstructions: string
	private onProgress?: (status: string) => void

	// Completion monitoring
	private completionCheckInterval?: NodeJS.Timeout
	private isCompleted: boolean = false
	private apiCallCount: number = 0

	constructor(params: TaskSection23S2Params) {
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
		this.ichInstructions = params.ichInstructions || ICH_SECTION_23S2_INSTRUCTIONS
		this.onProgress = params.onProgress
	}

	/**
	 * Reports progress via the callback if provided
	 */
	private reportProgress(status: string): void {
		if (this.onProgress) {
			this.onProgress(status)
		}
		console.log(`[TaskSection23S2] ${status}`)
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

		console.log(`[TaskSection23S2] Starting completion monitoring for: ${this.expectedOutputFile}`)

		this.completionCheckInterval = setInterval(async () => {
			if (this.isCompleted) {
				this.stopCompletionMonitoring()
				return
			}

			const fileExists = await this.checkFileExists()
			if (fileExists && !this.isCompleted) {
				console.log(`[TaskSection23S2] Output file found at: ${this.expectedOutputFile}`)
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
	 * Main entry point: Generates the full section 2.3.S.2 content
	 */
	public async runSectionGeneration(): Promise<TaskSection23S2Result> {
		try {
			this.reportProgress("Starting section 2.3.S.2 (Manufacture) generation")
			showSystemNotification({
				subtitle: "Section 2.3.S.2",
				message: "Starting Manufacture section generation...",
			})
			this.startCompletionMonitoring()

			// Read section tags.md to get drug name
			const sectionTags = await this.readTagsFile(this.tagsPath)
			if (!sectionTags.drugName) {
				return {
					success: false,
					error: "Could not determine drug name from section 2.3.S.2 tags.md",
				}
			}

			this.reportProgress(`Drug: ${sectionTags.drugName}`)

			// Build the user prompt
			const userPrompt = this.buildUserPrompt(sectionTags.drugName)

			// Run the task - this will use the Task's built-in execution with tools
			this.reportProgress("Generating section 2.3.S.2 content with AI agent...")
			await this.startTask(userPrompt)

			// Wait for completion (with timeout)
			const maxWaitTime = 600000 // 10 minutes for full section
			const startTime = Date.now()
			while (!this.isCompleted && Date.now() - startTime < maxWaitTime) {
				await new Promise((resolve) => setTimeout(resolve, 2000))
			}

			// Check if output file was created
			if (await this.checkFileExists()) {
				this.isCompleted = true
				this.stopCompletionMonitoring()
				this.reportProgress("Section 2.3.S.2 generated successfully")
				showSystemNotification({
					subtitle: "Section 2.3.S.2",
					message: "✓ Manufacture section generated successfully!",
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
	 * Builds the user prompt for section 2.3.S.2 generation
	 */
	private buildUserPrompt(drugName: string): string {
		return `Generate the complete CTD Section 2.3.S.2: Manufacture for ${drugName}.

## CRITICAL INSTRUCTION - READ THIS FIRST
**You MUST use the module3_tags_lookup tool to query the relevant Module 3 sections.**
**Focus on 3.2.S.2.x leaf sections (3.2.S.2.1 through 3.2.S.2.6) - these contain the manufacturing data.**
**Use the tool 5-6 times maximum to gather all necessary information, then proceed to writing.**

## Section Requirements

This section should provide a comprehensive summary of the drug substance manufacturing information from Module 3.2.S.2.

## ICH Instructions for Section 2.3.S.2

${this.ichInstructions}

## Workflow - FOLLOW THESE STEPS EXACTLY

1. Use the \`module3_tags_lookup\` tool to gather relevant Module 3 documents:
   - **Use this tool 5-8 times** to query all relevant manufacturing sections
   - **ONLY check LEAF sections** (sections with no children) - these are where documents are actually placed
   - The tool returns document NAMES and summaries (from info.json) only, NOT full content
   - After querying all necessary sections, proceed to step 2

   **Required Module 3 Sections to Query (in order of priority):**
   - **3.2.S.2.1**: Manufacturer(s) - Name, physical address, responsibilities
   - **3.2.S.2.2**: Description of Manufacturing Process and Process Controls - Process flow diagram, process description
   - **3.2.S.2.3**: Control of Materials - Source and starting materials, raw materials of biological origin
   - **3.2.S.2.4**: Controls of Critical Steps and Intermediates - Critical process parameters, intermediate specifications
   - **3.2.S.2.5**: Process Validation and/or Evaluation - Validation studies, process capability
   - **3.2.S.2.6**: Manufacturing Process Development (if available) - Development history, manufacturing changes

   **Optional Additional Sections (if relevant):**
   - **3.2.S.1.1**: Nomenclature - for drug substance identification
   - **3.2.S.3.2**: Impurities - if manufacturing-related impurities need discussion

2. Based on document names and summaries from the sections you checked, identify:
   - Manufacturer information (name, address, responsibilities)
   - Manufacturing process description and controls
   - Flow diagram details
   - Source and starting materials (including raw materials of biological origin)
   - Critical steps, process controls, acceptance criteria, and critical process intermediates
   - Process validation and/or evaluation information
   - Manufacturing changes and product consistency assessment

3. **OPTIONAL: Read specific .mmd files when detailed information is needed**

   **IMPORTANT**: You may read full .mmd file content when:
   - You need exact manufacturer details (name, address, site functions)
   - You need specific process step descriptions for the flow diagram reference
   - You need detailed starting material specifications or biological origin information
   - You need specific critical step parameters and acceptance criteria
   - You need process validation data or conclusions
   - The document summary is insufficient for writing comprehensive content

   **How to read .mmd files:**
   - Use the \`file_read\` tool to read .mmd files from the documents folder
   - **Use the \`mmdFilePath\` field** from module3_tags_lookup results - this is the exact path to use
   - Example: If mmdFilePath is "documents/manufacturer-info/output.mmd", use exactly that path with file_read
   - Read files as needed to gather comprehensive information
   - Before reading, state your objective: "I need to read [filename] to [specific reason]"

   **Examples of valid objectives:**
   - "I need to read the mmd file at documents/manufacturer-info/output.mmd to get the exact manufacturer name"
   - "I need to read the mmd file at documents/manufacturing-process/output.mmd for critical manufacturing steps"
   - "I need to read the mmd file at documents/starting-materials/output.mmd for source and specifications"
   - "I need to read the mmd file at documents/process-validation/output.mmd to summarize the validation approach"

4. Write the complete section 2.3.S.2 content following the ICH structure:

   **a) Manufacturer Information:**
   - Information on the manufacturer(s)
   - Name and physical address
   - Responsibilities (e.g., synthesis, purification, packaging)

   **b) Manufacturing Process Description:**
   - A brief description of the manufacturing process including:
     - Reference to starting materials
     - Critical steps in the manufacturing process
     - Reprocessing procedures (if applicable)
   - Controls that are intended to result in the routine and consistent production of material(s) of appropriate quality

   **c) Flow Diagram:**
   - A flow diagram as provided in Section 3.2.S.2.2
   - Brief description of major process steps shown in the diagram

   **d) Source and Starting Material:**
   - A description of the source and starting material as described in Section 3.2.S.2.3
   - Raw materials of biological origin used in the manufacture of the drug substance (if applicable)

   **e) Critical Steps and Intermediates:**
   - A discussion of the selection and justification of critical manufacturing steps
   - Process controls and acceptance criteria
   - **Highlight critical process intermediates** as described in Section 3.2.S.2.4

   **f) Process Validation and/or Evaluation:**
   - A description of process validation and/or evaluation as described in Section 3.2.S.2.5
   - Key validation results and conclusions

   **g) Manufacturing Changes:**
   - A brief summary of major manufacturing changes made throughout development
   - Conclusions from the assessment used to evaluate product consistency, as described in Section 3.2.S.2.6
   - **Cross-reference to the non-clinical and clinical studies that used batches affected by these manufacturing changes, as provided in the CTD-S and CTD-E modules of the dossier**

5. Use the \`write_tex\` tool to write the section content to: ${this.expectedOutputFile}
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
\\usepackage{booktabs}   % For professional tables
\\usepackage{longtable}  % For tables spanning multiple pages
\\usepackage{array}      % Enhanced table formatting

% Page setup
\\geometry{margin=1in}
\\onehalfspacing

\\begin{document}

\\section{2.3.S.2 Manufacture}

% Your content here with subsections

\\end{document}
\`\`\`

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

### Section and Subsection Commands
For Section 2.3.S.2, use proper LaTeX sectioning:
\`\`\`latex
\\section{2.3.S.2 Manufacture}

\\subsection{Manufacturer Information}
Content about manufacturer...

\\subsection{Description of Manufacturing Process}
Content about process...

\\subsection{Flow Diagram}
Reference to flow diagram...

\\subsection{Control of Materials}
Content about materials...

\\subsection{Controls of Critical Steps and Intermediates}
Content about critical steps...

\\subsection{Process Validation}
Content about validation...

\\subsection{Manufacturing Process Development}
Content about development changes...
\`\`\`

### Tables for Manufacturing Information
\`\`\`latex
\\begin{table}[htbp]
\\centering
\\caption{Manufacturer Information}
\\begin{tabular}{p{4cm}p{8cm}}
\\toprule
\\textbf{Attribute} & \\textbf{Details} \\\\
\\midrule
Manufacturer Name & ABC Pharmaceuticals Ltd. \\\\
Address & 123 Industrial Park, City, Country \\\\
Responsibilities & Synthesis, Purification, Packaging \\\\
\\bottomrule
\\end{tabular}
\\end{table}
\`\`\`

### Critical Steps Table Example
\`\`\`latex
\\begin{table}[htbp]
\\centering
\\caption{Critical Process Steps and Controls}
\\begin{tabular}{p{3cm}p{4cm}p{4cm}}
\\toprule
\\textbf{Step} & \\textbf{Critical Parameter} & \\textbf{Acceptance Criteria} \\\\
\\midrule
Reaction & Temperature & 20--25\\textdegree{}C \\\\
Crystallization & Cooling rate & 0.5\\textdegree{}C/min \\\\
Drying & Moisture content & $\\leq$ 0.5\\% w/w \\\\
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

### Quotation Marks
- Use \`\`text'' for double quotes
- Use \`text' for single quotes
- Do NOT use straight quotes " or '

### Cross-References
\`\`\`latex
As detailed in Section 3.2.S.2.2, the manufacturing process...
The flow diagram (see Section~3.2.S.2.2) illustrates...
\`\`\`

### Common Mistakes to AVOID
1. ❌ Unescaped: %, &, $, #, _, {, }
2. ❌ Straight quotes: "text" (use \`\`text'' instead)
3. ❌ Degree symbol: ° (use \\textdegree{} instead)
4. ❌ Undefined commands
5. ❌ Unclosed environments (tables, itemize, etc.)
6. ❌ Missing \\\\  at end of table rows

## Output Requirements

- Write the COMPLETE section 2.3.S.2, not just an introduction
- **Format**: Valid, compilable LaTeX with proper structure
- Use \\section{} and \\subsection{} for organization
- Follow the ICH guidelines for section organization exactly
- Include all required subsections (a through g) as outlined
- Reference Module 3 documents by section number
- Use professional regulatory language
- Include tables for structured information (properly formatted)
- All special characters must be properly escaped
- Ensure comprehensive coverage of all ICH requirements

## LaTeX Validation Checklist
- [ ] Document has \\documentclass, \\begin{document}, \\end{document}
- [ ] All special characters escaped: %, &, $, #, _, {, }
- [ ] Quotation marks use LaTeX style: \`\`text''
- [ ] Degree symbols use \\textdegree{}
- [ ] Tables have proper structure with \\\\  at row ends
- [ ] All \\begin{} have matching \\end{}
- [ ] Cross-references use Section~X.X format`
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
				sectionId: "2.3.S.2",
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
						console.log(`[TaskSection23S2] Using drug name from RegulatoryProductConfig: ${currentProduct.drugName}`)
					}
				} catch (error) {
					console.warn(`[TaskSection23S2] Failed to get drug name from RegulatoryProductConfig: ${error}`)
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
						sectionId: "2.3.S.2",
						drugName: currentProduct.drugName,
						apiName: currentProduct.drugName,
					}
				}
			} catch (error) {
				console.warn(`[TaskSection23S2] Failed to get drug name from RegulatoryProductConfig: ${error}`)
			}

			return {
				sectionId: "2.3.S.2",
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
				// Extract tool name from text for better progress reporting
				if (text) {
					if (text.includes("module3_tags_lookup")) {
						this.reportProgress("Looking up Module 3 documents...")
					} else if (text.includes("write_tex")) {
						this.reportProgress("Writing LaTeX content...")
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
				this.reportProgress(`Error: ${text?.substring(0, 50) || "Unknown error"}`)
				break
			case "api_req_started":
				this.apiCallCount++
				this.reportProgress(`Making API request #${this.apiCallCount}...`)
				break
			case "api_req_finished":
				this.reportProgress(`Processing response #${this.apiCallCount}...`)
				break
			case "completion_result":
				this.reportProgress("Task completing...")
				break
			case "text":
				// Show abbreviated AI response
				if (text && text.length > 0) {
					this.reportProgress("AI generating content...")
				}
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

/**

CTD SECTION 2.2 – INTRODUCTION TO THE SUMMARY

PURPOSE OF SECTION 2.2

Section 2.2 serves as a high-level, factual introduction to the summaries provided in Module 2 of the Common Technical Document (CTD). Its purpose is to orient the regulatory reviewer by briefly describing the drug substance and drug product, their therapeutic use, and general pharmacological characteristics.

This section is narrative and contextual only. It must not introduce new data, results, or justification.

SCOPE AND BOUNDARIES
The content of Section 2.2 must remain descriptive and introductory in nature.

MUST INCLUDE:
Drug substance identity (name, class)
General chemical or stereochemical description, if relevant
Therapeutic use and indication categories
Broad regulatory or development background
High-level mechanism of action

MUST NOT INCLUDE:
Study results or outcomes
Bioequivalence or clinical data
Manufacturing or process details
Stability, validation, or analytical data
Claims of superiority, efficacy, or safety
Justification or argumentative language

RECOMMENDED CONTENT STRUCTURE

Paragraph 1: Drug Identity and Class
Describe the drug substance by: International Nonproprietary Name (INN)

Pharmacological class
Key chemical or stereochemical characteristics, if applicable
Example pattern:
“<Drug Name> is a <pharmacological class> and <key chemical or stereochemical descriptor>.”

Paragraph 2: Distinguishing Characteristics
Provide widely accepted, literature-based characteristics such as: Relative activity or spectrum (qualitative or broad ranges only)
Stability or isomeric properties, if relevant
Classification within a drug generation or subgroup
Use neutral, literature-style phrasing (e.g., “is reported to”, “is characterized by”).

Paragraph 3: Therapeutic Context
Describe:
Therapeutic areas
Types of conditions or infections treated
General clinical use categories
Use label-aligned, non-promotional language. Avoid dosing or outcomes.

Paragraph 4: Regulatory and Development Background
Optionally include:
Initial approval authority and year
Subsequent approvals in other regions
Historical context only
Avoid claims related to established efficacy or safety.

Paragraph 5: Mechanism of Action
Provide a concise, high-level description of:
Molecular or enzymatic target
General pharmacological effect
Class-consistent mechanism
Limit to one paragraph. Do not include potency or kinetic data.

LANGUAGE AND STYLE CONSTRAINTS

Tone:
Neutral
Scientific
Non-promotional

Preferred verbs:
“is”
“is classified as”
“is used for”
“acts by”
“inhibits”

Avoid verbs and phrases such as:
“demonstrates”
“shows superior”
“highly effective”
“proven”

LENGTH GUIDANCE
Typical length:
ANDA submissions: 0.5 to 1.5 pages
NDA submissions: 1 to 2 pages
Conciseness is preferred.

ALLOWED SOURCE MATERIAL FOR GENERATION
The LLM may reference:
Module 3.2.S.1 (General Information)
Public regulatory drug labels (factual content only)
USP, INN, or pharmacopeial descriptions
Previously generated Section 2.3 (Quality Overall Summary), summarized only

The LLM must not reference:
Study reports
Validation or analytical datasets
Internal development or strategy documents

VALIDATION CHECKLIST
Before finalizing Section 2.2, ensure:
No numerical study results are included
No justificatory or promotional language is used
Terminology is consistent with Module 3
Drug name and classification are consistent throughout
Mechanism of action is described only at a class or high level

 */
