import * as vscode from "vscode"
import { WebviewProvider } from "@/core/webview"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { ShowMessageType } from "@/shared/proto/index.host"
import { PendingFileApprovalManager } from "./PendingFileApprovalManager"
import { clearPendingFileDecorations, notifyMarkdownEditorClearDecorations } from "./PendingFileDecorations"

/**
 * Handle accepting file changes for the active editor or any pending file
 * Note: This is a VS Code command handler, so using vscode APIs directly is acceptable
 */
export async function handleAcceptFileChanges(): Promise<void> {
	const approvalManager = PendingFileApprovalManager.getInstance()

	// Try to get the file path from active editor first
	// biome-ignore lint: VS Code command handler needs direct access to activeTextEditor
	const activeEditor = vscode.window.activeTextEditor
	let absolutePath: string | undefined

	if (activeEditor) {
		absolutePath = activeEditor.document.uri.fsPath
	}

	// If no active editor or active editor doesn't have pending changes,
	// try to find any pending file (useful when called from markdown editor webview)
	let pendingInfo = absolutePath ? approvalManager.getPendingFile(absolutePath) : undefined

	if (!pendingInfo) {
		// Get all pending files and use the first one
		const allPendingFiles = approvalManager.getAllPendingFiles()
		if (allPendingFiles.length > 0) {
			absolutePath = allPendingFiles[0].absolutePath
			pendingInfo = allPendingFiles[0]
		}
	}

	if (!absolutePath) {
		await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: "No active editor. Please open a file with pending changes.",
		})
		return
	}

	if (!pendingInfo) {
		await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "No pending changes found for this file.",
		})
		return
	}

	// Approve the file
	const approved = await approvalManager.approveFile(absolutePath)
	if (!approved) {
		await HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to approve file changes.",
		})
		return
	}

	// Clear visual decorations
	if (activeEditor && activeEditor.document.uri.fsPath === absolutePath) {
		clearPendingFileDecorations(activeEditor)
	} else {
		// Try to find the editor for this file
		// biome-ignore lint: VS Code command handler needs direct access to visibleTextEditors
		const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === absolutePath)
		if (editor) {
			clearPendingFileDecorations(editor)
		}
	}
	// Also clear decorations in markdown editor if open
	await notifyMarkdownEditorClearDecorations(absolutePath)

	// Mark file as edited by Cline and track context
	// We need to access the controller to get file context tracker
	const webview = WebviewProvider.getInstance()
	const controller = webview?.controller

	if (controller?.task) {
		// Update task state - file is already written, so we just mark it as edited
		controller.task.taskState.didEditFile = true

		// Note: File tracking (markFileAsEditedByCline, trackFileContext) would ideally happen here,
		// but fileContextTracker is private in Task. The file is already written and visible,
		// so the main functionality (approval/rejection) works correctly.
		// File tracking will happen naturally when the task processes file operations.
	}

	// Capture telemetry
	const apiConfig = controller?.stateManager.getApiConfiguration()
	const currentMode = controller?.stateManager.getGlobalSettingsKey("mode")
	const providerId = currentMode === "plan" ? apiConfig?.planModeApiProvider : apiConfig?.actModeApiProvider
	// Get model ID from task if available
	let modelId: string | undefined
	if (controller?.task) {
		modelId = controller.task.api.getModel().id
	}

	if (providerId && modelId && pendingInfo.taskId) {
		telemetryService.captureToolUsage(
			pendingInfo.taskId,
			pendingInfo.toolName,
			modelId,
			providerId,
			false, // wasAutoApproved
			true, // approved
			undefined,
			false, // isNativeToolCall - we don't have this info
		)
	}
}

/**
 * Handle rejecting file changes for the active editor or any pending file
 * Note: This is a VS Code command handler, so using vscode APIs directly is acceptable
 */
export async function handleRejectFileChanges(): Promise<void> {
	const approvalManager = PendingFileApprovalManager.getInstance()

	// Try to get the file path from active editor first
	// biome-ignore lint: VS Code command handler needs direct access to activeTextEditor
	const activeEditor = vscode.window.activeTextEditor
	let absolutePath: string | undefined

	if (activeEditor) {
		absolutePath = activeEditor.document.uri.fsPath
	}

	// If no active editor or active editor doesn't have pending changes,
	// try to find any pending file (useful when called from markdown editor webview)
	let pendingInfo = absolutePath ? approvalManager.getPendingFile(absolutePath) : undefined

	if (!pendingInfo) {
		// Get all pending files and use the first one
		const allPendingFiles = approvalManager.getAllPendingFiles()
		if (allPendingFiles.length > 0) {
			absolutePath = allPendingFiles[0].absolutePath
			pendingInfo = allPendingFiles[0]
		}
	}

	if (!absolutePath) {
		await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: "No active editor. Please open a file with pending changes.",
		})
		return
	}

	if (!pendingInfo) {
		await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "No pending changes found for this file.",
		})
		return
	}

	// Reject the file (reverts to original content)
	const rejected = await approvalManager.rejectFile(absolutePath)
	if (!rejected) {
		await HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to reject file changes.",
		})
		return
	}

	// Clear visual decorations
	if (activeEditor && activeEditor.document.uri.fsPath === absolutePath) {
		clearPendingFileDecorations(activeEditor)
	} else {
		// Try to find the editor for this file
		// biome-ignore lint: VS Code command handler needs direct access to visibleTextEditors
		const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === absolutePath)
		if (editor) {
			clearPendingFileDecorations(editor)
		}
	}
	// Also clear decorations in markdown editor if open
	await notifyMarkdownEditorClearDecorations(absolutePath)

	// Update task state if there's an active task
	const webview = WebviewProvider.getInstance()
	const controller = webview?.controller
	if (controller?.task) {
		controller.task.taskState.didRejectTool = true
	}

	// Capture telemetry
	const apiConfig = controller?.stateManager.getApiConfiguration()
	const currentMode = controller?.stateManager.getGlobalSettingsKey("mode")
	const providerId = currentMode === "plan" ? apiConfig?.planModeApiProvider : apiConfig?.actModeApiProvider
	// Get model ID from task if available
	let modelId: string | undefined
	if (controller?.task) {
		modelId = controller.task.api.getModel().id
	}

	if (providerId && modelId && pendingInfo.taskId) {
		telemetryService.captureToolUsage(
			pendingInfo.taskId,
			pendingInfo.toolName,
			modelId,
			providerId,
			false, // wasAutoApproved
			false, // approved (rejected)
			undefined,
			false, // isNativeToolCall - we don't have this info
		)
	}
}
