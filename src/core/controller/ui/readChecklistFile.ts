import { String, StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import * as path from "path"
import { SECTION_PARENT_MAP } from "@/core/ctd/templates/eac-nmra/prompts"
import { ChecklistService } from "@/core/task/services/ChecklistService"
import type { Controller } from "../index"

/**
 * Reads checklist.md file content for a section
 */
export async function readChecklistFile(controller: Controller, request: StringRequest): Promise<String> {
	try {
		const { sectionId, product } = JSON.parse(request.value || "{}") as {
			sectionId: string
			product?: RegulatoryProductConfig
		}

		if (!sectionId) {
			throw new Error("Section ID is required")
		}

		// Get submissions path from product or state
		let submissionsPath: string | undefined
		if (product?.submissionsPath) {
			submissionsPath = product.submissionsPath
		} else {
			// Try to get from state
			const currentProduct = controller.stateManager.getGlobalStateKey("currentRegulatoryProduct") as
				| RegulatoryProductConfig
				| undefined
			if (currentProduct?.submissionsPath) {
				submissionsPath = currentProduct.submissionsPath
			}
		}

		if (!submissionsPath) {
			throw new Error("Submissions path not found. Please ensure a regulatory product is selected.")
		}

		// Construct checklist path using same logic as InputChecklistUpdation
		const moduleNum = sectionId.charAt(0)
		const dossierPath = path.join(submissionsPath, "dossier")

		if (!(sectionId in SECTION_PARENT_MAP)) {
			throw new Error(`Cannot determine folder path for section ${sectionId}`)
		}

		const ancestors: string[] = []
		let current: string | null = sectionId

		while (current !== null) {
			ancestors.unshift(current)
			current = SECTION_PARENT_MAP[current] ?? null
		}

		const sectionFolders = ancestors.map((s) => `section-${s}`)
		const sectionFolderPath = path.join(dossierPath, `module-${moduleNum}`, ...sectionFolders)
		const checklistPath = path.join(sectionFolderPath, "checklist.md")

		// Parse checklist file
		const parsedChecklist = await ChecklistService.parseChecklistMd(checklistPath)

		// Return parsed checklist as JSON
		return String.create({ value: JSON.stringify(parsedChecklist) })
	} catch (error) {
		console.error("Failed to read checklist file:", error)
		throw error
	}
}
