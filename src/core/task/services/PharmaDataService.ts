import { fetch } from "@/shared/net"

/**
 * Interface for modular pharma function handlers
 */
export interface IPharmaFunction {
	name: string
	description: string
	execute(drugName: string): Promise<string>
}

/**
 * Result from pharma data fetching
 */
export interface PharmaDataResult {
	drugInfo?: string
	regulatoryInfo?: string
	clinicalData?: string
	manufacturingInfo?: string
	safetyData?: string
	errors: string[]
}

/**
 * Service for fetching pharmaceutical data from various sources
 * Provides a modular wrapper around Function1-5 handlers
 */
export class PharmaDataService {
	private functions: Map<string, IPharmaFunction> = new Map()
	private maxRetries: number = 3
	private baseDelay: number = 2000

	constructor() {
		// Register default functions
		this.registerFunction(new DrugInfoFunction())
		this.registerFunction(new RegulatoryInfoFunction())
		this.registerFunction(new ClinicalDataFunction())
		this.registerFunction(new ManufacturingInfoFunction())
		this.registerFunction(new SafetyDataFunction())
	}

	/**
	 * Registers a new pharma function handler
	 */
	registerFunction(func: IPharmaFunction): void {
		this.functions.set(func.name, func)
	}

	/**
	 * Fetches all available pharma data for a drug
	 */
	async fetchAllData(drugName: string): Promise<PharmaDataResult> {
		const result: PharmaDataResult = {
			errors: [],
		}

		// Execute all functions in parallel with error handling
		const promises = [
			this.executeWithRetry("drugInfo", drugName),
			this.executeWithRetry("regulatoryInfo", drugName),
			this.executeWithRetry("clinicalData", drugName),
			this.executeWithRetry("manufacturingInfo", drugName),
			this.executeWithRetry("safetyData", drugName),
		]

		const results = await Promise.allSettled(promises)

		if (results[0].status === "fulfilled") result.drugInfo = results[0].value
		else result.errors.push(`Drug info: ${results[0].reason}`)

		if (results[1].status === "fulfilled") result.regulatoryInfo = results[1].value
		else result.errors.push(`Regulatory info: ${results[1].reason}`)

		if (results[2].status === "fulfilled") result.clinicalData = results[2].value
		else result.errors.push(`Clinical data: ${results[2].reason}`)

		if (results[3].status === "fulfilled") result.manufacturingInfo = results[3].value
		else result.errors.push(`Manufacturing info: ${results[3].reason}`)

		if (results[4].status === "fulfilled") result.safetyData = results[4].value
		else result.errors.push(`Safety data: ${results[4].reason}`)

		return result
	}

	/**
	 * Executes a function with retry logic
	 */
	private async executeWithRetry(funcName: string, drugName: string): Promise<string> {
		const func = this.functions.get(funcName)
		if (!func) {
			throw new Error(`Function ${funcName} not registered`)
		}

		let lastError: Error | null = null

		for (let attempt = 0; attempt < this.maxRetries; attempt++) {
			try {
				return await func.execute(drugName)
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error))

				// Check if it's a rate limit error
				if (this.isRateLimitError(error)) {
					const delay = this.parseRetryDelay(lastError.message) || this.baseDelay * 2 ** attempt
					console.log(`[PharmaDataService] Rate limit hit for ${funcName}, waiting ${delay}ms`)
					await this.sleep(delay)
				} else if (attempt < this.maxRetries - 1) {
					// Non-rate-limit error, still retry with backoff
					const delay = this.baseDelay * 2 ** attempt
					await this.sleep(delay)
				}
			}
		}

		throw lastError || new Error(`Failed to execute ${funcName} after ${this.maxRetries} retries`)
	}

	/**
	 * Checks if an error is a rate limit error
	 */
	private isRateLimitError(error: unknown): boolean {
		if (!error) return false
		const message = String(error).toLowerCase()
		return message.includes("429") || message.includes("rate limit") || message.includes("too many requests")
	}

	/**
	 * Parses retry delay from error message
	 */
	private parseRetryDelay(message: string): number | null {
		const match = message.match(/try again in ([\d.]+)s/i)
		if (match) {
			return Math.ceil(parseFloat(match[1]) * 1000)
		}
		return null
	}

	/**
	 * Sleep for a given duration
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * Formats all pharma data as a single context string
	 */
	formatAsContext(data: PharmaDataResult): string {
		const parts: string[] = []

		parts.push(`<pharma_data>`)

		if (data.drugInfo) {
			parts.push(`<drug_information>`)
			parts.push(data.drugInfo)
			parts.push(`</drug_information>`)
		}

		if (data.regulatoryInfo) {
			parts.push(`<regulatory_information>`)
			parts.push(data.regulatoryInfo)
			parts.push(`</regulatory_information>`)
		}

		if (data.clinicalData) {
			parts.push(`<clinical_data>`)
			parts.push(data.clinicalData)
			parts.push(`</clinical_data>`)
		}

		if (data.manufacturingInfo) {
			parts.push(`<manufacturing_information>`)
			parts.push(data.manufacturingInfo)
			parts.push(`</manufacturing_information>`)
		}

		if (data.safetyData) {
			parts.push(`<safety_data>`)
			parts.push(data.safetyData)
			parts.push(`</safety_data>`)
		}

		if (data.errors.length > 0) {
			parts.push(`<data_fetch_errors>`)
			parts.push(data.errors.join("\n"))
			parts.push(`</data_fetch_errors>`)
		}

		parts.push(`</pharma_data>`)

		return parts.join("\n")
	}
}

