import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { showSystemNotification } from "@integrations/notifications"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { createDirectoriesForFile, fileExistsAtPath } from "@utils/fs"
import { getCwd, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { spawn } from "child_process"
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
 * Handler for write_tex tool that creates LaTeX files, compiles them to PDF,
 * and displays the PDF while hiding the .tex file.
 */
export class WriteTexToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.WRITE_TEX

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
		const rawContent = block.params.content

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

		if (!rawContent) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
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
			const pathResult = resolveWorkspacePath(cwd, texPath, "WriteTexToolHandler.execute")
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

			// Process content
			let newContent = rawContent
			if (newContent.startsWith("```")) {
				newContent = newContent.split("\n").slice(1).join("\n").trim()
			}
			if (newContent.endsWith("```")) {
				newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
			}
			newContent = applyModelContentFixes(newContent, config.api.getModel().id, resolvedPath)
			newContent = newContent.trimEnd()

			// Apply header and footer format
			newContent = await this.applyDocumentFormat(newContent, absolutePath, config)

			// Create directories if needed
			await createDirectoriesForFile(absolutePath)

			// Write .tex file
			const uri = vscode.Uri.file(absolutePath)
			const edit = new vscode.WorkspaceEdit()

			if (fileExists) {
				// Modify existing file
				const document = await vscode.workspace.openTextDocument(uri)
				const fullRange = new vscode.Range(0, 0, document.lineCount, 0)
				edit.replace(uri, fullRange, newContent)
			} else {
				// Create new file
				edit.createFile(uri, { ignoreIfExists: false, contents: Buffer.from(newContent, "utf8") })
			}

			const applied = await vscode.workspace.applyEdit(edit)
			if (!applied) {
				throw new Error(`Failed to ${fileExists ? "modify" : "create"} file: ${absolutePath}`)
			}

			// Close the .tex file if it's open
			await this.closeTexFile(absolutePath)

			// Compile to PDF using LaTeX Workshop if available, otherwise use pdflatex directly
			const pdfPath = await this.compileToPdf(absolutePath, config)

			// Open PDF in VS Code
			if (pdfPath) {
				// Wait a bit to ensure PDF file is fully written
				await new Promise((resolve) => setTimeout(resolve, 500))

				// Double-check PDF exists before opening
				if (await fileExistsAtPath(pdfPath)) {
					await this.openPdfInVscode(pdfPath)
				} else {
					showSystemNotification({
						subtitle: "PDF Not Found",
						message: `PDF file was not found at: ${pdfPath}. The .tex file has been created.`,
					})
				}
			} else {
				// If PDF compilation failed, show notification
				const expectedPdfPath = path.join(path.dirname(absolutePath), `${path.basename(absolutePath, ".tex")}.pdf`)
				showSystemNotification({
					subtitle: "PDF Compilation",
					message: `PDF compilation may have failed. Expected PDF at: ${expectedPdfPath}. The .tex file has been created.`,
				})
			}

			// Set up file watcher to auto-compile on changes
			await this.setupTexFileWatcher(absolutePath, config)

			// Prepare response message
			const shouldAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, resolvedPath)

			const completeMessage = JSON.stringify({
				tool: fileExists ? "editedExistingFile" : "newFileCreated",
				path: getReadablePath(config.cwd, resolvedPath),
				content: newContent,
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
				const notificationMessage = `Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(resolvedPath)}`
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
			return formatResponse.toolError(`Failed to create/compile LaTeX file: ${errorMessage}`)
		}
	}

	/**
	 * Applies header and footer format to LaTeX document
	 */
	private async applyDocumentFormat(content: string, texPath: string, config: TaskConfig): Promise<string> {
		// Get workspace root
		const workspaceRoot = config.workspaceManager?.getPrimaryRoot()?.path || config.cwd

		// Check if logo exists
		const logoPath = path.join(workspaceRoot, "logos", "company_logo.png")
		const logoExists = await fileExistsAtPath(logoPath)

		// Extract body content from the LaTeX document
		// Look for content between \begin{document} and \end{document}
		const documentBeginMatch = content.match(/\\begin\{document\}/i)
		const documentEndMatch = content.match(/\\end\{document\}/i)

		let bodyContent = ""
		let preamble = ""
		let documentClass = "\\documentclass{article}"
		const requiredPackages = ["graphicx", "fancyhdr", "lastpage"]

		if (documentBeginMatch && documentEndMatch) {
			const beginIndex = documentBeginMatch.index! + documentBeginMatch[0].length
			const endIndex = documentEndMatch.index!
			bodyContent = content.substring(beginIndex, endIndex).trim()
			preamble = content.substring(0, documentBeginMatch.index!).trim()

			// Extract document class if present
			const docClassMatch = preamble.match(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/)
			if (docClassMatch) {
				documentClass = docClassMatch[0]
				// Remove document class from preamble
				preamble = preamble.replace(docClassMatch[0], "").trim()
			}

			// Check which required packages are already in preamble
			const existingPackages = new Set<string>()
			for (const pkg of requiredPackages) {
				// Check for \usepackage{pkg} or \usepackage[...]{pkg}
				const pkgRegex = new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${pkg}\\}`, "i")
				if (pkgRegex.test(preamble)) {
					existingPackages.add(pkg)
				}
			}

			// Check if geometry package is present
			const hasGeometry = /\\usepackage(?:\[[^\]]*\])?\{geometry\}/i.test(preamble)

			// Add missing packages
			const missingPackages = requiredPackages.filter((pkg) => !existingPackages.has(pkg))
			if (missingPackages.length > 0 || !hasGeometry) {
				const packagesToAdd: string[] = []
				if (missingPackages.length > 0) {
					packagesToAdd.push(...missingPackages.map((pkg) => `\\usepackage{${pkg}}`))
				}
				if (!hasGeometry) {
					packagesToAdd.push("\\usepackage[margin=1in]{geometry}")
				}
				if (packagesToAdd.length > 0) {
					preamble = preamble ? `${preamble}\n${packagesToAdd.join("\n")}` : packagesToAdd.join("\n")
				}
			}
		} else {
			// If no document environment found, use entire content as body
			bodyContent = content
			// Add all required packages
			preamble = `\\usepackage{graphicx}
\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\usepackage[margin=1in]{geometry}`
		}

		// Calculate relative path from tex file to logo
		const texDir = path.dirname(texPath)
		const relativeLogoPath = path.relative(texDir, logoPath).replace(/\\/g, "/")

		// Build formatted document with header and footer
		const formattedContent = `${documentClass}
${preamble}

% Header and footer configuration
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0.4pt}
\\renewcommand{\\footrulewidth}{0.4pt}

% Header: Logo on left, title on right
\\fancyhead[L]{${logoExists ? `\\includegraphics[height=0.8cm]{${relativeLogoPath}}` : ""}}
\\fancyhead[R]{Levofloxacin Tablets USP (500 mg)\\\\Module 2: Overview and Summary}

% Footer: Confidential on left, page number in center, company name on right
\\fancyfoot[L]{Confidential}
\\fancyfoot[C]{\\thepage}
\\fancyfoot[R]{Acme Lifetech LLP}

% Apply the same style to the first page (plain style)
\\fancypagestyle{plain}{%
  \\fancyhf{}
  \\renewcommand{\\headrulewidth}{0.4pt}
  \\renewcommand{\\footrulewidth}{0.4pt}
  \\fancyhead[L]{${logoExists ? `\\includegraphics[height=0.8cm]{${relativeLogoPath}}` : ""}}
  \\fancyhead[R]{Levofloxacin Tablets USP (500 mg)\\\\Module 2: Overview and Summary}
  \\fancyfoot[L]{Confidential}
  \\fancyfoot[C]{\\thepage}
  \\fancyfoot[R]{Acme Lifetech LLP}
}

\\begin{document}
${bodyContent}
\\end{document}`

		return formattedContent
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
			console.log(`[WriteTexToolHandler] Attempting to compile using LaTeX Workshop: ${texPath}`)

			// Check if LaTeX Workshop extension is available
			const latexWorkshopExtension = vscode.extensions.getExtension("James-Yu.latex-workshop")
			if (!latexWorkshopExtension) {
				console.log(`[WriteTexToolHandler] LaTeX Workshop extension not found`)
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

			// Trigger LaTeX Workshop build - use the build command without parameters
			// This will use the active editor's file
			console.log(`[WriteTexToolHandler] Triggering LaTeX Workshop build...`)
			await vscode.commands.executeCommand("latex-workshop.build")

			// Wait for compilation to complete (LaTeX Workshop compiles asynchronously)
			// Poll for the PDF file - increase timeout to 60 seconds for complex documents
			console.log(`[WriteTexToolHandler] Waiting for PDF to be created by LaTeX Workshop...`)
			for (let i = 0; i < 120; i++) {
				await new Promise((resolve) => setTimeout(resolve, 500))
				if (await fileExistsAtPath(pdfPath)) {
					console.log(`[WriteTexToolHandler] PDF created by LaTeX Workshop: ${pdfPath}`)
					// Close the .tex file after compilation
					await this.closeTexFile(texPath)
					return pdfPath
				}
			}

			console.log(`[WriteTexToolHandler] LaTeX Workshop compilation timed out after 60 seconds`)
			// Close the .tex file even if compilation timed out
			await this.closeTexFile(texPath)
			return null
		} catch (error) {
			console.log(`[WriteTexToolHandler] LaTeX Workshop build failed: ${error}`)
			// Close the .tex file if we opened it
			await this.closeTexFile(texPath)
		}

		// If LaTeX Workshop didn't work, return null (don't fall back to pdflatex if it's not available)
		return null
	}

	/**
	 * Compiles a .tex file to PDF using pdflatex directly
	 */
	private async compileToPdfWithPdflatex(texPath: string, config: TaskConfig): Promise<string | null> {
		const texDir = path.dirname(texPath)
		const texBasename = path.basename(texPath, ".tex")
		const texFilename = path.basename(texPath)
		// PDF will be created in the same directory as the .tex file
		const pdfPath = path.join(texDir, `${texBasename}.pdf`)

		console.log(`[WriteTexToolHandler] Compiling LaTeX file: ${texPath}`)
		console.log(`[WriteTexToolHandler] Expected PDF output: ${pdfPath}`)

		return new Promise((resolve) => {
			// Use pdflatex to compile - output to the same directory as the .tex file
			const pdflatex = spawn("pdflatex", ["-interaction=nonstopmode", "-output-directory", texDir, texFilename], {
				cwd: texDir,
				shell: process.platform === "win32",
			})

			let stdout = ""
			let stderr = ""

			pdflatex.stdout.on("data", (data) => {
				const output = data.toString()
				stdout += output
				console.log(`[WriteTexToolHandler] pdflatex stdout: ${output}`)
			})

			pdflatex.stderr.on("data", (data) => {
				const output = data.toString()
				stderr += output
				console.log(`[WriteTexToolHandler] pdflatex stderr: ${output}`)
			})

			pdflatex.on("close", (code) => {
				console.log(`[WriteTexToolHandler] First pdflatex run completed with code: ${code}`)
				if (code === 0) {
					// Run pdflatex again to resolve references
					const pdflatex2 = spawn("pdflatex", ["-interaction=nonstopmode", "-output-directory", texDir, texFilename], {
						cwd: texDir,
						shell: process.platform === "win32",
					})

					let stdout2 = ""
					let stderr2 = ""

					pdflatex2.stdout.on("data", (data) => {
						const output = data.toString()
						stdout2 += output
						console.log(`[WriteTexToolHandler] pdflatex2 stdout: ${output}`)
					})

					pdflatex2.stderr.on("data", (data) => {
						const output = data.toString()
						stderr2 += output
						console.log(`[WriteTexToolHandler] pdflatex2 stderr: ${output}`)
					})

					pdflatex2.on("close", (code2) => {
						console.log(`[WriteTexToolHandler] Second pdflatex run completed with code: ${code2}`)
						fileExistsAtPath(pdfPath).then((exists) => {
							if (exists) {
								console.log(`[WriteTexToolHandler] PDF successfully created at: ${pdfPath}`)
								resolve(pdfPath)
							} else {
								console.error(`[WriteTexToolHandler] PDF not found at: ${pdfPath}`)
								console.error(
									`[WriteTexToolHandler] Compilation output:\n${stdout}\n${stderr}\n${stdout2}\n${stderr2}`,
								)
								showSystemNotification({
									subtitle: "PDF Compilation Failed",
									message: `PDF was not created. Check console for pdflatex output.`,
								})
								resolve(null)
							}
						})
					})

					pdflatex2.on("error", (err) => {
						console.error("[WriteTexToolHandler] Error running second pdflatex:", err)
						// Check if PDF was created anyway
						fileExistsAtPath(pdfPath).then((exists) => {
							if (exists) {
								resolve(pdfPath)
							} else {
								resolve(null)
							}
						})
					})
				} else {
					console.warn(`[WriteTexToolHandler] First pdflatex run failed with code ${code}`)
					console.warn(`[WriteTexToolHandler] Compilation output:\n${stdout}\n${stderr}`)
					// Check if PDF was created anyway (sometimes pdflatex returns non-zero but creates PDF)
					fileExistsAtPath(pdfPath).then((exists) => {
						if (exists) {
							console.log(`[WriteTexToolHandler] PDF was created despite error code`)
							resolve(pdfPath)
						} else {
							showSystemNotification({
								subtitle: "PDF Compilation Failed",
								message: `pdflatex exited with code ${code}. Check console for details.`,
							})
							resolve(null)
						}
					})
				}
			})

			pdflatex.on("error", (err) => {
				console.error("[WriteTexToolHandler] Error running pdflatex:", err)
				showSystemNotification({
					subtitle: "LaTeX Compilation Error",
					message: `Failed to run pdflatex. Make sure pdflatex is installed and in your PATH. Error: ${err.message}`,
				})
				resolve(null)
			})
		})
	}

	/**
	 * Opens a PDF file in VS Code using the built-in PDF viewer
	 */
	private async openPdfInVscode(pdfPath: string): Promise<void> {
		try {
			const pdfUri = vscode.Uri.file(pdfPath)
			console.log(`[WriteTexToolHandler] Attempting to open PDF: ${pdfPath}`)

			// First, try to use LaTeX Workshop's PDF viewer if available
			try {
				await vscode.commands.executeCommand("vscode.openWith", pdfUri, "latex-workshop-pdf-hook", {
					viewColumn: vscode.ViewColumn.Active,
					preserveFocus: false,
				})
				console.log(`[WriteTexToolHandler] Opened PDF with LaTeX Workshop viewer`)
				return
			} catch (error) {
				console.log(`[WriteTexToolHandler] LaTeX Workshop viewer not available, trying fallback: ${error}`)
			}

			// Fallback 1: Try VS Code's built-in PDF viewer via openTextDocument
			try {
				const document = await vscode.workspace.openTextDocument(pdfUri)
				await vscode.window.showTextDocument(document, {
					viewColumn: vscode.ViewColumn.Active,
					preserveFocus: false,
					preview: false,
				})
				console.log(`[WriteTexToolHandler] Opened PDF with showTextDocument`)
				return
			} catch (error) {
				console.log(`[WriteTexToolHandler] showTextDocument failed, trying vscode.open: ${error}`)
			}

			// Fallback 2: Try the vscode.open command
			try {
				await vscode.commands.executeCommand("vscode.open", pdfUri)
				console.log(`[WriteTexToolHandler] Opened PDF with vscode.open command`)
				return
			} catch (error) {
				console.log(`[WriteTexToolHandler] vscode.open failed: ${error}`)
			}

			// If all else fails, show error notification
			showSystemNotification({
				subtitle: "PDF Viewer Error",
				message: `Failed to open PDF file. You can manually open it at: ${pdfPath}`,
			})
		} catch (error) {
			console.error("[WriteTexToolHandler] Error opening PDF:", error)
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
				// PDF viewer should auto-refresh, but we can try to reload it
				// The PDF viewer in VS Code typically auto-refreshes when the file changes
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
