import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"

/**
 * Entry in the processing index tracking a processed PDF
 */
export interface ProcessingIndexEntry {
	/** Relative path from workspace root to source PDF */
	sourcePath: string
	/** SHA-256 hash of PDF content */
	sourceHash: string
	/** Relative path from workspace root to output folder in documents/ */
	outputFolder: string
	/** ISO timestamp when processing completed */
	processedAt: string
	/** Processing version for future compatibility */
	processingVersion: string
}

/**
 * Processing index structure
 */
interface ProcessingIndex {
	/** Index format version */
	version: string
	/** Entries keyed by source file hash */
	entries: Record<string, ProcessingIndexEntry>
}

/**
 * Service for tracking processed PDFs using a hash-based index
 * Provides fast lookups and handles file moves/renames via content hashing
 */
export class PdfProcessingTracker {
	private readonly indexPath: string
	private index: ProcessingIndex | null = null
	private readonly indexVersion = "1.0"

	constructor(workspaceRoot: string) {
		this.indexPath = path.join(workspaceRoot, ".pdf-processing-index.json")
	}

	/**
	 * Loads the processing index from disk
	 */
	private async loadIndex(): Promise<ProcessingIndex> {
		if (this.index) {
			return this.index
		}

		try {
			const content = await fs.promises.readFile(this.indexPath, "utf-8")
			this.index = JSON.parse(content) as ProcessingIndex

			// Validate version
			if (this.index.version !== this.indexVersion) {
				console.warn(
					`Processing index version mismatch: expected ${this.indexVersion}, got ${this.index.version}. Resetting index.`,
				)
				this.index = this.createEmptyIndex()
				await this.saveIndex()
			}

			return this.index
		} catch (error) {
			// Index doesn't exist or is corrupted, create new one
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				this.index = this.createEmptyIndex()
				return this.index
			}
			console.error(`Error loading processing index: ${error}`)
			this.index = this.createEmptyIndex()
			return this.index
		}
	}

	/**
	 * Saves the processing index to disk
	 */
	private async saveIndex(): Promise<void> {
		if (!this.index) {
			return
		}

		try {
			await fs.promises.writeFile(this.indexPath, JSON.stringify(this.index, null, 2), "utf-8")
		} catch (error) {
			console.error(`Error saving processing index: ${error}`)
			throw error
		}
	}

	/**
	 * Creates an empty index structure
	 */
	private createEmptyIndex(): ProcessingIndex {
		return {
			version: this.indexVersion,
			entries: {},
		}
	}

	/**
	 * Computes SHA-256 hash of a file
	 */
	private async computeFileHash(filePath: string): Promise<string> {
		try {
			const fileBuffer = await fs.promises.readFile(filePath)
			return crypto.createHash("sha256").update(fileBuffer).digest("hex")
		} catch (error) {
			console.error(`Error computing hash for ${filePath}: ${error}`)
			throw error
		}
	}

	/**
	 * Checks if output folder has processed content (markdown files)
	 */
	private async hasProcessedContent(outputPath: string): Promise<boolean> {
		try {
			await fs.promises.access(outputPath)
			const entries = await fs.promises.readdir(outputPath)
			return entries.some((f) => f.endsWith(".mmd") || f.endsWith(".md"))
		} catch {
			return false
		}
	}

	/**
	 * Checks if a PDF file has already been processed
	 * Uses content hash to handle file moves/renames
	 * Returns true only if:
	 * 1. File hash exists in index
	 * 2. Output folder exists with content
	 * 3. Source file hash still matches (file hasn't changed)
	 */
	async isProcessed(pdfPath: string, workspaceRoot: string): Promise<boolean> {
		try {
			// Compute hash of source PDF
			const hash = await this.computeFileHash(pdfPath)

			// Load index
			const index = await this.loadIndex()
			const entry = index.entries[hash]

			if (!entry) {
				return false
			}

			// Verify output folder exists and has content
			const outputPath = path.join(workspaceRoot, entry.outputFolder)
			const hasContent = await this.hasProcessedContent(outputPath)

			if (!hasContent) {
				// Output folder missing or empty, remove from index
				delete index.entries[hash]
				await this.saveIndex()
				return false
			}

			// Verify source file hasn't changed (hash still matches)
			const currentHash = await this.computeFileHash(pdfPath)
			if (currentHash !== hash) {
				// File changed, needs reprocessing - remove old entry
				delete index.entries[hash]
				await this.saveIndex()
				return false
			}

			return true
		} catch (error) {
			console.error(`Error checking if PDF is processed: ${error}`)
			return false
		}
	}

	/**
	 * Marks a PDF as processed in the index
	 */
	async markProcessed(pdfPath: string, outputFolder: string, workspaceRoot: string, sourceHash?: string): Promise<void> {
		try {
			// Compute hash if not provided
			const hash = sourceHash || (await this.computeFileHash(pdfPath))
			const relativePath = path.relative(workspaceRoot, pdfPath)
			const relativeOutputFolder = path.relative(workspaceRoot, outputFolder)

			const index = await this.loadIndex()
			index.entries[hash] = {
				sourcePath: relativePath,
				sourceHash: hash,
				outputFolder: relativeOutputFolder,
				processedAt: new Date().toISOString(),
				processingVersion: this.indexVersion,
			}

			await this.saveIndex()
		} catch (error) {
			console.error(`Error marking PDF as processed: ${error}`)
			throw error
		}
	}

	/**
	 * Gets the output folder path for a processed PDF (if it exists in index)
	 */
	async getOutputFolder(pdfPath: string, workspaceRoot: string): Promise<string | null> {
		try {
			const hash = await this.computeFileHash(pdfPath)
			const index = await this.loadIndex()
			const entry = index.entries[hash]

			if (!entry) {
				return null
			}

			return path.join(workspaceRoot, entry.outputFolder)
		} catch {
			return null
		}
	}

	/**
	 * Gets the source hash for a PDF file
	 */
	async getSourceHash(pdfPath: string): Promise<string> {
		return this.computeFileHash(pdfPath)
	}

	/**
	 * Removes an entry from the index (e.g., when output is deleted)
	 */
	async removeEntry(pdfPath: string): Promise<void> {
		try {
			const hash = await this.computeFileHash(pdfPath)
			const index = await this.loadIndex()

			if (index.entries[hash]) {
				delete index.entries[hash]
				await this.saveIndex()
			}
		} catch (error) {
			console.error(`Error removing entry from index: ${error}`)
		}
	}

	/**
	 * Cleans up orphaned entries (where output folder no longer exists)
	 */
	async cleanupOrphanedEntries(workspaceRoot: string): Promise<number> {
		const index = await this.loadIndex()
		let removedCount = 0

		for (const [hash, entry] of Object.entries(index.entries)) {
			const outputPath = path.join(workspaceRoot, entry.outputFolder)
			const exists = await this.hasProcessedContent(outputPath)

			if (!exists) {
				delete index.entries[hash]
				removedCount++
			}
		}

		if (removedCount > 0) {
			await this.saveIndex()
		}

		return removedCount
	}

	/**
	 * Gets all entries in the index (for debugging/inspection)
	 */
	async getAllEntries(): Promise<ProcessingIndexEntry[]> {
		const index = await this.loadIndex()
		return Object.values(index.entries)
	}
}
