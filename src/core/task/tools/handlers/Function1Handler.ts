import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { showSystemNotification } from "@integrations/notifications"
import { fetch } from "@/shared/net"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

interface PubChemCIDResponse {
	IdentifierList?: {
		CID?: number[]
	}
}

interface PubChemPropertyResponse {
	PropertyTable?: {
		Properties?: Array<{
			CID?: number
			MolecularFormula?: string
			MolecularWeight?: string
			IUPACName?: string
		}>
	}
}

interface PubChemSynonymResponse {
	InformationList?: {
		Information?: Array<{
			CID?: number
			Synonym?: string[]
		}>
	}
}

interface PubChemPUGViewResponse {
	Record?: {
		RecordTitle?: string
		Section?: Array<{
			TOCHeading?: string
			Description?: string
			Information?: Array<{
				Name?: string
				URL?: string
				Value?: {
					StringWithMarkup?: Array<{
						String?: string
					}>
				}
			}>
			Section?: Array<{
				TOCHeading?: string
				URL?: string
				Information?: Array<{
					Name?: string
					URL?: string
					Value?: {
						StringWithMarkup?: Array<{
							String?: string
						}>
					}
				}>
			}>
		}>
	}
}

interface EuropePMCResponse {
	resultList?: {
		result?: Array<{
			title?: string
			abstractText?: string
			authorString?: string
			journalTitle?: string
			pubYear?: string
		}>
	}
}

export class Function1Handler implements IToolHandler {
	readonly name = ClineDefaultTool.FUNCTION1

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.query}']`
	}

	private async getCIDFromName(drugName: string): Promise<number | null> {
		try {
			const encodedName = encodeURIComponent(drugName)
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodedName}/cids/json`
			const response = await fetch(url)
			if (!response.ok) return null
			const data: PubChemCIDResponse = await response.json()
			return data.IdentifierList?.CID?.[0] ?? null
		} catch {
			return null
		}
	}

	private async getCompoundProperties(cid: number): Promise<{ formula?: string; weight?: string; iupac?: string }> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName/json`
			const response = await fetch(url)
			if (!response.ok) return {}
			const data: PubChemPropertyResponse = await response.json()
			const props = data.PropertyTable?.Properties?.[0]
			return {
				formula: props?.MolecularFormula,
				weight: props?.MolecularWeight,
				iupac: props?.IUPACName,
			}
		} catch {
			return {}
		}
	}

	private async getCompoundSynonyms(cid: number): Promise<string[]> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/json`
			const response = await fetch(url)
			if (!response.ok) return []
			const data: PubChemSynonymResponse = await response.json()
			return data.InformationList?.Information?.[0]?.Synonym ?? []
		} catch {
			return []
		}
	}

	private extractPUGViewSection(data: PubChemPUGViewResponse, heading: string): string[] {
		const results: string[] = []
		const sections = data.Record?.Section ?? []
		for (const section of sections) {
			if (section.TOCHeading?.toLowerCase().includes(heading.toLowerCase())) {
				if (section.Description) results.push(section.Description)
				const info = section.Information ?? []
				for (const item of info) {
					if (item.Value?.StringWithMarkup) {
						for (const str of item.Value.StringWithMarkup) {
							if (str.String)
								results.push(
									`${item.Name ? `${item.Name}:\n` : ""}${str.String}${item.URL ? `(URL: ${item.URL})` : ""}`,
								)
						}
					}
				}
				// Check nested sections
				const nestedSections = section.Section ?? []
				for (const nested of nestedSections) {
					// Extract URL from nested section
					if (nested.URL) {
						results.push(`URL: ${nested.URL}`)
					}
					const nestedInfo = nested.Information ?? []
					for (const item of nestedInfo) {
						if (item.Value?.StringWithMarkup) {
							for (const str of item.Value.StringWithMarkup) {
								if (str.String)
									results.push(
										`${item.Name ? `${item.Name}:\n` : ""}${str.String}${item.URL ? `(URL: ${item.URL})` : ""}`,
									)
							}
						}
					}
				}
			}
		}
		return results
	}

	private async getPUGViewData(
		cid: number,
	): Promise<{ therapeutic?: string[]; indications?: string[]; manufaturing?: string[] }> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/json`
			const response = await fetch(url)
			if (!response.ok) return {}
			const data: PubChemPUGViewResponse = await response.json()

			// TODO: Use more sections and use the links provided in the API's response to get more information.
			const therapeutic = this.extractPUGViewSection(data, "Pharmacology")
			const indications = this.extractPUGViewSection(data, "Drug and Medication")
			const manufaturing = this.extractPUGViewSection(data, "Manufactur")

			return {
				therapeutic: therapeutic.length > 0 ? therapeutic : undefined,
				indications: indications.length > 0 ? indications : undefined,
				manufaturing: manufaturing.length > 0 ? manufaturing : undefined,
			}
		} catch {
			return {}
		}
	}

	private async searchEuropePMC(query: string): Promise<string[]> {
		try {
			const encodedQuery = encodeURIComponent(query)
			const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodedQuery}&pageSize=15&format=json`
			const response = await fetch(url)
			if (!response.ok) return []
			const data: EuropePMCResponse = await response.json()
			return data.resultList?.result?.map((r) => r.abstractText ?? r.title ?? "").filter(Boolean) ?? []
		} catch {
			return []
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const query: string | undefined = block.params.query

		// Validate required parameters
		if (!query) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "query")
		}

		config.taskState.consecutiveMistakeCount = 0

		// if (config.autoApprovalSettings.enableNotifications) {
		showSystemNotification({
			subtitle: "Pharma Tool: Drug Information",
			message: `Querying drug information for: ${query}`,
		})
		// }

		try {
			// Step 1: Get CID from drug name
			const cid = await this.getCIDFromName(query)
			if (!cid) {
				return formatResponse.toolResult(
					`Drug Information for: ${query}\n\nError: Could not find compound information for "${query}". Please verify the drug name.`,
				)
			}

			// Step 2-4: Get compound data in parallel
			const [properties, synonyms, pugViewData] = await Promise.all([
				this.getCompoundProperties(cid),
				this.getCompoundSynonyms(cid),
				this.getPUGViewData(cid),
			])

			// Step 5: Search literature
			const literature = await this.searchEuropePMC(query)

			// Extract dosage forms and strength from literature
			// let dosageForms = "Information not available in open APIs"
			// let strength = "Information not available in open APIs"
			const literatureText = literature.join("\n").toLowerCase()
			if (literatureText.includes("tablet") || literatureText.includes("capsule") || literatureText.includes("injection")) {
				const forms: string[] = []
				if (literatureText.includes("tablet")) forms.push("Tablet")
				if (literatureText.includes("capsule")) forms.push("Capsule")
				if (literatureText.includes("injection")) forms.push("Injection")
				// dosageForms = forms.join(", ")
			}

			// Build response
			const response = `Drug Information for: ${query}

Active Ingredient: ${properties.iupac || query}
Therapeutic Classification: ${pugViewData.therapeutic?.join(", ").substring(0, 800) || "Information not available in open APIs"}
Indications: ${pugViewData.indications?.join(", ").substring(0, 800) || "Information not available in open APIs"}
Manufacturer: ${pugViewData.manufaturing?.join(", ").substring(0, 800) || "Information not available in open APIs"}`

			return formatResponse.toolResult(response)
		} catch (error) {
			return formatResponse.toolResult(
				`Drug Information for: ${query}\n\nError: Failed to retrieve drug information. ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}
}
