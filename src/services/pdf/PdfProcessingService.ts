import axios from "axios"
import extractZip from "extract-zip"
import fs from "fs"
import path from "path"
import { Readable } from "stream"
import { fetch, getAxiosSettings } from "@/shared/net"
import { CtdClassifierServiceV2 } from "./CtdClassifierServiceV2"
import { PdfMetadataService } from "./PdfMetadataService"
import { PdfProcessingTracker } from "./PdfProcessingTracker"

const DUMMY_API_BASE_URL = "https://dummy-api.com"

interface UploadSlot {
	url: string
	key: string
}

interface UploadSlotsResponse {
	uploadUrls: UploadSlot[]
	jobId: string
}

interface PdfFileStatus {
	pdfIndex: number
	pdfName: string
	status: "pending" | "processing" | "completed" | "failed"
	downloadUrl?: string
	error?: string
}

interface JobStatusResponse {
	status: "pending" | "processing" | "completed" | "failed"
	downloadUrl?: string // Legacy: single zip URL for backward compatibility
	error?: string
	// New: per-PDF status array for incremental downloads
	pdfStatuses?: PdfFileStatus[]
	completedCount?: number
	totalCount?: number
}

/**
 * Service for cloud-based PDF processing using S3 presigned URLs
 */
export class PdfProcessingService {
	private readonly apiBaseUrl: string
	private readonly apiToken?: string
	private readonly maxConcurrentUploads: number
	private readonly maxConcurrentDownloads: number
	private abortController: AbortController | null = null
	private readonly metadataService: PdfMetadataService
	private trackerCache: Map<string, PdfProcessingTracker> = new Map()

	constructor(
		apiBaseUrl: string = DUMMY_API_BASE_URL,
		apiToken?: string,
		maxConcurrentUploads: number = 10,
		maxConcurrentDownloads: number = 5,
	) {
		this.apiBaseUrl = apiBaseUrl
		this.apiToken = apiToken
		this.maxConcurrentUploads = maxConcurrentUploads
		this.maxConcurrentDownloads = maxConcurrentDownloads
		this.metadataService = new PdfMetadataService()
	}

	/**
	 * Gets or creates the processing tracker for a workspace
	 */
	private getTracker(workspaceRoot: string): PdfProcessingTracker {
		if (!this.trackerCache.has(workspaceRoot)) {
			this.trackerCache.set(workspaceRoot, new PdfProcessingTracker(workspaceRoot))
		}
		return this.trackerCache.get(workspaceRoot)!
	}

	/**
	 * Cancels the current processing job
	 */
	cancel(): void {
		if (this.abortController) {
			this.abortController.abort()
			this.abortController = null
		}
	}

	private getHeaders() {
		return this.apiToken ? { Authorization: `Bearer ${this.apiToken}` } : {}
	}

	/**
	 * Recursively finds all PDF files in the workspace
	 * Excludes PDFs within the submissions folder
	 */
	private async findPdfFiles(workspaceRoot: string, submissionsFolder?: string): Promise<string[]> {
		const pdfFiles: string[] = []
		const excludedDirs = new Set([".git", "node_modules"])

		// Normalize and resolve paths for comparison (ensure absolute paths)
		const normalizedSubmissionsFolder = submissionsFolder ? path.resolve(path.normalize(submissionsFolder)) : undefined

		async function traverse(currentPath: string): Promise<void> {
			let entries
			try {
				entries = await fs.promises.readdir(currentPath, { withFileTypes: true })
			} catch (error) {
				return
			}

			for (const entry of entries) {
				const fullPath = path.join(currentPath, entry.name)
				const normalizedFullPath = path.resolve(path.normalize(fullPath))

				// Skip if this path is within or equals the submissions folder
				if (
					normalizedSubmissionsFolder &&
					(normalizedFullPath === normalizedSubmissionsFolder ||
						normalizedFullPath.startsWith(normalizedSubmissionsFolder + path.sep))
				) {
					continue
				}

				if (entry.isDirectory()) {
					if (!excludedDirs.has(entry.name)) {
						await traverse(fullPath)
					}
				} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
					pdfFiles.push(fullPath)
				}
			}
		}

