/**
 * CTD Prompt Generator Script
 *
 * This script generates pre-compiled prompts from CTD template definitions.
 * Run with: npx ts-node src/core/ctd/scripts/generate-prompts.ts
 *
 * The generated prompts are static strings that are used at runtime,
 * ensuring no prompt generation overhead during classification.
 */

import * as fs from "fs"
import * as path from "path"
import { buildSectionParentMap, CTDModuleDef, CTDTemplate, getTopLevelSections } from "../types"

/**
 * Generates the module selection prompt
 */
function generateModuleSelectionPrompt(template: CTDTemplate): string {
	const moduleDescriptions = template.modules
		.map((m) => {
			const keywords = Object.values(m.sections)
				.flatMap((s) => s.classification?.keywords || [])
				.slice(0, 10)
				.join(", ")
			return `Module ${m.moduleNumber}: ${m.title}\n  ${m.description}\n  Keywords: ${keywords}`
		})
		.join("\n\n")

	return `You are a Regulatory Affairs classifier for ${template.region} generic drug submissions (ANDA / EU Generic MAA).

Given a file description, determine the most appropriate CTD Module for PLACEMENT (where the file should be stored).

Available Modules:
${moduleDescriptions}

IMPORTANT:
- Choose the SINGLE BEST module where this file should be PLACED/STORED.
- Consider the primary purpose of the document.
- Only one module allowed.

Respond with valid JSON:
{
  "module": "1" | "2" | "3" | "5",
  "confidence": "High" | "Medium" | "Low",
  "reason": "<1-2 line justification>"
}`
}

/**
 * Generates the section selection prompt for a module
 */
function generateModuleSectionPrompt(module: CTDModuleDef, template: CTDTemplate): string {
	const topLevelSections = getTopLevelSections(module)
	const sectionDescriptions = topLevelSections
		.map((id) => {
			const section = module.sections[id]
			const keywords = section.classification?.keywords?.join(", ") || ""
			const docTypes = section.classification?.documentTypes?.join(", ") || ""
			return `${id}: ${section.title}${keywords ? `\n  Keywords: ${keywords}` : ""}${docTypes ? `\n  Document types: ${docTypes}` : ""}`
		})
		.join("\n\n")

	return `You are a Regulatory Affairs classifier for ${template.region} generic drug submissions.
You are classifying into CTD Module ${module.moduleNumber} (${module.title}).

${module.description}

Available sections:
${sectionDescriptions}

Based on the file description, select the SINGLE BEST section for PLACEMENT.
- Only one section allowed.

Respond with valid JSON:
{
  "section": "<section ID like ${topLevelSections[0]}>",
  "confidence": "High" | "Medium" | "Low",
  "reason": "<1-2 line justification>"
}`
}

/**
 * Generates subsection prompts for sections that have children
 */
function generateSubsectionPrompts(module: CTDModuleDef, template: CTDTemplate): Record<string, string> {
	const prompts: Record<string, string> = {}

	for (const [sectionId, section] of Object.entries(module.sections)) {
		if (!section.children || section.children.length === 0) continue

		const childDescriptions = section.children
			.map((childId) => {
				const child = module.sections[childId]
				if (!child) return null
				const keywords = child.classification?.keywords?.join(", ") || ""
				const docTypes = child.classification?.documentTypes?.join(", ") || ""
				return `${childId}: ${child.title}${keywords ? `\n  Keywords: ${keywords}` : ""}${docTypes ? `\n  Document types: ${docTypes}` : ""}`
			})
			.filter(Boolean)
			.join("\n\n")

		if (!childDescriptions) continue

		prompts[sectionId] = `You are a Regulatory Affairs classifier for ${template.region} generic drug submissions.
You are classifying into CTD Section ${sectionId} (${section.title}).

Available subsections:
${childDescriptions}

Based on the file description, select the SINGLE BEST subsection for PLACEMENT.
- Only one subsection allowed.

Respond with valid JSON:
{
  "subsection": "<subsection ID>",
  "confidence": "High" | "Medium" | "Low",
  "reason": "<1-2 line justification>"
}`
	}

	return prompts
}

/**
 * Generates reference classification prompts (multi-choice)
 */
