import { readFile } from "node:fs/promises"
import { resolveWorkspacePath } from "@core/workspace"
import { openFile } from "@integrations/misc/open-file"
import { showSystemNotification } from "@integrations/notifications"
import { createDirectoriesForFile } from "@utils/fs"
import { arePathsEqual, getCwd } from "@utils/path"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { DIFF_VIEW_URI_SCHEME } from "@/hosts/vscode/VscodeDiffViewProvider"
import { diagnosticsToProblemsString, getNewDiagnostics } from "@/integrations/diagnostics"
import { detectEncoding } from "@/integrations/misc/extract-text"
import { DiagnosticSeverity } from "@/shared/proto/index.cline"
import { ClineDefaultTool } from "@/shared/tools"
import type { FileOpsResult } from "./FileProviderOperations"
import { PendingFileApprovalManager } from "./PendingFileApprovalManager"
import { applyPendingFileDecorations, notifyMarkdownEditorDecorations } from "./PendingFileDecorations"

/**
 * Utility class for direct file operations that write files to disk
 * and open them in the regular editor (not diff view)
 * Uses WorkspaceEdit API to ensure TextDocument is immediately updated for other extensions
 */
export class DirectFileOperations {
	private preDiagnostics: any[] = []
	private approvalManager = PendingFileApprovalManager.getInstance()

