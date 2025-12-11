import { StateManager } from "@core/storage/StateManager"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import * as fs from "fs"
import * as path from "path"

/**
 * Represents a document entry from tags.md
 */
export interface DocumentEntry {
	pdfName: string
	relativePath: string
	confidence: string
	type: "placement" | "reference"
}

/**
 * Represents the parsed content of a tags.md file
 */
export interface ParsedTagsFile {
	sectionId: string
	sectionTitle: string
	drugName: string
	apiName: string
	placements: DocumentEntry[]
	references: DocumentEntry[]
}

/**
 * Represents document content loaded from processed folders
 */
export interface DocumentContent {
	entry: DocumentEntry
	mmdContent: string
	infoJson: any
	estimatedTokens: number
}

/**
 * Represents a chunk of documents for processing
 */
export interface DocumentChunk {
	documents: DocumentContent[]
	totalTokens: number
	chunkIndex: number
}

/**
 * Service for processing documents from tags.md files
 * Handles parsing, reading document content, and chunking for context management
 */
export class DocumentProcessingService {
	private workspaceRoot: string
	private documentsBasePath: string
	private submissionsPath: string | undefined

	// Token estimation: ~4 characters per token
	private static readonly CHARS_PER_TOKEN = 4
	// Default max tokens per chunk (50% of typical context window)
	private static readonly DEFAULT_MAX_TOKENS_PER_CHUNK = 60000

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
		this.documentsBasePath = path.join(workspaceRoot, "documents")