// ============================================================================
// Individual Pharma Function Implementations
// ============================================================================

/**
 * Drug Information Function (Function1)
 * Fetches drug info from PubChem and Europe PMC
 */
class DrugInfoFunction implements IPharmaFunction {
	name = "drugInfo"
	description = "Fetches drug information including active ingredient, therapeutic classification, and indications"

	async execute(drugName: string): Promise<string> {
		try {
			const cid = await this.getCIDFromName(drugName)
			if (!cid) {
				return `Drug Information: Could not find compound information for "${drugName}"`
			}

			const [properties, pugViewData] = await Promise.all([this.getCompoundProperties(cid), this.getPUGViewData(cid)])

			return `Drug Information for: ${drugName}
Active Ingredient: ${properties.iupac || drugName}
Molecular Formula: ${properties.formula || "N/A"}
Molecular Weight: ${properties.weight || "N/A"}
Therapeutic Classification: ${pugViewData.therapeutic?.slice(0, 3).join("; ") || "N/A"}
Indications: ${pugViewData.indications?.slice(0, 3).join("; ") || "N/A"}`
		} catch (error) {
			return `Drug Information: Error fetching data - ${error instanceof Error ? error.message : "Unknown error"}`
		}
	}

	private async getCIDFromName(drugName: string): Promise<number | null> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(drugName)}/cids/json`
			const response = await fetch(url)
			if (!response.ok) return null
			const data = await response.json()
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
			const data = await response.json()
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

	private async getPUGViewData(cid: number): Promise<{ therapeutic?: string[]; indications?: string[] }> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/json`
			const response = await fetch(url)
			if (!response.ok) return {}
			const data = await response.json()

			const therapeutic = this.extractSection(data, "Pharmacology")
			const indications = this.extractSection(data, "Drug and Medication")

			return { therapeutic, indications }
		} catch {
			return {}
		}
	}

	private extractSection(data: any, heading: string): string[] {
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
			}
		}
		return results.slice(0, 5)
	}
}

/**
 * Regulatory Information Function (Function2)
 */
class RegulatoryInfoFunction implements IPharmaFunction {
	name = "regulatoryInfo"
	description = "Fetches regulatory compliance information from literature"

	async execute(drugName: string): Promise<string> {
		try {
			const searchQuery = `(${drugName}) AND (FDA OR approval OR NDA OR regulatory)`
			const results = await this.searchEuropePMC(searchQuery, 10)

			if (results.length === 0) {
				return `Regulatory Information: No regulatory data found in open literature for "${drugName}"`
			}

			const extractedInfo = this.extractRegulatoryInfo(results.join(" "))

			return `Regulatory Information for: ${drugName}
Approval Status: ${extractedInfo.approvalStatus || "N/A"}
Regulatory Pathway: ${extractedInfo.regulatoryPathway || "N/A"}
GMP Compliance: ${extractedInfo.gmpCompliance || "N/A"}
Relevant Literature: ${results.slice(0, 3).join("; ").substring(0, 500)}`
		} catch (error) {
			return `Regulatory Information: Error - ${error instanceof Error ? error.message : "Unknown error"}`
		}
	}

