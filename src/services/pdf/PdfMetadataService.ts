import { buildApiHandler } from "@core/api"
import * as fs from "fs"
import * as path from "path"
import { StateManager } from "@/core/storage/StateManager"

const METADATA_EXTRACTION_PROMPT = {
	system: `You are a senior regulatory dossier specialist at a pharmaceutical company.
You review draft clinical and quality documents and capture metadata that helps regulatory writers quickly understand each file's origin and contents.`,
	instruction: `We are cataloging pharmaceutical regulatory dossier source files.
Review the provided document content and describe:
1. source_of_file: probable origin (eg. CRO, sponsor submission, health authority letter, internal SOP).
2. dossier_summary: concise description or Table-of-Contents style summary useful to a regulatory writer.

Respond strictly as JSON with keys 'source_of_file' and 'dossier_summary'. Do not include any other text or markdown formatting.`,
}

interface PdfMetadata {
	source_of_file: string
	dossier_summary: string
	filepath: string
	processed_at: string
	source_hash?: string // SHA-256 hash of source PDF
	source_path?: string // Original relative path to source PDF
}

// Placeholder values that indicate failed or incomplete extraction
const PLACEHOLDER_VALUES = ["Unknown - LLM extraction failed", "Unable to extract summary", "Unknown", ""]

/**
 * Service for extracting metadata from processed PDF folders using Cline's configured LLM
 */
export class PdfMetadataService {
	/**
	 * Finds all .mmd or .md files in a directory
	 */
	private async findMarkdownFiles(folderPath: string): Promise<string[]> {
		const markdownFiles: string[] = []
		try {
			const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
			for (const entry of entries) {
				if (entry.isFile() && (entry.name.endsWith(".mmd") || entry.name.endsWith(".md"))) {
					markdownFiles.push(path.join(folderPath, entry.name))
				}
			}
		} catch (error) {
			console.error(`Error reading directory ${folderPath}:`, error)
		}
		return markdownFiles
	}

	/**
	 * Reads content from markdown files (up to first 3 files, truncated)
	 */
	private async readMarkdownContent(markdownFiles: string[], maxChars: number = 15000): Promise<string> {
		let content = ""
		const filesToRead = markdownFiles.slice(0, 3) // Read up to 3 files

		for (const filePath of filesToRead) {
			try {
				const fileContent = await fs.promises.readFile(filePath, "utf-8")
				content += `\n\n--- File: ${path.basename(filePath)} ---\n${fileContent}`
			} catch (error) {
				console.error(`Error reading file ${filePath}:`, error)
			}
		}

		// Truncate to prevent token limits
		if (content.length > maxChars) {
			content = content.substring(0, maxChars) + "\n\n[Content truncated...]"
		}

		return content
	}

	/**
	 * Calls Cline's configured LLM to extract metadata
	 * Uses the same pattern as commit-message-generator.ts
	 */
	private async callLlmForMetadata(documentContent: string): Promise<{ source_of_file: string; dossier_summary: string }> {
		try {
			// Get the current API configuration from StateManager (same pattern as commit-message-generator)
			const stateManager = StateManager.get()
			const apiConfiguration = stateManager.getApiConfiguration()

			// Use "act" mode by default (same as commit-message-generator)
			const currentMode = "act"

			// Build the API handler using Cline's configured provider
			const apiHandler = buildApiHandler(apiConfiguration, currentMode)

			// Create messages for the API
			const prompt = `${METADATA_EXTRACTION_PROMPT.instruction}\n\nDocument content:\n${documentContent}`
			const messages = [{ role: "user" as const, content: prompt }]

			// Call the API and stream response
			const stream = apiHandler.createMessage(METADATA_EXTRACTION_PROMPT.system, messages)

			let response = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					response += chunk.text
				}
			}

			// Parse JSON response
			const jsonMatch = response.match(/\{[\s\S]*\}/)
			if (!jsonMatch) {
				throw new Error("No valid JSON found in LLM response")
			}

