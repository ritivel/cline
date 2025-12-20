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
 * Parameters for creating a TaskSection22Introduction instance
 */
export interface TaskSection22IntroductionParams {
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
	ichInstructions?: string // ICH instructions for writing section 2.2
	onProgress?: (status: string) => void
}

/**
 * Result of task completion
 */
export interface TaskSection22IntroductionResult {
	success: boolean
	error?: string
}

/**
 * ICH Instructions for Introduction to the Summary (Section 2.2)
 *
 * Section 2.2 serves as a high-level, factual introduction to the summaries
 * provided in Module 2 of the CTD. It orients the regulatory reviewer by
 * briefly describing the drug substance and drug product, their therapeutic
 * use, and general pharmacological characteristics.
 */
const ICH_SECTION_22_INSTRUCTIONS = `CTD SECTION 2.2 – INTRODUCTION TO THE SUMMARY

PURPOSE OF SECTION 2.2

Section 2.2 serves as a high-level, factual introduction to the summaries provided in Module 2 of the Common Technical Document (CTD). Its purpose is to orient the regulatory reviewer by briefly describing the drug substance and drug product, their therapeutic use, and general pharmacological characteristics.

This section is narrative and contextual only. It must not introduce new data, results, or justification.

SCOPE AND BOUNDARIES

The content of Section 2.2 must remain descriptive and introductory in nature.

MUST INCLUDE:
- Drug substance identity (name, class)
- General chemical or stereochemical description, if relevant
- Therapeutic use and indication categories
- Broad regulatory or development background
- High-level mechanism of action

MUST NOT INCLUDE:
- Study results or outcomes
- Bioequivalence or clinical data
- Manufacturing or process details
- Stability, validation, or analytical data
- Claims of superiority, efficacy, or safety
- Justification or argumentative language

RECOMMENDED CONTENT STRUCTURE

Paragraph 1: Drug Identity and Class
Describe the drug substance by:
- International Nonproprietary Name (INN)
- Pharmacological class
- Key chemical or stereochemical characteristics, if applicable

Example pattern:
"<Drug Name> is a <pharmacological class> and <key chemical or stereochemical descriptor>."

Paragraph 2: Distinguishing Characteristics
Provide widely accepted, literature-based characteristics such as:
- Relative activity or spectrum (qualitative or broad ranges only)
- Stability or isomeric properties, if relevant
- Classification within a drug generation or subgroup
Use neutral, literature-style phrasing (e.g., "is reported to", "is characterized by").

Paragraph 3: Therapeutic Context
Describe:
- Therapeutic areas
- Types of conditions or infections treated
- General clinical use categories
Use label-aligned, non-promotional language. Avoid dosing or outcomes.

Paragraph 4: Regulatory and Development Background
Optionally include:
- Initial approval authority and year
- Subsequent approvals in other regions
- Historical context only
Avoid claims related to established efficacy or safety.

Paragraph 5: Mechanism of Action
Provide a concise, high-level description of:
- Molecular or enzymatic target
- General pharmacological effect
- Class-consistent mechanism
Limit to one paragraph. Do not include potency or kinetic data.

LANGUAGE AND STYLE CONSTRAINTS

Tone:
- Neutral
- Scientific
- Non-promotional

Preferred verbs:
- "is"
- "is classified as"
- "is used for"
- "acts by"
- "inhibits"

Avoid verbs and phrases such as:
- "demonstrates"
- "shows superior"
- "highly effective"
- "proven"

LENGTH GUIDANCE
Typical length:
- ANDA submissions: 0.5 to 1.5 pages
- NDA submissions: 1 to 2 pages
Conciseness is preferred.`

/**
 * TaskSection22Introduction extends Task to generate CTD Section 2.2: Introduction to the Summary
 * It uses Module 3 section tags.md files and previously generated Section 2.3 to gather context
 */
export class TaskSection22Introduction extends Task {
	private sectionFolderPath: string
	private expectedOutputFile: string
	private tagsPath: string
	private ichInstructions: string
	private onProgress?: (status: string) => void

	// Completion monitoring
	private completionCheckInterval?: NodeJS.Timeout
	private isCompleted: boolean = false
	private apiCallCount: number = 0

	constructor(params: TaskSection22IntroductionParams) {
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
		this.ichInstructions = params.ichInstructions || ICH_SECTION_22_INSTRUCTIONS
		this.onProgress = params.onProgress
	}

