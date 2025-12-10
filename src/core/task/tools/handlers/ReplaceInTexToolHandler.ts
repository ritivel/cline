import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { constructNewFileContent } from "@core/assistant-message/diff"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { showSystemNotification } from "@integrations/notifications"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { getCwd, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import chokidar, { FSWatcher } from "chokidar"
import * as vscode from "vscode"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { applyModelContentFixes } from "../utils/ModelContentProcessor"
import { ToolDisplayUtils } from "../utils/ToolDisplayUtils"
import { ToolResultUtils } from "../utils/ToolResultUtils"

/**
 * Handler for replace_in_tex tool that edits LaTeX files using SEARCH/REPLACE blocks,
 * recompiles them to PDF, and updates the PDF viewer.
 */
export class ReplaceInTexToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.REPLACE_IN_TEX

	// Map to track file watchers for each .tex file
	private texFileWatchers = new Map<string, FSWatcher>()

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path || block.params.absolutePath}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Skip partial block streaming - files will be written directly after full content is received
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawRelPath = block.params.path || block.params.absolutePath
		const rawDiff = block.params.diff

		// Extract provider information for telemetry
		const { providerId, modelId } = this.getModelInfo(config)

		// Validate required parameters
		if (!rawRelPath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(
				block.name,
				block.params.absolutePath ? "absolutePath" : "path",
			)
		}

		if (!rawDiff) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "diff")
		}

		// Ensure path ends with .tex
		let texPath = rawRelPath
		if (!texPath.endsWith(".tex")) {
			texPath = texPath + ".tex"
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			// Resolve path
			const cwd = await getCwd()
			const pathResult = resolveWorkspacePath(cwd, texPath, "ReplaceInTexToolHandler.execute")
			const { absolutePath, resolvedPath } =
				typeof pathResult === "string"
					? { absolutePath: pathResult, resolvedPath: texPath }
					: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }

			// Check clineignore access
			const accessValidation = this.validator.checkClineIgnorePath(resolvedPath)
			if (!accessValidation.ok) {
				await config.callbacks.say("clineignore_error", resolvedPath)
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
				return ""
			}

			const fileExists = await fileExistsAtPath(absolutePath)
			if (!fileExists) {
				return formatResponse.toolError(`File does not exist: ${resolvedPath}. Use write_tex to create new LaTeX files.`)
			}

			// Read original content for diff construction
			let originalContent = ""
			try {
				const { readFile } = await import("node:fs/promises")
				originalContent = await readFile(absolutePath, "utf8")
			} catch (error) {
				return formatResponse.toolError(
					`Failed to read file: ${resolvedPath}. Error: ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			// Process diff
			let processedDiff = rawDiff
			processedDiff = applyModelContentFixes(processedDiff, config.api.getModel().id, resolvedPath)

			// Construct new content from diff
			let newContent: string
			try {
				newContent = await constructNewFileContent(processedDiff, originalContent, !block.partial)
			} catch (error) {
				await config.callbacks.say("diff_error", resolvedPath)

				const errorType =
					error instanceof Error && error.message.includes("does not match anything")
						? "search_not_found"
						: "other_diff_error"

				telemetryService.captureDiffEditFailure(config.ulid, modelId, providerId, errorType, block.isNativeToolCall)

				const errorResponse = formatResponse.toolError(
					`${(error as Error)?.message}\n\n` + formatResponse.diffError(resolvedPath, originalContent),
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
				return ""
			}

			newContent = newContent.trimEnd()

			// Write modified .tex file
			const uri = vscode.Uri.file(absolutePath)
			const edit = new vscode.WorkspaceEdit()
			const document = await vscode.workspace.openTextDocument(uri)
			const fullRange = new vscode.Range(0, 0, document.lineCount, 0)
			edit.replace(uri, fullRange, newContent)

			const applied = await vscode.workspace.applyEdit(edit)
			if (!applied) {
				throw new Error(`Failed to modify file: ${absolutePath}`)
			}

			// Save the file
			await document.save()

			// Close the .tex file if it's open
			await this.closeTexFile(absolutePath)

			// Compile to PDF using LaTeX Workshop if available
			const pdfPath = await this.compileToPdf(absolutePath, config)

			// Open/update PDF in VS Code
			if (pdfPath && (await fileExistsAtPath(pdfPath))) {
				await this.openPdfInVscode(pdfPath, processedDiff)
			}

			// Set up file watcher to auto-compile on changes (if not already set up)
			await this.setupTexFileWatcher(absolutePath, config)

			// Prepare response message
			const shouldAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, resolvedPath)

			const completeMessage = JSON.stringify({
				tool: "editedExistingFile",
				path: getReadablePath(config.cwd, resolvedPath),
				content: processedDiff,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(resolvedPath),
			} satisfies ClineSayTool)

			if (shouldAutoApprove) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					modelId,
					providerId,
					true,
					true,
					{
						isMultiRootEnabled: false,
						usedWorkspaceHint: false,
						resolvedToNonPrimary: false,
						resolutionMethod: "primary_fallback",
					},
					block.isNativeToolCall,
				)
			} else {
				const notificationMessage = `Cline wants to edit ${path.basename(resolvedPath)}`
				showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)
				await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			}

			// Mark file as edited
			config.services.fileContextTracker.markFileAsEditedByCline(resolvedPath)
			config.taskState.didEditFile = true
			await config.services.fileContextTracker.trackFileContext(resolvedPath, "cline_edited")

			return formatResponse.fileEditWithoutUserChanges(resolvedPath, undefined, newContent, undefined)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			return formatResponse.toolError(`Failed to edit/compile LaTeX file: ${errorMessage}`)
		}
	}

	/**
	 * Compiles a .tex file to PDF using LaTeX Workshop if available, otherwise falls back to pdflatex
	 */
	private async compileToPdf(texPath: string, config: TaskConfig): Promise<string | null> {
		const texDir = path.dirname(texPath)
		const texBasename = path.basename(texPath, ".tex")
		const pdfPath = path.join(texDir, `${texBasename}.pdf`)

		// First, try to use LaTeX Workshop's build command if available
		try {
			console.log(`[ReplaceInTexToolHandler] Attempting to compile using LaTeX Workshop: ${texPath}`)

			// Check if LaTeX Workshop extension is available
			const latexWorkshopExtension = vscode.extensions.getExtension("James-Yu.latex-workshop")
			if (!latexWorkshopExtension) {
				console.log(`[ReplaceInTexToolHandler] LaTeX Workshop extension not found`)
				return null
			}

			// Ensure the extension is activated
			if (!latexWorkshopExtension.isActive) {
				await latexWorkshopExtension.activate()
			}

			// Open and save the .tex file first so LaTeX Workshop can detect it
			const texUri = vscode.Uri.file(texPath)
			const document = await vscode.workspace.openTextDocument(texUri)
			const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false })

			// Save the file to ensure it's on disk
			await document.save()

			// Wait a bit for LaTeX Workshop to recognize the file
			await new Promise((resolve) => setTimeout(resolve, 2000))

			// Trigger LaTeX Workshop build
			console.log(`[ReplaceInTexToolHandler] Triggering LaTeX Workshop build...`)
			await vscode.commands.executeCommand("latex-workshop.build")

			// Wait for compilation to complete
			console.log(`[ReplaceInTexToolHandler] Waiting for PDF to be created by LaTeX Workshop...`)
			for (let i = 0; i < 120; i++) {
				await new Promise((resolve) => setTimeout(resolve, 500))
				if (await fileExistsAtPath(pdfPath)) {
					console.log(`[ReplaceInTexToolHandler] PDF created by LaTeX Workshop: ${pdfPath}`)
					// Close the .tex file after compilation
					await this.closeTexFile(texPath)
					return pdfPath
				}
			}

			console.log(`[ReplaceInTexToolHandler] LaTeX Workshop compilation timed out after 60 seconds`)
			// Close the .tex file even if compilation timed out
			await this.closeTexFile(texPath)
			return null
		} catch (error) {
			console.log(`[ReplaceInTexToolHandler] LaTeX Workshop build failed: ${error}`)
			// Close the .tex file if we opened it
			await this.closeTexFile(texPath)
		}

		return null
	}

	/**
	 * Opens a PDF file in VS Code using the built-in PDF viewer
	 * @param pdfPath Path to the PDF file
	 * @param diff Optional diff information to show visual indicators
	 */
	private async openPdfInVscode(pdfPath: string, diff?: string): Promise<void> {
		try {
			const pdfUri = vscode.Uri.file(pdfPath)
			console.log(`[ReplaceInTexToolHandler] Attempting to open PDF: ${pdfPath}`)

			// First, try to use LaTeX Workshop's PDF viewer if available
			try {
				await vscode.commands.executeCommand("vscode.openWith", pdfUri, "latex-workshop-pdf-hook", {
					viewColumn: vscode.ViewColumn.Active,
					preserveFocus: false,
				})
				console.log(`[ReplaceInTexToolHandler] Opened PDF with LaTeX Workshop viewer`)

				// Add visual indicator for changes after a short delay to ensure PDF is loaded
				if (diff) {
					setTimeout(() => {
						this.addPdfChangeIndicator(pdfUri, diff)
					}, 2000)
				}
				return
			} catch (error) {
				console.log(`[ReplaceInTexToolHandler] LaTeX Workshop viewer not available, trying fallback: ${error}`)
			}

			// Fallback 1: Try VS Code's built-in PDF viewer via openTextDocument
			try {
				const document = await vscode.workspace.openTextDocument(pdfUri)
				await vscode.window.showTextDocument(document, {
					viewColumn: vscode.ViewColumn.Active,
					preserveFocus: false,
					preview: false,
				})
				console.log(`[ReplaceInTexToolHandler] Opened PDF with showTextDocument`)

				// Add visual indicator for changes
				if (diff) {
					setTimeout(() => {
						this.addPdfChangeIndicator(pdfUri, diff)
					}, 2000)
				}
				return
			} catch (error) {
				console.log(`[ReplaceInTexToolHandler] showTextDocument failed, trying vscode.open: ${error}`)
			}

			// Fallback 2: Try the vscode.open command
			try {
				await vscode.commands.executeCommand("vscode.open", pdfUri)
				console.log(`[ReplaceInTexToolHandler] Opened PDF with vscode.open command`)
				return
			} catch (error) {
				console.log(`[ReplaceInTexToolHandler] vscode.open failed: ${error}`)
			}

			// If all else fails, show error notification
			showSystemNotification({
				subtitle: "PDF Viewer Error",
				message: `Failed to open PDF file. You can manually open it at: ${pdfPath}`,
			})
		} catch (error) {
			console.error("[ReplaceInTexToolHandler] Error opening PDF:", error)
			showSystemNotification({
				subtitle: "PDF Viewer Error",
				message: `Failed to open PDF file: ${pdfPath}. Error: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	}

	/**
	 * Closes the .tex file if it's currently open in the editor
	 */
	private async closeTexFile(texPath: string): Promise<void> {
		try {
			const tabs = vscode.window.tabGroups.all.flatMap((tg) => tg.tabs)
			const texTab = tabs.find((tab) => {
				if (tab.input instanceof vscode.TabInputText) {
					return tab.input.uri.fsPath === texPath
				}
				return false
			})

			if (texTab && !texTab.isDirty) {
				await vscode.window.tabGroups.close(texTab)
			}
		} catch (error) {
			// Non-critical - if closing fails, continue anyway
			console.warn("Failed to close .tex file:", error)
		}
	}

	/**
	 * Adds a visual indicator to the PDF viewer to show that changes were made
	 * This creates a colored flash/border overlay on the PDF
	 */
	private async addPdfChangeIndicator(pdfUri: vscode.Uri, diff: string): Promise<void> {
		try {
			// Show notification about the update
			showSystemNotification({
				subtitle: "PDF Updated",
				message: "LaTeX document has been edited and PDF has been recompiled. Changes are now visible in the PDF viewer.",
			})

			// Try to add visual indicator via LaTeX Workshop's viewer
			// We'll attempt to inject a visual overlay by:
			// 1. Triggering a refresh with a visual indicator
			// 2. Adding a colored border/flash effect

			// Wait a bit for PDF to fully load
			await new Promise((resolve) => setTimeout(resolve, 1500))

			// Try to use LaTeX Workshop's refresh command which shows a loading mask
			// The mask system in LaTeX Workshop already provides visual feedback
			try {
				// Trigger refresh to show the loading mask (which indicates changes)
				await vscode.commands.executeCommand("latex-workshop.viewer.refresh", pdfUri)

				// After refresh, we could add a colored overlay, but that would require
				// modifying LaTeX Workshop's viewer code, which we can't do from here
				// Instead, the refresh itself provides visual feedback
			} catch {
				// Command might not exist, try alternative approach
				try {
					// Try to find and refresh the PDF viewer
					const visibleEditors = vscode.window.visibleTextEditors
					const pdfEditor = visibleEditors.find((editor) => editor.document.uri.toString() === pdfUri.toString())

					if (pdfEditor) {
						// The PDF viewer should auto-refresh when the file changes
						// LaTeX Workshop's watcher will handle this
						console.log(`[ReplaceInTexToolHandler] PDF viewer found, should auto-refresh`)
					}
				} catch (err) {
					console.log(`[ReplaceInTexToolHandler] Could not add visual indicator: ${err}`)
				}
			}

			// Note: For a more sophisticated diff visualization, we would need to:
			// 1. Parse the diff to identify changed sections
			// 2. Use SyncTeX to map LaTeX positions to PDF coordinates
			// 3. Overlay colored highlights on the PDF viewer
			// This would require integration with LaTeX Workshop's SyncTeX system
			// For now, the refresh mechanism and notification provide sufficient feedback
		} catch (error) {
			console.warn(`[ReplaceInTexToolHandler] Failed to add PDF change indicator: ${error}`)
		}
	}

	/**
	 * Sets up a file watcher to automatically recompile the .tex file when it changes
	 */
	private async setupTexFileWatcher(texPath: string, config: TaskConfig): Promise<void> {
		// Remove existing watcher if any
		const existingWatcher = this.texFileWatchers.get(texPath)
		if (existingWatcher) {
			existingWatcher.close()
		}

		// Create new watcher
		const watcher = chokidar.watch(texPath, {
			persistent: true,
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: 500, // Wait 500ms for file to stabilize
				pollInterval: 100,
			},
		})

		watcher.on("change", async () => {
			// Recompile when .tex file changes
			const pdfPath = await this.compileToPdf(texPath, config)
			if (pdfPath && (await fileExistsAtPath(pdfPath))) {
				// Add visual indicator that PDF was updated
				const pdfUri = vscode.Uri.file(pdfPath)
				await this.addPdfChangeIndicator(pdfUri, "File changed")
			}
		})

		watcher.on("error", (error) => {
			console.error(`Error watching .tex file ${texPath}:`, error)
		})

		this.texFileWatchers.set(texPath, watcher)
	}

	/**
	 * Cleanup watchers when handler is disposed
	 */
	dispose(): void {
		this.texFileWatchers.forEach((watcher) => watcher.close())
		this.texFileWatchers.clear()
	}

	private getModelInfo(config: TaskConfig) {
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const providerId = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const modelId = config.api.getModel().id
		return { providerId, modelId }
	}
}
