import * as path from "path"
import { EAC_NMRA_TEMPLATE } from "@/core/ctd/templates/eac-nmra/definition"
import { SECTION_PARENT_MAP } from "@/core/ctd/templates/eac-nmra/prompts"
import type { CTDModuleDef, CTDSectionDef } from "@/core/ctd/types"

/**
 * Utility functions for dossier generation
 * Extracted from DossierGeneratorService for reuse
 */

/**
 * Converts a CTD section number to a dossier folder path
 */
export function sectionToFolderPath(section: string, dossierPath: string): string | null {
	const moduleNum = section.charAt(0)

	if (!(section in SECTION_PARENT_MAP)) {
		console.warn(`Unknown CTD section: ${section}, cannot determine folder path`)
		return null
	}

	const ancestors: string[] = []
	let current: string | null = section

	while (current !== null) {
		ancestors.unshift(current)
		current = SECTION_PARENT_MAP[current] ?? null
	}

	const sectionFolders = ancestors.map((s) => `section-${s}`)
	return path.join(dossierPath, `module-${moduleNum}`, ...sectionFolders)
}

/**
 * Gets all leaf sections (sections without children) from a module
 */
export function getLeafSections(module: CTDModuleDef): string[] {
	return Object.entries(module.sections)
		.filter(([_, section]) => !section.children || section.children.length === 0)
		.map(([id]) => id)
}

/**
 * Gets modules in regulatory submission order
 */
export function getModulesInOrder(): CTDModuleDef[] {
	// Order: Module 3 (Quality) → Module 5 (Clinical) → Module 2 (Summaries) → Module 1 (Administrative)
	const moduleOrder = [3, 5, 2, 1]
	const modules: CTDModuleDef[] = []

	for (const moduleNum of moduleOrder) {
		const module = EAC_NMRA_TEMPLATE.modules.find((m) => m.moduleNumber === moduleNum)
		if (module) {
			modules.push(module)
		}
	}

	return modules
}

/**
 * Gets all leaf sections across all modules in regulatory order
 */
export function getAllLeafSectionsInOrder(): Array<{
	sectionId: string
	section: CTDSectionDef
	moduleNum: number
	moduleTitle: string
}> {
	const modules = getModulesInOrder()
	const allSections: Array<{ sectionId: string; section: CTDSectionDef; moduleNum: number; moduleTitle: string }> = []

	for (const module of modules) {
		const leafSections = getLeafSections(module)
		for (const sectionId of leafSections) {
			const section = module.sections[sectionId]
			if (section) {
				allSections.push({
					sectionId,
					section,
					moduleNum: module.moduleNumber,
					moduleTitle: module.title,
				})
			}
		}
	}

	return allSections
}