	/**
	 * Reports progress via the callback if provided
	 */
	private reportProgress(status: string): void {
		if (this.onProgress) {
			this.onProgress(status)
		}
		console.log(`[TaskSection22Introduction] ${status}`)
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

		console.log(`[TaskSection22Introduction] Starting completion monitoring for: ${this.expectedOutputFile}`)

		this.completionCheckInterval = setInterval(async () => {
			if (this.isCompleted) {
				this.stopCompletionMonitoring()
				return
			}

			const fileExists = await this.checkFileExists()
			if (fileExists && !this.isCompleted) {
				console.log(`[TaskSection22Introduction] Output file found, marking as complete`)
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
	 * Main entry point: Generates Section 2.2 Introduction to the Summary
	 */
	public async runIntroductionGeneration(): Promise<TaskSection22IntroductionResult> {
		try {
			this.reportProgress("Starting section 2.2 (Introduction to the Summary) generation")
			showSystemNotification({
				subtitle: "Section 2.2",
				message: "Starting Introduction to the Summary generation...",
			})
			this.startCompletionMonitoring()

			// Read section 2.2 tags.md to get drug name
			const sectionTags = await this.readTagsFile(this.tagsPath)
			if (!sectionTags.drugName) {
				return {
					success: false,
					error: "Could not determine drug name from section 2.2 tags.md",
				}
			}

			this.reportProgress(`Drug: ${sectionTags.drugName}`)

			// Build the user prompt
			const userPrompt = this.buildUserPrompt(sectionTags.drugName)

			// Run the task - this will use the Task's built-in execution with tools
			this.reportProgress("Generating Introduction to the Summary with AI agent...")
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
				this.reportProgress("Section 2.2 generated successfully")
				showSystemNotification({
					subtitle: "Section 2.2",
					message: "✓ Introduction to the Summary generated successfully!",
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
	 * Builds the user prompt for section 2.2 generation
	 */
	private buildUserPrompt(drugName: string): string {
		return `Generate CTD Section 2.2: Introduction to the Summary for ${drugName}.

## OBJECTIVE
Write a **comprehensive, 1-page introduction** that thoroughly orients the regulatory reviewer to the drug substance and drug product. This section should provide a complete factual overview covering drug identity, characteristics, therapeutic use, regulatory background, and mechanism of action.

## KEY REQUIREMENTS
- **Target Length**: Approximately 1 full page (300-400 words, 5 well-developed paragraphs)
- **Content**: Factual, descriptive information only (no study results or promotional claims)
- **Style**: Professional regulatory narrative with comprehensive coverage of each topic
- Use the module3_tags_lookup tool 2-4 times to gather drug identity information

## Purpose of Section 2.2

Section 2.2 serves as a factual introduction to the summaries provided in Module 2 of the CTD. Its purpose is to thoroughly orient the regulatory reviewer by describing the drug substance and drug product, their therapeutic use, and pharmacological characteristics.

This section is **narrative and descriptive**. It must NOT include study results, data tables, or justification arguments, but it SHOULD provide comprehensive factual information about the drug.

## ICH Guidelines

${this.ichInstructions}

## Workflow - FOLLOW THESE STEPS EXACTLY

1. Use the \`module3_tags_lookup\` tool to gather basic drug identity information:
   - **CRITICAL LIMIT**: Use this tool EXACTLY 2-4 times maximum
   - **ONLY check LEAF sections** (sections with no children)
   - Focus on sections that provide drug identity and classification information

   **Priority Sections to Query:**
   - **3.2.S.1.1**: Nomenclature (INN, chemical name, CAS number) - REQUIRED
   - **3.2.S.1.2**: Structure (molecular structure, stereochemistry) - if relevant
   - **3.2.S.1.3**: General Properties (physicochemical properties) - if needed
   - **3.2.P.1**: Description and Composition of the FPP - for dosage form context

   **DO NOT query manufacturing, analytical, or stability sections - they are NOT relevant for Section 2.2.**

2. Based on document names and summaries, identify:
   - Drug substance name (INN)
   - Pharmacological class
   - Key chemical or stereochemical characteristics
   - Dosage form (if available)

3. **OPTIONAL: Check if Section 2.3 preamble exists**
   - If section 2.3 has been generated, you may reference its preamble.tex for additional context
   - Path: Look in the parent directory for section-2.3/preamble.tex
   - Only use factual information (drug name, class, indication categories)
   - Do NOT copy study data or detailed quality information

4. **OPTIONAL: Read specific .mmd files ONLY when absolutely necessary**
   - Only read 1-2 .mmd files maximum
   - Only read if summaries are insufficient for basic drug identity
   - **Use the \`mmdFilePath\` field** from module3_tags_lookup results - this is the exact path to use
   - State your objective before reading: "I need to read [mmdFilePath] to get [specific factual info]"

5. Write Section 2.2 following the **REQUIRED 5-paragraph structure** with COMPREHENSIVE coverage:

   **Paragraph 1: Drug Identity and Class (4-6 sentences)**
   Write a thorough introduction covering:
   - Full International Nonproprietary Name (INN) and any synonyms
   - Complete pharmacological/therapeutic class designation
   - Chemical class or structural family (e.g., "a substituted benzimidazole", "a fluoroquinolone derivative")
   - Key stereochemical characteristics if applicable (racemic mixture, specific enantiomer, etc.)
   - Molecular characteristics that define the drug class
   - Example: "${drugName} is a [pharmacological class] belonging to the [chemical class] family of compounds. It is characterized as [stereochemistry if relevant]. The compound is classified within the [broader therapeutic category] and shares structural features with other [class members]."

   **Paragraph 2: Distinguishing Characteristics (4-6 sentences)**
   Provide comprehensive, literature-based characteristics:
   - Spectrum of activity or therapeutic coverage (qualitative descriptions)
   - Physicochemical properties relevant to its use (e.g., solubility, stability)
   - Comparison to drug class or generation (e.g., "second-generation", "broad-spectrum")
   - Unique features within its class (without promotional language)
   - Isomeric or polymorphic properties if relevant
   - Use neutral phrasing: "is reported to", "is characterized by", "is known to"
   - Example: "${drugName} is characterized by its [property]. It is reported to have [spectrum/activity]. The compound is classified as a [generation/subtype] agent within its therapeutic class. It is known for its [distinguishing feature] compared to earlier compounds in this class."

   **Paragraph 3: Therapeutic Context (4-6 sentences)**
   Describe the full therapeutic landscape:
   - Primary therapeutic area(s) and medical specialty
   - Complete list of condition categories treated
   - Patient populations (adults, pediatrics if applicable)
   - Clinical settings where the drug is used
   - Route(s) of administration
   - General treatment context (acute, chronic, prophylactic)
   - Use label-aligned, non-promotional language
   - Example: "${drugName} is used in the treatment of [primary conditions]. It is indicated for [patient populations] with [condition types]. The drug is administered [route] and is utilized in both [settings]. It is employed for the management of [condition categories] across various clinical scenarios."

   **Paragraph 4: Regulatory and Development Background (3-5 sentences)**
   Include relevant regulatory history:
   - Original approval by FDA (year and original indication if known)
   - Reference Listed Drug (RLD) information
   - Subsequent regulatory approvals in major markets (EU, Japan, etc.)
   - General development history or timeline
   - Current regulatory status
   - Example: "${drugName} was first approved by the U.S. Food and Drug Administration (FDA) in [year]. The reference listed drug is [brand name]. It has subsequently received marketing authorization in [regions]. The drug has been available for clinical use for [duration] and remains widely prescribed in its therapeutic category."

   **Paragraph 5: Mechanism of Action (4-6 sentences)**
   Provide a complete but accessible description:
   - Primary molecular or cellular target
   - Biochemical pathway affected
   - Physiological effect at the target level
   - Downstream therapeutic effect
   - Class-consistent mechanism description
   - Connection between mechanism and therapeutic use
   - Example: "${drugName} acts by [primary mechanism] at the [target site]. This results in [biochemical effect], which leads to [physiological outcome]. The mechanism involves [pathway description]. This action underlies the therapeutic effect in [condition], where [brief explanation of why mechanism helps the condition].\"

6. Use ONLY the \`write_tex\` tool to write the section to: ${this.expectedOutputFile}
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

% Page setup
\\geometry{margin=1in}
\\onehalfspacing

\\begin{document}

% Your content here - NO \\section commands for Section 2.2
% This is a narrative introduction, use plain paragraphs

\\end{document}
\`\`\`

### Special Character Escaping - CRITICAL
LaTeX treats certain characters specially. You MUST escape them:

| Character | Escape As | Example |
|-----------|-----------|---------|
| % | \\% | 50\\% |
| & | \\& | Smith \\& Co. |
| $ | \\$ | \\$100 |
| # | \\# | Item \\#1 |
| _ | \\_ | drug\\_name |
| { | \\{ | \\{value\\} |
| } | \\} | \\{value\\} |
| ~ | \\textasciitilde{} | approximately\\textasciitilde{}10 |
| ^ | \\textasciicircum{} | 10\\textasciicircum{}3 |
| \\ | \\textbackslash{} | file\\textbackslash{}path |

### Drug Names and Chemical Terms
- Use \\textit{} for genus/species names: \`\\textit{Staphylococcus aureus}\`
- Use \\textsuperscript{} for superscripts: \`Ca\\textsuperscript{2+}\`
- Use \\textsubscript{} for subscripts: \`H\\textsubscript{2}O\`
- For Greek letters: \`$\\alpha$\`, \`$\\beta$\`, \`$\\gamma$\` (in math mode)
- For chemical formulas with mixed sub/superscripts: \`\\ce{}\` from mhchem package or manual formatting

### Common Drug Name Patterns
\`\`\`latex
% INN names - regular text
Omeprazole is a proton pump inhibitor.

% Brand names - can use regular text or emphasize
The reference listed drug is Prilosec (omeprazole).

% Chemical names with special characters
The chemical name is 5-methoxy-2-[[(4-methoxy-3,5-dimethyl-2-pyridinyl)methyl]sulfinyl]-1H-benzimidazole.
\`\`\`

### Paragraph Formatting for Section 2.2
- Do NOT use \\section{} or \\subsection{} commands - Section 2.2 is a flowing narrative
- Separate paragraphs with blank lines (standard LaTeX paragraph breaks)
- Do NOT use \\par explicitly unless needed for special formatting
- Use \\noindent if you need to suppress indentation

### Quotation Marks
- Use \`\`text'' for double quotes (two backticks and two single quotes)
- Use \`text' for single quotes
- Do NOT use straight quotes " or '

### Dashes
- Hyphen: - (compound words: "well-known")
- En-dash: -- (ranges: "pages 1--10")
- Em-dash: --- (parenthetical---like this)

### Common Mistakes to AVOID
1. ❌ Do NOT use: \\begin{section} or \\end{section}
2. ❌ Do NOT use: straight quotes " "
3. ❌ Do NOT leave special characters unescaped: %, &, $, #, _, {, }
4. ❌ Do NOT use: \\\\newline in the middle of paragraphs (use blank lines)
5. ❌ Do NOT use: undefined commands or packages not in the preamble
6. ❌ Do NOT include: \\maketitle without \\title{} and \\author{}

### Example Section 2.2 Output Structure (TARGET: ~1 page, 300-400 words)
\`\`\`latex
\\documentclass[12pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{geometry}
\\usepackage{setspace}
\\usepackage{parskip}
\\geometry{margin=1in}
\\onehalfspacing

\\begin{document}

% Paragraph 1: Drug Identity and Class (4-6 sentences)
Omeprazole is a substituted benzimidazole compound classified as a proton pump inhibitor (PPI). It belongs to the antisecretory class of gastrointestinal agents and is chemically designated as 5-methoxy-2-[[(4-methoxy-3,5-dimethyl-2-pyridinyl)methyl]sulfinyl]-1H-benzimidazole. The drug substance exists as a racemic mixture of two enantiomers, the S- and R-isomers, with both contributing to its pharmacological activity. Omeprazole is a weak base with acid-labile properties and is formulated as delayed-release preparations to protect it from gastric acid degradation.

% Paragraph 2: Distinguishing Characteristics (4-6 sentences)
Omeprazole is characterized by its ability to form a covalent bond with the gastric proton pump, resulting in irreversible inhibition of acid secretion. It is classified as a first-generation proton pump inhibitor and serves as the prototype compound for this therapeutic class. The drug is reported to provide sustained suppression of gastric acid secretion, with effects persisting beyond its plasma half-life due to the irreversible nature of enzyme inhibition. Omeprazole is known for its acid-activated mechanism, requiring conversion to the active sulfenamide form in the acidic environment of the parietal cell canaliculus.

% Paragraph 3: Therapeutic Context (4-6 sentences)
Omeprazole is used in the treatment of acid-related gastrointestinal disorders in adult and pediatric patients. It is indicated for the management of gastroesophageal reflux disease (GERD), including erosive esophagitis and symptomatic GERD. The drug is also utilized for the treatment of gastric and duodenal ulcers, including those associated with \\textit{Helicobacter pylori} infection as part of combination therapy. Additionally, omeprazole is employed in conditions involving pathological hypersecretion, such as Zollinger-Ellison syndrome. The drug is administered orally as delayed-release capsules or tablets.

% Paragraph 4: Regulatory Background (3-5 sentences)
Omeprazole was first approved by the U.S. Food and Drug Administration (FDA) in 1989 under the brand name Prilosec. It has subsequently received marketing authorization in numerous countries worldwide and is included in the World Health Organization's List of Essential Medicines. The drug has been available for clinical use for over three decades and remains one of the most widely prescribed medications in its therapeutic class. Multiple generic formulations have been approved following patent expiration.

% Paragraph 5: Mechanism of Action (4-6 sentences)
Omeprazole acts by selectively and irreversibly inhibiting the gastric hydrogen-potassium adenosine triphosphatase (H\\textsuperscript{+}/K\\textsuperscript{+}-ATPase) enzyme system at the secretory surface of gastric parietal cells. This enzyme, commonly referred to as the proton pump, is responsible for the final step in gastric acid production. Upon absorption, omeprazole accumulates in the acidic compartment of the parietal cell where it is converted to its active form. The active metabolite binds covalently to cysteine residues on the proton pump, resulting in prolonged inhibition of acid secretion. This mechanism underlies the therapeutic effect in acid-related disorders by reducing gastric acidity and promoting healing of acid-damaged tissues.

\\end{document}
\`\`\`

## LANGUAGE CONSTRAINTS - CRITICAL

**ALLOWED verbs and phrases:**
- "is"
- "is classified as"
- "is used for"
- "acts by"
- "inhibits"
- "is reported to"
- "is characterized by"

**FORBIDDEN verbs and phrases (DO NOT USE):**
- "demonstrates"
- "shows superior"
- "highly effective"
- "proven"
- "establishes"
- "confirms"
- Any comparative or superlative claims

## CONTENT BOUNDARIES - CRITICAL

**MUST INCLUDE:**
✓ Drug substance identity (name, class)
✓ General chemical or stereochemical description
✓ Therapeutic use and indication categories
✓ Broad regulatory or development background
✓ High-level mechanism of action

**MUST NOT INCLUDE:**
✗ Study results or outcomes
✗ Bioequivalence or clinical data
✗ Manufacturing or process details
✗ Stability, validation, or analytical data
✗ Claims of superiority, efficacy, or safety
✗ Justification or argumentative language
✗ Numerical data or statistics

## Output Requirements

- **Length TARGET**: Approximately **1 full page** of text for ANDA/generic submissions (300-400 words)
  - Each paragraph should be 4-6 sentences for comprehensive coverage
  - Do NOT write overly brief paragraphs - develop each topic fully
  - The introduction should orient the reviewer thoroughly
- **Format**: Valid, compilable LaTeX with proper document structure
- **Tone**: Neutral, scientific, non-promotional but COMPREHENSIVE
- **Structure**: Follow the 5-paragraph structure exactly (NO section/subsection commands)
- **References**: Do NOT include study references or citations
- **Encoding**: Use UTF-8 compatible characters or LaTeX commands for special characters

**IMPORTANT**: Write substantive paragraphs. Each paragraph should fully develop its topic with multiple relevant details. Avoid single-sentence or two-sentence paragraphs - expand each section with appropriate factual content.

## Validation Checklist - COMPLETE BEFORE WRITING

### Content Validation
- [ ] No numerical study results included
- [ ] No justificatory or promotional language used
- [ ] Drug name and classification consistent throughout
- [ ] Mechanism of action described only at class/high level
- [ ] **Each paragraph has 4-6 sentences with comprehensive coverage**
- [ ] **Total content is approximately 1 full page (300-400 words)**

### LaTeX Validation - CRITICAL
- [ ] Document has \\documentclass declaration
- [ ] Document has \\begin{document} and \\end{document}
- [ ] All special characters escaped: %, &, $, #, _, {, }
- [ ] Quotation marks use LaTeX style: \`\`text'' not "text"
- [ ] No undefined commands used
- [ ] No \\section{} or \\subsection{} commands (Section 2.2 is narrative only)
- [ ] Superscripts use \\textsuperscript{} or math mode
- [ ] Subscripts use \\textsubscript{} or math mode
- [ ] Greek letters in math mode: $\\alpha$, $\\beta$
- [ ] Scientific names italicized: \\textit{species name}
- [ ] All opened environments are closed
- [ ] No raw Unicode characters that might cause compilation errors`
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
				sectionId: "2.2",
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
							`[TaskSection22Introduction] Using drug name from RegulatoryProductConfig: ${currentProduct.drugName}`,
						)
					}
				} catch (error) {
					console.warn(`[TaskSection22Introduction] Failed to get drug name from RegulatoryProductConfig: ${error}`)
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
						sectionId: "2.2",
						drugName: currentProduct.drugName,
						apiName: currentProduct.drugName,
					}
				}
			} catch (error) {
				console.warn(`[TaskSection22Introduction] Failed to get drug name from RegulatoryProductConfig: ${error}`)
			}

			return {
				sectionId: "2.2",
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
			// case "api_req_started":
			// 	this.apiCallCount++
			// 	this.reportProgress("Making API request...")
			// 	break
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
