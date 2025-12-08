import * as fs from "fs"
import * as path from "path"

// Import section parent map from template (single source of truth)
import { SECTION_PARENT_MAP } from "@/core/ctd/templates/eac-nmra/prompts"

interface PdfTagEntry {
	pdfName: string
	processedFolderPath: string // Relative path to the processed folder in documents/
	confidence: string
	type: "placement" | "reference"
}

interface SectionTags {
	placements: PdfTagEntry[]
	references: PdfTagEntry[]
}

/**
 * Alias for backward compatibility
 * The parent map is now imported from the template
 */
const CTD_SECTION_PARENTS = SECTION_PARENT_MAP

/**
 * Service for managing tags.md files in dossier section folders
 * Creates/updates markdown files that list PDFs placed or referenced in each CTD section
 */
export class DossierTagsService {
	private workspaceRoot: string
	private dossierPath: string
	private documentsPath: string

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
		this.dossierPath = path.join(workspaceRoot, "dossier")
		this.documentsPath = path.join(workspaceRoot, "documents")
	}

	/**
	 * Converts a CTD section number (e.g., "3.2.P.5") to a dossier folder path
	 * Uses the CTD_SECTION_PARENTS map to correctly build the hierarchical path
	 * e.g., "3.2.P.5" -> "dossier/module-3/section-3.2/section-3.2.P/section-3.2.P.5"
	 */
	private sectionToFolderPath(section: string): string | null {
		// Extract module number from section (first character)
		const moduleNum = section.charAt(0)

		// Check if section is in our parent map
		if (!(section in CTD_SECTION_PARENTS)) {
			console.warn(`Unknown CTD section: ${section}, cannot determine folder path`)
			return null
		}

		// Build the ancestor chain from the section up to its top-level parent
		const ancestors: string[] = []
		let current: string | null = section

		while (current !== null) {
			ancestors.unshift(current) // Add to front to maintain order from root to leaf
			current = CTD_SECTION_PARENTS[current] ?? null
		}

		// Convert ancestors to folder names
		const sectionFolders = ancestors.map((s) => `section-${s}`)

		return path.join(this.dossierPath, `module-${moduleNum}`, ...sectionFolders)
	}

	/**
	 * Checks if a dossier section folder exists
	 */
	private async sectionFolderExists(section: string): Promise<boolean> {
		const folderPath = this.sectionToFolderPath(section)
		if (!folderPath) return false

		try {
			const stat = await fs.promises.stat(folderPath)
			return stat.isDirectory()
		} catch {
			return false
		}
	}

	/**
	 * Reads existing tags from a tags.md file
	 */
	private async readExistingTags(tagsPath: string): Promise<SectionTags> {
		const result: SectionTags = { placements: [], references: [] }

		try {
			const content = await fs.promises.readFile(tagsPath, "utf-8")

			// Parse placements section
			const placementsMatch = content.match(/## Placements\s*\n([\s\S]*?)(?=## References|$)/i)
			if (placementsMatch) {
				const placementLines = placementsMatch[1].match(/- \[([^\]]+)\]\(([^)]+)\)(?: \(([^)]+)\))?/g) || []
				for (const line of placementLines) {
					const match = line.match(/- \[([^\]]+)\]\(([^)]+)\)(?: \(([^)]+)\))?/)
					if (match) {
						result.placements.push({
							pdfName: match[1],
							processedFolderPath: match[2],
							confidence: match[3] || "Unknown",
							type: "placement",
						})
					}
				}
			}

			// Parse references section
			const referencesMatch = content.match(/## References\s*\n([\s\S]*?)$/i)
			if (referencesMatch) {
				const referenceLines = referencesMatch[1].match(/- \[([^\]]+)\]\(([^)]+)\)(?: \(([^)]+)\))?/g) || []
				for (const line of referenceLines) {
					const match = line.match(/- \[([^\]]+)\]\(([^)]+)\)(?: \(([^)]+)\))?/)
					if (match) {
						result.references.push({
							pdfName: match[1],
							processedFolderPath: match[2],
							confidence: match[3] || "Unknown",
							type: "reference",
						})
					}
				}
			}
		} catch {
			// File doesn't exist or can't be parsed
		}

		return result
	}

	/**
	 * Writes tags to a tags.md file
	 */
	private async writeTagsFile(tagsPath: string, sectionName: string, tags: SectionTags): Promise<void> {
		// Sort entries by PDF name for consistent output
		tags.placements.sort((a, b) => a.pdfName.localeCompare(b.pdfName))
		tags.references.sort((a, b) => a.pdfName.localeCompare(b.pdfName))

		// Build markdown content
		let content = `# Section ${sectionName} - Document Tags\n\n`
		content += `> This file lists all documents that should be placed in or referenced from this CTD section.\n\n`

		// Placements section
		content += `## Placements\n\n`
		content += `Documents that should be **stored** in this section:\n\n`
		if (tags.placements.length === 0) {
			content += `_No documents placed in this section yet._\n\n`
		} else {
			for (const entry of tags.placements) {
				content += `- [${entry.pdfName}](${entry.processedFolderPath}) (${entry.confidence})\n`
			}
			content += `\n`
		}

		// References section
		content += `## References\n\n`
		content += `Documents that are **referenced/used** in this section:\n\n`
		if (tags.references.length === 0) {
			content += `_No documents referenced in this section yet._\n\n`
		} else {
			for (const entry of tags.references) {
				content += `- [${entry.pdfName}](${entry.processedFolderPath}) (${entry.confidence})\n`
			}
			content += `\n`
		}

		// Write the file
		await fs.promises.writeFile(tagsPath, content, "utf-8")
	}

	/**
	 * Checks if a PDF is already in a section's tags.md file
	 */
	async isPdfAlreadyTagged(
		section: string,
		pdfName: string,
		processedFolderRelativePath: string,
		type: "placement" | "reference",
	): Promise<boolean> {
		const sectionFolderPath = this.sectionToFolderPath(section)
		if (!sectionFolderPath) return false

		const tagsPath = path.join(sectionFolderPath, "tags.md")

		const existingTags = await this.readExistingTags(tagsPath)
		const relativePathToProcessed = path.relative(
			sectionFolderPath,
			path.join(this.workspaceRoot, processedFolderRelativePath),
		)

		const targetList = type === "placement" ? existingTags.placements : existingTags.references
		return targetList.some((e) => e.pdfName === pdfName && e.processedFolderPath === relativePathToProcessed)
	}

	/**
	 * Adds a PDF to a section's tags.md file
	 * Returns true if the entry was added, false if it already existed or section doesn't exist
	 */
	async addPdfToSection(
		section: string,
		pdfName: string,
		processedFolderRelativePath: string, // Relative to workspace root, e.g., "documents/stability_report"
		confidence: string,
		type: "placement" | "reference",
	): Promise<boolean> {
		const sectionFolderPath = this.sectionToFolderPath(section)
		if (!sectionFolderPath) {
			console.log(`Unknown section ${section}, cannot add tag for ${pdfName}`)
			return false
		}

		// Check if the dossier section folder exists (don't create non-existent folders)
		const folderExists = await this.sectionFolderExists(section)
		if (!folderExists) {
			console.log(
				`Dossier folder does not exist for section ${section} (expected path: ${sectionFolderPath}), skipping tag for ${pdfName}. ` +
					`Run /create-dossier first to create the folder structure.`,
			)
			return false
		}

		const tagsPath = path.join(sectionFolderPath, "tags.md")

		// Calculate relative path from dossier section to documents folder
		const relativePathToProcessed = path.relative(
			sectionFolderPath,
			path.join(this.workspaceRoot, processedFolderRelativePath),
		)

		// Read existing tags
		const existingTags = await this.readExistingTags(tagsPath)

		// Check if entry already exists
		const targetList = type === "placement" ? existingTags.placements : existingTags.references
		const exists = targetList.some((e) => e.pdfName === pdfName && e.processedFolderPath === relativePathToProcessed)

		// Skip if already exists - no changes needed
		if (exists) {
			console.log(`PDF ${pdfName} already tagged in section ${section} as ${type}, skipping`)
			return false
		}

		// Create and add new entry
		const newEntry: PdfTagEntry = {
			pdfName,
			processedFolderPath: relativePathToProcessed,
			confidence,
			type,
		}
		targetList.push(newEntry)

		// Write updated tags file
		await this.writeTagsFile(tagsPath, section, existingTags)
		console.log(`Added ${pdfName} to tags.md for section ${section} as ${type}`)
		return true
	}

	/**
	 * Checks if all tags for a PDF already exist in the dossier
	 * Returns true if all tags exist, false if any need to be added
	 */
	async areAllTagsPresent(
		pdfName: string,
		processedFolderRelativePath: string,
		placementSection: string | null,
		referenceSections: string[],
	): Promise<boolean> {
		// Check placement section
		if (placementSection) {
			const placementExists = await this.isPdfAlreadyTagged(
				placementSection,
				pdfName,
				processedFolderRelativePath,
				"placement",
			)
			if (!placementExists) {
				return false
			}
		}

		// Check reference sections
		for (const refSection of referenceSections) {
			if (refSection === placementSection) {
				continue // Skip if same as placement
			}

			const refExists = await this.isPdfAlreadyTagged(refSection, pdfName, processedFolderRelativePath, "reference")
			if (!refExists) {
				return false
			}
		}

		return true
	}

	/**
	 * Updates tags.md files for a classified PDF
	 * @param pdfName Name of the PDF
	 * @param processedFolderRelativePath Relative path to the processed folder (e.g., "documents/stability_report")
	 * @param placementSection The placement section (e.g., "3.2.P.5")
	 * @param placementConfidence Confidence for placement
	 * @param referenceSections List of reference sections
	 * @param confidenceMap Map of section to confidence
	 * @returns Object with counts of added placements and references
	 */
	async updateTagsForPdf(
		pdfName: string,
		processedFolderRelativePath: string,
		placementSection: string | null,
		placementConfidence: string,
		referenceSections: string[],
		confidenceMap: Record<string, string>,
	): Promise<{ placementsAdded: number; referencesAdded: number; skipped: boolean }> {
		let placementsAdded = 0
		let referencesAdded = 0

		// Quick check: if all tags already exist, skip entirely
		const allTagsPresent = await this.areAllTagsPresent(
			pdfName,
			processedFolderRelativePath,
			placementSection,
			referenceSections,
		)

		if (allTagsPresent) {
			console.log(`All dossier tags already exist for ${pdfName}, skipping`)
			return { placementsAdded: 0, referencesAdded: 0, skipped: true }
		}

		// Add to placement section
		if (placementSection) {
			const added = await this.addPdfToSection(
				placementSection,
				pdfName,
				processedFolderRelativePath,
				placementConfidence,
				"placement",
			)
			if (added) {
				placementsAdded++
			}
		}

		// Add to reference sections (excluding placement section to avoid duplication)
		for (const refSection of referenceSections) {
			// Skip if this is the same as placement section
			if (refSection === placementSection) {
				continue
			}

			const added = await this.addPdfToSection(
				refSection,
				pdfName,
				processedFolderRelativePath,
				confidenceMap[refSection] || "Unknown",
				"reference",
			)
			if (added) {
				referencesAdded++
			}
		}

		return { placementsAdded, referencesAdded, skipped: false }
	}
}
