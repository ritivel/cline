/**
 * CTD Classifier Service V2 - Template-Driven Classification
 *
 * This service uses pre-generated prompts from CTD templates for classification.
 * It replaces the hardcoded prompts in CtdClassifierService.ts with template-based prompts.
 */

import { buildApiHandler } from "@core/api"
import * as fs from "fs"
import * as path from "path"
// Import pre-generated prompts from template
import {
	getReferenceSubsectionPrompt,
	getSubsectionPrompt,
	isValidSection,
	MODULE_SECTION_PROMPTS,
	MODULE_SELECTION_PROMPT,
	REFERENCE_MODULE_PROMPT,
	REFERENCE_SECTION_PROMPTS,
	TEMPLATE_NAME,
	VALID_MODULES,
} from "@/core/ctd/templates/eac-nmra/prompts"
import { StateManager } from "@/core/storage/StateManager"
import { DossierTagsService } from "./DossierTagsService"

/**
 * Metadata from info.json file
 */
interface InfoJsonMetadata {
	source_of_file: string
	dossier_summary: string
	filepath: string
	processed_at: string
}

/**
 * Classification result for placement (single best section)
 */
interface PlacementClassificationResult {
	module: string
	section: string | null
	confidence: string
	classified_at: string
}

/**
 * Classification result for references (multiple sections)
 */
interface ReferenceClassificationResult {
	modules: string[]
	sections: string[]
	confidence_map: Record<string, string>
}

/**
 * Patterns for parsing existing classification.txt files
 */
const CLASSIFICATION_PATTERNS = {
	module: /Module:\s*(\d)/i,
	placementSection: /Placement Section:\s*([^\n]+)/i,
	referenceSections: /Reference Sections:\s*\n([\s\S]*?)(?=\n\n|METADATA|$)/i,
	confidence: /Confidence:\s*(High|Medium|Low)/i,
}

/**
 * Placeholder values that indicate failed or incomplete classification
 */
const CLASSIFICATION_PLACEHOLDER_VALUES = ["Unknown - Classification failed", "Unable to classify", "Not determined", ""]

/**
 * CTD Classifier Service using template-driven prompts
 */
export class CtdClassifierServiceV2 {
	private dossierTagsService: DossierTagsService | undefined

	constructor(_workspaceRoot?: string) {
		if (workspaceRoot) {
			this.dossierTagsService = new DossierTagsService(workspaceRoot)
		}
	}