		// Get submissions path from SubmissionsPaneProvider
		try {
			const { SubmissionsPaneProvider } = require("@/hosts/vscode/SubmissionsPaneProvider")
			const submissionsProvider = SubmissionsPaneProvider.getInstance()
			this.submissionsPath = submissionsProvider?.getSubmissionsFolder()
		} catch (error) {
			console.warn(`[DocumentProcessingService] Failed to get submissions path: ${error}`)
		}
	}

	/**
	 * Parses a tags.md file and extracts document information
	 */
	async parseTagsFile(tagsPath: string): Promise<ParsedTagsFile> {
		console.log(`[DocumentProcessingService] Parsing tags file: ${tagsPath}`)

		const content = await fs.promises.readFile(tagsPath, "utf-8")
		console.log(`[DocumentProcessingService] Tags file content length: ${content.length} chars`)

		const lines = content.split("\n")

		const result: ParsedTagsFile = {
			sectionId: "",
			sectionTitle: "",
			drugName: "",
			apiName: "",
			placements: [],
			references: [],
		}

		let currentSection: "none" | "placements" | "references" = "none"

		for (const line of lines) {
			const trimmedLine = line.trim()

			// Parse section header: # Section X.X.X - Title
			const headerMatch = trimmedLine.match(/^#\s+Section\s+([\d.A-Za-z]+)\s*[-–]\s*(.+)$/)
			if (headerMatch) {
				result.sectionId = headerMatch[1]
				result.sectionTitle = headerMatch[2].replace("Document Tags", "").trim()
				continue
			}

			// Parse drug name: Drug Name: Levofloxacin
			const drugNameMatch = trimmedLine.match(/^Drug\s*Name:\s*(.+)$/i)
			if (drugNameMatch) {
				result.drugName = drugNameMatch[1].trim()
				continue
			}

			// Parse API name: API Name: Levofloxacin USP
			const apiNameMatch = trimmedLine.match(/^API\s*Name:\s*(.+)$/i)
			if (apiNameMatch) {
				result.apiName = apiNameMatch[1].trim()
				continue
			}

			// Detect section markers
			if (trimmedLine.startsWith("## Placements")) {
				currentSection = "placements"
				continue
			}
			if (trimmedLine.startsWith("## References")) {
				currentSection = "references"
				continue
			}

			// Parse document entries: - [name.pdf](path) (Confidence)
			const docMatch = trimmedLine.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*\(([^)]+)\)/)
			if (docMatch && currentSection !== "none") {
				const entry: DocumentEntry = {
					pdfName: docMatch[1],
					relativePath: docMatch[2],
					confidence: docMatch[3],
					type: currentSection === "placements" ? "placement" : "reference",
				}

				if (currentSection === "placements") {
					result.placements.push(entry)
				} else {
					result.references.push(entry)
				}
			}
		}

		// If drug name not found in file, try to extract from document names
		if (!result.drugName) {
			result.drugName = this.extractDrugNameFromDocuments([...result.placements, ...result.references])
		}

		// Get drug name from RegulatoryProductConfig using StateManager
		try {
			const stateManager = StateManager.get()
			const currentProduct = stateManager.getGlobalStateKey("currentRegulatoryProduct") as
				| RegulatoryProductConfig
				| undefined

			if (currentProduct?.drugName) {
				// Use the stored drug name for both drugName and apiName
				result.drugName = currentProduct.drugName
				result.apiName = currentProduct.drugName
				console.log(
					`[DocumentProcessingService] Using drug name from RegulatoryProductConfig: ${currentProduct.drugName}`,
				)
			}
		} catch (error) {
			console.warn(`[DocumentProcessingService] Failed to get drug name from RegulatoryProductConfig: ${error}`)
		}

		console.log(`[DocumentProcessingService] Parsed tags file:`)
		console.log(`  Section: ${result.sectionId} - ${result.sectionTitle}`)
		console.log(`  Drug: ${result.drugName}, API: ${result.apiName}`)
		console.log(`  Placements: ${result.placements.length}, References: ${result.references.length}`)

		return result
	}

	/**
	 * Attempts to extract drug name from document names
	 */
	private extractDrugNameFromDocuments(documents: DocumentEntry[]): string {
		// Look for common patterns in document names
		for (const doc of documents) {
			// Pattern: "Drug Name Tab USP" or similar
			const match = doc.pdfName.match(/([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:Tab|Tablet|Cap|Capsule|Inj)/i)
			if (match) {
				return match[1].trim()
			}
		}
		return "Unknown Drug"
	}

	/**
	 * Reads document content from a processed folder
	 * Note: Paths in tags.md are relative to the workspace's documents folder
	 */
	async readDocumentContent(entry: DocumentEntry): Promise<DocumentContent | null> {
		// Use submissions path if available, otherwise fall back to documents base path
		const basePath = this.submissionsPath || this.documentsBasePath
		const documentFolderPath = path.join(basePath, entry.relativePath)

		console.log(`[DocumentProcessingService] Reading document: ${entry.pdfName}`)
		console.log(`[DocumentProcessingService] Submissions path: ${this.submissionsPath}`)
		console.log(`[DocumentProcessingService] Documents base path: ${this.documentsBasePath}`)
		console.log(`[DocumentProcessingService] Using base path: ${basePath}`)
		console.log(`[DocumentProcessingService] Relative path: ${entry.relativePath}`)
		console.log(`[DocumentProcessingService] Full path: ${documentFolderPath}`)

		try {
			const stat = await fs.promises.stat(documentFolderPath)
			if (!stat.isDirectory()) {
				console.warn(`[DocumentProcessingService] Not a directory: ${documentFolderPath}`)
				return null
			}
			console.log(`[DocumentProcessingService] Found directory: ${documentFolderPath}`)
		} catch (error) {
			console.warn(`[DocumentProcessingService] Folder not found: ${documentFolderPath}`)
			console.warn(`[DocumentProcessingService] Error: ${error}`)
			return null
		}

		// Read .mmd file
		let mmdContent = ""
		try {
			const entries = await fs.promises.readdir(documentFolderPath, { withFileTypes: true })
			for (const dirEntry of entries) {
				if (dirEntry.isFile() && dirEntry.name.endsWith(".mmd")) {
					const mmdPath = path.join(documentFolderPath, dirEntry.name)
					mmdContent = await fs.promises.readFile(mmdPath, "utf-8")
					break
				}
			}
		} catch (error) {
			console.warn(`[DocumentProcessingService] Error reading .mmd file: ${error}`)
		}

		// Read info.json
		let infoJson: any = {}
		try {
			const infoPath = path.join(documentFolderPath, "info.json")
			const infoContent = await fs.promises.readFile(infoPath, "utf-8")
			infoJson = JSON.parse(infoContent)
		} catch {
			// info.json may not exist
		}

		if (!mmdContent && !infoJson.summary) {
			console.warn(`[DocumentProcessingService] No content found for: ${entry.pdfName}`)
			return null
		}

		const estimatedTokens = this.estimateTokens(mmdContent + JSON.stringify(infoJson))

		return {
			entry,
			mmdContent,
			infoJson,
			estimatedTokens,
		}
	}

	/**
	 * Reads all documents from a parsed tags file
	 * Paths in tags.md are relative to the workspace's documents folder
	 */
	async readAllDocuments(parsedTags: ParsedTagsFile): Promise<DocumentContent[]> {
		const documents: DocumentContent[] = []

		// Process placements first (higher priority)
		for (const entry of parsedTags.placements) {
			const content = await this.readDocumentContent(entry)
			if (content) {
				documents.push(content)
			}
		}

		// Then process references
		for (const entry of parsedTags.references) {
			const content = await this.readDocumentContent(entry)
			if (content) {
				documents.push(content)
			}
		}

		return documents
	}

	/**
	 * Estimates the number of tokens in a string
	 */
	estimateTokens(text: string): number {
		return Math.ceil(text.length / DocumentProcessingService.CHARS_PER_TOKEN)
	}

	/**
	 * Groups documents into chunks based on token limits
	 */
	groupIntoChunks(
		documents: DocumentContent[],
		maxTokensPerChunk: number = DocumentProcessingService.DEFAULT_MAX_TOKENS_PER_CHUNK,
	): DocumentChunk[] {
		const chunks: DocumentChunk[] = []
		let currentChunk: DocumentContent[] = []
		let currentTokens = 0
		let chunkIndex = 0

		for (const doc of documents) {
			// If adding this document would exceed the limit, start a new chunk
			if (currentTokens + doc.estimatedTokens > maxTokensPerChunk && currentChunk.length > 0) {
				chunks.push({
					documents: currentChunk,
					totalTokens: currentTokens,
					chunkIndex: chunkIndex++,
				})
				currentChunk = []
				currentTokens = 0
			}

			currentChunk.push(doc)
			currentTokens += doc.estimatedTokens
		}

		// Add the last chunk if it has documents
		if (currentChunk.length > 0) {
			chunks.push({
				documents: currentChunk,
				totalTokens: currentTokens,
				chunkIndex: chunkIndex,
			})
		}

		return chunks
	}

	/**
	 * Formats a document chunk as a string for LLM processing
	 */
	formatChunkForLLM(chunk: DocumentChunk): string {
		const parts: string[] = []

		parts.push(`<document_chunk index="${chunk.chunkIndex}" total_tokens="${chunk.totalTokens}">`)

		for (const doc of chunk.documents) {
			parts.push(`<document name="${doc.entry.pdfName}" type="${doc.entry.type}" confidence="${doc.entry.confidence}">`)

			if (doc.infoJson?.summary) {
				parts.push(`<summary>${doc.infoJson.summary}</summary>`)
			}

			if (doc.mmdContent) {
				// Truncate very long content to avoid overwhelming the context
				const maxContentLength = 50000 // ~12.5k tokens
				const content =
					doc.mmdContent.length > maxContentLength
						? doc.mmdContent.substring(0, maxContentLength) + "\n... [content truncated]"
						: doc.mmdContent
				parts.push(`<content>${content}</content>`)
			}

			parts.push(`</document>`)
		}

		parts.push(`</document_chunk>`)

		return parts.join("\n")
	}

	/**
	 * Creates a summary of all documents (for overview purposes)
	 */
	createDocumentSummary(documents: DocumentContent[]): string {
		const parts: string[] = []

		parts.push(`<documents_overview total="${documents.length}">`)

		const placements = documents.filter((d) => d.entry.type === "placement")
		const references = documents.filter((d) => d.entry.type === "reference")

		if (placements.length > 0) {
			parts.push(`<placements count="${placements.length}">`)
			for (const doc of placements) {
				parts.push(`  - ${doc.entry.pdfName} (${doc.estimatedTokens} tokens)`)
			}
			parts.push(`</placements>`)
		}

		if (references.length > 0) {
			parts.push(`<references count="${references.length}">`)
			for (const doc of references) {
				parts.push(`  - ${doc.entry.pdfName} (${doc.estimatedTokens} tokens)`)
			}
			parts.push(`</references>`)
		}

		parts.push(`</documents_overview>`)

		return parts.join("\n")
	}

	/**
	 * Gets the total token count for all documents
	 */
	getTotalTokens(documents: DocumentContent[]): number {
		return documents.reduce((sum, doc) => sum + doc.estimatedTokens, 0)
	}
}
