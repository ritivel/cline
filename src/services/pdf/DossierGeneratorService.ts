import { buildApiHandler } from "@core/api"
import * as fs from "fs"
import * as path from "path"
import { Controller } from "@/core/controller"
import { EAC_NMRA_TEMPLATE } from "@/core/ctd/templates/eac-nmra/definition"
import { SECTION_PARENT_MAP } from "@/core/ctd/templates/eac-nmra/prompts"
import type { CTDModuleDef, CTDSectionDef } from "@/core/ctd/types"
import { StateManager } from "@/core/storage/StateManager"
import { Task } from "@/core/task"
import { tryAcquireTaskLockWithRetry } from "@/core/task/TaskLockUtils"
import { detectWorkspaceRoots } from "@/core/workspace/detection"
import { setupWorkspaceManager } from "@/core/workspace/setup"

interface PdfTagEntry {
	pdfName: string
	processedFolderPath: string // Relative path to the processed folder in documents/
	confidence: string
	type: "placement" | "reference"
}

interface SectionTags {
	placements: PdfTagEntry[]
	references: PdfTagEntry[]
}

interface DocumentContent {
	pdfName: string
	mmdContent: string
	infoJson: any
	path: string
}

/**
 * Service for generating regulatory-style content for CTD dossier sections
 */
export class DossierGeneratorService {
	private workspaceRoot: string
	private dossierPath: string
	private documentsPath: string
	private controller?: Controller

	constructor(workspaceRoot: string, controller?: Controller) {
		this.workspaceRoot = workspaceRoot
		this.dossierPath = path.join(workspaceRoot, "dossier")
		this.documentsPath = path.join(workspaceRoot, "documents")
		this.controller = controller
	}

	/**
	 * Converts a CTD section number to a dossier folder path
	 */
	private sectionToFolderPath(section: string): string | null {
		const moduleNum = section.charAt(0)

		if (!(section in SECTION_PARENT_MAP)) {
			console.warn(`Unknown CTD section: ${section}, cannot determine folder path`)
			return null
		}

		const ancestors: string[] = []
		let current: string | null = section

		while (current !== null) {
			ancestors.unshift(current)
			current = SECTION_PARENT_MAP[current] ?? null
		}

		const sectionFolders = ancestors.map((s) => `section-${s}`)
		return path.join(this.dossierPath, `module-${moduleNum}`, ...sectionFolders)
	}

	/**
	 * Gets all leaf sections (sections without children) from a module
	 */
	private getLeafSections(module: CTDModuleDef): string[] {
		return Object.entries(module.sections)
			.filter(([_, section]) => !section.children || section.children.length === 0)
			.map(([id]) => id)
	}

