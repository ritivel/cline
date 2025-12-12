import { String, StringRequest } from "@shared/proto/cline/common"
import { EAC_NMRA_TEMPLATE } from "@/core/ctd/templates/eac-nmra/definition"
import type { Controller } from "../index"

/**
 * Gets the CTD structure for a given market
 */
export async function getCtdStructure(_controller: Controller, request: StringRequest): Promise<String> {
	try {
		const { marketName } = JSON.parse(request.value || "{}")

		// For now, use EAC-NMRA template for all markets
		// In the future, this could select different templates based on marketName
		const template = EAC_NMRA_TEMPLATE

		// Convert template to a simple structure for the frontend
		const structure = {
			name: template.name,
			description: template.description,
			region: template.region,
			modules: template.modules.map((module) => ({
				moduleNumber: module.moduleNumber,
				title: module.title,
				description: module.description,
				sections: Object.entries(module.sections).map(([id, section]) => ({
					id: section.id,
					title: section.title,
					children: section.children || [],
				})),
			})),
		}

		return String.create({ value: JSON.stringify(structure) })
	} catch (error) {
		console.error("Failed to get CTD structure:", error)
		throw error
	}
}