	private async searchEuropePMC(query: string, pageSize: number): Promise<string[]> {
		try {
			const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&pageSize=${pageSize}&format=json`
			const response = await fetch(url)
			if (!response.ok) return []
			const data = await response.json()
			return data.resultList?.result?.map((r: any) => r.title ?? "").filter(Boolean) ?? []
		} catch {
			return []
		}
	}

	private extractRegulatoryInfo(text: string): { approvalStatus?: string; regulatoryPathway?: string; gmpCompliance?: string } {
		const lowerText = text.toLowerCase()
		const info: any = {}

		if (lowerText.includes("approved")) info.approvalStatus = "Approved"
		else if (lowerText.includes("pending")) info.approvalStatus = "Pending"

		if (lowerText.includes("nda")) info.regulatoryPathway = "NDA"
		else if (lowerText.includes("anda")) info.regulatoryPathway = "ANDA"

		if (lowerText.includes("gmp") && lowerText.includes("compliant")) info.gmpCompliance = "Yes"

		return info
	}
}

/**
 * Clinical Data Function (Function3)
 */
class ClinicalDataFunction implements IPharmaFunction {
	name = "clinicalData"
	description = "Fetches clinical trial data from literature"

	async execute(drugName: string): Promise<string> {
		try {
			const searchQuery = `(${drugName}) AND (clinical trial OR phase OR endpoint)`
			const results = await this.searchEuropePMC(searchQuery, 10)

			if (results.length === 0) {
				return `Clinical Data: No clinical trial data found in open literature for "${drugName}"`
			}

			const extractedInfo = this.extractTrialInfo(results.join(" "))

			return `Clinical Trial Data for: ${drugName}
Trial Phase: ${extractedInfo.phase || "N/A"}
Status: ${extractedInfo.status || "N/A"}
Primary Endpoint: ${extractedInfo.primaryEndpoint || "N/A"}
Relevant Studies: ${results.slice(0, 3).join("; ").substring(0, 500)}`
		} catch (error) {
			return `Clinical Data: Error - ${error instanceof Error ? error.message : "Unknown error"}`
		}
	}

	private async searchEuropePMC(query: string, pageSize: number): Promise<string[]> {
		try {
			const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&pageSize=${pageSize}&format=json`
			const response = await fetch(url)
			if (!response.ok) return []
			const data = await response.json()
			return data.resultList?.result?.map((r: any) => r.title ?? "").filter(Boolean) ?? []
		} catch {
			return []
		}
	}

	private extractTrialInfo(text: string): { phase?: string; status?: string; primaryEndpoint?: string } {
		const lowerText = text.toLowerCase()
		const info: any = {}

		if (lowerText.includes("phase iii")) info.phase = "Phase III"
		else if (lowerText.includes("phase ii")) info.phase = "Phase II"
		else if (lowerText.includes("phase i")) info.phase = "Phase I"

		if (lowerText.includes("completed")) info.status = "Completed"
		else if (lowerText.includes("recruiting")) info.status = "Recruiting"

		const endpointMatch = text.match(/primary endpoint[:\s]+([^.]+)/i)
		if (endpointMatch) info.primaryEndpoint = endpointMatch[1].trim().substring(0, 100)

		return info
	}
}

/**
 * Manufacturing Information Function (Function4)
 */
class ManufacturingInfoFunction implements IPharmaFunction {
	name = "manufacturingInfo"
	description = "Fetches manufacturing and quality control information"

	async execute(drugName: string): Promise<string> {
		try {
			const searchQuery = `(${drugName}) AND (manufacturing OR GMP OR quality control)`
			const results = await this.searchEuropePMC(searchQuery, 10)

			const extractedInfo = this.extractManufacturingInfo(results.join(" "))

			return `Manufacturing Information for: ${drugName}
Manufacturing Process: ${extractedInfo.process || "Information from proprietary sources required"}
Quality Specifications: ${extractedInfo.specs || "Refer to product specifications"}
Storage Conditions: ${extractedInfo.storage || "Refer to product labeling"}
Relevant Literature: ${results.slice(0, 2).join("; ").substring(0, 300)}`
		} catch (error) {
			return `Manufacturing Information: Error - ${error instanceof Error ? error.message : "Unknown error"}`
		}
	}

