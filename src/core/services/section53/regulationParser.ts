/**
 * Regulation file parser for Module 5.3 sections
 * Parses .txt regulation files to extract section structure
 */

import * as fs from "fs/promises"
import * as path from "path"
import type { RegulationSection } from "./types"

/**
 * Get the path to the bundled regulation files
 */
export function getRegulationFilesPath(extensionPath: string): string {
	return path.join(extensionPath, "resources", "module5Regulation")
}

/**
 * Parse a regulation file to extract section structure
 * Returns a dictionary mapping subsection IDs to their descriptions
 */
export function parseRegulationContent(content: string): Record<string, RegulationSection> {
	const sections: Record<string, RegulationSection> = {}
	let currentSectionId: string | null = null
	let currentSectionTitle: string | null = null
	const currentDescription: string[] = []

	const lines = content.split("\n")

	// Regex to match section headers like "5.3.1.1 Bioavailability (BA) Study Reports"
	const sectionPattern = /^(\d+\.\d+\.\d+(?:\.\d+)?)\s+(.+)$/

	for (const line of lines) {
		const trimmedLine = line.trim()
		if (!trimmedLine) {
			continue
		}

		const sectionMatch = trimmedLine.match(sectionPattern)
		if (sectionMatch) {
			// Save previous section if exists
			if (currentSectionId && currentSectionTitle) {
				sections[currentSectionId] = {
					id: currentSectionId,
					title: currentSectionTitle,
					description: currentDescription.join("\n").trim(),
				}
			}

			// Start new section
			currentSectionId = sectionMatch[1]
			currentSectionTitle = sectionMatch[2]
			currentDescription.length = 0
		} else {
			// Add to current section description
			if (currentSectionId) {
				currentDescription.push(trimmedLine)
			}
		}
	}

	// Save last section
	if (currentSectionId && currentSectionTitle) {
		sections[currentSectionId] = {
			id: currentSectionId,
			title: currentSectionTitle,
			description: currentDescription.join("\n").trim(),
		}
	}

	return sections
}

/**
 * Parse a regulation file from disk
 */
export async function parseRegulationFile(filePath: string): Promise<Record<string, RegulationSection>> {
	const content = await fs.readFile(filePath, "utf-8")
	return parseRegulationContent(content)
}

/**
 * Load all 5.3.x regulation files and combine their sections
 */
export async function loadAllSection53Regulations(extensionPath: string): Promise<Record<string, RegulationSection>> {
	const regulationDir = getRegulationFilesPath(extensionPath)
	const allSections: Record<string, RegulationSection> = {}

	// Section IDs to load (5.3.1 through 5.3.7)
	const sectionFiles = ["5.3.1.txt", "5.3.2.txt", "5.3.3.txt", "5.3.4.txt", "5.3.5.txt", "5.3.6.txt", "5.3.7.txt"]

	for (const fileName of sectionFiles) {
		const filePath = path.join(regulationDir, fileName)

		try {
			const sections = await parseRegulationFile(filePath)
			Object.assign(allSections, sections)
			console.log(`[RegulationParser] Loaded ${Object.keys(sections).length} subsections from ${fileName}`)
		} catch (error) {
			console.warn(`[RegulationParser] Warning: Could not load ${fileName}: ${error}`)
		}
	}

	console.log(`[RegulationParser] Total subsections loaded: ${Object.keys(allSections).length}`)
	return allSections
}

/**
 * Extract base drug name by removing dosage, USP, and other suffixes
 * Examples:
 * - "Levofloxacin USP 250mg" -> "Levofloxacin"
 * - "Amoxicillin 500mg" -> "Amoxicillin"
 */
export function extractBaseDrugName(drugName: string): string {
	let base = drugName

	// Remove USP, BP, EP, JP, etc.
	base = base.replace(/\s+(USP|BP|EP|JP|NF)\s*/gi, " ")

	// Remove dosage/strength (e.g., "250mg", "500 mg", "10g")
	base = base.replace(/\s+\d+\s*(mg|g|mcg|µg|ml|mL)\s*/gi, " ")

	// Remove any remaining numbers at the end
	base = base.replace(/\s+\d+\s*$/g, "")

	// Clean up multiple spaces
	base = base.replace(/\s+/g, " ").trim()

	return base || drugName
}

/**
 * Sanitize a string for use in filenames
 */
export function sanitizeFilename(name: string): string {
	// Replace spaces and special characters with underscores
	let sanitized = name.replace(/[^\w\-_.]/g, "_")
	// Replace multiple underscores with single underscore
	sanitized = sanitized.replace(/_+/g, "_")
	// Trim underscores from ends
	return sanitized.replace(/^_+|_+$/g, "")
}
