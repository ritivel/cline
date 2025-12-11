import { EmptyRequest, String } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

/**
 * Gets the current workspace folder from the left pane
 * @param controller The controller instance
 * @param request Empty request
 * @returns String response with the current workspace folder path
 */
export async function getCurrentWorkspaceFolder(_controller: Controller, _request: EmptyRequest): Promise<String> {
	try {
		const workspacePaths = await HostProvider.get().hostBridge.workspaceClient.getWorkspacePaths({})
		if (workspacePaths.paths && workspacePaths.paths.length > 0) {
			console.log("[DEBUG] getCurrentWorkspaceFolder: Found folder:", workspacePaths.paths[0])
			// Return the first workspace folder
			return String.create({ value: workspacePaths.paths[0] })
		} else {
			console.log("[DEBUG] getCurrentWorkspaceFolder: No workspace folders found")
		}
		return String.create({ value: "" })
	} catch (error) {
		console.error("[DEBUG] Failed to get current workspace folder:", error)
		return String.create({ value: "" })
	}
}
