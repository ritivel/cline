import { String, StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import * as fs from "fs/promises"
import * as path from "path"
import { EAC_NMRA_TEMPLATE } from "@/core/ctd/templates/eac-nmra/definition"
import { SECTION_PARENT_MAP } from "@/core/ctd/templates/eac-nmra/prompts"
import type { Controller } from "../index"

interface CtdSectionStatus {
	sectionId: string
	sectionTitle: string
	hasDocuments: boolean
	presentDocuments: string[]
	missingDocuments: string[]
	isComplete: boolean
}

interface CtdAssessment {
	sections: CtdSectionStatus[]
	assessedAt: number
}

/**
 * Converts a CTD section number to a dossier folder path
 */
function sectionToFolderPath(section: string, dossierPath: string): string | null {
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
 * Checks if a section has documents in the dossier folder
 */
async function checkSectionDocuments(sectionPath: string): Promise<{ hasFiles: boolean; files: string[] }> {
	try {
		const entries = await fs.readdir(sectionPath, { withFileTypes: true })
		const files = entries.filter((e) => e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".tex"))).map((e) => e.name)
		return { hasFiles: files.length > 0, files }
	} catch {
		return { hasFiles: false, files: [] }
	}
}

/**
 * Checks if documents in the documents folder are tagged for a specific section
 */
async function checkTaggedDocuments(
	documentsPath: string,
	sectionId: string,
): Promise<{ hasDocuments: boolean; documents: string[] }> {
	const documents: string[] = []
	try {
		const entries = await fs.readdir(documentsPath, { withFileTypes: true })
		for (const entry of entries) {
			if (entry.isDirectory()) {
				const tagsPath = path.join(documentsPath, entry.name, "tags.md")
				try {
					const tagsContent = await fs.readFile(tagsPath, "utf-8")
					// Check if this document is tagged for this section
					if (tagsContent.includes(sectionId)) {
						documents.push(entry.name)
					}
				} catch {
					// No tags file or can't read it
				}
			}
		}
	} catch {
		// Documents folder doesn't exist
	}
	return { hasDocuments: documents.length > 0, documents }
}

/**
 * Assesses CTD documents for a regulatory product
 */
export async function assessCtdDocuments(controller: Controller, request: StringRequest): Promise<String> {
	try {
		const product: RegulatoryProductConfig = JSON.parse(request.value || "{}")
		const submissionsPath = product.submissionsPath
		const documentsPath = path.join(submissionsPath, "documents")
		const dossierPath = path.join(submissionsPath, "dossier")

		// Get CTD template based on market (for now, use EAC-NMRA)
		const template = EAC_NMRA_TEMPLATE

		const assessment: CtdAssessment = {
			sections: [],
			assessedAt: Date.now(),
		}

		// Check all sections in the template
		for (const module of template.modules) {
			for (const [sectionId, sectionDef] of Object.entries(module.sections)) {
				// Check if section folder exists in dossier
				const sectionPath = sectionToFolderPath(sectionId, dossierPath)
				let hasDocuments = false
				const presentDocuments: string[] = []
				const missingDocuments: string[] = []

				if (sectionPath) {
					// Check for generated documents in dossier folder
					const { hasFiles, files } = await checkSectionDocuments(sectionPath)
					if (hasFiles) {
						hasDocuments = true
						presentDocuments.push(...files)
					}
				}

				// Check documents folder for related PDFs
				const { hasDocuments: hasTaggedDocs, documents: taggedDocs } = await checkTaggedDocuments(
					documentsPath,
					sectionId,
				)
				if (hasTaggedDocs) {
					hasDocuments = true
					presentDocuments.push(...taggedDocs)
				}

				// If no documents found, mark as missing
				if (!hasDocuments) {
					missingDocuments.push(`${sectionDef.title} document`)
				}

				assessment.sections.push({
					sectionId,
					sectionTitle: sectionDef.title,
					hasDocuments,
					presentDocuments,
					missingDocuments,
					isComplete: hasDocuments && missingDocuments.length === 0,
				})
			}
		}

		return String.create({ value: JSON.stringify(assessment) })
	} catch (error) {
		console.error("Failed to assess CTD documents:", error)
		throw error
	}
}
