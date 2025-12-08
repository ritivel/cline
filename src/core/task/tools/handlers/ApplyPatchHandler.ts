import { readFile } from "node:fs/promises"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import type { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { BASH_WRAPPERS, DiffError, PATCH_MARKERS, type Patch, PatchActionType, type PatchChunk } from "@/shared/Patch"
import { preserveEscaping } from "@/shared/string"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { DirectFileOperations } from "../utils/DirectFileOperations"
import { type FileOpsResult } from "../utils/FileProviderOperations"
import { PatchParser } from "../utils/PatchParser"
import { PathResolver } from "../utils/PathResolver"
import { ToolResultUtils } from "../utils/ToolResultUtils"

interface FileChange {
	type: PatchActionType
	oldContent?: string
	newContent?: string
	movePath?: string
}

interface Commit {
	changes: Record<string, FileChange>
}

export const PatchClineSayMap = {
	[PatchActionType.ADD]: "newFileCreated",
	[PatchActionType.DELETE]: "fileDeleted",
	[PatchActionType.UPDATE]: "editedExistingFile",
}

export class ApplyPatchHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.APPLY_PATCH
	private appliedCommit?: Commit
	private config?: TaskConfig
	private pathResolver?: PathResolver
	private providerOps?: DirectFileOperations
	private partialPreviewState?: {
		originalFiles: Record<string, string>
		currentPreviewPath?: string
	}

	constructor(private validator: ToolValidator) {}

	private initializeHelpers(config: TaskConfig): void {
		if (!this.pathResolver || this.config !== config) {
			this.pathResolver = new PathResolver(config, this.validator)
		}
		if (!this.providerOps) {
			this.providerOps = new DirectFileOperations()
		}
	}

	getDescription(_block: ToolUse): string {
		return `[${this.name} for patch application]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Skip preview streaming for direct file operations mode
		// Files will be opened directly in the editor after patch application
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawInput = block.params.input

		if (!rawInput) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "input")
		}

		config.taskState.consecutiveMistakeCount = 0
		this.initializeHelpers(config)
		this.partialPreviewState = undefined

		try {
			const lines = this.preprocessLines(rawInput)

			// Identify files needed
			const filesToLoad = this.extractFilesForOperations(rawInput, [PATCH_MARKERS.UPDATE, PATCH_MARKERS.DELETE])
			const currentFiles = await this.loadFiles(config, filesToLoad)

			// Parse patch
			const parser = new PatchParser(lines, currentFiles)
			const { patch, fuzz } = parser.parse()

			// Convert to commit
			const commit = this.patchToCommit(patch, currentFiles)

			// Store for potential revert
			this.appliedCommit = commit
			this.config = config

			// Run PreToolUse hook before applying changes
			try {
				const { ToolHookUtils } = await import("../utils/ToolHookUtils")
				await ToolHookUtils.runPreToolUseIfEnabled(config, block)
			} catch (error) {
				const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
				if (error instanceof PreToolUseHookCancellationError) {
					return "The user denied this patch operation."
				}
				throw error
			}

			// Generate summary for logging
			const changedFiles = Object.keys(commit.changes)
			const messages = await this.generateChangeSummary(commit.changes)

			// Determine which files need approval
			const filesRequiringApproval: string[] = []
			for (const message of messages) {
				if (!message.path) continue
				const shouldAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, message.path)
				if (!shouldAutoApprove) {
					filesRequiringApproval.push(message.path)
					showNotificationForApproval(
						`Cline wants to edit '${message.path}'`,
						config.autoApprovalSettings.enableNotifications,
					)
				}
			}

			// Apply the commit - files will be written and opened in regular editor
			// Files requiring approval will be registered as pending
			console.log("[ApplyPatchHandler] About to apply commit with", Object.keys(commit.changes).length, "file changes")
			const applyResults = await this.applyCommit(commit, config.ulid, block.name, filesRequiringApproval)
			console.log("[ApplyPatchHandler] Commit applied, results:", Object.keys(applyResults))

			// Log the tool usage for telemetry
			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const providerId = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
			const modelId = config.api.getModel().id

			// Only mark files as edited if they were auto-approved
			const autoApprovedFiles: string[] = []
			for (const message of messages) {
				if (!message.path) continue
				const shouldAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, message.path)
				if (shouldAutoApprove) {
					autoApprovedFiles.push(message.path)
					telemetryService.captureToolUsage(
						config.ulid,
						this.name,
						modelId,
						providerId,
						true,
						true,
						undefined,
						block.isNativeToolCall,
					)
				} else {
					telemetryService.captureToolUsage(
						config.ulid,
						this.name,
						modelId,
						providerId,
						false,
						false, // Pending approval, not yet approved
						undefined,
						block.isNativeToolCall,
					)
				}
			}

			// Only mark auto-approved files as edited
			for (const filePath of autoApprovedFiles) {
				config.services.fileContextTracker.markFileAsEditedByCline(filePath)
				await config.services.fileContextTracker.trackFileContext(filePath, "cline_edited")
			}

			if (autoApprovedFiles.length > 0) {
				config.taskState.didEditFile = true
			}

			const finalResponses = messages.map((m) => m.path)

			this.appliedCommit = undefined
			this.config = undefined

			// Build response with file contents and diagnostics
			const pendingFiles = filesRequiringApproval.filter((path) => !autoApprovedFiles.includes(path))
			if (pendingFiles.length > 0) {
				const responseLines = [
					`Patch applied to ${changedFiles.length} file(s). ${pendingFiles.length} file(s) are pending approval:`,
				]
				for (const path of pendingFiles) {
					responseLines.push(`\n- ${path} (pending approval)`)
				}
				responseLines.push(
					`\nUse 'Cline: Accept File Changes' or 'Cline: Reject File Changes' from the command palette to approve or reject changes.`,
				)

				// Add info about auto-approved files
				if (autoApprovedFiles.length > 0) {
					responseLines.push(`\n\nAuto-approved files:`)
					for (const path of autoApprovedFiles) {
						const result = applyResults[path]
						if (result && !result.deleted) {
							responseLines.push(`\n${path}: Applied successfully`)
							if (result.newProblemsMessage) {
								responseLines.push(`  New problems: ${result.newProblemsMessage}`)
							}
						}
					}
				}

				if (fuzz > 0) {
					responseLines.push(`\nNote: Patch applied with fuzz factor ${fuzz}`)
				}

				return formatResponse.toolResult(responseLines.join(""))
			}

			// All files were auto-approved - show detailed response
			const responseLines = ["Successfully applied patch to the following files:"]

			for (const [path, result] of Object.entries(applyResults)) {
				if (result.deleted) {
					responseLines.push(`\n${path}: [deleted]`)
				} else {
					// Format response similar to WriteToFileToolHandler
					if (result.userEdits) {
						// User made edits during approval
						responseLines.push(`\nThe user made edits to the file:\n${result.userEdits}\n`)
						await config.callbacks.say(
							"user_feedback_diff",
							JSON.stringify({
								tool: "editedExistingFile",
								path,
								diff: result.userEdits,
							}),
						)
					}
					if (result.autoFormattingEdits) {
						responseLines.push(`\nAuto-formatting was applied to ${path}:\n${result.autoFormattingEdits}\n`)
					}
					if (result.finalContent) {
						responseLines.push(`\n<final_file_content path="${path}">`)
						responseLines.push(result.finalContent)
						responseLines.push(`\n</final_file_content>`)
					}
					if (result.newProblemsMessage) {
						responseLines.push(`\n\n${result.newProblemsMessage}`)
					}
				}
			}

			if (fuzz > 0) {
				responseLines.push(`\nNote: Patch applied with fuzz factor ${fuzz}`)
			}

			return responseLines.join("\n")
		} catch (error) {
			await this.revertChanges()
			console.error("Reverted changes due to error in ApplyPatchHandler.", error)
			throw error
		}
	}

	private preprocessLines(text: string): string[] {
		let lines = text.split("\n").map((line) => line.replace(/\r$/, ""))
		lines = this.stripBashWrapper(lines)

		const hasBegin = lines.length > 0 && lines[0].startsWith(PATCH_MARKERS.BEGIN)
		const hasEnd = lines.length > 0 && lines[lines.length - 1] === PATCH_MARKERS.END

		if (!hasBegin && !hasEnd) {
			return [PATCH_MARKERS.BEGIN, ...lines, PATCH_MARKERS.END]
		}
		if (hasBegin && hasEnd) {
			return lines
		}
		// Missing one of the sentinels: BEGIN or END PATCH
		throw new DiffError("Invalid patch text - incomplete sentinels. Try breaking it into smaller patches.")
	}

	private stripBashWrapper(lines: string[]): string[] {
		const result: string[] = []
		let insidePatch = false
		let foundBegin = false
		let foundContent = false

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			if (!insidePatch && BASH_WRAPPERS.some((wrapper) => line.startsWith(wrapper))) {
				continue
			}

			if (line.startsWith(PATCH_MARKERS.BEGIN)) {
				insidePatch = true
				foundBegin = true
				result.push(line)
				continue
			}

			if (line === PATCH_MARKERS.END) {
				insidePatch = false
				result.push(line)
				continue
			}

			const isPatchContent = this.isPatchLine(line)
			if (isPatchContent && i !== lines.length - 1) {
				foundContent = true
			}

			if (insidePatch || (!foundBegin && isPatchContent) || (line === "" && foundContent)) {
				result.push(line)
			}
		}

		while (result.length > 0 && result[result.length - 1] === "") {
			result.pop()
		}

		return !foundBegin && !foundContent ? lines : result
	}

	private isPatchLine(line: string): boolean {
		return (
			line.startsWith(PATCH_MARKERS.ADD) ||
			line.startsWith(PATCH_MARKERS.UPDATE) ||
			line.startsWith(PATCH_MARKERS.DELETE) ||
			line.startsWith(PATCH_MARKERS.MOVE) ||
			line.startsWith(PATCH_MARKERS.SECTION) ||
			line.startsWith("+") ||
			line.startsWith("-") ||
			line.startsWith(" ") ||
			line === "***"
		)
	}

	private extractFilesForOperations(text: string, markers: readonly string[]): string[] {
		const lines = this.stripBashWrapper(text.split("\n"))
		const files: string[] = []

		for (const line of lines) {
			for (const marker of markers) {
				if (line.startsWith(marker)) {
					const file = line.substring(marker.length).trim()
					if (text.trim().endsWith(file)) {
						// Ignore if the file path is at the very end of the text (likely incomplete)
						continue
					}
					files.push(file)
					break
				}
			}
		}

		return files
	}

	private extractAllFiles(text: string): string[] {
		return this.extractFilesForOperations(text, [PATCH_MARKERS.ADD, PATCH_MARKERS.UPDATE, PATCH_MARKERS.DELETE])
	}

	private async loadFiles(config: TaskConfig, filePaths: string[]): Promise<Record<string, string>> {
		const files: Record<string, string> = {}

		for (const filePath of filePaths) {
			const pathResult = resolveWorkspacePath(config, filePath, "ApplyPatchHandler.loadFiles")
			const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
			const resolvedPath = typeof pathResult === "string" ? filePath : pathResult.resolvedPath

			const accessValidation = this.validator.checkClineIgnorePath(resolvedPath)
			if (!accessValidation.ok) {
				await config.callbacks.say("clineignore_error", resolvedPath)
				throw new DiffError(`Access denied: ${resolvedPath}`)
			}

			if (!(await fileExistsAtPath(absolutePath))) {
				throw new DiffError(`File not found: ${filePath}`)
			}
			const fileContent = await readFile(absolutePath, "utf8")
			const normalizedContent = fileContent.replace(/\r\n/g, "\n")
			files[filePath] = normalizedContent
		}

		return files
	}

	private patchToCommit(patch: Patch, originalFiles: Record<string, string>): Commit {
		const changes: Record<string, FileChange> = {}

		for (const [path, action] of Object.entries(patch.actions)) {
			switch (action.type) {
				case PatchActionType.DELETE:
					changes[path] = { type: PatchActionType.DELETE, oldContent: originalFiles[path] }
					break
				case PatchActionType.ADD:
					if (!action.newFile) {
						throw new DiffError("ADD action without file content")
					}
					changes[path] = { type: PatchActionType.ADD, newContent: action.newFile }
					break
				case PatchActionType.UPDATE:
					changes[path] = {
						type: PatchActionType.UPDATE,
						oldContent: originalFiles[path],
						newContent: this.applyChunks(originalFiles[path]!, action.chunks, path),
						movePath: action.movePath,
					}
					break
			}
		}

		return { changes }
	}

	/**
	 * Applies patch chunks to the given content.
	 * @param content The original file content.
	 * @param chunks The patch chunks to apply.
	 * @param path The file path (for error messages).
	 * NOTE: Remove tryPreserveEscaping and related logic once we can confirm this is not an issue across providers.
	 * @param tryPreserveEscaping Whether to attempt preserving escaping style in cases where the provider has escaped the shared content during the API call.
	 * @returns The modified content after applying the chunks.
	 */
	private applyChunks(content: string, chunks: PatchChunk[], path: string, tryPreserveEscaping = false): string {
		if (chunks.length === 0) {
			return content
		}

		const endsWithNewline = content.endsWith("\n")
		const lines = content.split("\n")
		const result: string[] = []
		let currentIndex = 0

		for (const chunk of chunks) {
			if (chunk.origIndex > lines.length) {
				throw new DiffError(`${path}: chunk.origIndex ${chunk.origIndex} > lines.length ${lines.length}`)
			}
			if (currentIndex > chunk.origIndex) {
				throw new DiffError(`${path}: currentIndex ${currentIndex} > chunk.origIndex ${chunk.origIndex}`)
			}

			// Copy lines before the chunk
			result.push(...lines.slice(currentIndex, chunk.origIndex))

			// Get the original lines being replaced to detect escaping style
			const originalLines = lines.slice(chunk.origIndex, chunk.origIndex + chunk.delLines.length)
			const originalText = originalLines.join("\n")

			// Add inserted lines, preserving escaping style from original
			const insertedLines = chunk.insLines.map((line) => {
				// Only preserve escaping if we have original text to compare against
				if (tryPreserveEscaping && originalText) {
					return preserveEscaping(originalText, line)
				}
				return line
			})
			result.push(...insertedLines)

			// Skip deleted lines
			currentIndex = chunk.origIndex + chunk.delLines.length
		}

		// Copy remaining lines
		result.push(...lines.slice(currentIndex))
		const joined = result.join("\n")

		return endsWithNewline && !joined.endsWith("\n") ? `${joined}\n` : joined
	}

	private async applyCommit(
		commit: Commit,
		taskId: string,
		toolName: ClineDefaultTool,
		filesRequiringApproval: string[],
	): Promise<Record<string, FileOpsResult>> {
		console.log("[ApplyPatchHandler.applyCommit] Starting to apply commit")
		const ops = this.providerOps!
		console.log("[ApplyPatchHandler.applyCommit] Using DirectFileOperations:", ops.constructor.name)
		const results: Record<string, FileOpsResult> = {}

		for (const [path, change] of Object.entries(commit.changes)) {
			console.log("[ApplyPatchHandler.applyCommit] Processing change for:", path, "type:", change.type)
			const requiresApproval = filesRequiringApproval.includes(path)

			switch (change.type) {
				case PatchActionType.DELETE:
					await ops.deleteFile(path)
					results[path] = { deleted: true }
					break
				case PatchActionType.ADD:
					if (!change.newContent) {
						throw new DiffError(`Cannot create ${path} with no content`)
					}
					const addResult = await ops.createFile(path, change.newContent, taskId, toolName, requiresApproval)
					results[path] = {
						finalContent: addResult.finalContent,
						newProblemsMessage: addResult.newProblemsMessage,
						userEdits: addResult.userEdits,
						autoFormattingEdits: addResult.autoFormattingEdits,
					}
					break
				case PatchActionType.UPDATE:
					if (!change.newContent) {
						throw new DiffError(`UPDATE change for ${path} has no new content`)
					}
					if (change.movePath) {
						const moveResult = await ops.moveFile(path, change.movePath, change.newContent)
						results[change.movePath] = {
							finalContent: moveResult.finalContent,
							newProblemsMessage: moveResult.newProblemsMessage,
							userEdits: moveResult.userEdits,
							autoFormattingEdits: moveResult.autoFormattingEdits,
						}
						results[path] = { deleted: true }
					} else {
						const updateResult = await ops.modifyFile(path, change.newContent, taskId, toolName, requiresApproval)
						results[path] = {
							finalContent: updateResult.finalContent,
							newProblemsMessage: updateResult.newProblemsMessage,
							userEdits: updateResult.userEdits,
							autoFormattingEdits: updateResult.autoFormattingEdits,
						}
					}
					break
			}
		}

		return results
	}

	private async revertChanges(): Promise<void> {
		if (!this.appliedCommit || !this.providerOps) {
			return
		}

		const ops = this.providerOps

		for (const [path, change] of Object.entries(this.appliedCommit.changes)) {
			try {
				switch (change.type) {
					case PatchActionType.DELETE:
						if (change.oldContent !== undefined) {
							await ops.createFile(path, change.oldContent)
						}
						break
					case PatchActionType.ADD:
						await ops.deleteFile(path)
						break
					case PatchActionType.UPDATE:
						if (change.movePath) {
							await ops.deleteFile(change.movePath)
							if (change.oldContent !== undefined) {
								await ops.createFile(path, change.oldContent)
							}
						} else if (change.oldContent !== undefined) {
							await ops.modifyFile(path, change.oldContent)
						}
						break
				}
			} catch (error) {
				console.error(`Failed to revert ${path}:`, error)
			}
		}

		this.appliedCommit = undefined
		this.config = undefined
	}

	private async generateChangeSummary(changes: Record<string, FileChange>): Promise<ClineSayTool[]> {
		const summaries = await Promise.all(
			Object.entries(changes).map(async ([file, change]) => {
				const operationIsLocatedInWorkspace = await isLocatedInWorkspace(file)
				switch (change.type) {
					case PatchActionType.ADD:
						return {
							tool: "newFileCreated",
							path: file,
							content: change.newContent,
							operationIsLocatedInWorkspace,
						} as ClineSayTool
					case PatchActionType.UPDATE:
						return {
							tool: change.movePath ? "newFileCreated" : "editedExistingFile",
							path: change.movePath || file,
							content: change.movePath ? change.oldContent : change.newContent,
							operationIsLocatedInWorkspace,
						} as ClineSayTool
					case PatchActionType.DELETE:
						return {
							tool: "fileDeleted",
							path: file,
							content: change.newContent,
							operationIsLocatedInWorkspace,
						} as ClineSayTool
				}
			}),
		)

		return summaries
	}

	private async handleApproval(config: TaskConfig, block: ToolUse, message: ClineSayTool, rawInput: string): Promise<boolean> {
		const patch = { ...message, content: rawInput }
		const completeMessage = JSON.stringify(patch)
		const shouldAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, message.path)

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const providerId = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const modelId = config.api.getModel().id

		if (shouldAutoApprove) {
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			telemetryService.captureToolUsage(
				config.ulid,
				this.name,
				modelId,
				providerId,
				true,
				true,
				undefined,
				block.isNativeToolCall,
			)
			return true
		}

		showNotificationForApproval(`Cline wants to edit '${message.path}'`, config.autoApprovalSettings.enableNotifications)

		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
		const { response, text, images, files } = await config.callbacks.ask("tool", completeMessage, false)

		if (text || images?.length || files?.length) {
			const fileContent = files?.length ? await processFilesIntoText(files) : ""
			ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContent)
			await config.callbacks.say("user_feedback", text, images, files)
		}

		const approved = response === "yesButtonClicked"
		config.taskState.didRejectTool = !approved
		telemetryService.captureToolUsage(
			config.ulid,
			this.name,
			modelId,
			providerId,
			false,
			approved,
			undefined,
			block.isNativeToolCall,
		)
		return approved
	}
}