	/**
	 * Calls the LLM with a system prompt and user prompt
	 */
	private async callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
		try {
			const stateManager = StateManager.get()
			const apiConfiguration = stateManager.getApiConfiguration()
			const currentMode = "act"
			const apiHandler = buildApiHandler(apiConfiguration, currentMode)

			const messages = [{ role: "user" as const, content: userPrompt }]
			const stream = apiHandler.createMessage(systemPrompt, messages)

			let response = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					response += chunk.text
				}
			}
			return response
		} catch (error) {
			console.error("LLM call failed:", error)
			return ""
		}
	}

	/**
	 * Parses JSON from LLM response
	 */
	private parseJsonResponse<T>(response: string, defaultValue: T): T {
		try {
			const jsonMatch = response.match(/\{[\s\S]*\}/)
			if (!jsonMatch) {
				return defaultValue
			}
			return JSON.parse(jsonMatch[0])
		} catch {
			return defaultValue
		}
	}

	/**
	 * Builds a description string from document metadata
	 */
	private buildDescription(metadata: InfoJsonMetadata, filename: string): string {
		return `Filename: ${filename}
Source: ${metadata.source_of_file}
Summary: ${metadata.dossier_summary}`
	}

	// ============================================================================
	// PLACEMENT CLASSIFICATION (Single-choice)
	// ============================================================================

	/**
	 * Classifies a file into a CTD module for placement
	 */
	private async classifyModule(description: string): Promise<{ module: string; confidence: string }> {
		const userPrompt = `Classify this file into one CTD Module.
Return ONLY a JSON object exactly in this shape:
{ "module": "1" | "2" | "3" | "5", "confidence": "High" | "Medium" | "Low", "reason": "..." }

File description:
${description}`

		const response = await this.callLlm(MODULE_SELECTION_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ module?: string; confidence?: string }>(response, {})

		let module = String(result.module || "").trim()
		if (!VALID_MODULES.includes(module as (typeof VALID_MODULES)[number])) {
			module = "3" // Default to Quality module
		}

		return {
			module,
			confidence: result.confidence || "Low",
		}
	}

	/**
	 * Classifies a file into a section within a module for placement
	 */
	private async classifySection(description: string, moduleNumber: number): Promise<{ section: string; confidence: string }> {
		const sectionPrompt = MODULE_SECTION_PROMPTS[moduleNumber]
		if (!sectionPrompt) {
			return { section: `${moduleNumber}.1`, confidence: "Low" }
		}

		const userPrompt = `This file has already been classified as Module ${moduleNumber}.
Classify it into exactly one section.
Return ONLY a JSON object exactly in this shape:
{ "section": "<section ID>", "confidence": "High" | "Medium" | "Low", "reason": "..." }

File description:
${description}`

		const response = await this.callLlm(sectionPrompt, userPrompt)
		const result = this.parseJsonResponse<{ section?: string; confidence?: string }>(response, {})

		let section = String(result.section || "").trim()
		if (!isValidSection(section)) {
			// Fallback to first section in module
			section = `${moduleNumber}.1`
		}

		return {
			section,
			confidence: result.confidence || "Low",
		}
	}

	/**
	 * Recursively classifies into subsections until no more subsections exist
	 */
	private async classifySubsectionRecursively(
		description: string,
		parentSection: string,
		depth: number = 0,
	): Promise<{ section: string; confidence: string }> {
		// Safety limit on recursion depth
		if (depth > 5) {
			return { section: parentSection, confidence: "Low" }
		}

		// Check if this section has a subsection prompt
		const subsectionPrompt = getSubsectionPrompt(parentSection)
		if (!subsectionPrompt) {
			// No subsections, return current section
			return { section: parentSection, confidence: "Medium" }
		}

		const userPrompt = `This file has already been classified as Section ${parentSection}.
Classify it into exactly one subsection.
Return ONLY a JSON object exactly in this shape:
{ "subsection": "<subsection ID>", "confidence": "High" | "Medium" | "Low", "reason": "..." }

File description:
${description}`

		const response = await this.callLlm(subsectionPrompt, userPrompt)
		const result = this.parseJsonResponse<{ subsection?: string; confidence?: string }>(response, {})

		const subsection = String(result.subsection || "").trim()
		if (!isValidSection(subsection)) {
			// Invalid subsection, return parent
			return { section: parentSection, confidence: "Low" }
		}

		// Recursively check for deeper subsections
		return this.classifySubsectionRecursively(description, subsection, depth + 1)
	}

	/**
	 * Full placement classification pipeline
	 */
	async classifyForPlacement(metadata: InfoJsonMetadata, filename: string): Promise<PlacementClassificationResult> {
		const description = this.buildDescription(metadata, filename)

		// Step 1: Classify into module
		const moduleResult = await this.classifyModule(description)
		const moduleNumber = parseInt(moduleResult.module, 10)

		// Step 2: Classify into section
		const sectionResult = await this.classifySection(description, moduleNumber)

		// Step 3: Recursively classify into subsections
		const finalResult = await this.classifySubsectionRecursively(description, sectionResult.section)

		return {
			module: moduleResult.module,
			section: finalResult.section,
			confidence: finalResult.confidence,
			classified_at: new Date().toISOString(),
		}
	}

	// ============================================================================
	// REFERENCE CLASSIFICATION (Multi-choice)
	// ============================================================================

	/**
	 * Finds all modules where a file might be referenced
	 */
	private async classifyReferenceModules(description: string): Promise<Array<{ module: string; confidence: string }>> {
		const userPrompt = `Determine ALL CTD Modules where this file might be referenced or used.
Return ONLY a JSON object exactly in this shape:
{ "modules": [ { "module": "1"|"2"|"3"|"5", "confidence": "High"|"Medium"|"Low" }, ... ], "reason": "..." }

File description:
${description}`

		const response = await this.callLlm(REFERENCE_MODULE_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ modules?: Array<{ module?: string; confidence?: string }> }>(response, {
			modules: [],
		})

		const normalized: Array<{ module: string; confidence: string }> = []
		for (const item of result.modules || []) {
			const module = String(item.module || "").trim()
			if (VALID_MODULES.includes(module as (typeof VALID_MODULES)[number])) {
				normalized.push({ module, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Finds all sections in a module where a file might be referenced
	 */
	private async classifyReferenceSections(
		description: string,
		moduleNumber: number,
	): Promise<Array<{ section: string; confidence: string }>> {
		const sectionPrompt = REFERENCE_SECTION_PROMPTS[moduleNumber]
		if (!sectionPrompt) {
			return []
		}

		const userPrompt = `Find ALL sections in Module ${moduleNumber} where this file might be referenced.
Return ONLY a JSON object exactly in this shape:
{ "sections": [ { "section": "<section ID>", "confidence": "High"|"Medium"|"Low" }, ... ] }

File description:
${description}`

		const response = await this.callLlm(sectionPrompt, userPrompt)
		const result = this.parseJsonResponse<{ sections?: Array<{ section?: string; confidence?: string }> }>(response, {
			sections: [],
		})

		const normalized: Array<{ section: string; confidence: string }> = []
		for (const item of result.sections || []) {
			const section = String(item.section || "").trim()
			if (isValidSection(section)) {
				normalized.push({ section, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Recursively finds all subsections where a file might be referenced
	 */
	private async classifyReferenceSubsectionsRecursively(
		description: string,
		parentSection: string,
		depth: number = 0,
	): Promise<Array<{ section: string; confidence: string }>> {
		// Safety limit
		if (depth > 5) {
			return [{ section: parentSection, confidence: "Low" }]
		}

		const subsectionPrompt = getReferenceSubsectionPrompt(parentSection)
		if (!subsectionPrompt) {
			// No subsections, return parent
			return [{ section: parentSection, confidence: "Medium" }]
		}

		const userPrompt = `Find ALL subsections in ${parentSection} where this file might be referenced.
Return ONLY a JSON object exactly in this shape:
{ "subsections": [ { "subsection": "<subsection ID>", "confidence": "High"|"Medium"|"Low" }, ... ] }

File description:
${description}`

		const response = await this.callLlm(subsectionPrompt, userPrompt)
		const result = this.parseJsonResponse<{ subsections?: Array<{ subsection?: string; confidence?: string }> }>(response, {
			subsections: [],
		})

		const allSections: Array<{ section: string; confidence: string }> = []

		for (const item of result.subsections || []) {
			const subsection = String(item.subsection || "").trim()
			if (isValidSection(subsection)) {
				// Recursively find deeper subsections
				const deeperSections = await this.classifyReferenceSubsectionsRecursively(description, subsection, depth + 1)
				allSections.push(...deeperSections)
			}
		}

		// If no valid subsections found, return parent
		if (allSections.length === 0) {
			return [{ section: parentSection, confidence: "Low" }]
		}

		return allSections
	}

	/**
	 * Full reference classification pipeline
	 */
	async classifyForReferences(metadata: InfoJsonMetadata, filename: string): Promise<ReferenceClassificationResult> {
		const description = this.buildDescription(metadata, filename)

		// Step 1: Find all reference modules
		const moduleResults = await this.classifyReferenceModules(description)

		const allSections: string[] = []
		const confidenceMap: Record<string, string> = {}

		// Step 2: For each module, find all reference sections
		for (const moduleResult of moduleResults) {
			const moduleNumber = parseInt(moduleResult.module, 10)
			const sectionResults = await this.classifyReferenceSections(description, moduleNumber)

			// Step 3: For each section, recursively find all subsections
			for (const sectionResult of sectionResults) {
				const subsections = await this.classifyReferenceSubsectionsRecursively(description, sectionResult.section)

				for (const sub of subsections) {
					if (!allSections.includes(sub.section)) {
						allSections.push(sub.section)
						confidenceMap[sub.section] = sub.confidence
					}
				}
			}
		}

		return {
			modules: moduleResults.map((r) => r.module),
			sections: allSections,
			confidence_map: confidenceMap,
		}
	}

	// ============================================================================
	// CLASSIFICATION FILE MANAGEMENT
	// ============================================================================

	/**
	 * Parses existing classification.txt content
	 */
	private parseClassificationContent(content: string): {
		module: string | null
		placementSection: string | null
		referenceSections: string[]
		confidence: string
		isValid: boolean
	} {
		const result = {
			module: null as string | null,
			placementSection: null as string | null,
			referenceSections: [] as string[],
			confidence: "Low",
			isValid: false,
		}

		if (!content.trim()) {
			return result
		}

		// Extract module
		const moduleMatch = content.match(CLASSIFICATION_PATTERNS.module)
		if (moduleMatch && VALID_MODULES.includes(moduleMatch[1] as (typeof VALID_MODULES)[number])) {
			result.module = moduleMatch[1]
		}

		// Extract placement section
		const placementMatch = content.match(CLASSIFICATION_PATTERNS.placementSection)
		if (placementMatch) {
			const section = placementMatch[1].trim()
			if (section && !CLASSIFICATION_PLACEHOLDER_VALUES.some((p) => section.toLowerCase().includes(p.toLowerCase()))) {
				if (isValidSection(section)) {
					result.placementSection = section
				}
			}
		}

		// Extract reference sections
		const refMatch = content.match(CLASSIFICATION_PATTERNS.referenceSections)
		if (refMatch) {
			const refContent = refMatch[1]
			const sectionMatches = refContent.matchAll(/- ([0-9.A-Z]+)/gi)
			for (const match of sectionMatches) {
				if (match[1] && isValidSection(match[1])) {
					result.referenceSections.push(match[1])
				}
			}
		}

		// Extract confidence
		const confMatch = content.match(CLASSIFICATION_PATTERNS.confidence)
		if (confMatch) {
			result.confidence = confMatch[1]
		}

		// Classification is valid if we have a module AND (a placement section OR reference sections)
		result.isValid = !!(result.module && (result.placementSection || result.referenceSections.length > 0))

		return result
	}

	/**
	 * Classifies a folder and saves results to classification.txt
	 */
	async classifyFolder(folderPath: string, relativePath: string, workspaceRoot?: string): Promise<boolean> {
		const infoJsonPath = path.join(folderPath, "info.json")
		const classificationPath = path.join(folderPath, "classification.txt")

		// Check if classification.txt already exists with valid content
		try {
			const existingContent = await fs.promises.readFile(classificationPath, "utf-8")
			const parsedClassification = this.parseClassificationContent(existingContent)

			if (parsedClassification.isValid) {
				console.log(`classification.txt already exists with valid content for ${folderPath}`)

				// Update dossier tags if classification.txt exists and dossier folder exists
				if (workspaceRoot) {
					const dossierPath = path.join(workspaceRoot, "dossier")
					try {
						await fs.promises.access(dossierPath)
						// Dossier folder exists, update tags
						try {
							// Lazily create DossierTagsService if not already created
							const tagsService = this.dossierTagsService || new DossierTagsService(workspaceRoot)

							const pdfName = path.basename(folderPath) + ".pdf"
							const processedFolderRelativePath = path.join("documents", relativePath)

							const confidenceMap: Record<string, string> = {}
							for (const sec of parsedClassification.referenceSections) {
								confidenceMap[sec] = parsedClassification.confidence
							}

							const tagResult = await tagsService.updateTagsForPdf(
								pdfName,
								processedFolderRelativePath,
								parsedClassification.placementSection,
								parsedClassification.confidence,
								parsedClassification.referenceSections,
								confidenceMap,
							)

							if (tagResult.skipped) {
								console.log(`Dossier tags already exist for ${pdfName}`)
							} else {
								console.log(
									`Updated dossier tags for ${pdfName}: ${tagResult.placementsAdded} placement(s), ${tagResult.referencesAdded} reference(s)`,
								)
							}
						} catch (error) {
							console.error(`Failed to update dossier tags for ${folderPath}:`, error)
						}
					} catch {
						// Dossier folder doesn't exist yet, skip tag creation
						console.log(`Dossier folder does not exist at ${dossierPath}, skipping tag creation for ${folderPath}`)
					}
				}

				return true
			}
			console.log(`classification.txt has invalid content for ${folderPath}, re-processing`)
		} catch {
			// File doesn't exist, proceed with classification
		}

		// Read info.json
		let metadata: InfoJsonMetadata
		try {
			const content = await fs.promises.readFile(infoJsonPath, "utf-8")
			metadata = JSON.parse(content) as InfoJsonMetadata
		} catch (error) {
			console.error(`Failed to read info.json from ${folderPath}:`, error)
			return false
		}

		// Skip if metadata has placeholder values
		if (!metadata.source_of_file || !metadata.dossier_summary) {
			console.log(`Metadata incomplete in ${folderPath}, skipping classification`)
			return false
		}

		const filename = path.basename(folderPath)

		// Classify for placement (single best section)
		const placementClassification = await this.classifyForPlacement(metadata, filename)

		// Classify for references (all sections where file might be used)
		const referenceClassification = await this.classifyForReferences(metadata, filename)

		// Format classification as text
		const classificationText = `CTD Classification Results
==========================

PLACEMENT (Single Best Section)
-------------------------------
Module: ${placementClassification.module}
Placement Section: ${placementClassification.section || "Not determined"}
Confidence: ${placementClassification.confidence}

REFERENCES (All Sections Where File May Be Used)
-------------------------------------------------
Modules: ${referenceClassification.modules.join(", ") || "None"}
Reference Sections:
${referenceClassification.sections.map((sec) => `  - ${sec} (${referenceClassification.confidence_map[sec] || "Unknown"})`).join("\n") || "  None identified"}

METADATA
--------
Source File: ${relativePath}
Source of File: ${metadata.source_of_file}
Summary: ${metadata.dossier_summary}

Classified At: ${placementClassification.classified_at}
Template: ${TEMPLATE_NAME}
`

		// Write classification.txt (always create, regardless of dossier folder existence)
		try {
			await fs.promises.writeFile(classificationPath, classificationText, "utf-8")
			console.log(`Saved classification to ${classificationPath}`)
		} catch (error) {
			console.error(`Failed to write classification.txt to ${folderPath}:`, error)
			return false
		}

		// Update dossier tags.md files only if dossier folder exists
		if (workspaceRoot) {
			const dossierPath = path.join(workspaceRoot, "dossier")
			try {
				await fs.promises.access(dossierPath)
				// Dossier folder exists, update tags
				try {
					// Lazily create DossierTagsService if not already created
					const tagsService = this.dossierTagsService || new DossierTagsService(workspaceRoot)

					const pdfName = path.basename(folderPath) + ".pdf"
					const processedFolderRelativePath = path.join("documents", relativePath)

					const tagResult = await tagsService.updateTagsForPdf(
						pdfName,
						processedFolderRelativePath,
						placementClassification.section,
						placementClassification.confidence,
						referenceClassification.sections,
						referenceClassification.confidence_map,
					)

					if (tagResult.skipped) {
						console.log(`Dossier tags already exist for ${pdfName}`)
					} else {
						console.log(
							`Updated dossier tags for ${pdfName}: ${tagResult.placementsAdded} placement(s), ${tagResult.referencesAdded} reference(s)`,
						)
					}
				} catch (error) {
					console.error(`Failed to update dossier tags for ${folderPath}:`, error)
				}
			} catch {
				// Dossier folder doesn't exist yet, skip tag creation
				console.log(`Dossier folder does not exist at ${dossierPath}, skipping tag creation for ${folderPath}`)
			}
		}

		return true
	}

	/**
	 * Processes all folders in a documents directory
	 */
	async processAllFolders(documentsPath: string, workspaceRoot: string): Promise<number> {
		let processedCount = 0

		try {
			const entries = await fs.promises.readdir(documentsPath, { withFileTypes: true })

			for (const entry of entries) {
				if (entry.isDirectory()) {
					const folderPath = path.join(documentsPath, entry.name)
					const relativePath = entry.name

					const success = await this.classifyFolder(folderPath, relativePath, workspaceRoot)
					if (success) {
						processedCount++
					}
				}
			}
		} catch (error) {
			console.error(`Error processing folders in ${documentsPath}:`, error)
		}

		return processedCount
	}
}