		await traverse(workspaceRoot)
		return pdfFiles
	}

	/**
	 * Uploads files to S3 using presigned URLs with concurrency control
	 * Uses a sliding window to maximize throughput
	 */
	private async uploadFilesToS3(
		files: string[],
		uploadUrls: UploadSlot[],
		onProgress?: (uploaded: number, total: number) => void,
	): Promise<void> {
		let uploadedCount = 0
		const activeUploads: Set<Promise<void>> = new Set()

		for (let i = 0; i < files.length; i++) {
			if (this.abortController?.signal.aborted) {
				throw new Error("Operation cancelled")
			}

			// Wait if we've reached the concurrency limit
			if (activeUploads.size >= this.maxConcurrentUploads) {
				await Promise.race(activeUploads)
			}

			if (this.abortController?.signal.aborted) {
				throw new Error("Operation cancelled")
			}

			const filePath = files[i]
			const uploadSlot = uploadUrls[i]

			const uploadTask = async () => {
				const fileStream = fs.createReadStream(filePath)
				try {
					const stats = await fs.promises.stat(filePath)
					await axios.put(uploadSlot.url, fileStream, {
						headers: {
							"Content-Type": "application/pdf",
							"Content-Length": stats.size,
						},
						maxContentLength: Infinity,
						maxBodyLength: Infinity,
						signal: this.abortController?.signal,
					})

					uploadedCount++
					if (onProgress) {
						onProgress(uploadedCount, files.length)
					}
				} catch (error) {
					if (axios.isCancel(error) || (error instanceof Error && error.message === "Operation cancelled")) {
						throw error
					}
					const errorMessage = error instanceof Error ? error.message : String(error)
					throw new Error(`Failed to upload ${filePath}: ${errorMessage}`)
				}
			}

			const promise = uploadTask().then(() => {
				activeUploads.delete(promise)
			})

			activeUploads.add(promise)
		}

		// Wait for all remaining uploads
		await Promise.all(activeUploads)
	}

	/**
	 * Polls job status until completion
	 */
	private async pollJobStatus(jobId: string): Promise<string> {
		// Poll for up to 2.5 hours
		const pollInterval = 10000 // 10 seconds (reduced load)
		const maxAttempts = (2.5 * 60 * 60 * 1000) / pollInterval // ~900 attempts

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			if (this.abortController?.signal.aborted) {
				throw new Error("Operation cancelled")
			}

			try {
				const response = await axios.get<JobStatusResponse>(`${this.apiBaseUrl}/jobs/${jobId}`, {
					headers: this.getHeaders(),
					signal: this.abortController?.signal,
				})
				const status = response.data

				if (status.status === "completed") {
					if (!status.downloadUrl) {
						throw new Error("Job completed but no download URL provided")
					}
					return status.downloadUrl
				}

				if (status.status === "failed") {
					throw new Error(status.error || "Job processing failed")
				}

				// Wait before next poll
				await new Promise((resolve) => setTimeout(resolve, pollInterval))
			} catch (error) {
				if (axios.isAxiosError(error) && error.response?.status === 404) {
					// Job not found, wait and retry
					await new Promise((resolve) => setTimeout(resolve, pollInterval))
					continue
				}
				throw error
			}
		}

		throw new Error("Job polling timeout - processing took too long")
	}

	/**
	 * Downloads the results zip file (legacy single zip download)
	 * Uses fetch directly for streaming downloads with proxy support
	 */
	private async downloadResults(downloadUrl: string, outputPath: string): Promise<void> {
		const controller = new AbortController()
		if (this.abortController?.signal) {
			this.abortController.signal.addEventListener("abort", () => {
				controller.abort()
			})
		}

		const response = await fetch(downloadUrl, {
			signal: controller.signal,
		})

		if (!response.ok) {
			throw new Error(`Download failed: ${response.status} ${response.statusText}`)
		}

		if (!response.body) {
			throw new Error("Response body is null")
		}

		// Convert ReadableStream to Node.js Readable stream using Readable.fromWeb
		const nodeStream = Readable.fromWeb(response.body as any)
		const writer = fs.createWriteStream(outputPath)
		nodeStream.pipe(writer)

		return new Promise<void>((resolve, reject) => {
			writer.on("finish", () => resolve())
			writer.on("error", reject)
			nodeStream.on("error", reject)
			if (this.abortController?.signal) {
				this.abortController.signal.addEventListener("abort", () => {
					nodeStream.destroy(new Error("Operation cancelled"))
					writer.destroy(new Error("Operation cancelled"))
					reject(new Error("Operation cancelled"))
				})
			}
		})
	}

	/**
	 * Checks if a PDF folder already exists with valid extracted content
	 * Uses hash-based tracking to handle file moves/renames
	 */
	private async isPdfFolderAlreadyProcessed(pdfPath: string, extractPath: string, workspaceRoot: string): Promise<boolean> {
		const tracker = this.getTracker(workspaceRoot)
		return tracker.isProcessed(pdfPath, workspaceRoot)
	}

	/**
	 * Calculates the expected output folder path for a PDF file
	 * Uses linear structure: all PDFs as folders directly in documents/
	 */
	private getExpectedOutputPath(pdfPath: string, workspaceRoot: string, outputDir: string): string {
		const pdfFolderName = path.basename(pdfPath, ".pdf")
		// Linear structure: always put directly in documents folder
		return path.join(outputDir, pdfFolderName)
	}

	/**
	 * Filters out PDFs that have already been processed (using hash-based tracking)
	 */
	private async filterUnprocessedPdfs(
		pdfFiles: string[],
		workspaceRoot: string,
		outputDir: string,
		onProgress?: (stage: string, details?: string) => void,
	): Promise<string[]> {
		const unprocessedPdfs: string[] = []
		let skippedCount = 0
		const tracker = this.getTracker(workspaceRoot)

		for (const pdfPath of pdfFiles) {
			const expectedOutputPath = this.getExpectedOutputPath(pdfPath, workspaceRoot, outputDir)
			const alreadyProcessed = await this.isPdfFolderAlreadyProcessed(pdfPath, expectedOutputPath, workspaceRoot)

			if (alreadyProcessed) {
				skippedCount++
				// Still run metadata extraction for existing folders (in case they need updates)
				try {
					const relativePath = path.relative(outputDir, expectedOutputPath)
					// Get source hash from tracker to include in metadata
					const sourceHash = await tracker.getSourceHash(pdfPath)
					const sourcePath = path.relative(workspaceRoot, pdfPath)
					await this.metadataService.extractMetadataForFolder(expectedOutputPath, relativePath, sourceHash, sourcePath)
				} catch (error) {
					console.error(`Error processing existing folder for ${pdfPath}:`, error)
				}
			} else {
				unprocessedPdfs.push(pdfPath)
			}
		}

		if (skippedCount > 0 && onProgress) {
			onProgress("skipped", `Skipped ${skippedCount} already processed PDF(s)`)
		}

		return unprocessedPdfs
	}

	/**
	 * Downloads and extracts a single PDF's result folder from S3
	 * Preserves the directory structure relative to workspace root
	 * Skips download if folder already exists with valid content
	 */
	private async downloadAndExtractPdfResults(
		downloadUrl: string,
		pdfIndex: number,
		pdfName: string,
		outputDir: string,
		workspaceRoot: string,
		submissionsFolder: string,
		onProgress?: (stage: string, details?: string) => void,
	): Promise<void> {
		// Calculate extraction path first to check if already processed
		// Linear structure: always put directly in documents folder
		const pdfFolderName = path.basename(pdfName, ".pdf")
		const extractPath = path.join(outputDir, pdfFolderName)

		// Check if folder already exists with valid content - skip download if so
		const tracker = this.getTracker(workspaceRoot)
		if (await this.isPdfFolderAlreadyProcessed(pdfName, extractPath, workspaceRoot)) {
			// Still try to extract metadata if info.json is missing or has placeholders
			try {
				if (onProgress) {
					onProgress("metadata", `Extracting metadata for ${path.basename(pdfName)}...`)
				}
				// Get source hash from tracker to include in metadata
				const sourceHash = await tracker.getSourceHash(pdfName)
				const sourcePath = path.relative(workspaceRoot, pdfName)
				const extracted = await this.metadataService.extractMetadataForFolder(
					extractPath,
					path.relative(outputDir, extractPath),
					sourceHash,
					sourcePath,
				)
				if (extracted && onProgress) {
					onProgress("metadata", `Metadata extracted for ${path.basename(pdfName)}`)
				}

				// Classify the document if info.json exists
				const infoJsonPath = path.join(extractPath, "info.json")
				try {
					await fs.promises.access(infoJsonPath)
					// info.json exists, classify the document
					if (onProgress) {
						onProgress("classifying", `Classifying ${path.basename(pdfName)}...`)
					}

					const relativePath = path.relative(outputDir, extractPath)
					const classifier = new CtdClassifierServiceV2(submissionsFolder)
					try {
						const success = await classifier.classifyFolder(extractPath, relativePath, submissionsFolder)
						if (success && onProgress) {
							onProgress("classified", `Classified ${path.basename(pdfName)}`)
						}
					} catch (classificationError) {
						// Log error but don't fail the process
						console.error(`Failed to classify ${pdfName}:`, classificationError)
						if (onProgress) {
							onProgress("error", `Classification failed for ${path.basename(pdfName)}`)
						}
					}
				} catch {
					// info.json doesn't exist, skip classification
					// This is expected for some documents, so we silently skip
				}
			} catch (metadataError) {
				console.error(`Failed to extract metadata for existing folder ${pdfName}:`, metadataError)
				if (onProgress) {
					onProgress("error", `Metadata extraction failed for ${path.basename(pdfName)}`)
				}
			}
			return
		}

		const tempZipPath = path.join(outputDir, `temp_${pdfIndex}_${Date.now()}.zip`)

		try {
			// Download the zip file from S3 presigned URL using fetch for streaming with proxy support
			const controller = new AbortController()
			if (this.abortController?.signal) {
				this.abortController.signal.addEventListener("abort", () => {
					controller.abort()
				})
			}

			const response = await fetch(downloadUrl, {
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(`Download failed: ${response.status} ${response.statusText}`)
			}

			if (!response.body) {
				throw new Error("Response body is null")
			}

			// Convert ReadableStream to Node.js Readable stream using Readable.fromWeb
			const nodeStream = Readable.fromWeb(response.body as any)
			const writer = fs.createWriteStream(tempZipPath)
			nodeStream.pipe(writer)

			await new Promise<void>((resolve, reject) => {
				writer.on("finish", () => resolve())
				writer.on("error", reject)
				nodeStream.on("error", reject)
				if (this.abortController?.signal) {
					this.abortController.signal.addEventListener("abort", () => {
						nodeStream.destroy(new Error("Operation cancelled"))
						writer.destroy(new Error("Operation cancelled"))
						reject(new Error("Operation cancelled"))
					})
				}
			})

			// Create extraction directory (extractPath already calculated above)
			await fs.promises.mkdir(extractPath, { recursive: true })

			await extractZip(tempZipPath, { dir: extractPath })

			// Clean up temp zip
			await fs.promises.unlink(tempZipPath)

			// Extract metadata from the folder after extraction is complete
			try {
				if (onProgress) {
					onProgress("metadata", `Extracting metadata for ${path.basename(pdfName)}...`)
				}
				// Get source hash to include in metadata
				const sourceHash = await tracker.getSourceHash(pdfName)
				const sourcePath = path.relative(workspaceRoot, pdfName)
				const extracted = await this.metadataService.extractMetadataForFolder(
					extractPath,
					path.relative(outputDir, extractPath),
					sourceHash,
					sourcePath,
				)
				if (extracted && onProgress) {
					onProgress("metadata", `Metadata extracted for ${path.basename(pdfName)}`)
				}

				// Mark as processed in tracker after successful extraction and metadata processing
				if (extracted) {
					await tracker.markProcessed(pdfName, extractPath, workspaceRoot, sourceHash)
				}

				// Classify the document if info.json exists
				const infoJsonPath = path.join(extractPath, "info.json")
				try {
					await fs.promises.access(infoJsonPath)
					// info.json exists, classify the document
					if (onProgress) {
						onProgress("classifying", `Classifying ${path.basename(pdfName)}...`)
					}

					const relativePath = path.relative(outputDir, extractPath)
					const classifier = new CtdClassifierServiceV2(submissionsFolder)
					try {
						const success = await classifier.classifyFolder(extractPath, relativePath, submissionsFolder)
						if (success && onProgress) {
							onProgress("classified", `Classified ${path.basename(pdfName)}`)
						}
					} catch (classificationError) {
						// Log error but don't fail the download/extraction
						console.error(`Failed to classify ${pdfName}:`, classificationError)
						if (onProgress) {
							onProgress("error", `Classification failed for ${path.basename(pdfName)}`)
						}
					}
				} catch {
					// info.json doesn't exist, skip classification
					// This is expected for some documents, so we silently skip
				}
			} catch (metadataError) {
				console.error(`Failed to extract metadata for ${pdfName}:`, metadataError)
				if (onProgress) {
					onProgress("error", `Metadata extraction failed for ${path.basename(pdfName)}`)
				}
				// Don't fail the whole process for metadata extraction errors
				// Still mark as processed if folder has content (even if metadata extraction failed)
				try {
					const hasContent = await fs.promises
						.readdir(extractPath)
						.then((entries) => entries.some((f) => f.endsWith(".mmd") || f.endsWith(".md")))
						.catch(() => false)
					if (hasContent) {
						const sourceHash = await tracker.getSourceHash(pdfName)
						await tracker.markProcessed(pdfName, extractPath, workspaceRoot, sourceHash)
					}
				} catch (trackError) {
					console.error(`Failed to mark PDF as processed: ${trackError}`)
				}
			}
		} catch (error) {
			// Clean up temp zip on error
			if (fs.existsSync(tempZipPath)) {
				await fs.promises.unlink(tempZipPath).catch(() => {
					// Ignore cleanup errors
				})
			}
			throw error
		}
	}

	/**
	 * Polls job status and downloads PDF results incrementally as they become available
	 * Preserves the directory structure relative to workspace root
	 * Supports concurrent downloads with non-blocking polling
	 */
	private async pollAndDownloadIncremental(
		jobId: string,
		pdfFiles: string[],
		outputDir: string,
		workspaceRoot: string,
		submissionsFolder: string,
		onProgress?: (stage: string, details?: string) => void,
	): Promise<void> {
		const pollInterval = 10000 // 10 seconds
		const maxAttempts = (2.5 * 60 * 60 * 1000) / pollInterval // ~900 attempts (2.5 hours)
		const downloadedPdfs = new Set<number>()
		const activeDownloads = new Set<Promise<void>>()

		// Helper function to start a download task
		const startDownload = async (pdfStatus: PdfFileStatus): Promise<void> => {
			if (this.abortController?.signal.aborted) {
				throw new Error("Operation cancelled")
			}

			const pdfName = pdfFiles[pdfStatus.pdfIndex] || `pdf_${pdfStatus.pdfIndex}`

			try {
				if (onProgress) {
					onProgress("downloading", `Downloading results for ${path.basename(pdfName)}...`)
				}

				await this.downloadAndExtractPdfResults(
					pdfStatus.downloadUrl!,
					pdfStatus.pdfIndex,
					pdfName,
					outputDir,
					workspaceRoot,
					submissionsFolder,
					onProgress,
				)

				downloadedPdfs.add(pdfStatus.pdfIndex)

				if (onProgress) {
					onProgress("downloaded", `Downloaded ${downloadedPdfs.size}/${pdfFiles.length} PDF(s)`)
				}
			} catch (error) {
				// Log error but don't throw - allow other downloads to continue
				const errorMessage = error instanceof Error ? error.message : String(error)
				console.error(`Failed to download PDF ${pdfStatus.pdfIndex} (${pdfName}): ${errorMessage}`)
				if (onProgress) {
					onProgress("error", `Failed to download ${path.basename(pdfName)}: ${errorMessage}`)
				}
				// Still mark as attempted to avoid retrying immediately
				downloadedPdfs.add(pdfStatus.pdfIndex)
			}
		}

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			if (this.abortController?.signal.aborted) {
				// Cancel all active downloads
				for (const downloadPromise of activeDownloads) {
					// Downloads will be cancelled via abortController signal
				}
				await Promise.allSettled(activeDownloads)
				throw new Error("Operation cancelled")
			}

			try {
				const response = await axios.get<JobStatusResponse>(`${this.apiBaseUrl}/jobs/${jobId}`, {
					headers: this.getHeaders(),
					signal: this.abortController?.signal,
					...getAxiosSettings(),
				})
				const status = response.data

				// Check for per-PDF statuses (new API)
				if (status.pdfStatuses && status.pdfStatuses.length > 0) {
					// Start downloads for completed PDFs that we haven't downloaded yet
					for (const pdfStatus of status.pdfStatuses) {
						if (
							pdfStatus.status === "completed" &&
							pdfStatus.downloadUrl &&
							!downloadedPdfs.has(pdfStatus.pdfIndex)
						) {
							// Wait if we've reached the concurrency limit
							if (activeDownloads.size >= this.maxConcurrentDownloads) {
								await Promise.race(activeDownloads)
							}

							if (this.abortController?.signal.aborted) {
								break
							}

							// Start download task
							const downloadTask = startDownload(pdfStatus).finally(() => {
								activeDownloads.delete(downloadTask)
							})

							activeDownloads.add(downloadTask)
						}

						if (pdfStatus.status === "failed") {
							if (!downloadedPdfs.has(pdfStatus.pdfIndex)) {
								console.warn(`PDF ${pdfStatus.pdfIndex} (${pdfStatus.pdfName}) failed: ${pdfStatus.error}`)
								if (onProgress) {
									onProgress("error", `PDF ${path.basename(pdfStatus.pdfName)} failed: ${pdfStatus.error}`)
								}
								downloadedPdfs.add(pdfStatus.pdfIndex) // Mark as processed
							}
						}
					}

					// Check if all PDFs are completed (either successfully or failed)
					const allCompleted = status.pdfStatuses.every((s) => s.status === "completed" || s.status === "failed")

					if (allCompleted) {
						// Wait for all active downloads to complete
						if (activeDownloads.size > 0) {
							if (onProgress) {
								onProgress("downloading", `Waiting for ${activeDownloads.size} download(s) to complete...`)
							}
							await Promise.allSettled(activeDownloads)
						}

						if (onProgress) {
							onProgress(
								"completed",
								`All ${pdfFiles.length} PDF(s) processed. Downloaded ${downloadedPdfs.size} result(s).`,
							)
						}
						return
					}
				} else if (status.status === "completed") {
					// Fallback to legacy single zip download if API doesn't support per-PDF status
					// Wait for any active downloads to complete first
					if (activeDownloads.size > 0) {
						await Promise.allSettled(activeDownloads)
					}

					if (status.downloadUrl) {
						if (onProgress) {
							onProgress("downloading", "Downloading results zip...")
						}
						const resultsPath = path.join(outputDir, "results.zip")
						await this.downloadResults(status.downloadUrl, resultsPath)
						return
					}
				}

				if (status.status === "failed") {
					// Wait for active downloads before throwing
					if (activeDownloads.size > 0) {
						await Promise.allSettled(activeDownloads)
					}
					throw new Error(status.error || "Job processing failed")
				}

				// Update progress with current status
				if (status.completedCount !== undefined && status.totalCount !== undefined) {
					const downloadingCount = activeDownloads.size
					if (onProgress) {
						if (downloadingCount > 0) {
							onProgress(
								"processing",
								`Processing ${status.completedCount}/${status.totalCount} PDF(s)... (${downloadingCount} downloading)`,
							)
						} else {
							onProgress("processing", `Processing ${status.completedCount}/${status.totalCount} PDF(s)...`)
						}
					}
				}

				// Wait before next poll (non-blocking - downloads continue in background)
				await new Promise((resolve) => setTimeout(resolve, pollInterval))
			} catch (error) {
				if (axios.isAxiosError(error) && error.response?.status === 404) {
					// Job not found, wait and retry
					await new Promise((resolve) => setTimeout(resolve, pollInterval))
					continue
				}
				// Wait for active downloads before throwing
				if (activeDownloads.size > 0) {
					await Promise.allSettled(activeDownloads)
				}
				throw error
			}
		}

		// Wait for any remaining downloads before timing out
		if (activeDownloads.size > 0) {
			await Promise.allSettled(activeDownloads)
		}

		throw new Error("Job polling timeout - processing took too long")
	}

	/**
	 * Main processing method - orchestrates the entire workflow
	 * @param workspaceRoot Path to the workspace root (where PDFs are located)
	 * @param submissionsFolder Path to the submissions folder (where processed documents are saved)
	 * @param incremental If true, downloads PDF results as they become available. If false, waits for all PDFs and downloads single zip.
	 */
	async processPdfs(
		workspaceRoot: string,
		submissionsFolder: string,
		onProgress?: (stage: string, details?: string) => void,
		incremental: boolean = true,
	): Promise<void> {
		this.abortController = new AbortController()
		const signal = this.abortController.signal

		try {
			if (signal.aborted) throw new Error("Operation cancelled")

			// Stage 1: Find PDF files in workspace root (excluding submissions folder)
			if (onProgress) {
				onProgress("discovering", "Scanning workspace for PDF files...")
			}
			const allPdfFiles = await this.findPdfFiles(workspaceRoot, submissionsFolder)

			if (allPdfFiles.length === 0) {
				if (onProgress) {
					onProgress("completed", "No PDF files found to process")
				}
				return
			}

			if (onProgress) {
				onProgress("discovered", `Found ${allPdfFiles.length} PDF file(s)`)
			}

			if (signal.aborted) throw new Error("Operation cancelled")

			// Stage 1.5: Filter out already processed PDFs
			// Save processed documents in submissions folder
			const documentsPath = path.join(submissionsFolder, "documents")
			await fs.promises.mkdir(documentsPath, { recursive: true })

			if (onProgress) {
				onProgress("checking", "Checking for already processed PDFs...")
			}
			const pdfFiles = await this.filterUnprocessedPdfs(allPdfFiles, workspaceRoot, documentsPath, onProgress)

			if (pdfFiles.length === 0) {
				if (onProgress) {
					onProgress("completed", `All ${allPdfFiles.length} PDF(s) already processed. No new files to upload.`)
				}
				return
			}

			if (onProgress) {
				onProgress(
					"filtered",
					`${pdfFiles.length} PDF(s) need processing (${allPdfFiles.length - pdfFiles.length} skipped)`,
				)
			}

			if (signal.aborted) throw new Error("Operation cancelled")

			// Stage 2: Request upload slots (only for unprocessed PDFs)
			if (onProgress) {
				onProgress("requesting", "Requesting upload slots from server...")
			}
			const uploadSlotsResponse = await axios.post<UploadSlotsResponse>(
				`${this.apiBaseUrl}/upload-slots`,
				{ count: pdfFiles.length },
				{ headers: this.getHeaders(), signal },
			)

			const { uploadUrls, jobId } = uploadSlotsResponse.data

			if (uploadUrls.length !== pdfFiles.length) {
				throw new Error(`Mismatch: received ${uploadUrls.length} upload URLs for ${pdfFiles.length} files`)
			}

			if (signal.aborted) throw new Error("Operation cancelled")

			// Stage 3: Upload files to S3 (only unprocessed PDFs)
			if (onProgress) {
				onProgress("uploading", `Uploading ${pdfFiles.length} file(s) to S3...`)
			}
			await this.uploadFilesToS3(pdfFiles, uploadUrls, (uploaded, total) => {
				if (signal.aborted) throw new Error("Operation cancelled")
				if (onProgress) {
					onProgress("uploading", `Uploaded ${uploaded}/${total} files`)
				}
			})

			if (signal.aborted) throw new Error("Operation cancelled")

			// Stage 4: Trigger processing
			if (onProgress) {
				onProgress("triggering", "Triggering server-side processing...")
			}
			await axios.post(`${this.apiBaseUrl}/jobs/start`, { jobId }, { headers: this.getHeaders(), signal })

			if (signal.aborted) throw new Error("Operation cancelled")

			// Stage 5: Poll and download results
			if (incremental) {
				// New: Incremental download approach - download folders as they become available
				if (onProgress) {
					onProgress("processing", "Processing PDFs on server...")
				}
				await this.pollAndDownloadIncremental(
					jobId,
					pdfFiles,
					documentsPath,
					workspaceRoot,
					submissionsFolder,
					onProgress,
				)
			} else {
				// Legacy: Wait for all, then download single zip
				if (onProgress) {
					onProgress("processing", "Processing PDFs on server...")
				}
				const downloadUrl = await this.pollJobStatus(jobId)

				if (signal.aborted) throw new Error("Operation cancelled")

				if (onProgress) {
					onProgress("downloading", "Downloading processed results...")
				}
				const resultsPath = path.join(documentsPath, "results.zip")
				await this.downloadResults(downloadUrl, resultsPath)

				if (signal.aborted) throw new Error("Operation cancelled")

				if (onProgress) {
					onProgress(
						"completed",
						`Successfully processed ${pdfFiles.length} PDF(s). Results saved to documents/results.zip`,
					)
				}
			}
		} catch (error) {
			if (axios.isCancel(error) || (error instanceof Error && error.message === "Operation cancelled")) {
				if (onProgress) {
					onProgress("error", "Operation cancelled by user")
				}
				throw new Error("Operation cancelled by user")
			}
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (onProgress) {
				onProgress("error", `Error: ${errorMessage}`)
			}
			throw new Error(`PDF processing failed: ${errorMessage}`)
		}
	}
}