	async createFile(
		path: string,
		content: string,
		taskId?: string,
		toolName?: ClineDefaultTool,
		requiresApproval: boolean = false,
	): Promise<FileOpsResult> {
		console.log("[DirectFileOperations] createFile called for:", path)

		const cwd = await getCwd()
		const pathResult = resolveWorkspacePath(cwd, path, "DirectFileOperations.createFile")
		const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
		console.log("[DirectFileOperations] Resolved absolute path:", absolutePath)

		// Close any existing diff views for this file before opening regular editor
		await this.closeDiffViewsForFile(absolutePath)

		// Create directories if needed
		await createDirectoriesForFile(absolutePath)

		// Get pre-diagnostics
		this.preDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics

		// Store original content (empty for new files)
		const originalContent = ""

		// Write file using WorkspaceEdit API (ensures TextDocument is immediately updated)
		console.log("[DirectFileOperations] Writing file using WorkspaceEdit API...")
		const uri = vscode.Uri.file(absolutePath)
		const edit = new vscode.WorkspaceEdit()
		edit.createFile(uri, { ignoreIfExists: false, contents: Buffer.from(content, "utf8") })

		const applied = await vscode.workspace.applyEdit(edit)
		if (!applied) {
			throw new Error(`Failed to create file: ${absolutePath}`)
		}
		console.log("[DirectFileOperations] File created successfully via WorkspaceEdit")

		// Always register file for undo/keep functionality (even when auto-approved)
		// This allows users to undo changes even if they were auto-approved
		if (taskId && toolName) {
			this.approvalManager.registerPendingFile(absolutePath, originalContent, content, taskId, toolName)
			// Only show notification if manual approval was required
			if (requiresApproval) {
				showSystemNotification({
					subtitle: "File Changes Pending Approval",
					message: `Changes to ${this.getFileName(absolutePath)} are pending approval. Use 'Cline: Accept File Changes' or 'Cline: Reject File Changes' from command palette.`,
				})
			}
		}

		// Check if this is a markdown file and open in markdown editor if so
		const isMarkdown = absolutePath.toLowerCase().endsWith(".md") || absolutePath.toLowerCase().endsWith(".markdown")

		if (isMarkdown) {
			console.log("[DirectFileOperations] Opening markdown file in markdown editor...")
			try {
				// biome-ignore lint: VS Code command API needed to open markdown editor
				await vscode.commands.executeCommand("markdown-editor.openEditor", vscode.Uri.file(absolutePath))
				console.log("[DirectFileOperations] Markdown editor opened")
			} catch (error) {
				console.log(`[DirectFileOperations] Failed to open markdown editor, falling back to default: ${error}`)
				await openFile(absolutePath, false, false)
			}
		} else {
			// Open file in regular editor
			console.log("[DirectFileOperations] Opening file in regular editor (not diff view)...")
			await openFile(absolutePath, false, false)
			console.log("[DirectFileOperations] File opened in editor")
		}

		// Always apply visual decorations to show changes (for new files, all lines are additions)
		// This allows users to see what changed even when auto-approved
		if (content && taskId && toolName) {
			if (isMarkdown) {
				// For markdown files, wait for the markdown editor to be ready
				setTimeout(() => {
					notifyMarkdownEditorDecorations(absolutePath, originalContent, content)
					// Also apply to text editor if it's open
					const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === absolutePath)
					if (editor) {
						applyPendingFileDecorations(editor, originalContent, content)
					}
				}, 500) // Longer delay for markdown editor to initialize
			} else {
				const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === absolutePath)
				if (editor) {
					// Wait a bit for the editor to fully load before applying decorations
					setTimeout(() => {
						applyPendingFileDecorations(editor, originalContent, content)
					}, 100)
				}
			}
		}

		// Get post-diagnostics
		const postDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics
		const newProblems = getNewDiagnostics(this.preDiagnostics, postDiagnostics)
		const newProblemsMessage =
			(await diagnosticsToProblemsString(newProblems, [DiagnosticSeverity.DIAGNOSTIC_ERROR])) || undefined

		// Read final content from TextDocument (more reliable than fs)
		let finalContent: string
		try {
			const document = await vscode.workspace.openTextDocument(uri)
			finalContent = document.getText()
		} catch {
			// Fallback to fs read if TextDocument not available
			finalContent = await readFile(absolutePath, "utf8")
		}

		return {
			finalContent,
			newProblemsMessage,
		}
	}

	async modifyFile(
		path: string,
		content: string,
		taskId?: string,
		toolName?: ClineDefaultTool,
		requiresApproval: boolean = false,
	): Promise<FileOpsResult> {
		console.log("[DirectFileOperations] modifyFile called for:", path)

		const cwd = await getCwd()
		const pathResult = resolveWorkspacePath(cwd, path, "DirectFileOperations.modifyFile")
		const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
		console.log("[DirectFileOperations] Resolved absolute path:", absolutePath)

		// Close any existing diff views for this file before opening regular editor
		await this.closeDiffViewsForFile(absolutePath)

		// Save any dirty changes first
		console.log("[DirectFileOperations] Saving dirty changes...")
		await HostProvider.workspace.saveOpenDocumentIfDirty({
			filePath: absolutePath,
		})

		// Get pre-diagnostics
		this.preDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics

		// Read original content for storing and encoding detection
		let originalContent = ""
		let fileEncoding = "utf8"
		try {
			const fileBuffer = await fs.readFile(absolutePath)
			fileEncoding = await detectEncoding(fileBuffer)
			originalContent = fileBuffer.toString(fileEncoding as BufferEncoding)
		} catch {
			// File might not exist, use default encoding
		}

		// Write new content using WorkspaceEdit API (ensures TextDocument is immediately updated)
		console.log("[DirectFileOperations] Writing file using WorkspaceEdit API...")
		const uri = vscode.Uri.file(absolutePath)
		const edit = new vscode.WorkspaceEdit()

		// Ensure document is available, then replace entire content
		const document = await vscode.workspace.openTextDocument(uri)
		const fullRange = new vscode.Range(0, 0, document.lineCount, 0)
		edit.replace(uri, fullRange, content)

		const applied = await vscode.workspace.applyEdit(edit)
		if (!applied) {
			throw new Error(`Failed to modify file: ${absolutePath}`)
		}
		console.log("[DirectFileOperations] File modified successfully via WorkspaceEdit")

		// Always register file for undo/keep functionality (even when auto-approved)
		// This allows users to undo changes even if they were auto-approved
		if (taskId && toolName && originalContent !== content) {
			this.approvalManager.registerPendingFile(absolutePath, originalContent, content, taskId, toolName)
			// Only show notification if manual approval was required
			if (requiresApproval) {
				showSystemNotification({
					subtitle: "File Changes Pending Approval",
					message: `Changes to ${this.getFileName(absolutePath)} are pending approval. Use 'Cline: Accept File Changes' or 'Cline: Reject File Changes' from command palette.`,
				})
			}
		}

		// Check if this is a markdown file and open in markdown editor if so
		const isMarkdown = absolutePath.toLowerCase().endsWith(".md") || absolutePath.toLowerCase().endsWith(".markdown")

		if (isMarkdown) {
			console.log("[DirectFileOperations] Opening markdown file in markdown editor...")
			try {
				// biome-ignore lint: VS Code command API needed to open markdown editor
				await vscode.commands.executeCommand("markdown-editor.openEditor", vscode.Uri.file(absolutePath))
				console.log("[DirectFileOperations] Markdown editor opened")
			} catch (error) {
				console.log(`[DirectFileOperations] Failed to open markdown editor, falling back to default: ${error}`)
				await openFile(absolutePath, false, false)
			}
		} else {
			// Open file in regular editor
			console.log("[DirectFileOperations] Opening file in regular editor (not diff view)...")
			await openFile(absolutePath, false, false)
			console.log("[DirectFileOperations] File opened in editor")
		}

		// Always apply visual decorations to show changes
		// This allows users to see what changed even when auto-approved
		if (originalContent !== content && taskId && toolName) {
			if (isMarkdown) {
				// For markdown files, wait for the markdown editor to be ready
				setTimeout(() => {
					notifyMarkdownEditorDecorations(absolutePath, originalContent, content)
					// Also apply to text editor if it's open
					const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === absolutePath)
					if (editor) {
						applyPendingFileDecorations(editor, originalContent, content)
					}
				}, 500) // Longer delay for markdown editor to initialize
			} else {
				const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === absolutePath)
				if (editor) {
					// Wait a bit for the editor to fully load before applying decorations
					setTimeout(() => {
						applyPendingFileDecorations(editor, originalContent, content)
					}, 100)
				}
			}
		}

		// Get post-diagnostics
		const postDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics
		const newProblems = getNewDiagnostics(this.preDiagnostics, postDiagnostics)
		const newProblemsMessage =
			(await diagnosticsToProblemsString(newProblems, [DiagnosticSeverity.DIAGNOSTIC_ERROR])) || undefined

		// Read final content from TextDocument (more reliable than fs)
		let finalContent: string
		try {
			const updatedDocument = await vscode.workspace.openTextDocument(uri)
			finalContent = updatedDocument.getText()
		} catch {
			// Fallback to fs read if TextDocument not available
			finalContent = await readFile(absolutePath, fileEncoding as BufferEncoding)
		}

		return {
			finalContent,
			newProblemsMessage,
		}
	}

	async deleteFile(path: string): Promise<void> {
		const cwd = await getCwd()
		const pathResult = resolveWorkspacePath(cwd, path, "DirectFileOperations.deleteFile")
		const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath

		// Delete file directly
		await fs.rm(absolutePath, { force: true })
	}

	async moveFile(
		oldPath: string,
		newPath: string,
		content: string,
		taskId?: string,
		toolName?: ClineDefaultTool,
		requiresApproval: boolean = false,
	): Promise<FileOpsResult> {
		const result = await this.createFile(newPath, content, taskId, toolName, requiresApproval)
		await this.deleteFile(oldPath)
		return result
	}

	async getFileContent(): Promise<string | undefined> {
		// Not used in direct mode, but kept for interface compatibility
		return undefined
	}

	/**
	 * Close any existing diff views for a specific file to prevent diff view from appearing
	 */
	private async closeDiffViewsForFile(absolutePath: string): Promise<void> {
		try {
			// Close any diff views that use the cline-diff scheme for this file
			const tabs = vscode.window.tabGroups.all.flatMap((tg) => tg.tabs)
			const diffTabs = tabs.filter(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff &&
					tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME &&
					arePathsEqual(tab.input.modified.fsPath, absolutePath),
			)
			for (const tab of diffTabs) {
				if (!tab.isDirty) {
					try {
						await vscode.window.tabGroups.close(tab)
						console.log("[DirectFileOperations] Closed diff view for:", absolutePath)
					} catch (error) {
						console.warn("[DirectFileOperations] Failed to close diff tab:", error)
					}
				}
			}
		} catch (error) {
			// Non-critical - if closing fails, we'll still try to open the regular editor
			console.warn("[DirectFileOperations] Failed to close diff views:", error)
		}
	}

	/**
	 * Get file name from absolute path for display
	 */
	private getFileName(absolutePath: string): string {
		const parts = absolutePath.split(/[/\\]/)
		return parts[parts.length - 1] || absolutePath
	}
}