			return JSON.parse(jsonMatch[0])
		} catch (error) {
			console.error("LLM call failed:", error)
			return {
				source_of_file: "Unknown - LLM extraction failed",
				dossier_summary: "Unable to extract summary",
			}
		}
	}

	/**
	 * Checks if an info.json file has valid (non-placeholder) metadata
	 */
	private isValidMetadata(metadata: PdfMetadata): boolean {
		const sourceValid =
			!!metadata.source_of_file &&
			!PLACEHOLDER_VALUES.some((p) => metadata.source_of_file.toLowerCase().includes(p.toLowerCase()))
		const summaryValid =
			!!metadata.dossier_summary &&
			!PLACEHOLDER_VALUES.some((p) => metadata.dossier_summary.toLowerCase().includes(p.toLowerCase()))

		return sourceValid && summaryValid
	}

	/**
	 * Extracts metadata for a single PDF folder and saves info.json
	 * Skips if valid info.json already exists, re-processes if it has placeholder values
	 * @param sourceHash Optional SHA-256 hash of the source PDF file
	 * @param sourcePath Optional original relative path to the source PDF
	 */
	async extractMetadataForFolder(
		folderPath: string,
		relativePath: string,
		sourceHash?: string,
		sourcePath?: string,
	): Promise<boolean> {
		const infoJsonPath = path.join(folderPath, "info.json")

		// Check if info.json already exists and has valid content
		try {
			const existingContent = await fs.promises.readFile(infoJsonPath, "utf-8")
			const existingMetadata = JSON.parse(existingContent) as PdfMetadata

			if (this.isValidMetadata(existingMetadata)) {
				console.log(`info.json already exists with valid content for ${folderPath}, skipping`)
				return true
			}

			// info.json exists but has placeholder values - will re-process
			console.log(`info.json has placeholder values for ${folderPath}, re-processing`)
		} catch {
			// File doesn't exist or can't be parsed, proceed with extraction
		}

		// Find markdown files
		const markdownFiles = await this.findMarkdownFiles(folderPath)
		if (markdownFiles.length === 0) {
			console.log(`No markdown files found in ${folderPath}`)
			return false
		}

		// Read content
		const content = await this.readMarkdownContent(markdownFiles)
		if (!content.trim()) {
			console.log(`Empty content in ${folderPath}`)
			return false
		}

		// Extract metadata via LLM
		const { source_of_file, dossier_summary } = await this.callLlmForMetadata(content)

		// Create metadata object
		const metadata: PdfMetadata = {
			source_of_file,
			dossier_summary,
			filepath: relativePath,
			processed_at: new Date().toISOString(),
			...(sourceHash && { source_hash: sourceHash }),
			...(sourcePath && { source_path: sourcePath }),
		}

		// Write info.json
		try {
			await fs.promises.writeFile(infoJsonPath, JSON.stringify(metadata, null, 2), "utf-8")
			console.log(`Saved metadata to ${infoJsonPath}`)
			return true
		} catch (error) {
			console.error(`Failed to write info.json for ${folderPath}:`, error)
			return false
		}
	}

	/**
	 * Processes all PDF folders in documents directory
	 */
	async processAllFolders(
		documentsPath: string,
		onProgress?: (processed: number, total: number, current: string) => void,
	): Promise<{ processed: number; total: number; errors: string[] }> {
		const errors: string[] = []
		let processed = 0

		// Find all PDF folders (directories that contain .mmd files)
		const pdfFolders: string[] = []

		async function findPdfFolders(dirPath: string, _basePath: string): Promise<void> {
			try {
				const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
				for (const entry of entries) {
					if (entry.isDirectory()) {
						const fullPath = path.join(dirPath, entry.name)
						// Check if this folder contains markdown files
						const hasMarkdown = (await fs.promises.readdir(fullPath)).some(
							(f) => f.endsWith(".mmd") || f.endsWith(".md"),
						)
						if (hasMarkdown) {
							pdfFolders.push(fullPath)
						}
						// Also check subdirectories
						await findPdfFolders(fullPath, _basePath)
					}
				}
			} catch (error) {
				console.error(`Error scanning ${dirPath}:`, error)
			}
		}

		await findPdfFolders(documentsPath, documentsPath)
		const total = pdfFolders.length

		for (const folderPath of pdfFolders) {
			const relativePath = path.relative(documentsPath, folderPath)

			if (onProgress) {
				onProgress(processed, total, relativePath)
			}

			try {
				await this.extractMetadataForFolder(folderPath, relativePath)
				processed++
			} catch (error) {
				const errorMsg = `Error processing ${relativePath}: ${error}`
				console.error(errorMsg)
				errors.push(errorMsg)
			}
		}

		return { processed, total, errors }
	}
}
