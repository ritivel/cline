import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { constructNewFileContent } from "@core/assistant-message/diff"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { showSystemNotification } from "@integrations/notifications"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { DirectFileOperations } from "../utils/DirectFileOperations"
import { applyModelContentFixes } from "../utils/ModelContentProcessor"
import { ToolDisplayUtils } from "../utils/ToolDisplayUtils"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class WriteToFileToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.FILE_NEW // This handler supports write_to_file, replace_in_file, and new_rule

	private directFileOps?: DirectFileOperations

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path || block.params.absolutePath}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Skip partial block streaming for direct file operations mode
		// Files will be written directly after full content is received
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawRelPath = block.params.path || block.params.absolutePath
		const rawContent = block.params.content // for write_to_file
		const rawDiff = block.params.diff // for replace_in_file

		// Extract provider information for telemetry
		const { providerId, modelId } = this.getModelInfo(config)

		// Validate required parameters based on tool type
		if (!rawRelPath) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(
				block.name,
				block.params.absolutePath ? "absolutePath" : "path",
			)
		}

		if (block.name === "replace_in_file" && !rawDiff) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "diff")
		}

		if (block.name === "write_to_file" && !rawContent) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
		}

		if (block.name === "new_rule" && !rawContent) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			const result = await this.validateAndPrepareFileOperation(config, block, rawRelPath, rawDiff, rawContent)
			if (!result) {
				return "" // can only happen if the sharedLogic adds an error to userMessages
			}

			const { relPath, absolutePath, fileExists, diff, content, newContent, workspaceContext } = result

			// Handle approval flow
			const sharedMessageProps: ClineSayTool = {
				tool: fileExists ? "editedExistingFile" : "newFileCreated",
				path: getReadablePath(config.cwd, relPath),
				content: diff || content,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
			}
			// VISIBLE TEST: Show notification to confirm new code is running
			showSystemNotification({
				subtitle: "✅ NEW BUILD ACTIVE",
				message: `WriteToFileToolHandler - Applying changes directly (no diff view)`,
			})

			// Initialize DirectFileOperations if needed
			if (!this.directFileOps) {
				this.directFileOps = new DirectFileOperations()
			}

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				content: diff || content,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
			} satisfies ClineSayTool)

			const shouldAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath)

			if (shouldAutoApprove) {
				// Auto-approval flow - apply changes directly without pending approval
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

				// Capture telemetry
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					modelId,
					providerId,
					true,
					true,
					workspaceContext,
					block.isNativeToolCall,
				)
			} else {
				// Manual approval flow - show notification
				const notificationMessage = `Cline wants to ${fileExists ? "edit" : "create"} ${getWorkspaceBasename(relPath, "WriteToFile.notification")}`

				// Show notification
				showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)

				await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

				// Use say instead of ask to avoid triggering diff view
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			}

			// Run PreToolUse hook before applying changes
			try {
				const { ToolHookUtils } = await import("../utils/ToolHookUtils")
				await ToolHookUtils.runPreToolUseIfEnabled(config, block)
			} catch (error) {
				const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
				if (error instanceof PreToolUseHookCancellationError) {
					return formatResponse.toolDenied()
				}
				throw error
			}

			// Apply changes using DirectFileOperations with pending approval if needed
			let fileOpsResult
			if (fileExists) {
				fileOpsResult = await this.directFileOps.modifyFile(
					relPath,
					newContent,
					config.ulid,
					block.name,
					!shouldAutoApprove,
				)
			} else {
				fileOpsResult = await this.directFileOps.createFile(
					relPath,
					newContent,
					config.ulid,
					block.name,
					!shouldAutoApprove,
				)
			}

			// Only mark as edited if auto-approved (pending files will be marked after approval)
			if (shouldAutoApprove) {
				// Mark the file as edited by Cline
				config.services.fileContextTracker.markFileAsEditedByCline(relPath)
				config.taskState.didEditFile = true

				// Track file edit operation
				await config.services.fileContextTracker.trackFileContext(relPath, "cline_edited")

				// Return success response
				return formatResponse.fileEditWithoutUserChanges(
					relPath,
					undefined, // autoFormattingEdits - not tracked in direct mode
					fileOpsResult.finalContent,
					fileOpsResult.newProblemsMessage,
				)
			} else {
				// File is pending approval - return response indicating pending status
				return formatResponse.toolResult(
					`File '${relPath}' has been updated and is pending your approval. Use 'Cline: Accept File Changes' or 'Cline: Reject File Changes' from the command palette to approve or reject the changes.`,
				)
			}
		} catch (error) {
			// Error handling - no diff view to reset
			throw error
		}
	}

	/**
	 * Shared validation and preparation logic used by both handlePartialBlock and execute methods.
	 * This validates file access permissions, checks if the file exists, and constructs the new content
	 * from either direct content or diff patches. It handles both creation of new files and modifications
	 * to existing ones.
	 *
	 * @param config The task configuration containing services and state
	 * @param block The tool use block containing the operation parameters
	 * @param relPath The relative path to the target file
	 * @param diff Optional diff content for replace operations
	 * @param content Optional direct content for write operations
	 * @param provider Optional provider string for telemetry (used when capturing diff edit failures)
	 * @returns Object containing validated path, file existence status, diff/content, and constructed new content,
	 *          or undefined if validation fails
	 */
	async validateAndPrepareFileOperation(config: TaskConfig, block: ToolUse, relPath: string, diff?: string, content?: string) {
		// Parse workspace hint and resolve path for multi-workspace support
		const pathResult = resolveWorkspacePath(config, relPath, "WriteToFileToolHandler.validateAndPrepareFileOperation")
		const { absolutePath, resolvedPath } =
			typeof pathResult === "string"
				? { absolutePath: pathResult, resolvedPath: relPath }
				: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relPath)
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: typeof pathResult !== "string", // multi-root path result indicates hint usage
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (typeof pathResult !== "string" ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Check clineignore access first
		const accessValidation = this.validator.checkClineIgnorePath(resolvedPath)
		if (!accessValidation.ok) {
			// Show error and return early (full original behavior)
			await config.callbacks.say("clineignore_error", resolvedPath)

			// Push tool result and save checkpoint using existing utilities
			const errorResponse = formatResponse.toolError(formatResponse.clineIgnoreError(resolvedPath))
			ToolResultUtils.pushToolResult(
				errorResponse,
				block,
				config.taskState.userMessageContent,
				ToolDisplayUtils.getToolDescription,
				config.api,
				() => {
					config.taskState.didAlreadyUseTool = true
				},
				config.coordinator,
				config.taskState.toolUseIdMap,
			)

			return
		}

		// Check if file exists to determine the correct UI message
		const fileExists = await fileExistsAtPath(absolutePath)

		// Construct newContent from diff
		let newContent: string
		newContent = "" // default to original content if not editing

		if (diff) {
			// Handle replace_in_file with diff construction
			// Apply model-specific fixes (deepseek models tend to use unescaped html entities in diffs)
			diff = applyModelContentFixes(diff, config.api.getModel().id, resolvedPath)

			// Read original content for diff construction
			let originalContent = ""
			if (fileExists) {
				try {
					const { readFile } = await import("node:fs/promises")
					originalContent = await readFile(absolutePath, "utf8")
				} catch {
					// File might not exist or be unreadable
					originalContent = ""
				}
			}

			try {
				newContent = await constructNewFileContent(diff, originalContent, !block.partial)
			} catch (error) {
				// Error handling for diff construction
				await config.callbacks.say("diff_error", relPath)

				// Extract provider information for telemetry
				const { providerId, modelId } = this.getModelInfo(config)

				// Extract error type from error message if possible
				const errorType =
					error instanceof Error && error.message.includes("does not match anything")
						? "search_not_found"
						: "other_diff_error"

				// Add telemetry for diff edit failure
				const isNativeToolCall = block.isNativeToolCall === true
				telemetryService.captureDiffEditFailure(config.ulid, modelId, providerId, errorType, isNativeToolCall)

				// Push tool result with detailed error using existing utilities
				const errorResponse = formatResponse.toolError(
					`${(error as Error)?.message}\n\n` + formatResponse.diffError(relPath, originalContent),
				)
				ToolResultUtils.pushToolResult(
					errorResponse,
					block,
					config.taskState.userMessageContent,
					ToolDisplayUtils.getToolDescription,
					config.api,
					() => {
						config.taskState.didAlreadyUseTool = true
					},
					config.coordinator,
					config.taskState.toolUseIdMap,
				)

				return
			}
		} else if (content) {
			// Handle write_to_file with direct content
			newContent = content

			// pre-processing newContent for cases where weaker models might add artifacts like markdown codeblock markers (deepseek/llama) or extra escape characters (gemini)
			if (newContent.startsWith("```")) {
				// this handles cases where it includes language specifiers like ```python ```js
				newContent = newContent.split("\n").slice(1).join("\n").trim()
			}
			if (newContent.endsWith("```")) {
				newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
			}

			// Apply model-specific fixes (llama, gemini, and other models may add escape characters)
			newContent = applyModelContentFixes(newContent, config.api.getModel().id, resolvedPath)

			// For .tex files, apply header/footer configuration
			if (resolvedPath.endsWith(".tex")) {
				newContent = this.applyTexHeaderFooter(newContent)
			}
		} else {
			// can't happen, since we already checked for content/diff above. but need to do this for type error
			return
		}

		newContent = newContent.trimEnd() // remove any trailing newlines, since it's automatically inserted by the editor

		return { relPath, absolutePath, fileExists, diff, content, newContent, workspaceContext }
	}

	private getModelInfo(config: TaskConfig) {
		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const providerId = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const modelId = config.api.getModel().id
		return { providerId, modelId }
	}

	/**
	 * Applies header and footer configuration to LaTeX content if not already present.
	 */
	private applyTexHeaderFooter(content: string): string {
		const documentBeginMatch = content.match(/\\begin\{document\}/i)
		const documentEndMatch = content.match(/\\end\{document\}/i)

		if (documentBeginMatch && documentEndMatch) {
			// Extract preamble (content before \begin{document})
			let preamble = content.substring(0, documentBeginMatch.index!).trim()
			const bodyContent = content
				.substring(documentBeginMatch.index! + documentBeginMatch[0].length, documentEndMatch.index!)
				.trim()
			const documentEnd = content.substring(documentEndMatch.index!)

			// Find all documentclass declarations in the preamble
			const docClassRegex = /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/g
			const docClassMatches = preamble.match(docClassRegex)

			let documentClass = "\\documentclass{article}"
			if (docClassMatches && docClassMatches.length > 0) {
				documentClass = docClassMatches[0]
				preamble = preamble.replace(docClassRegex, "").trim()
			}

			// Clean up any extra blank lines
			preamble = preamble.replace(/\n{3,}/g, "\n\n")

			// Check if fancyhdr package and pagestyle are already configured
			const hasFancyhdr = /\\usepackage(\[[^\]]*\])?\{fancyhdr\}/i.test(preamble)
			const hasFancyPagestyle = /\\pagestyle\{fancy\}/i.test(preamble)

			// Build header/footer config if missing
			let headerFooterConfig = ""
			if (!hasFancyhdr || !hasFancyPagestyle) {
				headerFooterConfig = `
${!hasFancyhdr ? "\\usepackage{fancyhdr}" : ""}

% Header and footer configuration
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0.4pt}
\\renewcommand{\\footrulewidth}{0.4pt}
% Header: Logo on left, title on right
\\fancyhead[L]{}
\\fancyhead[R]{Aspirin Tablets USP (500 mg)\\\\Module 2: Overview and Summary}
% Footer: Confidential on left, page number in center, company name on right
\\fancyfoot[L]{Confidential}
\\fancyfoot[C]{\\thepage}
\\fancyfoot[R]{YC LifeSciences Ltd}
% Apply the same style to the first page (plain style)
\\fancypagestyle{plain}{%
  \\fancyhf{}
  \\renewcommand{\\headrulewidth}{0.4pt}
  \\renewcommand{\\footrulewidth}{0.4pt}
  \\fancyhead[L]{}
  \\fancyhead[R]{Aspirin Tablets USP (500 mg)\\\\Module 2: Overview and Summary}
  \\fancyfoot[L]{Confidential}
  \\fancyfoot[C]{\\thepage}
  \\fancyfoot[R]{YC LifeSciences Ltd}
}
`
				// DEBUG notification
				showSystemNotification({
					subtitle: "DEBUG: Adding Header/Footer",
					message: `WriteToFileToolHandler adding fancyhdr config to .tex file`,
				})
			}

			// Reconstruct document
			return `${documentClass}
${preamble}
${headerFooterConfig}
\\begin{document}
${bodyContent}
${documentEnd}`
		}

		// If no document environment found, return content as-is
		return content
	}
}
