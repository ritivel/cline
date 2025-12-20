/**
 * Guidance file parser for Section 2.5 (Clinical Overview)
 * Loads and parses 2.5.x.txt guidance files from bundled resources
 */

import * as fs from "fs/promises"
import * as path from "path"
import type { GuidanceSection, SectionInfo } from "./types"
import { SECTION_DEPENDENCIES, SECTION_TITLES } from "./types"

/**
 * Get the path to the bundled guidance files
 */
export function getGuidanceFilesPath(extensionPath: string): string {
	return path.join(extensionPath, "resources", "section25Guidance")
}

/**
 * Load guidance text for a specific section
 */
export async function loadSectionGuidance(sectionId: string, extensionPath: string): Promise<string> {
	const guidancePath = getGuidanceFilesPath(extensionPath)
	const filename = `${sectionId}.txt`
	const filepath = path.join(guidancePath, filename)

	try {
		const content = await fs.readFile(filepath, "utf-8")
		return content
	} catch (error) {
		// For nested sections, try to find guidance in parent section
		// e.g., if 2.5.6.1.txt doesn't exist, look in 2.5.6.txt
		const parts = sectionId.split(".")
		if (parts.length > 3) {
			const parentId = parts.slice(0, -1).join(".")
			const parentFilename = `${parentId}.txt`
			const parentFilepath = path.join(guidancePath, parentFilename)

			try {
				const parentContent = await fs.readFile(parentFilepath, "utf-8")
				console.log(`[GuidanceParser] Note: ${filename} not found, using guidance from ${parentFilename}`)

				// Try to extract relevant subsection from parent
				const lines = parentContent.split("\n")
				let inSubsection = false
				const subsectionLines: string[] = []

				for (const line of lines) {
					if (line.includes(sectionId) && (line.startsWith(sectionId) || line.startsWith(`${sectionId} `))) {
						inSubsection = true
						subsectionLines.push(line)
					} else if (inSubsection) {
						// Check if we've hit another section
						if (/^\d+\.\d+/.test(line.trim())) {
							break
						}
						subsectionLines.push(line)
					}
				}

				if (subsectionLines.length > 0) {
					return subsectionLines.join("\n")
				}
				return parentContent
			} catch {
				throw new Error(`Guidance file not found: ${filepath} or ${parentFilepath}`)
			}
		}

		throw new Error(`Guidance file not found: ${filepath}`)
	}
}

/**
 * Load the preamble from 2.5.txt
 */
export async function loadPreamble(extensionPath: string): Promise<string> {
	const guidancePath = getGuidanceFilesPath(extensionPath)
	const filepath = path.join(guidancePath, "2.5.txt")

	try {
		return await fs.readFile(filepath, "utf-8")
	} catch {
		throw new Error(`Preamble file not found: ${filepath}`)
	}
}

/**
 * Get information about all sections in 2.5
 */
export async function getAllSectionInfo(extensionPath: string): Promise<Record<string, SectionInfo>> {
	const guidancePath = getGuidanceFilesPath(extensionPath)
	const sectionsInfo: Record<string, SectionInfo> = {}

	// List all .txt files in the guidance directory
	try {
		const files = await fs.readdir(guidancePath)
		const txtFiles = files.filter((f) => f.endsWith(".txt")).sort()

		for (const txtFile of txtFiles) {
			const sectionId = txtFile.replace(".txt", "")
			if (sectionId === "2.5") {
				continue // Skip preamble
			}

			try {
				const filepath = path.join(guidancePath, txtFile)
				const content = await fs.readFile(filepath, "utf-8")
				const lines = content.split("\n")
				let title = SECTION_TITLES[sectionId] || ""

				if (!title && lines.length > 0) {
					// Try to extract title from first line
					const firstLine = lines[0].trim()
					if (firstLine.includes(sectionId)) {
						title = firstLine.replace(sectionId, "").trim()
					}
				}

				// Get first few lines as description
				const description = lines.slice(0, 5).join("\n").trim()

				sectionsInfo[sectionId] = { title, description }
			} catch (e) {
				console.warn(`[GuidanceParser] Warning: Could not load info for ${sectionId}: ${e}`)
			}
		}
	} catch (e) {
		console.error(`[GuidanceParser] Error reading guidance directory: ${e}`)
	}

	return sectionsInfo
}

/**
 * Get sections that are related/should be cross-referenced
 */
export function getRelatedSections(sectionId: string, allSections: Record<string, SectionInfo>): Record<string, SectionInfo> {
	const related: Record<string, SectionInfo> = {}

	// Get dependencies (sections this section depends on)
	const relatedIds = [...(SECTION_DEPENDENCIES[sectionId] || [])]

	// Also include parent sections if this is a nested section
	const parts = sectionId.split(".")
	if (parts.length > 3) {
		// e.g., 2.5.6.1 -> also reference 2.5.6
		const parentId = parts.slice(0, -1).join(".")
		if (!relatedIds.includes(parentId) && allSections[parentId]) {
			relatedIds.push(parentId)
		}
	}

	// Get information for related sections
	for (const relatedId of relatedIds) {
		if (allSections[relatedId]) {
			related[relatedId] = allSections[relatedId]
		}
	}

	return related
}

