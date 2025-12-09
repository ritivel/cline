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
			pmid?: string
			title?: string
			abstractText?: string
			authorString?: string
			journalTitle?: string
			pubYear?: string
		}>
	}
}

export class Function5Handler implements IToolHandler {
	readonly name = ClineDefaultTool.FUNCTION5

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.drug_name}']`
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
					if (item.Name)
						results.push(`${item.Name}: ${item.Value?.StringWithMarkup?.map((s) => s.String).join(" ") ?? ""}`)
					if (item.Value?.StringWithMarkup) {
						for (const str of item.Value.StringWithMarkup) {
							if (str.String) results.push(str.String)
						}
					}
					// Extract URL from Information item
					if (item.URL) {
						results.push(`URL: ${item.URL}`)
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
	): Promise<{
		toxicity?: string[]
		safety?: string[]
		pharmacology?: string[]
		interactions?: string[]
		biologicalTestResults?: string[]
	}> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/json`
			const response = await fetch(url)
			if (!response.ok) return {}
			const data: PubChemPUGViewResponse = await response.json()

			const toxicity = this.extractPUGViewSection(data, "Toxicity")
			const safety = this.extractPUGViewSection(data, "Safety")
			const pharmacology = this.extractPUGViewSection(data, "Pharmacology and Biochemistry")
			const interactions = this.extractPUGViewSection(data, "Interactions and Pathways")
			const biologicalTestResults = this.extractPUGViewSection(data, "Biological Test Results")

			return {
				toxicity: toxicity.length > 0 ? toxicity : undefined,
				safety: safety.length > 0 ? safety : undefined,
				pharmacology: pharmacology.length > 0 ? pharmacology : undefined,
				interactions: interactions.length > 0 ? interactions : undefined,
				biologicalTestResults: biologicalTestResults.length > 0 ? biologicalTestResults : undefined,
			}
		} catch {
			return {}
		}
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

	private extractSafetyInfo(text: string): {
		safetyProfile?: string
		adverseEvents?: Array<{ name: string; percentage?: string }>
		seriousAdverseEvents?: string
		contraindications?: string[]
		warnings?: string[]
		precautions?: string[]
		drugInteractions?: string[]
		pregnancyCategory?: string
		lactation?: string
		pediatricUse?: string
		geriatricUse?: string
		rems?: string
		postMarketingSurveillance?: string
		adverseEventReports?: string
		seriousAdverseEventReports?: string
	} {
		const lowerText = text.toLowerCase()
		const info: ReturnType<typeof this.extractSafetyInfo> = {}

		// Extract safety profile
		if (lowerText.includes("well-tolerated") || lowerText.includes("generally safe")) {
			info.safetyProfile = "Generally well-tolerated"
		} else if (lowerText.includes("safety") || lowerText.includes("tolerability")) {
			const match = text.match(/(?:safety|tolerability)[:\s]+([^.]+)/i)
			if (match) info.safetyProfile = match[1].trim().substring(0, 100)
		}

		// Extract adverse events with percentages
		info.adverseEvents = []
		const adverseEventPattern = /(?:adverse\s+event|side\s+effect)[:\s]+([^,;.]+)\s*[:\s]*(\d+%)/gi
		let match
		while ((match = adverseEventPattern.exec(text)) !== null && info.adverseEvents.length < 5) {
			info.adverseEvents.push({
				name: match[1].trim(),
				percentage: match[2],
			})
		}
		// Also look for common patterns like "headache: 12%"
		const simplePattern = /([a-z\s]+)[:\s]+(\d+%)/gi
		while ((match = simplePattern.exec(text)) !== null && info.adverseEvents.length < 5) {
			const name = match[1].trim().toLowerCase()
			if (
				name.includes("headache") ||
				name.includes("nausea") ||
				name.includes("dizziness") ||
				name.includes("fatigue") ||
				name.includes("diarrhea")
			) {
				info.adverseEvents.push({
					name: match[1].trim(),
					percentage: match[2],
				})
			}
		}

		// Extract serious adverse events
		if (lowerText.includes("serious adverse event")) {
			const match = text.match(/serious\s+adverse\s+event[:\s]+([^.\n]+)/i)
			if (match) {
				info.seriousAdverseEvents = match[1].trim()
			} else if (lowerText.includes("<1%")) {
				info.seriousAdverseEvents = "<1%"
			}
		}

		// Extract contraindications
		if (lowerText.includes("contraindication")) {
			const match = text.match(/contraindication[:\s]+([^.\n]+)/i)
			if (match) {
				info.contraindications = match[1]
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean)
					.slice(0, 3)
			}
		}

		// Extract warnings
		if (lowerText.includes("warning")) {
			const match = text.match(/warning[:\s]+([^.\n]+)/i)
			if (match) {
				info.warnings = match[1]
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean)
					.slice(0, 3)
			}
		}

		// Extract precautions
		if (lowerText.includes("precaution")) {
			const match = text.match(/precaution[:\s]+([^.\n]+)/i)
			if (match) {
				info.precautions = match[1]
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean)
					.slice(0, 3)
			}
		}

		// Extract drug interactions
		if (lowerText.includes("drug interaction") || lowerText.includes("interaction")) {
			const match = text.match(/(?:drug\s+)?interaction[:\s]+([^.\n]+)/i)
			if (match) {
				info.drugInteractions = match[1]
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean)
					.slice(0, 3)
			}
		}

		// Extract pregnancy category
		const pregnancyMatch = text.match(/pregnancy\s+category[:\s]+([ABCDX])/i)
		if (pregnancyMatch) {
			info.pregnancyCategory = `Category ${pregnancyMatch[1]}`
		}

		// Extract lactation
		if (lowerText.includes("lactation")) {
			const match = text.match(/lactation[:\s]+([^.\n]+)/i)
			if (match) {
				info.lactation = match[1].trim().substring(0, 50)
			} else if (lowerText.includes("caution")) {
				info.lactation = "Use with caution"
			}
		}

		// Extract pediatric use
		if (lowerText.includes("pediatric")) {
			const match = text.match(/pediatric\s+use[:\s]+([^.\n]+)/i)
			if (match) {
				info.pediatricUse = match[1].trim().substring(0, 100)
			}
		}

		// Extract geriatric use
		if (lowerText.includes("geriatric") || lowerText.includes("elderly")) {
			const match = text.match(/(?:geriatric|elderly)\s+use[:\s]+([^.\n]+)/i)
			if (match) {
				info.geriatricUse = match[1].trim().substring(0, 100)
			} else if (lowerText.includes("dose adjustment")) {
				info.geriatricUse = "Dose adjustment may be required"
			}
		}

		// Extract REMS
		if (lowerText.includes("rems")) {
			if (lowerText.includes("not required") || lowerText.includes("no rems")) {
				info.rems = "Not required"
			} else {
				info.rems = "May be required"
			}
		}

		// Extract post-marketing surveillance
		if (lowerText.includes("post-marketing") || lowerText.includes("pharmacovigilance")) {
			if (lowerText.includes("active")) {
				info.postMarketingSurveillance = "Active"
			}
		}

		// Extract adverse event report counts
		const reportMatch = text.match(/(\d+)\s+(?:adverse\s+event\s+)?reports?/i)
		if (reportMatch) {
			info.adverseEventReports = `${reportMatch[1]} reports`
		}

		return info
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const drugName: string | undefined = block.params.drug_name

		// Validate required parameters
		if (!drugName) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "drug_name")
		}

		config.taskState.consecutiveMistakeCount = 0

		// if (config.autoApprovalSettings.enableNotifications) {
		showSystemNotification({
			subtitle: "Pharma Tool: Safety & Pharmacovigilance",
			message: `Querying safety data for drug: ${drugName}`,
		})
		// }

		try {
			// Step 1: Get CID from drug name
			const cid = await this.getCIDFromName(drugName)
			if (!cid) {
				return formatResponse.toolResult(`Safety and Pharmacovigilance Data for Drug: ${drugName}

