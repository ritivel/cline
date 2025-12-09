import { buildApiHandler } from "@core/api"
import * as fs from "fs"
import * as path from "path"
import { EAC_NMRA_TEMPLATE } from "@/core/ctd/templates/eac-nmra/definition"
import { SECTION_PARENT_MAP } from "@/core/ctd/templates/eac-nmra/prompts"
import type { CTDModuleDef, CTDSectionDef } from "@/core/ctd/types"
import { StateManager } from "@/core/storage/StateManager"

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

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
		this.dossierPath = path.join(workspaceRoot, "dossier")
		this.documentsPath = path.join(workspaceRoot, "documents")
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
	 * Generates content for all leaf sections in the dossier
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

		// Get modules in regulatory order
		const modules = this.getModulesInOrder()

		// Process each module
		for (const module of modules) {
			if (onProgress) {
				onProgress("processing", `Processing Module ${module.moduleNumber}: ${module.title}`)
			}

			// Get all leaf sections for this module
			const leafSections = this.getLeafSections(module)

			// Process sections with concurrency limit and rate limiting
			// Process in batches to avoid hitting rate limits
			const concurrencyLimit = 3 // Process max 3 sections concurrently
			const delayBetweenBatches = 2000 // 2 second delay between batches

			for (let i = 0; i < leafSections.length; i += concurrencyLimit) {
				const batch = leafSections.slice(i, i + concurrencyLimit)

				// Add delay before starting batch (except first batch)
				if (i > 0) {
					await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches))
				}

				// Process batch with staggered start times to avoid simultaneous rate limit hits
				const batchPromises = batch.map(async (sectionId, index) => {
					// Stagger requests within batch: 500ms delay between each request
					if (index > 0) {
						await new Promise((resolve) => setTimeout(resolve, 500 * index))
					}

					const section = module.sections[sectionId]
					if (!section) {
						return false
					}

					try {
						const success = await this.generateSectionContentForLeaf(sectionId, section, (id, status) => {
							if (onProgress) {
								onProgress("section", `${id}: ${status}`)
							}
						})

						if (success) {
							sectionsGenerated++
							if (onSectionComplete) {
								onSectionComplete(sectionId, module.moduleNumber)
							}
						}

						return success
					} catch (error) {
						const errorMsg = `Error generating content for section ${sectionId}: ${error instanceof Error ? error.message : String(error)}`
						console.error(errorMsg)
						errors.push(errorMsg)
						return false
					}
				})

				// Wait for batch to complete before starting next batch
				await Promise.all(batchPromises)
			}
		}

		return {
			success: errors.length === 0,
			sectionsGenerated,
			errors,
		}
	}
}