	private async searchEuropePMC(query: string, pageSize: number): Promise<string[]> {
		try {
			const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&pageSize=${pageSize}&format=json`
			const response = await fetch(url)
			if (!response.ok) return []
			const data = await response.json()
			return data.resultList?.result?.map((r: any) => r.title ?? "").filter(Boolean) ?? []
		} catch {
			return []
		}
	}

	private extractManufacturingInfo(text: string): { process?: string; specs?: string; storage?: string } {
		const info: any = {}

		const processMatch = text.match(/manufacturing process[:\s]+([^.]+)/i)
		if (processMatch) info.process = processMatch[1].trim().substring(0, 200)

		const storageMatch = text.match(/storage[:\s]+([^.]+)/i)
		if (storageMatch) info.storage = storageMatch[1].trim().substring(0, 100)

		return info
	}
}

/**
 * Safety Data Function (Function5)
 */
class SafetyDataFunction implements IPharmaFunction {
	name = "safetyData"
	description = "Fetches safety and pharmacovigilance data"

	async execute(drugName: string): Promise<string> {
		try {
			const cid = await this.getCIDFromName(drugName)
			let toxicityInfo: string[] = []

			if (cid) {
				toxicityInfo = await this.getToxicityData(cid)
			}

			const searchQuery = `(${drugName}) AND (adverse event OR safety OR side effect)`
			const results = await this.searchEuropePMC(searchQuery, 10)

			const extractedInfo = this.extractSafetyInfo(results.join(" "))

			return `Safety and Pharmacovigilance Data for: ${drugName}
Safety Profile: ${extractedInfo.safetyProfile || "Refer to product labeling"}
Common Adverse Events: ${extractedInfo.adverseEvents || "Refer to prescribing information"}
Contraindications: ${extractedInfo.contraindications || "Refer to prescribing information"}
Drug Interactions: ${extractedInfo.interactions || "Refer to prescribing information"}
Toxicity Data: ${toxicityInfo.slice(0, 2).join("; ").substring(0, 300) || "Refer to toxicology studies"}`
		} catch (error) {
			return `Safety Data: Error - ${error instanceof Error ? error.message : "Unknown error"}`
		}
	}

	private async getCIDFromName(drugName: string): Promise<number | null> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(drugName)}/cids/json`
			const response = await fetch(url)
			if (!response.ok) return null
			const data = await response.json()
			return data.IdentifierList?.CID?.[0] ?? null
		} catch {
			return null
		}
	}

	private async getToxicityData(cid: number): Promise<string[]> {
		try {
			const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/json`
			const response = await fetch(url)
			if (!response.ok) return []
			const data = await response.json()

			const results: string[] = []
			const sections = data.Record?.Section ?? []
			for (const section of sections) {
				if (section.TOCHeading?.toLowerCase().includes("toxicity")) {
					if (section.Description) results.push(section.Description)
				}
			}
			return results
		} catch {
			return []
		}
	}

	private async searchEuropePMC(query: string, pageSize: number): Promise<string[]> {
		try {
			const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&pageSize=${pageSize}&format=json`
			const response = await fetch(url)
			if (!response.ok) return []
			const data = await response.json()
			return data.resultList?.result?.map((r: any) => r.title ?? "").filter(Boolean) ?? []
		} catch {
			return []
		}
	}

	private extractSafetyInfo(text: string): {
		safetyProfile?: string
		adverseEvents?: string
		contraindications?: string
		interactions?: string
	} {
		const lowerText = text.toLowerCase()
		const info: any = {}

		if (lowerText.includes("well-tolerated")) info.safetyProfile = "Generally well-tolerated"
		else if (lowerText.includes("safety")) info.safetyProfile = "Safety profile established"

		const aeMatch = text.match(/adverse event[:\s]+([^.]+)/i)
		if (aeMatch) info.adverseEvents = aeMatch[1].trim().substring(0, 150)

		const contraMatch = text.match(/contraindication[:\s]+([^.]+)/i)
		if (contraMatch) info.contraindications = contraMatch[1].trim().substring(0, 150)

		const interactionMatch = text.match(/drug interaction[:\s]+([^.]+)/i)
		if (interactionMatch) info.interactions = interactionMatch[1].trim().substring(0, 150)

		return info
	}
}