function generateReferenceModulePrompt(template: CTDTemplate): string {
	const moduleDescriptions = template.modules.map((m) => `Module ${m.moduleNumber}: ${m.title} - ${m.description}`).join("\n")

	return `You are a Regulatory Affairs classifier for ${template.region} generic drug submissions.

Given a file description, determine ALL CTD Modules where this file might be REFERENCED or USED.
A file can be referenced in multiple modules even if it's only placed/stored in one.

Available Modules:
${moduleDescriptions}

IMPORTANT:
- Select ALL modules where this file might be referenced (can be multiple).
- Consider cross-references between quality, clinical, and administrative sections.
- Include the module where the file is placed PLUS any modules that might reference it.

Respond with valid JSON:
{
  "modules": [
    { "module": "1" | "2" | "3" | "5", "confidence": "High" | "Medium" | "Low" },
    ...
  ],
  "reason": "<brief explanation>"
}`
}

/**
 * Generates reference section prompts (multi-choice)
 */
function generateReferenceSectionPrompt(module: CTDModuleDef, template: CTDTemplate): string {
	const topLevelSections = getTopLevelSections(module)
	const sectionDescriptions = topLevelSections
		.map((id) => {
			const section = module.sections[id]
			return `${id}: ${section.title}`
		})
		.join("\n")

	return `You are a Regulatory Affairs classifier for ${template.region} generic drug submissions.
You are finding ALL sections in Module ${module.moduleNumber} (${module.title}) where a file might be REFERENCED.

Available sections:
${sectionDescriptions}

IMPORTANT:
- Select ALL sections where this file might be referenced (can be multiple).
- Consider where this file's information would be useful or cited.

Respond with valid JSON:
{
  "sections": [
    { "section": "<section ID>", "confidence": "High" | "Medium" | "Low" },
    ...
  ]
}`
}

/**
 * Generates reference subsection prompts (multi-choice)
 */
function generateReferenceSubsectionPrompts(module: CTDModuleDef, template: CTDTemplate): Record<string, string> {
	const prompts: Record<string, string> = {}

	for (const [sectionId, section] of Object.entries(module.sections)) {
		if (!section.children || section.children.length === 0) continue

		const childDescriptions = section.children
			.map((childId) => {
				const child = module.sections[childId]
				if (!child) return null
				return `${childId}: ${child.title}`
			})
			.filter(Boolean)
			.join("\n")

		if (!childDescriptions) continue

		prompts[sectionId] = `You are a Regulatory Affairs classifier for ${template.region} generic drug submissions.
You are finding ALL subsections in ${sectionId} (${section.title}) where a file might be REFERENCED.

Available subsections:
${childDescriptions}

IMPORTANT:
- Select ALL subsections where this file might be referenced (can be multiple).

Respond with valid JSON:
{
  "subsections": [
    { "subsection": "<subsection ID>", "confidence": "High" | "Medium" | "Low" },
    ...
  ]
}`
	}

	return prompts
}

/**
 * Escapes a string for use in a TypeScript template literal
 */
function escapeForTemplateLiteral(str: string): string {
	return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$")
}

/**
 * Generates the prompts.ts file content
 */
function generatePromptsFile(template: CTDTemplate): string {
	const parentMap = buildSectionParentMap(template)

	// Generate all prompts
	const moduleSelectionPrompt = generateModuleSelectionPrompt(template)
	const referenceModulePrompt = generateReferenceModulePrompt(template)

	const moduleSectionPrompts: Record<number, string> = {}
	const referenceSectionPrompts: Record<number, string> = {}
	const allSubsectionPrompts: Record<string, string> = {}
	const allReferenceSubsectionPrompts: Record<string, string> = {}

	for (const module of template.modules) {
		moduleSectionPrompts[module.moduleNumber] = generateModuleSectionPrompt(module, template)
		referenceSectionPrompts[module.moduleNumber] = generateReferenceSectionPrompt(module, template)

		const subsectionPrompts = generateSubsectionPrompts(module, template)
		Object.assign(allSubsectionPrompts, subsectionPrompts)

		const refSubsectionPrompts = generateReferenceSubsectionPrompts(module, template)
		Object.assign(allReferenceSubsectionPrompts, refSubsectionPrompts)
	}

	// Build the output file
	const output = `/**
 * Pre-generated CTD Classification Prompts for ${template.name}
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated from: ${template.name}/definition.ts
 * Run \`npm run generate-ctd-prompts\` to regenerate.
 *
 * Generated at: ${new Date().toISOString()}
 */

import { CTDSectionParentMap } from "../../types"

/**
 * Template metadata
 */
export const TEMPLATE_NAME = "${template.name}"
export const TEMPLATE_REGION = "${template.region}"
export const TEMPLATE_DESCRIPTION = "${template.description}"

/**
 * Valid module numbers for this template
 */
export const VALID_MODULES = [${template.modules.map((m) => `"${m.moduleNumber}"`).join(", ")}] as const

/**
 * Parent-child mapping for sections
 * Used by DossierTagsService to build correct folder paths
 */
export const SECTION_PARENT_MAP: CTDSectionParentMap = ${JSON.stringify(parentMap, null, "\t")}

// ============================================================================
// PLACEMENT CLASSIFICATION PROMPTS (Single-choice)
// ============================================================================

/**
 * Prompt for selecting the module for placement
 */
export const MODULE_SELECTION_PROMPT = \`${escapeForTemplateLiteral(moduleSelectionPrompt)}\`

/**
 * Prompts for selecting sections within each module (for placement)
 */
export const MODULE_SECTION_PROMPTS: Record<number, string> = {
${Object.entries(moduleSectionPrompts)
	.map(([moduleNum, prompt]) => `\t${moduleNum}: \`${escapeForTemplateLiteral(prompt)}\``)
	.join(",\n")}
}