/**
 * Parse guidance content to extract section structure
 */
export function parseGuidanceContent(content: string): GuidanceSection[] {
	const sections: GuidanceSection[] = []
	let currentSectionId: string | null = null
	let currentSectionTitle: string | null = null
	const currentDescription: string[] = []

	const lines = content.split("\n")

	// Regex to match section headers like "2.5.1 Product Development Rationale"
	const sectionPattern = /^(\d+\.\d+(?:\.\d+)*)\s+(.+)$/

	for (const line of lines) {
		const trimmedLine = line.trim()
		if (!trimmedLine) {
			continue
		}

		const sectionMatch = trimmedLine.match(sectionPattern)
		if (sectionMatch) {
			// Save previous section if exists
			if (currentSectionId && currentSectionTitle) {
				sections.push({
					id: currentSectionId,
					title: currentSectionTitle,
					description: currentDescription.join("\n").trim(),
				})
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
		sections.push({
			id: currentSectionId,
			title: currentSectionTitle,
			description: currentDescription.join("\n").trim(),
		})
	}

	return sections
}

/**
 * Load all Section 2.5 guidance files
 */
export async function loadAllSection25Guidance(extensionPath: string): Promise<Record<string, GuidanceSection>> {
	const guidancePath = getGuidanceFilesPath(extensionPath)
	const allGuidance: Record<string, GuidanceSection> = {}

	// Section files to load (main sections only, subsections are extracted from parent)
	const sectionFiles = ["2.5.1.txt", "2.5.2.txt", "2.5.3.txt", "2.5.4.txt", "2.5.5.txt", "2.5.6.txt", "2.5.7.txt"]

	for (const fileName of sectionFiles) {
		const filePath = path.join(guidancePath, fileName)
		const baseSectionId = fileName.replace(".txt", "")

		try {
			const content = await fs.readFile(filePath, "utf-8")
			const sections = parseGuidanceContent(content)

			// If no subsections found, create a single section from the file
			if (sections.length === 0) {
				const lines = content.split("\n")
				const firstLine = lines[0].trim()
				let title = SECTION_TITLES[baseSectionId] || baseSectionId
				let description = content

				// Check if first line is the section header
				const headerMatch = firstLine.match(/^(\d+\.\d+(?:\.\d+)*)\s+(.+)$/)
				if (headerMatch) {
					title = headerMatch[2]
					description = lines.slice(1).join("\n").trim()
				}

				allGuidance[baseSectionId] = {
					id: baseSectionId,
					title,
					description,
				}
			} else {
				// Add all parsed sections
				for (const section of sections) {
					allGuidance[section.id] = section
				}
			}

			console.log(`[GuidanceParser] Loaded guidance from ${fileName}`)
		} catch (error) {
			console.warn(`[GuidanceParser] Warning: Could not load ${fileName}: ${error}`)
		}
	}

	console.log(`[GuidanceParser] Total guidance sections loaded: ${Object.keys(allGuidance).length}`)
	return allGuidance
}

/**
 * Topological sort of sections based on dependencies
 */
export function topologicalSortSections(sections: string[]): string[] {
	// Build dependency graph
	const graph: Record<string, Set<string>> = {}
	for (const section of sections) {
		graph[section] = new Set(SECTION_DEPENDENCIES[section] || [])
	}

	// Calculate in-degree for each section
	const inDegree: Record<string, number> = {}
	for (const section of sections) {
		inDegree[section] = 0
	}
	for (const section of sections) {
		for (const dep of graph[section]) {
			if (dep in inDegree) {
				inDegree[section]++
			}
		}
	}

	// Find sections with no dependencies
	const queue = sections.filter((s) => inDegree[s] === 0).sort()
	const result: string[] = []

	while (queue.length > 0) {
		queue.sort()
		const section = queue.shift()!
		result.push(section)

		// Reduce in-degree of sections that depend on this one
		for (const otherSection of sections) {
			if (graph[otherSection].has(section)) {
				inDegree[otherSection]--
				if (inDegree[otherSection] === 0) {
					queue.push(otherSection)
				}
			}
		}
	}

	// Check for circular dependencies
	if (result.length !== sections.length) {
		const remaining = sections.filter((s) => !result.includes(s))
		console.warn(`[GuidanceParser] Warning: Possible circular dependencies for: ${remaining.join(", ")}`)
		result.push(...remaining)
	}

	return result
}
