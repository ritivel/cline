/**
 * CTD Template Type Definitions
 *
 * This module defines the types for CTD (Common Technical Document) templates.
 * Templates are the single source of truth for both:
 * - Dossier folder structure creation
 * - Document classification prompts
 */

/**
 * Classification hints for a CTD section
 * Used by the prompt generator to create better classification prompts
 */
export interface CTDClassificationHints {
	/** Keywords that help identify documents belonging to this section */
	keywords: string[]
	/** Common document types found in this section */
	documentTypes: string[]
	/** Section IDs this should NOT be confused with */
	excludeFrom?: string[]
	/** Additional context for the LLM classifier */
	description?: string
}

/**
 * Definition of a single CTD section
 */
export interface CTDSectionDef {
	/** Section ID (e.g., "3.2.P.5") */
	id: string
	/** Section title (e.g., "Control of FPP") */
	title: string
	/** Child section IDs (defines hierarchy) */
	children?: string[]
	/** Classification hints for prompt generation */
	classification?: CTDClassificationHints
}

/**
 * Definition of a CTD module (1-5)
 */
export interface CTDModuleDef {
	/** Module number (1, 2, 3, or 5 typically) */
	moduleNumber: number
	/** Module title */
	title: string
	/** Module description for classification context */
	description: string
	/** All sections in this module, keyed by section ID */
	sections: Record<string, CTDSectionDef>
}

/**
 * Complete CTD template definition
 */
export interface CTDTemplate {
	/** Template identifier (e.g., "eac-nmra") */
	name: string
	/** Human-readable description */
	description: string
	/** Regulatory region (e.g., "EAC", "FDA", "EMA") */
	region: string
	/** All modules in this template */
	modules: CTDModuleDef[]
}

/**
 * Pre-generated prompts for a CTD template
 * These are generated at build time from the template definition
 */
export interface CTDPrompts {
	/** Template name these prompts are for */
	templateName: string
	/** Prompt for selecting the module */
	moduleSelectionPrompt: string
	/** Prompts for selecting sections within each module */
	moduleSectionPrompts: Record<number, string>
	/** Prompts for selecting subsections (keyed by parent section ID) */
	subsectionPrompts: Record<string, string>
	/** Reference classification prompts (multi-choice) */
	referencePrompts: {
		moduleSelectionPrompt: string
		moduleSectionPrompts: Record<number, string>
		subsectionPrompts: Record<string, string>
	}
}

/**
 * Parent-child mapping for a template
 * Generated from the template definition, used for path building
 */
export interface CTDSectionParentMap {
	/** Maps section ID to parent section ID (null = top-level in module) */
	[sectionId: string]: string | null
}

/**
 * Gets all section IDs from a template
 */
export function getAllSectionIds(template: CTDTemplate): string[] {
	return template.modules.flatMap((m) => Object.keys(m.sections))
}

/**
 * Builds the parent map from a template
 * This replaces the hardcoded CTD_SECTION_PARENTS in DossierTagsService
 */
export function buildSectionParentMap(template: CTDTemplate): CTDSectionParentMap {
	const parentMap: CTDSectionParentMap = {}

	for (const module of template.modules) {
		for (const [sectionId, section] of Object.entries(module.sections)) {
			// Check if this section is a child of another section
			let parent: string | null = null

			for (const [potentialParentId, potentialParent] of Object.entries(module.sections)) {
				if (potentialParent.children?.includes(sectionId)) {
					parent = potentialParentId
					break
				}
			}

			parentMap[sectionId] = parent
		}
	}

	return parentMap
}

/**
 * Gets the top-level sections for a module (sections without parents)
 */
export function getTopLevelSections(module: CTDModuleDef): string[] {
	const childSections = new Set<string>()

	// Collect all child section IDs
	for (const section of Object.values(module.sections)) {
		if (section.children) {
			for (const childId of section.children) {
				childSections.add(childId)
			}
		}
	}

	// Return sections that are not children of any other section
	return Object.keys(module.sections).filter((id) => !childSections.has(id))
}

/**
 * Gets the children of a section
 */
export function getSectionChildren(template: CTDTemplate, sectionId: string): string[] {
	for (const module of template.modules) {
		const section = module.sections[sectionId]
		if (section?.children) {
			return section.children
		}
	}
	return []
}

/**
 * Gets a section definition by ID
 */
export function getSection(template: CTDTemplate, sectionId: string): CTDSectionDef | undefined {
	for (const module of template.modules) {
		if (module.sections[sectionId]) {
			return module.sections[sectionId]
		}
	}
	return undefined
}

/**
 * Gets the module number for a section
 */
export function getModuleForSection(template: CTDTemplate, sectionId: string): number | undefined {
	for (const module of template.modules) {
		if (module.sections[sectionId]) {
			return module.moduleNumber
		}
	}
	return undefined
}
