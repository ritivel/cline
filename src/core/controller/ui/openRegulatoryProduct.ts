import { Empty, StringRequest } from "@shared/proto/cline/common"
import { OpenWorkspaceFolderRequest } from "@shared/proto/host/workspace"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { HostProvider } from "@/hosts/host-provider"
import { SubmissionsPaneProvider } from "@/hosts/vscode/SubmissionsPaneProvider"
import type { Controller } from "../index"

/**
 * Opens an existing regulatory product
 * @param controller The controller instance
 * @param request String request containing JSON-encoded product configuration
 * @returns Empty response
 */
export async function openRegulatoryProduct(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const config: RegulatoryProductConfig = JSON.parse(request.value || "{}")

		// Validate required fields
		if (!config.workspacePath || !config.submissionsPath || !config.drugName || !config.marketName) {
			throw new Error("Missing required fields in product configuration")
		}

		// Get current workspace paths to check if we need to open a new workspace
		const currentWorkspacePaths = await HostProvider.get().hostBridge.workspaceClient.getWorkspacePaths({})
		const currentWorkspacePath = currentWorkspacePaths.paths?.[0]

		// If the workspace path is different, open it as a workspace
		if (!currentWorkspacePath || currentWorkspacePath !== config.workspacePath) {
			await HostProvider.get().hostBridge.workspaceClient.openWorkspaceFolder(
				OpenWorkspaceFolderRequest.create({ path: config.workspacePath }),
			)
		}

		// Set the submissions folder in the submissions pane
		const submissionsProvider = SubmissionsPaneProvider.getInstance()
		if (submissionsProvider) {
			await submissionsProvider.setSubmissionsFolder(config.submissionsPath)
		}

		// Set as current active product
		controller.stateManager.setGlobalState("currentRegulatoryProduct", config)

		// Set context to show navbar icons
		HostProvider.get().setContext("cline.hasActiveProduct", true)

		// Clear the regulatory onboarding flag in global state
		controller.stateManager.setGlobalState("showRegulatoryOnboarding", false)

		// Set flag to show CTD checklist (will be auto-cleared after showing once)
		controller.stateManager.setGlobalState("showCtdChecklist", true)

		await controller.postStateToWebview()

		// Clear the flag immediately after posting state to prevent it from persisting
		controller.stateManager.setGlobalState("showCtdChecklist", false)

		return Empty.create({})
	} catch (error) {
		console.error("Failed to open regulatory product:", error)
		throw error
	}
}
