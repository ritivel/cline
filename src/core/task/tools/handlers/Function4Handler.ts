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
				Value?: {
					StringWithMarkup?: Array<{
						String?: string
					}>
				}
			}>
			Section?: Array<{
				TOCHeading?: string
				Information?: Array<{
					Name?: string
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

interface PubChemCIDResponse {
	IdentifierList?: {
		CID?: number[]
	}
}

export class Function4Handler implements IToolHandler {
	readonly name = ClineDefaultTool.FUNCTION4

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.product_code}']`
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
							if (str.String) results.push(str.String)
						}
					}
				}
				// Check nested sections
				const nestedSections = section.Section ?? []
				for (const nested of nestedSections) {
					const nestedInfo = nested.Information ?? []
					for (const item of nestedInfo) {
						if (item.Value?.StringWithMarkup) {
							for (const str of item.Value.StringWithMarkup) {
								if (str.String) results.push(str.String)
							}
						}
					}
				}
			}
		}
		return results
	}

	private async getPUGViewData(cid: number): Promise<{ manufaturing?: string[] }> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/json`
			const response = await fetch(url)
			if (!response.ok) return {}
			const data: PubChemPUGViewResponse = await response.json()

			// TODO: Use more sections and use the links provided in the API's response to get more information.
			const manufaturing = this.extractPUGViewSection(data, "Manufactur")

			return {
				manufaturing: manufaturing.length > 0 ? manufaturing : undefined,
			}
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

	private extractManufacturingInfo(text: string): {
		manufacturingSite?: string
		facilityRegistration?: string
		lastInspection?: string
		inspectionStatus?: string
		batchSize?: string
		manufacturingProcess?: string
		qualitySpecs?: {
			purity?: string
			assay?: string
			impurities?: string
			microbialLimits?: string
		}
		qualityControlTesting?: string
		stabilityTesting?: string
		storageConditions?: string
		expiryDating?: string
	} {
		const lowerText = text.toLowerCase()
		const info: ReturnType<typeof this.extractManufacturingInfo> = {}

		// Extract manufacturing site
		const facilityMatch = text.match(/(?:manufacturing|production)\s+(?:site|facility)[:\s]+([^.]+)/i)
		if (facilityMatch) {
			info.manufacturingSite = facilityMatch[1].trim()
		}

		// Extract facility registration
		const regMatch = text.match(/(?:FDA|establishment)\s+(?:registration|reg)[:\s#]+([^\s,]+)/i)
		if (regMatch) {
			info.facilityRegistration = `FDA Establishment Registration #${regMatch[1]}`
		}

		// Extract inspection info
		const inspectionMatch = text.match(/(?:last|recent)\s+inspection[:\s]+([^\n.]+)/i)
		if (inspectionMatch) {
			const inspectionText = inspectionMatch[1]
			const dateMatch = inspectionText.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/)
			if (dateMatch) {
				info.lastInspection = dateMatch[1]
			}
			if (inspectionText.toLowerCase().includes("compliant")) {
				info.inspectionStatus = "Compliant"
			}
		}

		// Extract batch size
		const batchMatch = text.match(/(\d+(?:,\d+)*)\s*(?:units?|batches?)/i)
		if (batchMatch) {
			info.batchSize = `${batchMatch[1]} units`
		}

		// Extract manufacturing process
		const processMatch = text.match(/(?:manufacturing|production)\s+process[:\s]+([^.]+)/i)
		if (processMatch) {
			info.manufacturingProcess = processMatch[1].trim().substring(0, 400)
		}

		// Extract quality specifications
		info.qualitySpecs = {}
		const purityMatch = text.match(/purity[:\s]+([≥≤]?\s*\d+\.?\d*%)/i)
		if (purityMatch) {
			info.qualitySpecs.purity = purityMatch[1]
		}
		const assayMatch = text.match(/assay[:\s]+([\d.]+)\s*[-–]\s*([\d.]+)%/i)
		if (assayMatch) {
			info.qualitySpecs.assay = `${assayMatch[1]}% - ${assayMatch[2]}%`
		}
		const impurityMatch = text.match(/impurities?[:\s]+([≤≥]?\s*\d+\.?\d*%)/i)
		if (impurityMatch) {
			info.qualitySpecs.impurities = impurityMatch[1]
		}
		if (lowerText.includes("microbial") && lowerText.includes("usp")) {
			info.qualitySpecs.microbialLimits = "Meets USP requirements"
		}

		// Extract quality control testing
		if (lowerText.includes("quality control") || lowerText.includes("qc testing")) {
			info.qualityControlTesting = "In-process and finished product testing"
		}

		// Extract stability testing
		if (lowerText.includes("stability")) {
			if (lowerText.includes("ongoing") || lowerText.includes("active")) {
				info.stabilityTesting = "Ongoing"
			} else {
				info.stabilityTesting = "Information available"
			}
		}

		// Extract storage conditions
		const storageMatch = text.match(/(?:storage|store)[:\s]+([^\n.]+)/i)
		if (storageMatch) {
			info.storageConditions = storageMatch[1].trim().substring(0, 100)
		}

		// Extract expiry dating
		const expiryMatch = text.match(/(\d+)\s+months?\s+(?:from|after)/i)
		if (expiryMatch) {
			info.expiryDating = `${expiryMatch[1]} months from date of manufacture`
		}

		return info
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const productCode: string | undefined = block.params.product_code

		// Validate required parameters
		if (!productCode) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "product_code")
		}

		config.taskState.consecutiveMistakeCount = 0

		// if (config.autoApprovalSettings.enableNotifications) {
		showSystemNotification({
			subtitle: "Pharma Tool: Manufacturing & Quality Control",
			message: `Querying manufacturing data for product code: ${productCode}`,
		})
		// }

		try {
			// Step 1: Search for manufacturing information
			const searchQuery1 = `(${productCode}) AND (manufacturing OR production OR GMP)`
			const results1 = await this.searchEuropePMC(searchQuery1, 10)

			// Step 2: Search for quality control
			const searchQuery2 = `(${productCode}) AND (quality control OR QC OR specification OR stability)`
			const results2 = await this.searchEuropePMC(searchQuery2, 10)

			// Step 3: Search for facility information
			const searchQuery3 = `(${productCode}) AND (facility OR establishment OR inspection)`
			const results3 = await this.searchEuropePMC(searchQuery3, 5)

			// Combine results
			const allResults = [
				...(results1.resultList?.result ?? []),
				...(results2.resultList?.result ?? []),
				...(results3.resultList?.result ?? []),
			]

			if (allResults.length === 0) {
				return formatResponse.toolResult(`Manufacturing and Quality Control Information for Product Code: ${productCode}

Manufacturing Site: Information not available in open APIs
Facility Registration: Information not available in open APIs
Last Inspection: Information not available in open APIs
Inspection Status: Information not available in open APIs
Batch Size: Information not available in open APIs
Manufacturing Process: Information not available in open APIs
Quality Specifications:
  - Purity: Information not available in open APIs
  - Assay: Information not available in open APIs
  - Impurities: Information not available in open APIs
  - Microbial Limits: Information not available in open APIs
Batch Record Status: Information not available in open APIs
Quality Control Testing: Information not available in open APIs
Stability Testing: Information not available in open APIs
Storage Conditions: Information not available in open APIs
Expiry Dating: Information not available in open APIs

Note: Most manufacturing and quality control data is proprietary and not published in open literature. Available information would be limited to published research papers or regulatory filings that are publicly accessible.`)
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

			// Step 5: Get PUG View data
			const cid = await this.getCIDFromName(productCode)
			let manufacturingText = ""
			if (!cid) {
				manufacturingText = `Could not find compound information for "${productCode}".`
			} else {
				const pugViewData = await this.getPUGViewData(cid)
				const manufaturing = pugViewData.manufaturing ?? []
				manufacturingText = manufaturing.join("\n")
			}

			// Extract manufacturing information from all sources
			const combinedText = [
				...allResults.map((r) => `${r.title} (DOI: ${r.doi})`),
				...allResults.map((r) => r.abstractText ?? ""),
				...(pubTatorData.PubTator3 ?? []).flatMap((p) => p.passages?.map((pa) => pa.text ?? "") ?? []),
			].join(" ")

			const extractedInfo = this.extractManufacturingInfo(combinedText)

			// Build quality specifications string
			const qualitySpecs = extractedInfo.qualitySpecs
			const qualitySpecsText = qualitySpecs
				? `  - Purity: ${qualitySpecs.purity || "Information not available in open APIs"}
  - Assay: ${qualitySpecs.assay || "Information not available in open APIs"}
  - Impurities: ${qualitySpecs.impurities || "Information not available in open APIs"}
  - Microbial Limits: ${qualitySpecs.microbialLimits || "Information not available in open APIs"}`
				: `  - Purity: Information not available in open APIs
  - Assay: Information not available in open APIs
  - Impurities: Information not available in open APIs
  - Microbial Limits: Information not available in open APIs`

			// Build response
			const response = `Manufacturing and Quality Control Information for Product Code: ${productCode}

Information available in open APIs: ${combinedText}

Manufacturing information available in open APIs: ${manufacturingText}

Other information available in open APIs:
- Manufacturing Site: ${extractedInfo.manufacturingSite || "Information not available in open APIs"}
- Facility Registration: ${extractedInfo.facilityRegistration || "Information not available in open APIs"}
- Last Inspection: ${extractedInfo.lastInspection || "Information not available in open APIs"}
- Inspection Status: ${extractedInfo.inspectionStatus || "Information not available in open APIs"}
- Batch Size: ${extractedInfo.batchSize || "Information not available in open APIs"}
- Manufacturing Process: ${extractedInfo.manufacturingProcess || "Information not available in open APIs"}
- Quality Specifications: ${qualitySpecsText}
- Batch Record Status: Information not available in open APIs
- Quality Control Testing: ${extractedInfo.qualityControlTesting || "Information not available in open APIs"}
- Stability Testing: ${extractedInfo.stabilityTesting || "Information not available in open APIs"}
- Storage Conditions: ${extractedInfo.storageConditions || "Information not available in open APIs"}
- Expiry Dating: ${extractedInfo.expiryDating || "Information not available in open APIs"}

Note: Most manufacturing and quality control data is proprietary and not published in open literature. Available information would be limited to published research papers or regulatory filings that are publicly accessible.`

			return formatResponse.toolResult(response)
		} catch (error) {
			return formatResponse.toolResult(`Manufacturing and Quality Control Information for Product Code: ${productCode}

Error: Failed to retrieve manufacturing and quality control information. ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}
}
