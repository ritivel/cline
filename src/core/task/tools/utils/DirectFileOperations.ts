import { readFile } from "node:fs/promises"
import { resolveWorkspacePath } from "@core/workspace"
import { openFile } from "@integrations/misc/open-file"
import { showSystemNotification } from "@integrations/notifications"
import { createDirectoriesForFile, writeFile } from "@utils/fs"
import { arePathsEqual, getCwd } from "@utils/path"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { DIFF_VIEW_URI_SCHEME } from "@/hosts/vscode/VscodeDiffViewProvider"
import { diagnosticsToProblemsString, getNewDiagnostics } from "@/integrations/diagnostics"
import { detectEncoding } from "@/integrations/misc/extract-text"
import { DiagnosticSeverity } from "@/shared/proto/index.cline"
import type { FileOpsResult } from "./FileProviderOperations"

/**
 * Utility class for direct file operations that write files to disk
 * and open them in the regular editor (not diff view)
 */
export class DirectFileOperations {
	private preDiagnostics: any[] = []

	async createFile(path: string, content: string): Promise<FileOpsResult> {
		console.log("[DirectFileOperations] createFile called for:", path)

		// VISIBLE TEST: Show notification to confirm new code is running
		showSystemNotification({
			subtitle: "✅ NEW BUILD ACTIVE",
			message: `DirectFileOperations.createFile() - Applying patch directly (no diff view)`,
		})

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

		// Write file directly
		console.log("[DirectFileOperations] Writing file directly...")
		await writeFile(absolutePath, content, "utf8")
		console.log("[DirectFileOperations] File written successfully")

		// Open file in regular editor
		console.log("[DirectFileOperations] Opening file in regular editor (not diff view)...")
		await openFile(absolutePath, false, false)
		console.log("[DirectFileOperations] File opened in editor")

		// Get post-diagnostics
		const postDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics
		const newProblems = getNewDiagnostics(this.preDiagnostics, postDiagnostics)
		const newProblemsMessage =
			(await diagnosticsToProblemsString(newProblems, [DiagnosticSeverity.DIAGNOSTIC_ERROR])) || undefined

		// Read final content to return
		const finalContent = await readFile(absolutePath, "utf8")

		return {
			finalContent,
			newProblemsMessage,
		}
	}

	async modifyFile(path: string, content: string): Promise<FileOpsResult> {
		console.log("[DirectFileOperations] modifyFile called for:", path)

		// VISIBLE TEST: Show notification to confirm new code is running
		showSystemNotification({
			subtitle: "✅ NEW BUILD ACTIVE",
			message: `DirectFileOperations.modifyFile() - Applying patch directly (no diff view)`,
		})

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

		// Read original content for encoding detection
		let fileEncoding = "utf8"
		try {
			const fileBuffer = await fs.readFile(absolutePath)
			fileEncoding = await detectEncoding(fileBuffer)
		} catch {
			// File might not exist, use default encoding
		}

		// Write new content directly
		console.log("[DirectFileOperations] Writing file directly...")
		await writeFile(absolutePath, content, fileEncoding as BufferEncoding)
		console.log("[DirectFileOperations] File written successfully")

		// Open file in regular editor
		console.log("[DirectFileOperations] Opening file in regular editor (not diff view)...")
		await openFile(absolutePath, false, false)
		console.log("[DirectFileOperations] File opened in editor")

		// Get post-diagnostics
		const postDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics
		const newProblems = getNewDiagnostics(this.preDiagnostics, postDiagnostics)
		const newProblemsMessage =
			(await diagnosticsToProblemsString(newProblems, [DiagnosticSeverity.DIAGNOSTIC_ERROR])) || undefined

		// Read final content to return
		const finalContent = await readFile(absolutePath, fileEncoding as BufferEncoding)

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

	async moveFile(oldPath: string, newPath: string, content: string): Promise<FileOpsResult> {
		const result = await this.createFile(newPath, content)
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
}
