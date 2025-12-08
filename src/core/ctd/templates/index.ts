/**
 * CTD Template Registry
 *
 * Central registry for all CTD templates.
 * Add new templates here to make them available for dossier creation and classification.
 */

import { CTDTemplate } from "../types"
import { EAC_NMRA_TEMPLATE } from "./eac-nmra/definition"

/**
 * Registry of all available CTD templates
 */
export const CTD_TEMPLATES: Record<string, CTDTemplate> = {
	"eac-nmra": EAC_NMRA_TEMPLATE,
	// Add more templates here:
	// "fda-anda": FDA_ANDA_TEMPLATE,
	// "ema-generic": EMA_GENERIC_TEMPLATE,
}

/**
 * Default template name
 */
export const DEFAULT_TEMPLATE_NAME = "eac-nmra"

/**
 * Gets a CTD template by name
 * @param templateName Template identifier (e.g., "eac-nmra")
 * @returns The template or undefined if not found
 */
export function getTemplate(templateName: string): CTDTemplate | undefined {
	return CTD_TEMPLATES[templateName]
}

/**
 * Gets a CTD template by name, falling back to default if not found
 * @param templateName Template identifier (e.g., "eac-nmra")
 * @returns The template (guaranteed to exist)
 */
export function getTemplateOrDefault(templateName?: string): CTDTemplate {
	if (templateName && CTD_TEMPLATES[templateName]) {
		return CTD_TEMPLATES[templateName]
	}
	return CTD_TEMPLATES[DEFAULT_TEMPLATE_NAME]
}

/**
 * Lists all available template names
 */
export function listTemplates(): string[] {
	return Object.keys(CTD_TEMPLATES)
}

/**
 * Checks if a template exists
 */
export function templateExists(templateName: string): boolean {
	return templateName in CTD_TEMPLATES
}

// Re-export types for convenience
export * from "../types"
export { EAC_NMRA_TEMPLATE }