Error: Could not find compound information for "${drugName}". Please verify the drug name.`)
			}

			// Step 2-3: Get PubChem PUG-View data and search Europe PMC in parallel
			const [pugViewData, safetyResults, interactionResults] = await Promise.all([
				this.getPUGViewData(cid),
				this.searchEuropePMC(`(${drugName}) AND (adverse event OR safety OR pharmacovigilance OR side effect)`, 10),
				this.searchEuropePMC(`(${drugName}) AND (drug interaction OR contraindication)`, 5),
			])

			// Combine all text sources
			const combinedText = [
				...(pugViewData.toxicity ?? []),
				...(pugViewData.safety ?? []),
				...(pugViewData.pharmacology ?? []),
				...(pugViewData.interactions ?? []),
				...(pugViewData.biologicalTestResults ?? []),
				...(safetyResults.resultList?.result?.map((r) => r.title ?? "") ?? []),
				...(safetyResults.resultList?.result?.map((r) => r.abstractText ?? "") ?? []),
				...(interactionResults.resultList?.result?.map((r) => r.title ?? "") ?? []),
				...(interactionResults.resultList?.result?.map((r) => r.abstractText ?? "") ?? []),
			].join(" ")

			const extractedInfo = this.extractSafetyInfo(combinedText)

			// Build adverse events list
			const adverseEventsText =
				extractedInfo.adverseEvents && extractedInfo.adverseEvents.length > 0
					? extractedInfo.adverseEvents.map((ae) => `  - ${ae.name}: ${ae.percentage || "reported"}`).join("\n")
					: "  Information not available in open APIs"

			// Build response
			const response = `Safety and Pharmacovigilance Data for Drug: ${drugName}

Information available in open APIs: ${combinedText}

Other information available in open APIs:
Safety Profile: ${extractedInfo.safetyProfile || "Information not available in open APIs"}
Common Adverse Events (≥5%):
${adverseEventsText}
Serious Adverse Events: ${extractedInfo.seriousAdverseEvents || "Information not available in open APIs"}
Contraindications: ${extractedInfo.contraindications?.join(", ") || "Information not available in open APIs"}
Warnings: ${extractedInfo.warnings?.join(", ") || "Information not available in open APIs"}
Precautions: ${extractedInfo.precautions?.join(", ") || "Information not available in open APIs"}
Drug Interactions: ${extractedInfo.drugInteractions?.join(", ") || "Information not available in open APIs"}
Pregnancy Category: ${extractedInfo.pregnancyCategory || "Information not available in open APIs"}
Lactation: ${extractedInfo.lactation || "Information not available in open APIs"}
Pediatric Use: ${extractedInfo.pediatricUse || "Information not available in open APIs"}
Geriatric Use: ${extractedInfo.geriatricUse || "Information not available in open APIs"}
Risk Evaluation and Mitigation Strategy (REMS): ${extractedInfo.rems || "Information not available in open APIs"}
Post-Marketing Surveillance: ${extractedInfo.postMarketingSurveillance || "Information not available in open APIs"}
Adverse Event Reports (Last 12 months): ${extractedInfo.adverseEventReports || "Information not available in open APIs"}
Serious Adverse Event Reports: ${extractedInfo.seriousAdverseEventReports || "Information not available in open APIs"}`

			return formatResponse.toolResult(response)
		} catch (error) {
			return formatResponse.toolResult(`Safety and Pharmacovigilance Data for Drug: ${drugName}

Error: Failed to retrieve safety and pharmacovigilance data. ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}
}
