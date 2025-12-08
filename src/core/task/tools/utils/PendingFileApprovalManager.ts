import { showSystemNotification } from "@integrations/notifications"
import * as vscode from "vscode"
import { ClineDefaultTool } from "@/shared/tools"

interface PendingFileInfo {
	originalContent: string
	newContent: string
	taskId: string
	toolName: ClineDefaultTool
	absolutePath: string
}

/**
 * Singleton manager to track files that can be undone/reverted
 * Files are written immediately, but registered here so users can undo/keep changes
 * Works for both auto-approved and manually-approved files
 */
export class PendingFileApprovalManager {
	private static instance: PendingFileApprovalManager
	private pendingFiles = new Map<string, PendingFileInfo>()

	private constructor() {}

	static getInstance(): PendingFileApprovalManager {
		if (!PendingFileApprovalManager.instance) {
			PendingFileApprovalManager.instance = new PendingFileApprovalManager()
		}
		return PendingFileApprovalManager.instance
	}

	/**
	 * Register a file for undo/keep functionality
	 * Files are written immediately, but registered here so users can undo changes later
	 */
	registerPendingFile(
		absolutePath: string,
		originalContent: string,
		newContent: string,
		taskId: string,
		toolName: ClineDefaultTool,
	): void {
		this.pendingFiles.set(absolutePath, {
			originalContent,
			newContent,
			taskId,
			toolName,
			absolutePath,
		})
		console.log(`[PendingFileApprovalManager] Registered pending file: ${absolutePath}`)
	}

	/**
	 * Get pending file information
	 */
	getPendingFile(absolutePath: string): PendingFileInfo | undefined {
		return this.pendingFiles.get(absolutePath)
	}

	/**
	 * Check if a file has pending approval
	 */
	hasPendingFile(absolutePath: string): boolean {
		return this.pendingFiles.has(absolutePath)
	}

	/**
	 * Get all pending files
	 */
	getAllPendingFiles(): PendingFileInfo[] {
		return Array.from(this.pendingFiles.values())
	}

	/**
	 * Get all pending files for a specific task
	 */
	getPendingFilesForTask(taskId: string): PendingFileInfo[] {
		return Array.from(this.pendingFiles.values()).filter((info) => info.taskId === taskId)
	}

	/**
	 * Approve a pending file - marks it as approved and removes from pending
	 */
	async approveFile(absolutePath: string): Promise<boolean> {
		const pendingInfo = this.pendingFiles.get(absolutePath)
		if (!pendingInfo) {
			console.warn(`[PendingFileApprovalManager] No pending file found for: ${absolutePath}`)
			return false
		}

		// Remove from pending map
		this.pendingFiles.delete(absolutePath)

		console.log(`[PendingFileApprovalManager] Approved file: ${absolutePath}`)

		// Show success notification
		showSystemNotification({
			subtitle: "File Changes Approved",
			message: `Changes to ${this.getFileName(absolutePath)} have been approved`,
		})

		return true
	}

	/**
	 * Reject a pending file - reverts to original content and removes from pending
	 */
	async rejectFile(absolutePath: string): Promise<boolean> {
		const pendingInfo = this.pendingFiles.get(absolutePath)
		if (!pendingInfo) {
			console.warn(`[PendingFileApprovalManager] No pending file found for: ${absolutePath}`)
			return false
		}

		try {
			// Revert file to original content using WorkspaceEdit API
			const uri = vscode.Uri.file(absolutePath)
			const edit = new vscode.WorkspaceEdit()

			// Check if file exists (for new files, originalContent is empty string)
			if (pendingInfo.originalContent === "") {
				// File was new, delete it
				edit.deleteFile(uri, { ignoreIfNotExists: true })
			} else {
				// File existed, replace content with original
				// First, ensure document is available
				// biome-ignore lint: WorkspaceEdit API needed for TextDocument updates to be visible to other extensions
				const document = await vscode.workspace.openTextDocument(uri)
				const fullRange = new vscode.Range(0, 0, document.lineCount, 0)
				edit.replace(uri, fullRange, pendingInfo.originalContent)
			}

			// Apply the edit
			// biome-ignore lint: WorkspaceEdit API needed for TextDocument updates to be visible to other extensions
			const applied = await vscode.workspace.applyEdit(edit)
			if (!applied) {
				console.error(`[PendingFileApprovalManager] Failed to apply revert edit for: ${absolutePath}`)
				return false
			}

			// Remove from pending map
			this.pendingFiles.delete(absolutePath)

			console.log(`[PendingFileApprovalManager] Rejected and reverted file: ${absolutePath}`)

			// Show rejection notification
			showSystemNotification({
				subtitle: "File Changes Rejected",
				message: `Changes to ${this.getFileName(absolutePath)} have been rejected and reverted`,
			})

			return true
		} catch (error) {
			console.error(`[PendingFileApprovalManager] Error rejecting file ${absolutePath}:`, error)
			return false
		}
	}

	/**
	 * Clear all pending files (for cleanup on task completion/abort)
	 */
	clearAllPendingFiles(): void {
		this.pendingFiles.clear()
		console.log(`[PendingFileApprovalManager] Cleared all pending files`)
	}

	/**
	 * Clear pending files for a specific task
	 */
	clearPendingFilesForTask(taskId: string): void {
		const filesToRemove = this.getPendingFilesForTask(taskId)
		for (const info of filesToRemove) {
			this.pendingFiles.delete(info.absolutePath)
		}
		console.log(`[PendingFileApprovalManager] Cleared ${filesToRemove.length} pending files for task: ${taskId}`)
	}

	/**
	 * Get file name from absolute path for display
	 */
	private getFileName(absolutePath: string): string {
		const parts = absolutePath.split(/[/\\]/)
		return parts[parts.length - 1] || absolutePath
	}
}
