import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { showSystemNotification } from "@integrations/notifications"
import { fetch } from "@/shared/net"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

interface EuropePMCResponse {
	resultList?: {
		result?: Array<{
			pmid?: string
			title?: string
			doi?: string
			abstractText?: string
			authorString?: string
			journalTitle?: string
			pubYear?: string
			firstPublicationDate?: string
		}>
	}
}

interface PubTator3AutocompleteResponse {
	_id?: string
	name?: string
	db?: string
	db_id?: string
}

interface PubTator3ExportResponse {
	PubTator3?: Array<{
		_id?: string
		passages?: Array<{
			infons?: {
				type?: string
			}
			text?: string
		}>
	}>
}

export class Function2Handler implements IToolHandler {
	readonly name = ClineDefaultTool.FUNCTION2

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.product_id}']`
	}

	private async searchEuropePMC(query: string, pageSize: number = 20): Promise<EuropePMCResponse> {
		try {
			const encodedQuery = encodeURIComponent(query)
			const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodedQuery}&pageSize=${pageSize}&format=json`
			const response = await fetch(url)
			if (!response.ok) return {}
			return await response.json()
		} catch {
			return {}
		}
	}

	private async pubTator3Autocomplete(
		query: string,
		concept: string = "chemical",
	): Promise<PubTator3AutocompleteResponse | null> {
		try {
			const encodedQuery = encodeURIComponent(query)
			const url = `https://www.ncbi.nlm.nih.gov/research/pubtator3-api/entity/autocomplete/?query=${encodedQuery}&concept=${concept}&limit=1`
			const response = await fetch(url)
			if (!response.ok) return null
			const data: PubTator3AutocompleteResponse[] = await response.json()
			return data[0] ?? null
		} catch {
			return null
		}
	}

	private async pubTator3Export(pmids: string[]): Promise<PubTator3ExportResponse> {
		try {
			const url = "https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson"
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					pmids: pmids.join(","),
					full: "false",
				}),
			})
			if (!response.ok) return {}
			return await response.json()
		} catch {
			return {}
		}
	}

	private extractRegulatoryInfo(text: string): {
		approvalStatus?: string
		approvalDate?: string
		regulatoryPathway?: string
		complianceStatus?: string
		gmpCompliance?: string
		labelingCompliance?: string
		adverseEventReporting?: string
	} {
		const lowerText = text.toLowerCase()
		const info: ReturnType<typeof this.extractRegulatoryInfo> = {}

		// Extract approval status
		if (lowerText.includes("approved") || lowerText.includes("approval")) {
			info.approvalStatus = "Approved"
		} else if (lowerText.includes("pending")) {
			info.approvalStatus = "Pending"
		} else if (lowerText.includes("rejected") || lowerText.includes("denied")) {
			info.approvalStatus = "Rejected"
		}

		// Extract regulatory pathway
		if (lowerText.includes("nda")) {
			info.regulatoryPathway = "NDA (New Drug Application)"
		} else if (lowerText.includes("anda")) {
			info.regulatoryPathway = "ANDA (Abbreviated New Drug Application)"
		} else if (lowerText.includes("bla")) {
			info.regulatoryPathway = "BLA (Biologics License Application)"
		}

		// Extract compliance status
		if (lowerText.includes("compliant") || lowerText.includes("compliance")) {
			info.complianceStatus = "Current"
		}

		// Extract GMP compliance
		if (lowerText.includes("gmp") && (lowerText.includes("compliant") || lowerText.includes("yes"))) {
			info.gmpCompliance = "Yes"
		}

		// Extract labeling compliance
		if (lowerText.includes("labeling") && (lowerText.includes("compliant") || lowerText.includes("yes"))) {
			info.labelingCompliance = "Yes"
		}

		// Extract adverse event reporting
		if (lowerText.includes("adverse event") || lowerText.includes("pharmacovigilance")) {
			info.adverseEventReporting = "Active"
		}

		// Extract dates (simple pattern matching)
		const datePattern = /\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/
		const dateMatch = text.match(datePattern)
		if (dateMatch) {
			info.approvalDate = dateMatch[1]
		}

		return info
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const drugName: string | undefined = block.params.drug_name

		// Validate required parameters
		if (!drugName) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "product_name")
		}

		config.taskState.consecutiveMistakeCount = 0

		// if (config.autoApprovalSettings.enableNotifications) {
		showSystemNotification({
			subtitle: "Pharma Tool: Regulatory Compliance",
			message: `Querying regulatory compliance data for drug name: ${drugName}`,
		})
		// }

		try {
			// Step 1: Search Europe PMC with product ID
			const searchQuery1 = `${drugName} OR ${drugName.replace(/[^a-zA-Z0-9]/g, "")}`
			const results1 = await this.searchEuropePMC(searchQuery1, 20)

			// Step 2: Search for regulatory terms
			const searchQuery2 = `(${drugName}) AND (FDA OR approval OR NDA OR regulatory)`
			const results2 = await this.searchEuropePMC(searchQuery2, 20)

			// Combine results
			const allResults = [...(results1.resultList?.result ?? []), ...(results2.resultList?.result ?? [])]

			// TODO: there are DOI ids of the papers it finds; we should get the info like abstract out of them

			if (allResults.length === 0) {
				return formatResponse.toolResult(`Regulatory Compliance Information for Drug Name: ${drugName}

FDA Approval Status: Information not available in open APIs
Approval Date: Information not available in open APIs
Regulatory Pathway: Information not available in open APIs
Regulatory Classification: Information not available in open APIs
Compliance Status: Information not available in open APIs
Last Inspection Date: Information not available in open APIs
Inspection Result: Information not available in open APIs
GMP Compliance: Information not available in open APIs
Labeling Compliance: Information not available in open APIs
Adverse Event Reporting: Information not available in open APIs

Note: Direct FDA database access is not available through open APIs. Regulatory information would need to be extracted from published literature, which may not be available for all products.`)
			}

			// Step 3: Get PubTator3 annotations for relevant PMIDs
			const pmids = allResults
				.map((r) => r.pmid)
				.filter((pmid): pmid is string => Boolean(pmid))
				.slice(0, 5) // Limit to 5 PMIDs

			let pubTatorData: PubTator3ExportResponse = {}
			if (pmids.length > 0) {
				pubTatorData = await this.pubTator3Export(pmids)
			}

			// Extract regulatory information from all sources
			const combinedText = [
				...allResults.map((r) => `${r.title} (DOI: ${r.doi})`),
				...allResults.map((r) => r.abstractText ?? ""),
				...(pubTatorData.PubTator3 ?? []).flatMap((p) => p.passages?.map((pa) => pa.text ?? "") ?? []),
			].join(" ")

			const extractedInfo = this.extractRegulatoryInfo(combinedText)

			// Build response
			const response = `Regulatory Compliance Information for Drug Name: ${drugName}
Information available in open APIs: ${combinedText}

Other information available in open APIs:
- FDA Approval Status: ${extractedInfo.approvalStatus || "Information not available in open APIs"}
- Approval Date: ${extractedInfo.approvalDate || "Information not available in open APIs"}
- Regulatory Pathway: ${extractedInfo.regulatoryPathway || "Information not available in open APIs"}
- Compliance Status: ${extractedInfo.complianceStatus || "Information not available in open APIs"}
- Last Inspection Date: Information not available in open APIs
- Inspection Result: Information not available in open APIs
- GMP Compliance: ${extractedInfo.gmpCompliance || "Information not available in open APIs"}
- Labeling Compliance: ${extractedInfo.labelingCompliance || "Information not available in open APIs"}
- Adverse Event Reporting: ${extractedInfo.adverseEventReporting || "Information not available in open APIs"}

Note: Direct FDA database access is not available through open APIs. Information is extracted from published literature and may be incomplete.`

			return formatResponse.toolResult(response)
		} catch (error) {
			return formatResponse.toolResult(`Regulatory Compliance Information for Drug Name: ${drugName}

Error: Failed to retrieve regulatory compliance information. ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}
}
