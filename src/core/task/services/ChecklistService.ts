import * as fs from "fs"
import * as path from "path"
import { CTD_CHECKLISTS } from "../ctd_checklists"

/**
 * Represents a checklist entry from the CTD checklists data
 */
export interface ChecklistEntry {
	number: string
	title: string
	input: string[]
	output: string[]
}

/**
 * Represents the parsed state of a checklist feature
 */
export interface ChecklistFeature {
	text: string
	checked: boolean
}

/**
 * Represents a parsed checklist.md file
 */
export interface ParsedChecklist {
	sectionId: string
	features: ChecklistFeature[]
}

/**
 * Service for loading and managing checklist data
 */
export class ChecklistService {
	/**
	 * Loads checklist data from the bundled CTD_CHECKLISTS for a given section
	 */
	static async loadChecklistForSection(sectionId: string): Promise<ChecklistEntry | null> {
		try {
			const entry = CTD_CHECKLISTS.find((item) => item.number === sectionId)
			if (!entry) {
				console.warn(`[ChecklistService] No checklist found for section ${sectionId}`)
				return null
			}

			console.log(`[ChecklistService] Loaded checklist for section ${sectionId}: ${entry.title}`)
			return entry
		} catch (error) {
			console.error(`[ChecklistService] Error loading checklist for section ${sectionId}:`, error)
			throw new Error(`Failed to load checklist: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Parses an existing checklist.md file
	 */
	static async parseChecklistMd(checklistPath: string): Promise<ParsedChecklist | null> {
		try {
			const content = await fs.promises.readFile(checklistPath, "utf-8")
			const lines = content.split("\n")

			const result: ParsedChecklist = {
				sectionId: "",
				features: [],
			}

			let inInputSection = false

			for (const line of lines) {
				const trimmedLine = line.trim()

				// Parse section header: # Checklist for Section X.X.X
				const headerMatch = trimmedLine.match(/^#\s+Checklist\s+for\s+Section\s+(.+)$/i)
				if (headerMatch) {
					result.sectionId = headerMatch[1].trim()
					continue
				}

				// Detect Input Features section
				if (trimmedLine.startsWith("## Input Features")) {
					inInputSection = true
					continue
				}

				// Stop at next section
				if (trimmedLine.startsWith("##") && inInputSection) {
					break
				}

				// Parse checklist items: - [ ] or - [x]
				if (inInputSection) {
					const itemMatch = trimmedLine.match(/^-\s*\[([ xX])\]\s*(.+)$/)
					if (itemMatch) {
						const checked = itemMatch[1].toLowerCase() === "x"
						const text = itemMatch[2].trim()
						result.features.push({ text, checked })
					}
				}
			}

			console.log(
				`[ChecklistService] Parsed checklist.md: ${result.features.length} features, ${result.features.filter((f) => f.checked).length} checked`,
			)
			return result
		} catch (error) {
			// File doesn't exist or can't be read - return null to indicate no existing checklist
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				console.log(`[ChecklistService] No existing checklist.md found at ${checklistPath}`)
				return null
			}
			console.error(`[ChecklistService] Error parsing checklist.md:`, error)
			throw error
		}
	}

	/**
	 * Updates or creates a checklist.md file with the given features
	 * Merges with existing checked features if file exists
	 */
	static async updateChecklistMd(
		checklistPath: string,
		sectionId: string,
		features: string[],
		checkedFeatures: Set<string>,
		existingCheckedFeatures?: Set<string>,
	): Promise<void> {
		// Merge existing checked features with newly checked ones
		const allCheckedFeatures = new Set<string>([...(existingCheckedFeatures || []), ...checkedFeatures])

		const lines: string[] = []
		lines.push(`# Checklist for Section ${sectionId}`)
		lines.push("")
		lines.push("## Input Features")
		lines.push("")

		for (const feature of features) {
			const isChecked = allCheckedFeatures.has(feature)
			const checkbox = isChecked ? "[x]" : "[ ]"
			lines.push(`- ${checkbox} ${feature}`)
		}

		const content = lines.join("\n") + "\n"

		// Ensure directory exists
		const dir = path.dirname(checklistPath)
		await fs.promises.mkdir(dir, { recursive: true })

		// Write file
		await fs.promises.writeFile(checklistPath, content, "utf-8")
		console.log(`[ChecklistService] Updated checklist.md at ${checklistPath}`)
	}

	/**
	 * Gets the set of checked features from a parsed checklist
	 */
	static getCheckedFeatures(parsedChecklist: ParsedChecklist | null): Set<string> {
		if (!parsedChecklist) {
			return new Set<string>()
		}
		return new Set(parsedChecklist.features.filter((f) => f.checked).map((f) => f.text))
	}
}
