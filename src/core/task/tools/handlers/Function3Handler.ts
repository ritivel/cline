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

export class Function3Handler implements IToolHandler {
	readonly name = ClineDefaultTool.FUNCTION3

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.query}']`
	}

	private async searchEuropePMC(query: string, pageSize: number = 10): Promise<EuropePMCResponse> {
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

	private extractTrialInfo(text: string): {
		phase?: string
		status?: string
		startDate?: string
		completionDate?: string
		primaryEndpoint?: string
		secondaryEndpoints?: string[]
		patientPopulation?: string
		sampleSize?: string
		arms?: string
		primaryOutcome?: string
		secondaryOutcomes?: string[]
		inclusionCriteria?: string[]
		exclusionCriteria?: string[]
	} {
		const lowerText = text.toLowerCase()
		const info: ReturnType<typeof this.extractTrialInfo> = {}

		// Extract phase
		if (lowerText.includes("phase i")) {
			info.phase = "Phase I"
		} else if (lowerText.includes("phase ii")) {
			info.phase = "Phase II"
		} else if (lowerText.includes("phase iii")) {
			info.phase = "Phase III"
		} else if (lowerText.includes("phase iv")) {
			info.phase = "Phase IV"
		}

		// Extract status
		if (lowerText.includes("recruiting") || lowerText.includes("active")) {
			info.status = "Active, Recruiting"
		} else if (lowerText.includes("completed")) {
			info.status = "Completed"
		} else if (lowerText.includes("terminated")) {
			info.status = "Terminated"
		} else if (lowerText.includes("suspended")) {
			info.status = "Suspended"
		}

		// Extract dates
		const datePattern = /\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/g
		const dates = text.match(datePattern)
		if (dates && dates.length >= 1) {
			info.startDate = dates[0]
		}
		if (dates && dates.length >= 2) {
			info.completionDate = dates[dates.length - 1]
		}

		// Extract endpoints
		if (lowerText.includes("primary endpoint") || lowerText.includes("primary end point")) {
			const match = text.match(/primary endpoint[:\s]+([^.]+)/i)
			if (match) info.primaryEndpoint = match[1].trim()
		}
		if (lowerText.includes("secondary endpoint") || lowerText.includes("secondary end point")) {
			const match = text.match(/secondary endpoint[:\s]+([^.]+)/i)
			if (match) {
				info.secondaryEndpoints = match[1]
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean)
			}
		}

		// Extract patient population
		const ageMatch = text.match(/(?:aged?|age)\s+(\d+)[-\s]+(\d+)/i)
		if (ageMatch) {
			info.patientPopulation = `Adults aged ${ageMatch[1]}-${ageMatch[2]}`
		}

		// Extract sample size
		const sampleMatch = text.match(/(\d+)\s+(?:participants?|patients?|subjects?)/i)
		if (sampleMatch) {
			info.sampleSize = `${sampleMatch[1]} participants`
		}

		// Extract arms
		if (lowerText.includes("treatment") && lowerText.includes("placebo")) {
			info.arms = "2 (Treatment vs Placebo)"
		} else if (lowerText.includes("arm")) {
			const armMatch = text.match(/(\d+)\s+arms?/i)
			if (armMatch) {
				info.arms = `${armMatch[1]} arms`
			}
		}

		// Extract outcome measures
		if (lowerText.includes("primary outcome")) {
			const match = text.match(/primary outcome[:\s]+([^.]+)/i)
			if (match) info.primaryOutcome = match[1].trim()
		}
		if (lowerText.includes("secondary outcome")) {
			const match = text.match(/secondary outcome[:\s]+([^.]+)/i)
			if (match) {
				info.secondaryOutcomes = match[1]
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean)
			}
		}

		// Extract inclusion/exclusion criteria (basic extraction)
		if (lowerText.includes("inclusion criteria")) {
			const match = text.match(/inclusion criteria[:\s]+([^.]+)/i)
			if (match) {
				info.inclusionCriteria = match[1]
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean)
					.slice(0, 3)
			}
		}
		if (lowerText.includes("exclusion criteria")) {
			const match = text.match(/exclusion criteria[:\s]+([^.]+)/i)
			if (match) {
				info.exclusionCriteria = match[1]
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean)
					.slice(0, 3)
			}
		}

		return info
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
			subtitle: "Pharma Tool: Clinical Trial",
			message: `Querying clinical trial data for query: ${query}`,
		})
		// }

		try {
			// Step 1: Search Europe PMC with NCT number
			const results1 = await this.searchEuropePMC(query, 10)

			// Step 2: Search for trial results with phase and endpoint terms
			const searchQuery2 = `(${query}) AND (clinical trial OR phase OR endpoint)`
			const results2 = await this.searchEuropePMC(searchQuery2, 10)

			// Step 3: Search for protocol or results papers
			const searchQuery3 = `(${query}) AND (protocol OR results OR outcome)`
			const results3 = await this.searchEuropePMC(searchQuery3, 5)

			// Combine results
			const allResults = [
				...(results1.resultList?.result ?? []),
				...(results2.resultList?.result ?? []),
				...(results3.resultList?.result ?? []),
			]

			if (allResults.length === 0) {
				return formatResponse.toolResult(`Clinical Trial Data for Query: ${query}

Trial Phase: Information not available in open APIs
Status: Information not available in open APIs
Start Date: Information not available in open APIs
Estimated Completion: Information not available in open APIs
Primary Endpoint: Information not available in open APIs
Secondary Endpoints: Information not available in open APIs
Patient Population: Information not available in open APIs
Sample Size: Information not available in open APIs
Arms: Information not available in open APIs
Primary Outcome Measure: Information not available in open APIs
Secondary Outcome Measures: Information not available in open APIs
Inclusion Criteria: Information not available in open APIs
Exclusion Criteria: Information not available in open APIs

Note: ClinicalTrials.gov has a more comprehensive API, but it's not in the provided API list. Information is extracted from published literature and may be incomplete.`)
			}

			// Step 4: Get PubTator3 annotations for relevant PMIDs
			const pmids = allResults
				.map((r) => r.pmid)
				.filter((pmid): pmid is string => Boolean(pmid))
				.slice(0, 5) // Limit to 5 PMIDs

			let pubTatorData: PubTator3ExportResponse = {}
			if (pmids.length > 0) {
				pubTatorData = await this.pubTator3Export(pmids)
			}

			// Extract trial information from all sources
			const combinedText = [
				...allResults.map((r) => `${r.title} (DOI: ${r.doi})`),
				...allResults.map((r) => r.abstractText ?? ""),
				...(pubTatorData.PubTator3 ?? []).flatMap((p) => p.passages?.map((pa) => pa.text ?? "") ?? []),
			].join(" ")

			const extractedInfo = this.extractTrialInfo(combinedText)

			// Build response
			const response = `Clinical Trial Data for Query: ${query}

Information available in open APIs: ${combinedText}

Other information available in open APIs:
- Trial Phase: ${extractedInfo.phase || "Information not available in open APIs"}
- Status: ${extractedInfo.status || "Information not available in open APIs"}
- Start Date: ${extractedInfo.startDate || "Information not available in open APIs"}
- Estimated Completion: ${extractedInfo.completionDate || "Information not available in open APIs"}
- Primary Endpoint: ${extractedInfo.primaryEndpoint || "Information not available in open APIs"}
- Secondary Endpoints: ${extractedInfo.secondaryEndpoints?.join(", ") || "Information not available in open APIs"}
- Patient Population: ${extractedInfo.patientPopulation || "Information not available in open APIs"}
- Sample Size: ${extractedInfo.sampleSize || "Information not available in open APIs"}
- Arms: ${extractedInfo.arms || "Information not available in open APIs"}
- Primary Outcome Measure: ${extractedInfo.primaryOutcome || "Information not available in open APIs"}
- Secondary Outcome Measures: ${extractedInfo.secondaryOutcomes?.join(", ") || "Information not available in open APIs"}
- Inclusion Criteria: ${extractedInfo.inclusionCriteria?.join(", ") || "Information not available in open APIs"}
- Exclusion Criteria: ${extractedInfo.exclusionCriteria?.join(", ") || "Information not available in open APIs"}

Note: ClinicalTrials.gov has a more comprehensive API, but it's not in the provided API list. Information is extracted from published literature and may be incomplete.`

			return formatResponse.toolResult(response)
		} catch (error) {
			return formatResponse.toolResult(`Clinical Trial Data for Query: ${query}

Error: Failed to retrieve clinical trial data. ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}
}
