import { EmptyRequest, String } from "@shared/proto/cline/common"
import { SubmissionsPaneProvider } from "@/hosts/vscode/SubmissionsPaneProvider"
import type { Controller } from "../index"

/**
 * Gets the current submissions folder from the left pane
 * @param controller The controller instance
 * @param request Empty request
 * @returns String response with the current submissions folder path
 */
export async function getCurrentSubmissionsFolder(_controller: Controller, _request: EmptyRequest): Promise<String> {
	try {
		const submissionsProvider = SubmissionsPaneProvider.getInstance()
		if (submissionsProvider) {
			const submissionsFolder = submissionsProvider.getSubmissionsFolder()
			if (submissionsFolder) {
				console.log("[DEBUG] getCurrentSubmissionsFolder: Found folder:", submissionsFolder)
				return String.create({ value: submissionsFolder })
			} else {
				console.log("[DEBUG] getCurrentSubmissionsFolder: No folder found in provider")
			}
		} else {
			console.log("[DEBUG] getCurrentSubmissionsFolder: SubmissionsPaneProvider instance not found")
		}

		return String.create({ value: "" })
	} catch (error) {
		console.error("Failed to get current submissions folder:", error)
		return String.create({ value: "" })
	}
}
