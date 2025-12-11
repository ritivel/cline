import { EmptyRequest, String } from "@shared/proto/cline/common"
import { ShowOpenDialogueRequest } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

/**
 * Selects a submissions folder for regulatory product setup
 * @param controller The controller instance
 * @param request Empty request
 * @returns String response with the selected folder path
 */
export async function selectSubmissionsFolder(_controller: Controller, _request: EmptyRequest): Promise<String> {
	const result = await HostProvider.get().hostBridge.windowClient.showOpenDialogue(
		ShowOpenDialogueRequest.create({
			canSelectMany: false,
			openLabel: "Select Submissions Folder",
		}),
	)

	if (result.paths && result.paths.length > 0) {
		return String.create({ value: result.paths[0] })
	}

	return String.create({ value: "" })
}