/**
 * Prompts for selecting subsections (for placement)
 * Keyed by parent section ID
 */
export const SUBSECTION_PROMPTS: Record<string, string> = {
${Object.entries(allSubsectionPrompts)
	.map(([sectionId, prompt]) => `\t"${sectionId}": \`${escapeForTemplateLiteral(prompt)}\``)
	.join(",\n")}
}

// ============================================================================
// REFERENCE CLASSIFICATION PROMPTS (Multi-choice)
// ============================================================================

/**
 * Prompt for selecting modules for references
 */
export const REFERENCE_MODULE_PROMPT = \`${escapeForTemplateLiteral(referenceModulePrompt)}\`

/**
 * Prompts for selecting sections within each module (for references)
 */
export const REFERENCE_SECTION_PROMPTS: Record<number, string> = {
${Object.entries(referenceSectionPrompts)
	.map(([moduleNum, prompt]) => `\t${moduleNum}: \`${escapeForTemplateLiteral(prompt)}\``)
	.join(",\n")}
}

/**
 * Prompts for selecting subsections (for references)
 * Keyed by parent section ID
 */
export const REFERENCE_SUBSECTION_PROMPTS: Record<string, string> = {
${Object.entries(allReferenceSubsectionPrompts)
	.map(([sectionId, prompt]) => `\t"${sectionId}": \`${escapeForTemplateLiteral(prompt)}\``)
	.join(",\n")}
}

// ============================================================================
// HELPER: Get all valid section IDs
// ============================================================================

/**
 * All valid section IDs in this template
 */
export const ALL_SECTION_IDS = ${JSON.stringify(Object.keys(parentMap), null, "\t")} as const

/**
 * Checks if a section ID is valid for this template
 */
export function isValidSection(sectionId: string): boolean {
\treturn sectionId in SECTION_PARENT_MAP
}

/**
 * Gets the subsection prompt for a given parent section
 * Returns undefined if no subsections exist
 */
export function getSubsectionPrompt(parentSectionId: string): string | undefined {
\treturn SUBSECTION_PROMPTS[parentSectionId]
}

/**
 * Gets the reference subsection prompt for a given parent section
 * Returns undefined if no subsections exist
 */
export function getReferenceSubsectionPrompt(parentSectionId: string): string | undefined {
\treturn REFERENCE_SUBSECTION_PROMPTS[parentSectionId]
}
`

	return output
}

/**
 * Main function to generate prompts for a template
 */
async function main() {
	const args = process.argv.slice(2)
	const templateName = args[0] || "eac-nmra"

	console.log(`Generating prompts for template: ${templateName}`)

	// Dynamically import the template definition
	const templatePath = path.join(__dirname, "..", "templates", templateName, "definition.ts")

	if (!fs.existsSync(templatePath)) {
		console.error(`Template not found: ${templatePath}`)
		process.exit(1)
	}

	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const templateModule = require(templatePath)
	const template: CTDTemplate =
		templateModule.default || templateModule[`${templateName.toUpperCase().replace(/-/g, "_")}_TEMPLATE`]

	if (!template) {
		console.error(`Could not find template export in ${templatePath}`)
		process.exit(1)
	}

	// Generate the prompts file
	const promptsContent = generatePromptsFile(template)

	// Write to prompts.ts in the template directory
	const outputPath = path.join(__dirname, "..", "templates", templateName, "prompts.ts")
	fs.writeFileSync(outputPath, promptsContent, "utf-8")

	console.log(`Generated prompts file: ${outputPath}`)
	console.log(`Template: ${template.name}`)
	console.log(`Region: ${template.region}`)
	console.log(`Modules: ${template.modules.map((m) => m.moduleNumber).join(", ")}`)
	console.log(`Total sections: ${Object.keys(buildSectionParentMap(template)).length}`)
}

// Run if executed directly
main().catch(console.error)
