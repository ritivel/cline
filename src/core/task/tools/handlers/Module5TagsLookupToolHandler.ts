import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { fileExistsAtPath } from "@utils/fs"
import { getCwd } from "@utils/path"
import * as fs from "fs"
import * as path from "path"
import { EAC_NMRA_TEMPLATE } from "@/core/ctd/templates/eac-nmra/definition"
import { SECTION_PARENT_MAP } from "@/core/ctd/templates/eac-nmra/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * Tool handler for looking up tags.md files from Module 5 sections
 * Used by section 2.5 preamble generation agent
 */
export class Module5TagsLookupToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.MODULE5_TAGS_LOOKUP

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		const sectionNumber = (block.params as any).sectionNumber as string | undefined
		return `[${block.name} for module 5 section '${sectionNumber || "unknown"}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Skip partial block streaming for this tool
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const sectionNumber = (block.params as any).sectionNumber as string | undefined

		if (!sectionNumber) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name as ClineDefaultTool, "sectionNumber")
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			const cwd = await getCwd()
			const workspaceRoot = config.workspaceManager?.getPrimaryRoot()?.path || cwd
			const dossierPath = path.join(workspaceRoot, "dossier")

			// Validate section number is from Module 5
			const module5 = EAC_NMRA_TEMPLATE.modules.find((m: { moduleNumber: number }) => m.moduleNumber === 5)
			if (!module5) {
				return formatResponse.toolError("Module 5 not found in template")
			}

			// Find the section in Module 5
			const section = module5.sections[sectionNumber]
			if (!section) {
				return formatResponse.toolError(`Section ${sectionNumber} not found in Module 5`)
			}

			// Convert section number to folder path
			const sectionFolderPath = this.sectionToFolderPath(sectionNumber, dossierPath)
			const tagsPath = path.join(sectionFolderPath, "tags.md")

			// Check if tags.md exists
			if (!(await fileExistsAtPath(tagsPath))) {
				return JSON.stringify({
					sectionNumber,
					sectionTitle: section.title,
					tagsPath,
					exists: false,
					message: `tags.md not found for section ${sectionNumber}`,
					tags: null,
					documents: [],
				})
			}

			// Read and parse tags.md
			const tagsContent = await fs.promises.readFile(tagsPath, "utf-8")
			const parsedTags = this.parseTagsFile(tagsContent, sectionNumber)

			// Read document contents referenced in tags.md
			const documentsPath = path.join(workspaceRoot, "documents")
			const documentContents = await this.readReferencedDocuments(parsedTags, documentsPath, workspaceRoot)

			return JSON.stringify({
				sectionNumber,
				sectionTitle: section.title,
				tagsPath,
				exists: true,
				tags: parsedTags,
				documents: documentContents,
			})
		} catch (error) {
			return formatResponse.toolError(`Error: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Converts a section number to its folder path using SECTION_PARENT_MAP
	 */
	private sectionToFolderPath(sectionNumber: string, dossierPath: string): string {
		const moduleNum = sectionNumber.charAt(0)

		if (!(sectionNumber in SECTION_PARENT_MAP)) {
			// Fallback: build path from section number parts
			const parts = sectionNumber.split(".")
			let currentPath = path.join(dossierPath, `module-${moduleNum}`)

			for (let i = 1; i < parts.length; i++) {
				const sectionId = parts.slice(0, i + 1).join(".")
				currentPath = path.join(currentPath, `section-${sectionId}`)
			}

			return currentPath
		}

		// Use SECTION_PARENT_MAP to build the full path
		const ancestors: string[] = []
		let current: string | null = sectionNumber

		while (current !== null) {
			ancestors.unshift(current)
			current = SECTION_PARENT_MAP[current] ?? null
		}

		const sectionFolders = ancestors.map((s) => `section-${s}`)
		return path.join(dossierPath, `module-${moduleNum}`, ...sectionFolders)
	}

	/**
	 * Parses tags.md content
	 */
	private parseTagsFile(
		content: string,
		sectionId: string,
	): {
		sectionId: string
		drugName: string
		apiName: string
		placements: Array<{ pdfName: string; relativePath: string; confidence: string }>
		references: Array<{ pdfName: string; relativePath: string; confidence: string }>
	} {
		const lines = content.split("\n")
		const result = {
			sectionId,
			drugName: "",
			apiName: "",
			placements: [] as Array<{ pdfName: string; relativePath: string; confidence: string }>,
			references: [] as Array<{ pdfName: string; relativePath: string; confidence: string }>,
		}

		let currentSection: "none" | "placements" | "references" = "none"

		for (const line of lines) {
			const trimmed = line.trim()

			// Parse drug name
			const drugMatch = trimmed.match(/^Drug\s*Name:\s*(.+)$/i)
			if (drugMatch) {
				result.drugName = drugMatch[1].trim()
				continue
			}

			// Parse API name
			const apiMatch = trimmed.match(/^API\s*Name:\s*(.+)$/i)
			if (apiMatch) {
				result.apiName = apiMatch[1].trim()
				continue
			}

			// Detect section markers
			if (trimmed.startsWith("## Placements")) {
				currentSection = "placements"
				continue
			}
			if (trimmed.startsWith("## References")) {
				currentSection = "references"
				continue
			}

			// Parse document entries: - [name.pdf](path) (Confidence)
			const docMatch = trimmed.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*\(([^)]+)\)/)
			if (docMatch && currentSection !== "none") {
				const entry = {
					pdfName: docMatch[1],
					relativePath: docMatch[2],
					confidence: docMatch[3],
				}
				if (currentSection === "placements") {
					result.placements.push(entry)
				} else {
					result.references.push(entry)
				}
			}
		}

		return result
	}

	/**
	 * Reads document names and summaries from referenced documents
	 * Returns only document names and summaries (from info.json), NOT full .mmd content
	 * The agent will use this information to decide which documents are relevant
	 */
	private async readReferencedDocuments(
		tags: {
			placements: Array<{ pdfName: string; relativePath: string }>
			references: Array<{ pdfName: string; relativePath: string }>
		},
		documentsPath: string,
		workspaceRoot: string,
	): Promise<Array<{ pdfName: string; summary?: string; relativePath: string }>> {
		const allDocs = [...tags.placements, ...tags.references]
		const contents: Array<{ pdfName: string; summary?: string; relativePath: string }> = []

		for (const doc of allDocs) {
			try {
				// Paths in tags.md are relative to workspace root's documents folder
				const docFolderPath = path.join(documentsPath, doc.relativePath)

				// Read info.json if exists to get summary
				let summary: string | undefined
				try {
					const infoPath = path.join(docFolderPath, "info.json")
					const infoContent = await fs.promises.readFile(infoPath, "utf-8")
					const infoJson = JSON.parse(infoContent)
					summary = infoJson.summary
				} catch {
					// info.json not found, skip summary
				}

				// Always include the document (even without summary) so agent can see the name
				contents.push({
					pdfName: doc.pdfName,
					summary,
					relativePath: doc.relativePath,
				})
			} catch (error) {
				console.warn(`Failed to read document ${doc.pdfName}: ${error}`)
			}
		}

		return contents
	}
}