	/**
	 * Reads existing tags from a tags.md file
	 */
	private async readTagsFromFile(tagsPath: string): Promise<SectionTags> {
		const result: SectionTags = { placements: [], references: [] }

		try {
			const content = await fs.promises.readFile(tagsPath, "utf-8")

			// Parse placements section
			const placementsMatch = content.match(/## Placements\s*\n([\s\S]*?)(?=## References|$)/i)
			if (placementsMatch) {
				const placementLines = placementsMatch[1].match(/- \[([^\]]+)\]\(([^)]+)\)(?: \(([^)]+)\))?/g) || []
				for (const line of placementLines) {
					const match = line.match(/- \[([^\]]+)\]\(([^)]+)\)(?: \(([^)]+)\))?/)
					if (match) {
						result.placements.push({
							pdfName: match[1],
							processedFolderPath: match[2],
							confidence: match[3] || "Unknown",
							type: "placement",
						})
					}
				}
			}

			// Parse references section
			const referencesMatch = content.match(/## References\s*\n([\s\S]*?)$/i)
			if (referencesMatch) {
				const referenceLines = referencesMatch[1].match(/- \[([^\]]+)\]\(([^)]+)\)(?: \(([^)]+)\))?/g) || []
				for (const line of referenceLines) {
					const match = line.match(/- \[([^\]]+)\]\(([^)]+)\)(?: \(([^)]+)\))?/)
					if (match) {
						result.references.push({
							pdfName: match[1],
							processedFolderPath: match[2],
							confidence: match[3] || "Unknown",
							type: "reference",
						})
					}
				}
			}
		} catch {
			// File doesn't exist or can't be parsed
		}

		return result
	}

	/**
	 * Reads .mmd file content from a document folder
	 */
	private async readMmdFile(folderPath: string): Promise<string | null> {
		try {
			const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
			for (const entry of entries) {
				if (entry.isFile() && entry.name.endsWith(".mmd")) {
					const mmdPath = path.join(folderPath, entry.name)
					return await fs.promises.readFile(mmdPath, "utf-8")
				}
			}
		} catch (error) {
			console.error(`Error reading .mmd file from ${folderPath}:`, error)
		}
		return null
	}

	/**
	 * Reads info.json from a document folder
	 */
	private async readInfoJson(folderPath: string): Promise<any | null> {
		try {
			const infoPath = path.join(folderPath, "info.json")
			const content = await fs.promises.readFile(infoPath, "utf-8")
			return JSON.parse(content)
		} catch (error) {
			console.error(`Error reading info.json from ${folderPath}:`, error)
		}
		return null
	}

	/**
	 * Reads document content (.mmd and info.json) for a tagged document
	 */
	private async readDocumentContent(
		sectionFolderPath: string,
		processedFolderPath: string,
		pdfName: string,
	): Promise<DocumentContent | null> {
		// Resolve the document folder path
		// processedFolderPath in tags.md is relative to the section folder
		const documentFolderPath = path.resolve(sectionFolderPath, processedFolderPath)

		// Check if folder exists
		try {
			const stat = await fs.promises.stat(documentFolderPath)
			if (!stat.isDirectory()) {
				console.warn(`Document folder is not a directory: ${documentFolderPath}`)
				return null
			}
		} catch {
			console.warn(`Document folder does not exist: ${documentFolderPath}`)
			return null
		}

		const mmdContent = await this.readMmdFile(documentFolderPath)
		const infoJson = await this.readInfoJson(documentFolderPath)

		if (!mmdContent && !infoJson) {
			console.warn(`No .mmd or info.json found in ${documentFolderPath}`)
			return null
		}

		return {
			pdfName,
			mmdContent: mmdContent || "",
			infoJson: infoJson || {},
			path: documentFolderPath,
		}
	}

	/**
	 * Parses retry delay from rate limit error message
	 */
	private parseRetryDelay(errorMessage: string): number | null {
		// OpenAI format: "Please try again in 4.806s"
		const match = errorMessage.match(/try again in ([\d.]+)s/i)
		if (match) {
			return Math.ceil(parseFloat(match[1]) * 1000) // Convert to milliseconds
		}
		return null
	}

	/**
	 * Checks if error is a rate limit error
	 */
	private isRateLimitError(error: any): boolean {
		if (!error) return false
		const message = (error.message || String(error)).toLowerCase()
		return (
			error.status === 429 ||
			message.includes("rate limit") ||
			message.includes("429") ||
			message.includes("tpm") ||
			message.includes("tokens per min")
		)
	}

	/**
	 * Calls the LLM to generate regulatory-style content with retry logic and rate limiting
	 */
	private async callLlm(
		systemPrompt: string,
		userPrompt: string,
		maxRetries: number = 5,
		baseDelay: number = 2000,
	): Promise<string> {
		let lastError: any = null

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				const stateManager = StateManager.get()
				const apiConfiguration = stateManager.getApiConfiguration()
				const currentMode = "act"
				const apiHandler = buildApiHandler(apiConfiguration, currentMode)

				const messages = [{ role: "user" as const, content: userPrompt }]
				const stream = apiHandler.createMessage(systemPrompt, messages)

				let response = ""
				for await (const chunk of stream) {
					if (chunk.type === "text") {
						response += chunk.text
					}
				}
				return response
			} catch (error: any) {
				lastError = error
				const isRateLimit = this.isRateLimitError(error)
				const isLastAttempt = attempt === maxRetries - 1

				if (!isRateLimit || isLastAttempt) {
					// Not a rate limit error or last attempt - throw immediately
					console.error(`LLM call failed (attempt ${attempt + 1}/${maxRetries}):`, error)
					throw error
				}

				// Calculate delay for rate limit retry
				let delay: number
				const errorMessage = error.message || String(error)
				const retryDelay = this.parseRetryDelay(errorMessage)

				if (retryDelay) {
					// Use the delay specified in the error message
					delay = retryDelay
					console.log(
						`Rate limit hit. Waiting ${delay}ms as specified in error message (attempt ${attempt + 1}/${maxRetries})`,
					)
				} else {
					// Exponential backoff: baseDelay * 2^attempt, capped at 60 seconds
					delay = Math.min(60000, baseDelay * 2 ** attempt)
					console.log(`Rate limit hit. Using exponential backoff: ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
				}

				// Wait before retrying
				await new Promise((resolve) => setTimeout(resolve, delay))
			}
		}

		// If we get here, all retries failed
		throw lastError || new Error("LLM call failed after all retries")
	}

	/**
	 * Creates ICH-based prompt for regulatory content generation
	 */
	private createRegulatoryContentPrompt(sectionId: string, sectionTitle: string): string {
		return `You are a Regulatory Affairs professional preparing a Common Technical Document (CTD) submission for a generic drug product following ICH M4(R4) guidelines.

Your task is to write regulatory content for CTD Section ${sectionId}: ${sectionTitle}.

## ICH M4(R4) Writing Principles:

1. **Clarity and Precision**: Use clear, precise language. Avoid ambiguity. Use standard regulatory terminology.

2. **Completeness**: Include all relevant information from source documents. Do not omit critical data, specifications, or findings.

3. **Objectivity**: Present data objectively. Use factual statements supported by evidence from source documents.

4. **Structure**: Follow ICH CTD structure:
   - Begin with an introduction/overview when appropriate
   - Present information in logical sequence
   - Use appropriate headings and subheadings
   - Include tables, figures, and data summaries where relevant

5. **Regulatory Tone**: Write in formal, professional regulatory language:
   - Use third person or passive voice appropriately
   - Avoid colloquialisms and informal language
   - Use standard pharmaceutical and regulatory terminology
   - Maintain consistency in terminology throughout

6. **Data Presentation**:
   - Present numerical data clearly with appropriate units
   - Include statistical analyses where applicable
   - Reference supporting documents appropriately
   - Ensure all claims are substantiated by source data

7. **Compliance**: Ensure content meets regulatory requirements for the specified CTD section.

## Section-Specific Guidance:

For Section ${sectionId} (${sectionTitle}), focus on:
- Presenting information relevant to this specific CTD section
- Maintaining consistency with ICH guidelines for this section type
- Ensuring all critical information from source documents is included
- Writing in a manner suitable for regulatory authority review

## Instructions:

Transform the provided source document content into well-structured regulatory submission text. Do not simply copy-paste content. Instead:
- Synthesize information into coherent narrative
- Organize content logically
- Use appropriate regulatory language and terminology
- Ensure completeness - include all relevant information
- Maintain accuracy - do not add information not present in source documents
- Write as if submitting to a regulatory authority (e.g., FDA, EMA, EAC-NMRA)

Your output should be ready for inclusion in a regulatory submission dossier.`
	}

	/**
	 * Generates regulatory-style markdown content for a section using LLM
	 */
	private async generateSectionContent(
		sectionId: string,
		sectionTitle: string,
		tags: SectionTags,
		documents: DocumentContent[],
	): Promise<string> {
		let content = `# ${sectionId}: ${sectionTitle}\n\n`

		// If no documents, generate placeholder
		if (documents.length === 0) {
			content += `> **Note**: No documents have been tagged for this section yet.\n\n`
			content += `This section will be populated once relevant documents are classified and tagged.\n\n`
			return content
		}

		// Build document context for LLM
		const documentContexts: string[] = []
		for (const doc of documents) {
			const docType = tags.placements.some((p) => p.pdfName === doc.pdfName) ? "placed" : "referenced"
			let docContext = `## Document: ${doc.pdfName} (${docType})\n\n`

			if (doc.infoJson && doc.infoJson.summary) {
				docContext += `**Summary**: ${doc.infoJson.summary}\n\n`
			}

			if (doc.mmdContent) {
				docContext += `**Content**:\n${doc.mmdContent}\n\n`
			}

			documentContexts.push(docContext)
		}

		// Create user prompt with document content
		const userPrompt = `Generate regulatory submission content for CTD Section ${sectionId}: ${sectionTitle}.

The following documents have been tagged for this section:

${documentContexts.join("\n---\n\n")}

Please write comprehensive regulatory content based on the information provided in these documents. Follow ICH M4(R4) guidelines and write in professional regulatory submission style. Ensure all relevant information is included and presented in a clear, structured manner suitable for regulatory authority review.`

		// Generate content using LLM
		try {
			const systemPrompt = this.createRegulatoryContentPrompt(sectionId, sectionTitle)
			const generatedContent = await this.callLlm(systemPrompt, userPrompt)

			// Add header and generated content
			content += generatedContent

			// Add document references section
			content += `\n\n## Document References\n\n`
			content += `The following documents support this section:\n\n`
			for (const doc of documents) {
				const docType = tags.placements.some((p) => p.pdfName === doc.pdfName) ? "placed" : "referenced"
				content += `- **${doc.pdfName}** (${docType})\n`
			}

			return content
		} catch (error) {
			console.error(`Error generating content for section ${sectionId}:`, error)
			// Fallback to basic content if LLM fails
			content += `## Overview\n\n`
			content += `This section presents the ${sectionTitle.toLowerCase()} for the drug product submission.\n\n`

			if (documents.some((doc) => doc.infoJson && doc.infoJson.summary)) {
				for (const doc of documents) {
					if (doc.infoJson && doc.infoJson.summary) {
						content += `### ${doc.pdfName}\n\n${doc.infoJson.summary}\n\n`
					}
				}
			}

			content += `\n## Source Documents\n\n`
			for (const doc of documents) {
				const docType = tags.placements.some((p) => p.pdfName === doc.pdfName) ? "placed" : "referenced"
				content += `- **${doc.pdfName}** (${docType})\n`
			}

			return content
		}
	}

	/**
	 * Generates content for a single leaf section
	 */
	private async generateSectionContentForLeaf(
		sectionId: string,
		section: CTDSectionDef,
		onProgress?: (sectionId: string, status: string) => void,
	): Promise<boolean> {
		const sectionFolderPath = this.sectionToFolderPath(sectionId)
		if (!sectionFolderPath) {
			console.warn(`Cannot determine folder path for section ${sectionId}`)
			return false
		}

		// Check if section folder exists
		try {
			const stat = await fs.promises.stat(sectionFolderPath)
			if (!stat.isDirectory()) {
				console.warn(`Section folder is not a directory: ${sectionFolderPath}`)
				return false
			}
		} catch {
			console.warn(`Section folder does not exist: ${sectionFolderPath}`)
			return false
		}

		// Read tags.md
		const tagsPath = path.join(sectionFolderPath, "tags.md")
		const tags = await this.readTagsFromFile(tagsPath)

		// Collect all documents (placements + references)
		const allDocuments: PdfTagEntry[] = [...tags.placements, ...tags.references]

		// Read document content for all tagged documents
		const documentContents: DocumentContent[] = []
		for (const docTag of allDocuments) {
			if (onProgress) {
				onProgress(sectionId, `Reading ${docTag.pdfName}...`)
			}
			const docContent = await this.readDocumentContent(sectionFolderPath, docTag.processedFolderPath, docTag.pdfName)
			if (docContent) {
				documentContents.push(docContent)
			}
		}

		// Generate content using LLM
		const content = await this.generateSectionContent(sectionId, section.title, tags, documentContents)

		// Write content.md
		const contentPath = path.join(sectionFolderPath, "content.md")
		await fs.promises.writeFile(contentPath, content, "utf-8")

		if (onProgress) {
			onProgress(sectionId, `Completed`)
		}

		return true
	}

	/**
	 * Creates a comprehensive LaTeX prompt for subagent with standalone document requirements
	 */
	private createSubagentLaTeXPrompt(
		sectionId: string,
		section: CTDSectionDef,
		sectionFolderPath: string,
		tagsPath: string,
	): string {
		const texFilePath = path.join(sectionFolderPath, "content.tex")

		return `You are a regulatory affairs subagent with access to ALL tools (both PLAN and ACT mode tools).

Your task is to generate a COMPLETE STANDALONE LaTeX document for CTD Section ${sectionId}: ${section.title}.

## Output File
Write a complete, compilable LaTeX document to: ${texFilePath}

## CRITICAL: Document Requirements
The LaTeX file MUST be a complete, standalone document that can be compiled independently.

**MANDATORY: The document MUST start with \\documentclass[11pt,a4paper]{article} - DO NOT start from \\section or any other command.**

The document must include in this EXACT order:
1. Document class declaration: \\documentclass[11pt,a4paper]{article}
2. ALL required packages (see list below)
3. Package configurations (hyperref, fancyhdr, etc.)
4. \\begin{document}
5. Title, author, date, and \\maketitle
6. Section content starting with \\section{...}
7. All document content
8. \\end{document}

**DO NOT write a document that starts with \\section or any content before \\documentclass. The file must begin with \\documentclass[11pt,a4paper]{article} as the very first line.**

## LaTeX Document Structure

### Required Document Preamble
\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\usepackage{booktabs}        % For professional tables
\\usepackage{longtable}       % For multi-page tables
\\usepackage{graphicx}        % For figures
\\usepackage{hyperref}        % For cross-references
\\usepackage{amsmath}         % For mathematical equations
\\usepackage{amsfonts}        % For mathematical fonts
\\usepackage{siunitx}         % For proper unit formatting
\\usepackage{enumitem}        % For better list formatting
\\usepackage{xcolor}         % For colored text if needed
\\usepackage{fancyhdr}       % For headers and footers
\\usepackage{titlesec}       % For section formatting

% Hyperref configuration
\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=cyan,
    pdftitle={CTD Section ${sectionId}: ${section.title}},
    pdfauthor={Regulatory Affairs},
    pdfsubject={Common Technical Document}
}

% Page style
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[C]{CTD Section ${sectionId}: ${section.title}}
\\fancyfoot[C]{\\thepage}

\\begin{document}

\\title{CTD Section ${sectionId}: ${section.title}}
\\author{Regulatory Affairs}
\\date{\\today}
\\maketitle

## Section Formatting Guidelines

### Section Hierarchy
- Use \\section{${sectionId}: ${section.title}} for the main section
- Use \\subsection{} for major subsections
- Use \\subsubsection{} for minor subsections
- Use \\paragraph{} for paragraph-level headings if needed

### Text Formatting
- Use \\textbf{} for bold text (e.g., drug names, important terms)
- Use \\textit{} for italic text (e.g., Latin terms, emphasis)
- Use \\emph{} for emphasis
- Use \\texttt{} for code or technical identifiers
- Avoid excessive formatting; maintain professional appearance

### Tables
- Use \\begin{table}...\\end{table} for tables with captions
- Use booktabs package commands: \\toprule, \\midrule, \\bottomrule
- Use \\begin{longtable} for tables that span multiple pages
- Include table captions using \\caption{}
- Use \\label{} for cross-referencing
- Example structure:
\\begin{table}[h]
\\centering
\\caption{Table Title}
\\label{tab:label}
\\begin{tabular}{ll}
\\toprule
Header 1 & Header 2 \\\\
\\midrule
Data 1 & Data 2 \\\\
\\bottomrule
\\end{tabular}
\\end{table}

### Lists
- Use \\begin{itemize}...\\end{itemize} for bullet points
- Use \\begin{enumerate}...\\end{enumerate} for numbered lists
- Use \\begin{description}...\\end{description} for definition lists
- Use enumitem package for better spacing: \\setlist{itemsep=0.5em}

### Figures
- Use \\begin{figure}...\\end{figure} for figures
- Include \\includegraphics{} for images
- Use \\caption{} for figure captions
- Use \\label{} for cross-referencing
- Example:
\\begin{figure}[h]
\\centering
\\includegraphics[width=0.8\\textwidth]{figure.pdf}
\\caption{Figure Title}
\\label{fig:label}
\\end{figure}

### Mathematical Content
- Use $...$ for inline math
- Use \\[...\\] or \\begin{equation}...\\end{equation} for displayed equations
- Use siunitx package for units: \\SI{25}{\\milli\\gram}
- Use proper mathematical notation for statistical data

### Cross-References
- Use \\ref{} to reference sections, tables, figures
- Use \\pageref{} to reference page numbers
- Use \\autoref{} (with hyperref) for automatic reference types

### Special Characters
- Use proper LaTeX commands for special characters:
  - \\% for percent sign
  - \\& for ampersand
  - \\# for hash
  - \\$ for dollar sign
  - \\textdegree{} for degree symbol
  - \\textpm{} for plus-minus
  - \\textsuperscript{} for superscripts

### Regulatory-Specific Formatting
- Use consistent terminology throughout
- Format drug names consistently (consider using \\newcommand for repeated terms)
- Use proper formatting for batch numbers, lot numbers, reference numbers
- Format dates consistently (consider using datetime package)
- Use proper formatting for regulatory references (e.g., FDA guidance, ICH guidelines)

## Task Steps

1. Read the tags.md file from: ${tagsPath}
   - This file contains a list of documents tagged for this section
   - Each entry has a PDF name and a path to the processed document folder

2. **IMPORTANT: Reading Document Content**
   - The paths in tags.md are RELATIVE PATHS from the section folder: ${sectionFolderPath}
   - These paths point to FOLDERS (not PDF files) that contain processed document content
   - Each folder contains:
     - A .mmd file (markdown content extracted from the PDF) - the filename may vary (e.g., content.mmd, file-1.mmd, etc.)
     - An info.json file (metadata and summary)

   **Step-by-step process to read a document:**
   a. Read tags.md to get the relative path (e.g., \`../../documents/FP/FP Spec_Levofloxacin Tab USP 500 mg\`)
   b. Use path.join() or path.resolve() to combine: \`${sectionFolderPath}\` + relative path from tags.md
     - Example: If section folder is \`/workspace/dossier/module-3/section-3.2.P.5\` and path is \`../../documents/FP/Report\`
     - Result: \`/workspace/dossier/module-3/section-3.2.P.5/../../documents/FP/Report\` which resolves to \`/workspace/documents/FP/Report\`
   c. **CRITICAL**: First, LIST the directory contents using list_directory tool to see what files exist
   d. Find the .mmd file in that directory (it may be named anything ending in .mmd - do NOT assume a specific name)
   e. Read the .mmd file you found
   f. Read the \`info.json\` file from the same folder

   **CRITICAL RULES:**
   - **NEVER** construct absolute paths manually by concatenating workspace root + path from tags.md
   - **ALWAYS** use path.join() or path.resolve() with the section folder path
   - **ALWAYS** list the directory first to find the actual .mmd filename - do NOT guess the filename
   - **DO NOT** try to read PDF files directly - only read .mmd and info.json files from the processed folders
   - If a document folder doesn't exist or files are missing, note it and continue with available documents

3. Use function1-5 tools if you need additional pharmaceutical information:
   - function1: Drug information
   - function2: Regulatory compliance information
   - function3: Clinical trial data
   - function4: Manufacturing and quality control information
   - function5: Safety and pharmacovigilance data

4. Generate comprehensive regulatory submission content following ICH M4(R4) guidelines
   - Use all available document content from step 2
   - If some documents couldn't be read, proceed with available content
   - Include a note in the document if any expected documents were unavailable

5. Write a COMPLETE STANDALONE LaTeX document to: ${texFilePath}

   **CRITICAL REQUIREMENTS FOR THE OUTPUT FILE:**
   - The file MUST start with: \\documentclass[11pt,a4paper]{article}
   - Include ALL packages listed in the preamble section below
   - Include ALL package configurations
   - Include \\begin{document} before any content
   - Include \\title{}, \\author{}, \\date{}, and \\maketitle
   - Then include your section content starting with \\section{${sectionId}: ${section.title}}
   - End with \\end{document}

   **DO NOT:**
   - Start the file with \\section or any other command
   - Skip the document class declaration
   - Skip any required packages
   - Skip \\begin{document} or \\end{document}
   - Write a partial document - it must be complete and compilable

## ICH M4(R4) Writing Principles
- **Clarity and Precision**: Use clear, precise language. Avoid ambiguity. Use standard regulatory terminology.
- **Completeness**: Include all relevant information from source documents. Do not omit critical data, specifications, or findings.
- **Objectivity**: Present data objectively. Use factual statements supported by evidence from source documents.
- **Structure**: Follow ICH CTD structure with appropriate LaTeX sectioning commands
- **Regulatory Tone**: Write in formal, professional regulatory language
- **Data Presentation**: Present numerical data clearly with appropriate units using siunitx package
- **Compliance**: Ensure content meets regulatory requirements for the specified CTD section

## Document Reading Example

If tags.md contains:
\`\`\`
## Placements
- [Report.pdf](../../documents/M5-Clinical/Reports/Report)
\`\`\`

**Correct approach:**
1. The path in tags.md is: \`../../documents/M5-Clinical/Reports/Report\` (relative to section folder)
2. Section folder is: \`${sectionFolderPath}\`
3. Resolve the full path using path.join(): \`path.join("${sectionFolderPath}", "../../documents/M5-Clinical/Reports/Report")\`
   - This will correctly resolve to the document folder
4. **FIRST**: Use list_directory tool on the resolved folder path to see what files exist
5. Find the .mmd file in the directory listing (it may be named \`content.mmd\`, \`Report.mmd\`, \`file-1.mmd\`, or anything else ending in .mmd)
6. Read the .mmd file you found (using the exact filename from the directory listing)
7. Read \`info.json\` from the same folder for metadata and summary

**Incorrect approach (DO NOT DO THIS):**
- DO NOT try to read PDF files directly (e.g., \`Report.pdf\`)
- DO NOT construct absolute paths by manually concatenating workspace root + path from tags.md
  - WRONG: \`/Users/.../workspace/documents/FP/Report\` (manually constructed)
  - CORRECT: Use path.join(sectionFolderPath, relativePathFromTags)
- DO NOT assume paths are absolute - they are always relative to the section folder
- DO NOT guess .mmd filenames - always list the directory first to find the actual filename
- DO NOT try to read files like \`Report.mmd\` or \`file-1.mmd\` without first listing the directory
- If a path looks like it ends with .pdf, it's still a folder name, not a file

## Document References Section
Include a section listing all supporting documents with their placement/reference status. Format as a table or list.

## Example Document Structure
**This is the EXACT structure your output file must follow. Copy this structure and fill in the content:**

\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm}
\\usepackage{booktabs}        % For professional tables
\\usepackage{longtable}       % For multi-page tables
\\usepackage{graphicx}        % For figures
\\usepackage{hyperref}        % For cross-references
\\usepackage{amsmath}         % For mathematical equations
\\usepackage{amsfonts}        % For mathematical fonts
\\usepackage{siunitx}         % For proper unit formatting
\\usepackage{enumitem}        % For better list formatting
\\usepackage{xcolor}         % For colored text if needed
\\usepackage{fancyhdr}       % For headers and footers
\\usepackage{titlesec}       % For section formatting

% Hyperref configuration
\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=cyan,
    pdftitle={CTD Section ${sectionId}: ${section.title}},
    pdfauthor={Regulatory Affairs},
    pdfsubject={Common Technical Document}
}

% Page style
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[C]{CTD Section ${sectionId}: ${section.title}}
\\fancyfoot[C]{\\thepage}

\\begin{document}

\\title{CTD Section ${sectionId}: ${section.title}}
\\author{Regulatory Affairs}
\\date{\\today}
\\maketitle

\\section{${sectionId}: ${section.title}}

\\subsection{Overview}
[Content here]

\\subsection{Detailed Information}
[Content here]

\\begin{table}[h]
\\centering
\\caption{Supporting Documents}
\\label{tab:documents}
\\begin{tabular}{ll}
\\toprule
Document Name & Status \\\\
\\midrule
[Document entries] & [Placement/Reference] \\\\
\\bottomrule
\\end{tabular}
\\end{table}

\\subsection{Document References}
\\begin{itemize}
\\item Document 1 (placed)
\\item Document 2 (referenced)
\\end{itemize}

\\end{document}

**REMINDER: Your output file MUST start with \\documentclass[11pt,a4paper]{article} as the very first line. The document must be complete and standalone - it should compile independently without any additional files or preamble.**

Work autonomously and complete the section generation using all available tools. Ensure the LaTeX code is valid, complete, and compilable as a standalone document. The file you write must begin with \\documentclass and end with \\end{document}.`
	}

	/**
	 * Creates a subagent (Task instance) with access to both PLAN and ACT mode tools
	 */
	private async createSubagentTask(
		sectionId: string,
		section: CTDSectionDef,
		sectionFolderPath: string,
		tagsPath: string,
		controller: Controller,
		subagentPrompt: string,
	): Promise<Task> {
		const stateManager = StateManager.get()
		const shellIntegrationTimeout = stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		const terminalReuseEnabled = stateManager.getGlobalStateKey("terminalReuseEnabled")
		const vscodeTerminalExecutionMode = stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
		const terminalOutputLineLimit = stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
		const subagentTerminalOutputLineLimit = stateManager.getGlobalSettingsKey("subagentTerminalOutputLineLimit")
		const defaultTerminalProfile = stateManager.getGlobalSettingsKey("defaultTerminalProfile")

		// Setup workspace manager
		const workspaceManager = await setupWorkspaceManager({
			stateManager,
			detectRoots: detectWorkspaceRoots,
		})

		const cwd = workspaceManager?.getPrimaryRoot()?.path || this.workspaceRoot
		const taskId = `dossier-subagent-${sectionId}-${Date.now()}`

		// Acquire task lock
		const lockResult = await tryAcquireTaskLockWithRetry(taskId)
		const taskLockAcquired = !!(lockResult.acquired || lockResult.skipped)

		// Create Task instance in ACT mode (but with subagent flag in context)
		const task = new Task({
			controller,
			mcpHub: controller.mcpHub,
			updateTaskHistory: async () => [], // Subagents don't update main history
			postStateToWebview: async () => {}, // Subagents don't update UI
			reinitExistingTaskFromId: async () => {},
			cancelTask: async () => {},
			shellIntegrationTimeout,
			terminalReuseEnabled: terminalReuseEnabled ?? true,
			terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
			subagentTerminalOutputLineLimit: subagentTerminalOutputLineLimit ?? 2000,
			defaultTerminalProfile: defaultTerminalProfile ?? "default",
			vscodeTerminalExecutionMode: vscodeTerminalExecutionMode || "backgroundExec",
			cwd,
			stateManager,
			workspaceManager,
			task: subagentPrompt,
			images: undefined,
			files: undefined,
			historyItem: undefined,
			taskId,
			taskLockAcquired,
		})

		// Set mode to "act" and disable strict plan mode for subagents
		// The Task class will automatically detect subagent tasks by taskId prefix
		// and add isSubagent to runtimePlaceholders
		stateManager.setGlobalState("mode", "act")
		stateManager.setGlobalState("strictPlanModeEnabled", false)

		return task
	}

	/**
	 * Runs a subagent task and waits for completion
	 */
	private async runSubagentTask(
		task: Task,
		sectionId: string,
		subagentPrompt: string,
		onProgress?: (sectionId: string, status: string) => void,
	): Promise<{ success: boolean; error?: string }> {
		return new Promise((resolve) => {
			if (onProgress) {
				onProgress(sectionId, `Subagent started`)
			}

			let lastStateCheck = Date.now()
			let lastStateString = ""
			let checkCount = 0
			const maxStuckChecks = 150 // 5 minutes of no state change (150 * 2 seconds)
			let resolved = false

			// Helper to resolve once
			const resolveOnce = (result: { success: boolean; error?: string }) => {
				if (!resolved) {
					resolved = true
					resolve(result)
				}
			}

			// Start the task with the subagent prompt
			task.startTask(subagentPrompt, undefined, undefined).catch((error) => {
				console.error(`Error starting subagent task for section ${sectionId}:`, error)
				resolveOnce({
					success: false,
					error: `Failed to start subagent: ${error instanceof Error ? error.message : String(error)}`,
				})
			})

			// Get section folder path once
			const sectionFolderPath = this.sectionToFolderPath(sectionId)
			if (!sectionFolderPath) {
				resolveOnce({ success: false, error: `Could not determine folder path for section ${sectionId}` })
				return
			}
			const contentPath = path.join(sectionFolderPath, "content.tex")

			// Monitor task completion
			const checkInterval = setInterval(async () => {
				if (resolved) {
					clearInterval(checkInterval)
					return
				}

				checkCount++
				const state = task.taskState
				const currentStateString = JSON.stringify({
					isStreaming: state.isStreaming,
					didCompleteReadingStream: state.didCompleteReadingStream,
					userMessageContentReady: state.userMessageContentReady,
				})

				// Check if state changed
				if (currentStateString !== lastStateString) {
					lastStateString = currentStateString
					lastStateCheck = Date.now()
					console.log(`[Dossier Subagent ${sectionId}] State changed: ${currentStateString}`)
				}

				// Check if task appears stuck (no state change for 5 minutes)
				if (Date.now() - lastStateCheck > 5 * 60 * 1000) {
					console.warn(`[Dossier Subagent ${sectionId}] Task appears stuck - no state change for 5 minutes`)
					// Check if file exists anyway
					try {
						await fs.promises.access(contentPath, fs.constants.F_OK)
						console.log(`[Dossier Subagent ${sectionId}] File exists despite stuck state, marking as complete`)
						clearInterval(checkInterval)
						if (onProgress) {
							onProgress(sectionId, `Completed (file found despite stuck state)`)
						}
						resolveOnce({ success: true })
						return
					} catch {
						// File doesn't exist, continue waiting
					}
				}

				// Check if task is complete (not streaming and stream reading completed)
				if (!state.isStreaming && state.didCompleteReadingStream && state.userMessageContentReady) {
					clearInterval(checkInterval)

					// Give it a moment for file writes to complete
					await new Promise((resolve) => setTimeout(resolve, 2000))

					// Verify content.tex was created
					try {
						await fs.promises.access(contentPath, fs.constants.F_OK)
						if (onProgress) {
							onProgress(sectionId, `Completed`)
						}
						resolveOnce({ success: true })
					} catch {
						// File doesn't exist yet, wait a bit more and check again
						console.warn(
							`[Dossier Subagent ${sectionId}] Task complete but file not found, waiting 5 more seconds...`,
						)
						await new Promise((resolve) => setTimeout(resolve, 5000))
						try {
							await fs.promises.access(contentPath, fs.constants.F_OK)
							if (onProgress) {
								onProgress(sectionId, `Completed`)
							}
							resolveOnce({ success: true })
						} catch {
							resolveOnce({ success: false, error: `Content file not created for section ${sectionId}` })
						}
					}
				} else {
					// Log state every 30 seconds for debugging
					if (checkCount % 15 === 0) {
						console.log(
							`[Dossier Subagent ${sectionId}] Still running - isStreaming: ${state.isStreaming}, didCompleteReadingStream: ${state.didCompleteReadingStream}, userMessageContentReady: ${state.userMessageContentReady}`,
						)
					}

					// Also check if file exists even if state doesn't indicate completion
					// (sometimes the file is written but state flags aren't updated)
					if (checkCount % 10 === 0) {
						try {
							await fs.promises.access(contentPath, fs.constants.F_OK)
							console.log(`[Dossier Subagent ${sectionId}] File found before state completion, marking as complete`)
							clearInterval(checkInterval)
							if (onProgress) {
								onProgress(sectionId, `Completed (file found)`)
							}
							resolveOnce({ success: true })
							return
						} catch {
							// File doesn't exist yet, continue
						}
					}
				}
			}, 2000) // Check every 2 seconds

			// Timeout after 30 minutes
			setTimeout(
				() => {
					if (!resolved) {
						clearInterval(checkInterval)
						task.abortTask()
						console.error(`[Dossier Subagent ${sectionId}] Timeout after 30 minutes`)
						resolveOnce({ success: false, error: `Subagent timeout for section ${sectionId} after 30 minutes` })
					}
				},
				30 * 60 * 1000,
			)
		})
	}

	/**
	 * Generates content for a single section using an AI subagent
	 */
	private async generateSectionWithSubagent(
		sectionId: string,
		section: CTDSectionDef,
		moduleNum: number,
		controller: Controller,
		onProgress?: (sectionId: string, status: string) => void,
	): Promise<{ success: boolean; sectionId: string; moduleNum: number; error?: string }> {
		try {
			const sectionFolderPath = this.sectionToFolderPath(sectionId)
			if (!sectionFolderPath) {
				return { success: false, sectionId, moduleNum, error: `Cannot determine folder path for section ${sectionId}` }
			}

			// Check if section folder exists
			try {
				const stat = await fs.promises.stat(sectionFolderPath)
				if (!stat.isDirectory()) {
					return {
						success: false,
						sectionId,
						moduleNum,
						error: `Section folder is not a directory: ${sectionFolderPath}`,
					}
				}
			} catch {
				return { success: false, sectionId, moduleNum, error: `Section folder does not exist: ${sectionFolderPath}` }
			}

			const tagsPath = path.join(sectionFolderPath, "tags.md")

			// Create subagent prompt with LaTeX guidelines
			const subagentPrompt = this.createSubagentLaTeXPrompt(sectionId, section, sectionFolderPath, tagsPath)

			// Create and run subagent task
			const task = await this.createSubagentTask(
				sectionId,
				section,
				sectionFolderPath,
				tagsPath,
				controller,
				subagentPrompt,
			)
			const result = await this.runSubagentTask(task, sectionId, subagentPrompt, onProgress)

			return { ...result, sectionId, moduleNum }
		} catch (error) {
			const errorMsg = `Subagent error for section ${sectionId}: ${error instanceof Error ? error.message : String(error)}`
			console.error(errorMsg)
			return { success: false, sectionId, moduleNum, error: errorMsg }
		}
	}

	/**
	 * Gets modules in regulatory submission order
	 */
	private getModulesInOrder(): CTDModuleDef[] {
		// Order: Module 3 (Quality) → Module 5 (Clinical) → Module 2 (Summaries) → Module 1 (Administrative)
		const moduleOrder = [3, 5, 2, 1]
		const modules: CTDModuleDef[] = []

		for (const moduleNum of moduleOrder) {
			const module = EAC_NMRA_TEMPLATE.modules.find((m) => m.moduleNumber === moduleNum)
			if (module) {
				modules.push(module)
			}
		}

		return modules
	}

	/**
	 * Finds a section by ID or name (case-insensitive partial match)
	 */
	private findSectionByNameOrId(sectionNameOrId: string): {
		sectionId: string
		section: CTDSectionDef
		moduleNum: number
	} | null {
		const searchTerm = sectionNameOrId.toLowerCase().trim()

		// First, try exact ID match
		for (const module of EAC_NMRA_TEMPLATE.modules) {
			if (module.sections[sectionNameOrId]) {
				return {
					sectionId: sectionNameOrId,
					section: module.sections[sectionNameOrId],
					moduleNum: module.moduleNumber,
				}
			}
		}

		// Then, try case-insensitive partial match on section IDs
		for (const module of EAC_NMRA_TEMPLATE.modules) {
			for (const [sectionId, section] of Object.entries(module.sections)) {
				if (sectionId.toLowerCase().includes(searchTerm)) {
					return {
						sectionId,
						section,
						moduleNum: module.moduleNumber,
					}
				}
			}
		}

		// Finally, try case-insensitive partial match on section titles
		for (const module of EAC_NMRA_TEMPLATE.modules) {
			for (const [sectionId, section] of Object.entries(module.sections)) {
				if (section.title.toLowerCase().includes(searchTerm)) {
					return {
						sectionId,
						section,
						moduleNum: module.moduleNumber,
					}
				}
			}
		}

		return null
	}

	/**
	 * Generates content for a single section by name or ID using an AI subagent
	 */
	async generateSectionByName(
		sectionNameOrId: string,
		onProgress?: (status: string) => void,
	): Promise<{ success: boolean; error?: string }> {
		// Check if dossier folder exists
		try {
			const stat = await fs.promises.stat(this.dossierPath)
			if (!stat.isDirectory()) {
				return {
					success: false,
					error: `Dossier folder does not exist: ${this.dossierPath}. Run /create-dossier first.`,
				}
			}
		} catch {
			return {
				success: false,
				error: `Dossier folder does not exist: ${this.dossierPath}. Run /create-dossier first.`,
			}
		}

		// Check if controller is available (required for subagents)
		if (!this.controller) {
			return {
				success: false,
				error: `Controller not available. Cannot create AI subagent.`,
			}
		}

		// Find the section
		const sectionInfo = this.findSectionByNameOrId(sectionNameOrId)
		if (!sectionInfo) {
			return {
				success: false,
				error: `Section not found: "${sectionNameOrId}". Please provide a valid section ID (e.g., "3.2.P.5") or section name.`,
			}
		}

		const { sectionId, section, moduleNum } = sectionInfo

		// Check if it's a leaf section (only leaf sections can be generated)
		if (section.children && section.children.length > 0) {
			return {
				success: false,
				error: `Section "${sectionId}: ${section.title}" is not a leaf section (it has ${section.children.length} child sections). Only leaf sections can be generated. Please specify a specific leaf section.`,
			}
		}

		if (onProgress) {
			onProgress(`Found section: ${sectionId}: ${section.title}`)
		}

		// Generate the section using subagent
		try {
			const result = await this.generateSectionWithSubagent(
				sectionId,
				section,
				moduleNum,
				this.controller,
				(id, status) => {
					if (onProgress) {
						onProgress(`${id}: ${status}`)
					}
				},
			)

			if (result.success) {
				return { success: true }
			} else {
				return {
					success: false,
					error: result.error || `Failed to generate section ${sectionId}`,
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			return {
				success: false,
				error: `Error generating section ${sectionId}: ${errorMessage}`,
			}
		}
	}

	/**
	 * Generates content for all leaf sections in the dossier using parallel AI subagents
	 */
	async generateAllSections(
		onProgress?: (stage: string, details?: string) => void,
		onSectionComplete?: (sectionId: string, moduleNum: number) => void,
	): Promise<{ success: boolean; sectionsGenerated: number; errors: string[] }> {
		const errors: string[] = []
		let sectionsGenerated = 0

		// Check if dossier folder exists
		try {
			const stat = await fs.promises.stat(this.dossierPath)
			if (!stat.isDirectory()) {
				return {
					success: false,
					sectionsGenerated: 0,
					errors: [`Dossier folder does not exist: ${this.dossierPath}`],
				}
			}
		} catch {
			return {
				success: false,
				sectionsGenerated: 0,
				errors: [`Dossier folder does not exist: ${this.dossierPath}. Run /create-dossier first.`],
			}
		}

		// Check if controller is available (required for subagents)
		if (!this.controller) {
			return {
				success: false,
				sectionsGenerated: 0,
				errors: [`Controller not available. Cannot create AI subagents.`],
			}
		}

		// Get modules in regulatory order
		const modules = this.getModulesInOrder()

		// Collect all sections across all modules
		const allSections: Array<{ sectionId: string; section: CTDSectionDef; moduleNum: number }> = []
		for (const module of modules) {
			if (onProgress) {
				onProgress("processing", `Collecting sections for Module ${module.moduleNumber}: ${module.title}`)
			}

			const leafSections = this.getLeafSections(module)
			for (const sectionId of leafSections) {
				const section = module.sections[sectionId]
				if (section) {
					allSections.push({ sectionId, section, moduleNum: module.moduleNumber })
				}
			}
		}

		if (onProgress) {
			onProgress("processing", `Starting ${allSections.length} AI subagents in parallel...`)
		}

		// Execute all subagents in parallel with concurrency control
		// Reduced concurrency to avoid rate limits - subagents make many API calls
		const concurrencyLimit = 2 // Process max 2 subagents concurrently to avoid rate limit errors
		const subagentStartDelay = 3000 // 3 seconds delay between starting subagents to stagger API calls
		const batchDelay = 5000 // 5 seconds delay between batches to allow rate limit recovery
		const results: Array<{ success: boolean; sectionId: string; moduleNum: number; error?: string }> = []

		// Process subagents in batches
		for (let i = 0; i < allSections.length; i += concurrencyLimit) {
			const batch = allSections.slice(i, i + concurrencyLimit)

			if (onProgress) {
				onProgress(
					"processing",
					`Processing batch ${Math.floor(i / concurrencyLimit) + 1} of ${Math.ceil(allSections.length / concurrencyLimit)} (${batch.length} AI subagents)`,
				)
			}

			// Launch subagents with staggered delays to avoid rate limits
			const batchPromises = batch.map(({ sectionId, section, moduleNum }, index) => {
				// Add delay before starting each subagent to stagger API calls
				return new Promise<{ success: boolean; sectionId: string; moduleNum: number; error?: string }>((resolve) => {
					setTimeout(async () => {
						try {
							const result = await this.generateSectionWithSubagent(
								sectionId,
								section,
								moduleNum,
								this.controller!,
								(id, status) => {
									if (onProgress) {
										onProgress("section", `${id}: ${status}`)
									}
								},
							)
							resolve(result)
						} catch (error) {
							resolve({
								success: false,
								sectionId,
								moduleNum,
								error: error instanceof Error ? error.message : String(error),
							})
						}
					}, index * subagentStartDelay)
				})
			})

			// Wait for all subagents in batch to complete
			const batchResults = await Promise.all(batchPromises)
			results.push(...batchResults)

			// Process results
			for (const result of batchResults) {
				if (result.success) {
					sectionsGenerated++
					if (onSectionComplete) {
						onSectionComplete(result.sectionId, result.moduleNum)
					}
				} else if (result.error) {
					errors.push(result.error)
				}
			}

			// Add delay between batches to allow rate limit recovery (except for last batch)
			if (i + concurrencyLimit < allSections.length) {
				if (onProgress) {
					onProgress("processing", `Waiting ${batchDelay / 1000}s before next batch to avoid rate limits...`)
				}
				await new Promise((resolve) => setTimeout(resolve, batchDelay))
			}
		}

		return {
			success: errors.length === 0,
			sectionsGenerated,
			errors,
		}
	}
}
