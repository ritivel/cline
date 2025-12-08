import { buildApiHandler } from "@core/api"
import * as fs from "fs"
import * as path from "path"
import { StateManager } from "@/core/storage/StateManager"
import { DossierTagsService } from "./DossierTagsService"

/**
 * CTD Module Classification Prompts from placement_classifier.py
 */
const SECTION_MATCH_PROMPT = `You are a Regulatory Affairs classifier for generic drug submissions (ANDA / EU Generic MAA).
Given a file description, classify the document into the correct CTD Module:
| Module       | Purpose                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Module 1** | Regional administrative + labeling                                                                                 |
| **Module 2** | High-level overviews + summaries (usually does not require any files but only uses the other generated sections)   |
| **Module 3** | Quality / CMC (drug substance + product)                                                                           |
| **Module 4** | Nonclinical study reports (usually not required in ANDA)                                                           |
| **Module 5** | Clinical + bioequivalence + literature                                                                             |

Rules:
- If the document contains manufacturing, specifications, stability, or analytical validation → Module 3
- If it is bioequivalence, PK/BA study, clinical literature → Module 5
- If it is labeling, legal certificates, forms, correspondence → Module 1
- If it is clinical / nonclinical summaries → Module 2
- If unclear, choose the most likely module and state Low confidence

Output format (JSON):
{
  "module": "1" | "3" | "5",
  "confidence": "High" | "Medium" | "Low"
}`

const MODULE5_SUBSECTION_PROMPT = `You are a Regulatory Affairs classifier specialized in Module 5 of CTD for generic drug submissions (ANDA / EU Generics).

Given a file description that has already been identified as Module 5, classify it into one or more of the following subsections:

Subsection | Meaning                           | Typical Generic Content
---------- | --------------------------------- | -----------------------
5.1       | Table of Contents                 | eCTD publisher-generated index only (rarely used for specific files)
5.2       | Tabular Listing of All Clinical Studies | Study lists, BE study tables
5.3       | Clinical Study Reports            | BE/BA Reports, Clinical Protocols, PK Reports, Literature References (5.3.7 in EU)

Rules:
Bioequivalence/BA study reports → 5.3
Study protocols, amendments, synopses → 5.3
Tabular/structured listings of studies → 5.2
Clinical literature references → 5.3 (in many regions specifically 5.3.7, but classify under 5.3 for this level)
If description does not clearly match a subsection, choose the most likely and mark Low confidence

Output format (JSON)
{
  "subsections": [
    {
      "section": "5.1" | "5.2" | "5.3",
      "confidence": "High" | "Medium" | "Low"
    }
  ]
}`

const MODULE53_SUBSECTION_PROMPT = `You are a Regulatory Affairs classifier specialized in **Module 5.3 of the ICH CTD** (Clinical Study Reports).

Given a **file description** for a document that is already known to belong in **Section 5.3**, classify it into only one of the following **subsections**:

| Section | Title                                                                     |
| ------- | ------------------------------------------------------------------------- |
| 5.3.1   | Reports of Biopharmaceutic Studies                                        |
| 5.3.2   | Reports of Studies Pertinent to Pharmacokinetics Using Human Biomaterials |
| 5.3.3   | Reports of Human Pharmacokinetic (PK) Studies                             |
| 5.3.4   | Reports of Human Pharmacodynamic (PD) Studies                             |
| 5.3.5   | Reports of Efficacy and Safety Studies                                    |
| 5.3.6   | Reports of Post-Marketing Experience if Available                         |
| 5.3.7   | Case Report Forms and Individual Patient Listings                         |

Classification Rules:
1. 5.3.1 – Reports of Biopharmaceutic Studies: BA/BE study reports, in vitro biopharmaceutic studies
2. 5.3.2 – Human Biomaterials: Studies using human liver microsomes, hepatocytes
3. 5.3.3 – Human PK Studies: Single/multiple dose PK, ADME, population PK
4. 5.3.4 – Human PD Studies: PD-only or PK/PD studies with PD focus
5. 5.3.5 – Efficacy and Safety: Phase 2/3 trials, efficacy/safety studies
6. 5.3.6 – Post-Marketing: Post-marketing surveillance, observational studies
7. 5.3.7 – CRFs: Case report forms, individual patient listings

Output format (JSON):
{
  "section": "5.3.1",
  "confidence": "High" | "Medium" | "Low"
}`

const MODULE1_SUBSECTION_PROMPT = `You are a Regulatory Affairs classifier specialized in **Module 1** of the ICH CTD.

Given a document description, classify it into exactly **one** of the Module 1 subsections below:

| Section  | Title                                                     |
| -------- | --------------------------------------------------------- |
| **1.1**  | Comprehensive Table of Contents for all Modules           |
| **1.2**  | Cover Letter                                              |
| **1.3**  | Comprehensive Table of Contents                           |
| **1.4**  | Quality Information Summary (QIS)                         |
| **1.5**  | Product Information                                       |
| **1.6**  | Information about the Experts                             |
| **1.7**  | APIMFs and CEPs (Certificates of Suitability to Ph. Eur.) |
| **1.8**  | Good Manufacturing Practice (GMP)                         |
| **1.9**  | Regulatory Status within EAC and Countries with SRAs      |
| **1.10** | Paediatric Development Program                            |
| **1.11** | Product Samples                                           |
| **1.12** | Requirement for Submission of Risk Mitigation Plan        |
| **1.13** | Submission of Risk Management Plan (RMP)                  |

Classification Rules:
* Cover letters or administrative correspondence → 1.2
* Labeling and product information (SmPC, PIL, carton labels) → 1.5
* Expert CVs/certifications → 1.6
* GMP certificates, manufacturing site compliance → 1.8
* APIMF/DMF / Ph. Eur. CEP documentation → 1.7
* Risk management plans → 1.13

Output format (JSON):
{
  "section": "1.x",
  "confidence": "High" | "Medium" | "Low"
}`

const MODULE3_SUBSECTION_PROMPT = `You are an expert in ICH CTD Module 3 documentation. Given a file name and optional description, determine the single best primary placement section in Module 3 where this file should be stored.

Allowed sections: "3.2.S", "3.2.P", "3.2.R", "3.3"

Rules:
- 3.2.S = API-related
- 3.2.P = FPP-related
- 3.2.R = Regional or executed docs
- 3.3   = Literature
- Only one section allowed.

Output must be valid JSON:
{
  "section": "3.2.S" | "3.2.P" | "3.2.R" | "3.3",
  "reason": "<1-2 line justification>",
  "confidence": "High" | "Medium" | "Low"
}`

const MODULE32S_SUBSECTION_PROMPT = `You are an expert in CTD Module 3.2.S (Drug Substance).

Determine the single best subsection in 3.2.S where this file strictly belongs.

Allowed Subsections:
- 3.2.S.1: General Info (Nomenclature, Structure, General Properties)
- 3.2.S.2: Manufacture (Manufacturers, Process, Materials, Controls, Validation)
- 3.2.S.3: Characterization (Structure Elucidation, Impurity Profiling)
- 3.2.S.4: Control of Drug Substance (Specification, Analytical Procedures, Validation, Batch Analyses)
- 3.2.S.5: Reference Standards
- 3.2.S.6: Container Closure System
- 3.2.S.7: Stability

Output valid JSON:
{
  "subsection": "3.2.S.x",
  "reason": "<Specific ICH logic>",
  "confidence": "High" | "Medium" | "Low"
}`

const MODULE32P_SUBSECTION_PROMPT = `You are an expert in CTD Module 3.2.P (Drug Product).

Determine the single best subsection in 3.2.P for primary placement.

Allowed Subsections:
- 3.2.P.1: Description & Composition
- 3.2.P.2: Pharmaceutical Development
- 3.2.P.3: Manufacture (Batch Formula, Process, Controls, Validation)
- 3.2.P.4: Control of Excipients
- 3.2.P.5: Control of Drug Product (Specs, Methods, Validation, Batch Analysis)
- 3.2.P.6: Reference Standards
- 3.2.P.7: Container Closure
- 3.2.P.8: Stability

Output valid JSON:
{
  "subsection": "3.2.P.x",
  "reason": "<Explain based on document intent>",
  "confidence": "High" | "Medium" | "Low"
}`

// =====================================================
// REFERENCE CLASSIFICATION PROMPTS (Multi-choice)
// =====================================================

const MODULE_REFERENCE_PROMPT = `You are a Regulatory Affairs classifier for generic drug submissions (ANDA / EU Generic MAA).
Given a file description, determine ALL CTD Modules where this file might be referenced or used.

IMPORTANT: Select MULTIPLE modules if the file is referenced in multiple areas.

Output format (JSON):
{
  "modules": [
    { "module": "1" | "2" | "3" | "4" | "5", "confidence": "High" | "Medium" | "Low" }
  ]
}

Return ALL applicable modules, not just one.`

const MODULE1_REFERENCE_SUBSECTIONS_PROMPT = `You are a Regulatory Affairs classifier specialized in Module 1 of the ICH CTD.
Determine ALL Module 1 subsections where this file will be referenced or used.

IMPORTANT: Select MULTIPLE sections if the file contributes to multiple areas.

| Section  | Title                                                     |
| -------- | --------------------------------------------------------- |
| 1.1-1.13 | Various administrative and regulatory sections            |

Output format (JSON):
{
  "sections": [
    { "section": "1.x", "confidence": "High" | "Medium" | "Low" }
  ]
}

Return ALL applicable sections.`

const MODULE2_REFERENCE_SUBSECTIONS_PROMPT = `You are a Regulatory Affairs classifier specialized in Module 2 of the ICH CTD (Summaries).
Determine ALL Module 2 subsections where this file will be referenced or used.

IMPORTANT: Select MULTIPLE subsections if the file supports multiple summary areas.

| Section | Title                                          |
| ------- | ---------------------------------------------- |
| 2.3     | Quality Overall Summary (QOS)                  |
| 2.5     | Clinical Overview                              |
| 2.7     | Clinical Summary                               |

Output format (JSON):
{
  "sections": [
    { "section": "2.x", "confidence": "High" | "Medium" | "Low" }
  ]
}

Return ALL applicable sections.`

const MODULE3_REFERENCE_SUBSECTIONS_PROMPT = `You are an expert in ICH CTD Module 3 documentation.
Determine ALL Module 3 sections where this file will be used or referenced.

IMPORTANT: Select MULTIPLE sections if the file serves multiple purposes.

Allowed sections: "3.2.S", "3.2.P", "3.2.R", "3.3"

Output format (JSON):
{
  "sections": [
    { "section": "3.2.S" | "3.2.P" | "3.2.R" | "3.3", "confidence": "High" | "Medium" | "Low" }
  ]
}

Return ALL applicable sections.`

const MODULE32S_REFERENCE_SUBSECTIONS_PROMPT = `You are an expert in CTD Module 3.2.S (Drug Substance).
Determine ALL 3.2.S subsections where this file contributes data or is referenced.

IMPORTANT: Select MULTIPLE subsections if the file serves multiple purposes.

Allowed: 3.2.S.1 - 3.2.S.7

Output format (JSON):
{
  "sections": [
    { "subsection": "3.2.S.x", "confidence": "High" | "Medium" | "Low" }
  ]
}

Return ALL applicable subsections.`

const MODULE32P_REFERENCE_SUBSECTIONS_PROMPT = `You are an expert in CTD Module 3.2.P (Drug Product).
Determine ALL 3.2.P subsections where this file contributes data or is referenced.

IMPORTANT: Select MULTIPLE subsections if the file serves multiple purposes.

Allowed: 3.2.P.1 - 3.2.P.8

Output format (JSON):
{
  "sections": [
    { "subsection": "3.2.P.x", "confidence": "High" | "Medium" | "Low" }
  ]
}

Return ALL applicable subsections.`

const MODULE5_REFERENCE_SUBSECTIONS_PROMPT = `You are a Regulatory Affairs classifier specialized in Module 5 of CTD.
Determine ALL Module 5 subsections where this file will be referenced or used.

IMPORTANT: Select MULTIPLE subsections if the file is referenced in multiple areas.

Subsections: 5.1, 5.2, 5.3

Output format (JSON):
{
  "subsections": [
    { "section": "5.1" | "5.2" | "5.3", "confidence": "High" | "Medium" | "Low" }
  ]
}

Return ALL applicable subsections.`

const MODULE53_REFERENCE_SUBSECTIONS_PROMPT = `You are a Regulatory Affairs classifier specialized in Module 5.3 of the ICH CTD.
Determine ALL 5.3.x subsections where this file will be referenced or used.

IMPORTANT: Select MULTIPLE subsections if the file is referenced in multiple study types.

Subsections: 5.3.1 - 5.3.7

Output format (JSON):
{
  "subsections": [
    { "section": "5.3.x", "confidence": "High" | "Medium" | "Low" }
  ]
}

Return ALL applicable subsections.`

interface CtdClassification {
	module: string
	placement_section: string | null
	confidence: string
	classified_at: string
}

interface CtdReferenceClassification {
	reference_sections: string[]
	confidence_map: Record<string, string>
	modules: string[]
	classified_at: string
}

interface InfoJsonMetadata {
	source_of_file: string
	dossier_summary: string
	filepath: string
	processed_at: string
}

// Placeholder values that indicate classification should be skipped
const CLASSIFICATION_PLACEHOLDER_VALUES = ["Unknown - Classification failed", "Unable to classify", "Not determined"]

// Valid module numbers
const VALID_MODULES = ["1", "2", "3", "4", "5"]

// Regex patterns to extract classification data from classification.txt
const CLASSIFICATION_PATTERNS = {
	module: /Module:\s*(\d)/,
	placementSection: /Placement Section:\s*([^\n]+)/,
	referenceSections: /Reference Sections:\s*\n([\s\S]*?)(?=\n\n|METADATA|$)/,
	confidence: /Confidence:\s*(High|Medium|Low)/i,
}

/**
 * Service for classifying extracted PDF documents into CTD modules and sections
 */
export class CtdClassifierService {
	/**
	 * Builds a file description from metadata for the LLM classifier
	 */
	private buildFileDescription(metadata: InfoJsonMetadata, folderName: string): string {
		const parts: string[] = []

		parts.push(`File path in dossier: ${metadata.filepath || folderName}`)

		if (metadata.source_of_file) {
			parts.push(`Source of file: ${metadata.source_of_file}`)
		}

		if (metadata.dossier_summary) {
			parts.push(`Dossier summary: ${metadata.dossier_summary}`)
		}

		return parts.join("\n").trim()
	}

	/**
	 * Calls Cline's configured LLM with a prompt
	 */
	private async callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
		try {
			const stateManager = StateManager.get()
			const apiConfiguration = stateManager.getApiConfiguration()
			const currentMode = "act"
			const apiHandler = buildApiHandler(apiConfiguration, currentMode)

			const messages = [{ role: "user" as const, content: userPrompt }]
			const stream = apiHandler.createMessage(systemPrompt, messages)

			let response = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					response += chunk.text
				}
			}

			return response
		} catch (error) {
			console.error("LLM call failed:", error)
			throw error
		}
	}

	/**
	 * Parses JSON from LLM response
	 */
	private parseJsonResponse<T>(response: string, defaultValue: T): T {
		try {
			const jsonMatch = response.match(/\{[\s\S]*\}/)
			if (!jsonMatch) {
				return defaultValue
			}
			return JSON.parse(jsonMatch[0])
		} catch {
			return defaultValue
		}
	}

	/**
	 * Classifies a file into a CTD module (1-5)
	 */
	private async classifyModule(description: string): Promise<{ module: string; confidence: string }> {
		const userPrompt = `Classify this file into one CTD Module (1–5).
Return ONLY a JSON object exactly in this shape:
{ "module": "1" | "3" | "5", "confidence": "High" | "Medium" | "Low" }

File description:
${description}`

		const response = await this.callLlm(SECTION_MATCH_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ module?: string; confidence?: string }>(response, {})

		const allowedModules = ["1", "2", "3", "4", "5"]
		let module = String(result.module || "").trim()
		if (!allowedModules.includes(module)) {
			module = "5"
		}

		return {
			module,
			confidence: result.confidence || "Low",
		}
	}

	/**
	 * Classifies Module 1 file into subsection
	 */
	private async classifyModule1Subsection(description: string): Promise<{ section: string; confidence: string }> {
		const userPrompt = `This file has already been classified as Module 1.
Classify it into exactly one Module 1 subsection.
Return ONLY a JSON object exactly in this shape:
{ "section": "1.x", "confidence": "High" | "Medium" | "Low" }

File description:
${description}`

		const response = await this.callLlm(MODULE1_SUBSECTION_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ section?: string; confidence?: string }>(response, {})

		const allowedSections = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "1.11", "1.12", "1.13"]
		let section = String(result.section || "").trim()
		if (!allowedSections.includes(section)) {
			section = "1.5"
		}

		return {
			section,
			confidence: result.confidence || "Low",
		}
	}

	/**
	 * Classifies Module 3 file into subsection
	 */
	private async classifyModule3Subsection(description: string): Promise<{ section: string; confidence: string }> {
		const userPrompt = `This file has already been classified as CTD Module 3.
Classify it into exactly one Module 3 placement section.
Return ONLY a JSON object exactly in this shape:
{ "section": "3.2.S" | "3.2.P" | "3.2.R" | "3.3", "reason": "<1-2 line justification>", "confidence": "High" | "Medium" | "Low" }

File description:
${description}`

		const response = await this.callLlm(MODULE3_SUBSECTION_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ section?: string; confidence?: string }>(response, {})

		const allowedSections = ["3.2.S", "3.2.P", "3.2.R", "3.3"]
		let section = String(result.section || "").trim()
		if (!allowedSections.includes(section)) {
			section = "3.2.P"
		}

		return {
			section,
			confidence: result.confidence || "Low",
		}
	}

	/**
	 * Classifies 3.2.S file into deeper subsection
	 */
	private async classifyModule32SSubsection(description: string): Promise<{ subsection: string; confidence: string }> {
		const userPrompt = `This file has already been classified as CTD Module 3.2.S.
Classify it into exactly one 3.2.S.x subsection.
Return ONLY a JSON object exactly in this shape:
{ "subsection": "3.2.S.1" | "3.2.S.2" | "3.2.S.3" | "3.2.S.4" | "3.2.S.5" | "3.2.S.6" | "3.2.S.7", "reason": "<reason>", "confidence": "High" | "Medium" | "Low" }

File description:
${description}`

		const response = await this.callLlm(MODULE32S_SUBSECTION_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ subsection?: string; confidence?: string }>(response, {})

		const allowedSubsections = ["3.2.S.1", "3.2.S.2", "3.2.S.3", "3.2.S.4", "3.2.S.5", "3.2.S.6", "3.2.S.7"]
		let subsection = String(result.subsection || "").trim()
		if (!allowedSubsections.includes(subsection)) {
			subsection = "3.2.S.4"
		}

		return {
			subsection,
			confidence: result.confidence || "Low",
		}
	}

	/**
	 * Classifies 3.2.P file into deeper subsection
	 */
	private async classifyModule32PSubsection(description: string): Promise<{ subsection: string; confidence: string }> {
		const userPrompt = `This file has already been classified as CTD Module 3.2.P.
Classify it into exactly one 3.2.P.x subsection.
Return ONLY a JSON object exactly in this shape:
{ "subsection": "3.2.P.1" | "3.2.P.2" | "3.2.P.3" | "3.2.P.4" | "3.2.P.5" | "3.2.P.6" | "3.2.P.7" | "3.2.P.8", "reason": "<reason>", "confidence": "High" | "Medium" | "Low" }

File description:
${description}`

		const response = await this.callLlm(MODULE32P_SUBSECTION_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ subsection?: string; confidence?: string }>(response, {})

		const allowedSubsections = ["3.2.P.1", "3.2.P.2", "3.2.P.3", "3.2.P.4", "3.2.P.5", "3.2.P.6", "3.2.P.7", "3.2.P.8"]
		let subsection = String(result.subsection || "").trim()
		if (!allowedSubsections.includes(subsection)) {
			subsection = "3.2.P.3"
		}

		return {
			subsection,
			confidence: result.confidence || "Low",
		}
	}

	/**
	 * Classifies Module 5 file into subsection
	 */
	private async classifyModule5Subsection(
		description: string,
	): Promise<{ subsections: Array<{ section: string; confidence: string }> }> {
		const userPrompt = `This file has already been classified as Module 5.
Classify it into one or more Module 5 subsections.
Return ONLY a JSON object exactly in this shape:
{ "subsections": [ { "section": "5.1" | "5.2" | "5.3", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE5_SUBSECTION_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ subsections?: Array<{ section?: string; confidence?: string }> }>(response, {
			subsections: [],
		})

		const allowedSections = ["5.1", "5.2", "5.3"]
		const normalized: Array<{ section: string; confidence: string }> = []

		for (const item of result.subsections || []) {
			const section = String(item.section || "").trim()
			if (allowedSections.includes(section)) {
				normalized.push({
					section,
					confidence: item.confidence || "Low",
				})
			}
		}

		return { subsections: normalized }
	}

	/**
	 * Classifies 5.3 file into deeper subsection
	 */
	private async classifyModule53Subsection(description: string): Promise<{ section: string; confidence: string }> {
		const userPrompt = `This file has already been classified as CTD Module 5.3 (Clinical Study Reports).
Classify it into one 5.3.x subsection.
Return ONLY a JSON object exactly in this shape:
{ "section": "5.3.1" | "5.3.2" | "5.3.3" | "5.3.4" | "5.3.5" | "5.3.6" | "5.3.7", "confidence": "High" | "Medium" | "Low" }

File description:
${description}`

		const response = await this.callLlm(MODULE53_SUBSECTION_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ section?: string; confidence?: string }>(response, {})

		const allowedSections = ["5.3.1", "5.3.2", "5.3.3", "5.3.4", "5.3.5", "5.3.6", "5.3.7"]
		let section = String(result.section || "").trim()
		if (!allowedSections.includes(section)) {
			section = "5.3.1"
		}

		return {
			section,
			confidence: result.confidence || "Low",
		}
	}

	/**
	 * Full classification pipeline - classifies a file to the most specific CTD section
	 */
	async classifyFile(metadata: InfoJsonMetadata, folderName: string): Promise<CtdClassification> {
		const description = this.buildFileDescription(metadata, folderName)

		if (!description) {
			return {
				module: "5",
				placement_section: null,
				confidence: "Low",
				classified_at: new Date().toISOString(),
			}
		}

		// Step 1: Classify module
		const moduleResult = await this.classifyModule(description)
		const module = moduleResult.module
		let placementSection: string | null = null
		let confidence = moduleResult.confidence

		// Step 2: Classify subsection based on module
		if (module === "1") {
			const m1 = await this.classifyModule1Subsection(description)
			placementSection = m1.section
			confidence = m1.confidence
		} else if (module === "3") {
			const m3 = await this.classifyModule3Subsection(description)
			placementSection = m3.section

			// Further classify 3.2.S or 3.2.P
			if (m3.section === "3.2.S") {
				const m32s = await this.classifyModule32SSubsection(description)
				placementSection = m32s.subsection
				confidence = m32s.confidence
			} else if (m3.section === "3.2.P") {
				const m32p = await this.classifyModule32PSubsection(description)
				placementSection = m32p.subsection
				confidence = m32p.confidence
			} else {
				confidence = m3.confidence
			}
		} else if (module === "5") {
			const m5 = await this.classifyModule5Subsection(description)
			if (m5.subsections.length > 0) {
				placementSection = m5.subsections[0].section
				confidence = m5.subsections[0].confidence

				// If 5.3, further classify
				if (placementSection === "5.3") {
					const m53 = await this.classifyModule53Subsection(description)
					placementSection = m53.section
					confidence = m53.confidence
				}
			}
		}

		return {
			module,
			placement_section: placementSection,
			confidence,
			classified_at: new Date().toISOString(),
		}
	}

	// =====================================================
	// REFERENCE CLASSIFICATION METHODS (Multi-choice)
	// =====================================================

	/**
	 * Classifies a file into ALL applicable modules (multi-choice)
	 */
	private async classifyModuleReferences(description: string): Promise<Array<{ module: string; confidence: string }>> {
		const userPrompt = `Determine ALL CTD Modules (1-5) where this file might be referenced or used.
Return ONLY a JSON object exactly in this shape:
{ "modules": [ { "module": "1" | "2" | "3" | "4" | "5", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE_REFERENCE_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ modules?: Array<{ module?: string; confidence?: string }> }>(response, {
			modules: [],
		})

		const allowedModules = ["1", "2", "3", "4", "5"]
		const normalized: Array<{ module: string; confidence: string }> = []

		for (const item of result.modules || []) {
			const module = String(item.module || "").trim()
			if (allowedModules.includes(module)) {
				normalized.push({ module, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Finds ALL Module 1 subsections where file is referenced
	 */
	private async classifyModule1ReferenceSubsections(
		description: string,
	): Promise<Array<{ section: string; confidence: string }>> {
		const userPrompt = `Determine ALL Module 1 subsections where this file will be referenced or used.
Return ONLY a JSON object exactly in this shape:
{ "sections": [ { "section": "1.x", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE1_REFERENCE_SUBSECTIONS_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ sections?: Array<{ section?: string; confidence?: string }> }>(response, {
			sections: [],
		})

		const allowedSections = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "1.11", "1.12", "1.13"]
		const normalized: Array<{ section: string; confidence: string }> = []

		for (const item of result.sections || []) {
			const section = String(item.section || "").trim()
			if (allowedSections.includes(section)) {
				normalized.push({ section, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Finds ALL Module 2 subsections where file is referenced
	 */
	private async classifyModule2ReferenceSubsections(
		description: string,
	): Promise<Array<{ section: string; confidence: string }>> {
		const userPrompt = `Determine ALL Module 2 subsections where this file will be referenced or used.
Return ONLY a JSON object exactly in this shape:
{ "sections": [ { "section": "2.x", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE2_REFERENCE_SUBSECTIONS_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ sections?: Array<{ section?: string; confidence?: string }> }>(response, {
			sections: [],
		})

		const allowedSections = ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7"]
		const normalized: Array<{ section: string; confidence: string }> = []

		for (const item of result.sections || []) {
			const section = String(item.section || "").trim()
			if (allowedSections.includes(section)) {
				normalized.push({ section, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Finds ALL Module 3 subsections where file is referenced
	 */
	private async classifyModule3ReferenceSubsections(
		description: string,
	): Promise<Array<{ section: string; confidence: string }>> {
		const userPrompt = `Determine ALL Module 3 sections where this file will be referenced or used.
Return ONLY a JSON object exactly in this shape:
{ "sections": [ { "section": "3.2.S" | "3.2.P" | "3.2.R" | "3.3", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE3_REFERENCE_SUBSECTIONS_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ sections?: Array<{ section?: string; confidence?: string }> }>(response, {
			sections: [],
		})

		const allowedSections = ["3.2.S", "3.2.P", "3.2.R", "3.3"]
		const normalized: Array<{ section: string; confidence: string }> = []

		for (const item of result.sections || []) {
			const section = String(item.section || "").trim()
			if (allowedSections.includes(section)) {
				normalized.push({ section, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Finds ALL 3.2.S subsections where file is referenced
	 */
	private async classifyModule32SReferenceSubsections(
		description: string,
	): Promise<Array<{ subsection: string; confidence: string }>> {
		const userPrompt = `Determine ALL 3.2.S subsections where this file is referenced.
Return ONLY a JSON object exactly in this shape:
{ "sections": [ { "subsection": "3.2.S.x", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE32S_REFERENCE_SUBSECTIONS_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ sections?: Array<{ subsection?: string; confidence?: string }> }>(response, {
			sections: [],
		})

		const allowedSubsections = ["3.2.S.1", "3.2.S.2", "3.2.S.3", "3.2.S.4", "3.2.S.5", "3.2.S.6", "3.2.S.7"]
		const normalized: Array<{ subsection: string; confidence: string }> = []

		for (const item of result.sections || []) {
			const subsection = String(item.subsection || "").trim()
			if (allowedSubsections.includes(subsection)) {
				normalized.push({ subsection, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Finds ALL 3.2.P subsections where file is referenced
	 */
	private async classifyModule32PReferenceSubsections(
		description: string,
	): Promise<Array<{ subsection: string; confidence: string }>> {
		const userPrompt = `Determine ALL 3.2.P subsections where this file is referenced.
Return ONLY a JSON object exactly in this shape:
{ "sections": [ { "subsection": "3.2.P.x", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE32P_REFERENCE_SUBSECTIONS_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ sections?: Array<{ subsection?: string; confidence?: string }> }>(response, {
			sections: [],
		})

		const allowedSubsections = ["3.2.P.1", "3.2.P.2", "3.2.P.3", "3.2.P.4", "3.2.P.5", "3.2.P.6", "3.2.P.7", "3.2.P.8"]
		const normalized: Array<{ subsection: string; confidence: string }> = []

		for (const item of result.sections || []) {
			const subsection = String(item.subsection || "").trim()
			if (allowedSubsections.includes(subsection)) {
				normalized.push({ subsection, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Finds ALL Module 5 subsections where file is referenced
	 */
	private async classifyModule5ReferenceSubsections(
		description: string,
	): Promise<Array<{ section: string; confidence: string }>> {
		const userPrompt = `Determine ALL Module 5 subsections where this file will be referenced or used.
Return ONLY a JSON object exactly in this shape:
{ "subsections": [ { "section": "5.1" | "5.2" | "5.3", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE5_REFERENCE_SUBSECTIONS_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ subsections?: Array<{ section?: string; confidence?: string }> }>(response, {
			subsections: [],
		})

		const allowedSections = ["5.1", "5.2", "5.3"]
		const normalized: Array<{ section: string; confidence: string }> = []

		for (const item of result.subsections || []) {
			const section = String(item.section || "").trim()
			if (allowedSections.includes(section)) {
				normalized.push({ section, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Finds ALL 5.3.x subsections where file is referenced
	 */
	private async classifyModule53ReferenceSubsections(
		description: string,
	): Promise<Array<{ section: string; confidence: string }>> {
		const userPrompt = `Determine ALL 5.3.x subsections where this file will be referenced or used.
Return ONLY a JSON object exactly in this shape:
{ "subsections": [ { "section": "5.3.x", "confidence": "High" | "Medium" | "Low" } ] }

File description:
${description}`

		const response = await this.callLlm(MODULE53_REFERENCE_SUBSECTIONS_PROMPT, userPrompt)
		const result = this.parseJsonResponse<{ subsections?: Array<{ section?: string; confidence?: string }> }>(response, {
			subsections: [],
		})

		const allowedSections = ["5.3.1", "5.3.2", "5.3.3", "5.3.4", "5.3.5", "5.3.6", "5.3.7"]
		const normalized: Array<{ section: string; confidence: string }> = []

		for (const item of result.subsections || []) {
			const section = String(item.section || "").trim()
			if (allowedSections.includes(section)) {
				normalized.push({ section, confidence: item.confidence || "Low" })
			}
		}

		return normalized
	}

	/**
	 * Full reference classification pipeline - finds ALL CTD sections where file is referenced
	 * Returns multiple sections at all hierarchy levels
	 */
	async classifyFileReferences(metadata: InfoJsonMetadata, folderName: string): Promise<CtdReferenceClassification> {
		const description = this.buildFileDescription(metadata, folderName)

		if (!description) {
			return {
				reference_sections: [],
				confidence_map: {},
				modules: [],
				classified_at: new Date().toISOString(),
			}
		}

		const referenceSections: string[] = []
		const confidenceMap: Record<string, string> = {}

		// Step 1: Classify into ALL applicable modules
		const moduleRefs = await this.classifyModuleReferences(description)
		const modules = moduleRefs.map((m) => m.module)

		// Step 2: For each module, find all reference subsections
		for (const moduleItem of moduleRefs) {
			const module = moduleItem.module

			if (module === "1") {
				const m1Refs = await this.classifyModule1ReferenceSubsections(description)
				for (const secItem of m1Refs) {
					if (!referenceSections.includes(secItem.section)) {
						referenceSections.push(secItem.section)
						confidenceMap[secItem.section] = secItem.confidence
					}
				}
			} else if (module === "2") {
				const m2Refs = await this.classifyModule2ReferenceSubsections(description)
				for (const secItem of m2Refs) {
					if (!referenceSections.includes(secItem.section)) {
						referenceSections.push(secItem.section)
						confidenceMap[secItem.section] = secItem.confidence
					}
				}
			} else if (module === "3") {
				const m3Refs = await this.classifyModule3ReferenceSubsections(description)
				for (const secItem of m3Refs) {
					if (!referenceSections.includes(secItem.section)) {
						referenceSections.push(secItem.section)
						confidenceMap[secItem.section] = secItem.confidence
					}

					// Dive deeper: 3.2.S.x
					if (secItem.section === "3.2.S") {
						const m32sRefs = await this.classifyModule32SReferenceSubsections(description)
						for (const subItem of m32sRefs) {
							if (!referenceSections.includes(subItem.subsection)) {
								referenceSections.push(subItem.subsection)
								confidenceMap[subItem.subsection] = subItem.confidence
							}
						}
					}

					// Dive deeper: 3.2.P.x
					if (secItem.section === "3.2.P") {
						const m32pRefs = await this.classifyModule32PReferenceSubsections(description)
						for (const subItem of m32pRefs) {
							if (!referenceSections.includes(subItem.subsection)) {
								referenceSections.push(subItem.subsection)
								confidenceMap[subItem.subsection] = subItem.confidence
							}
						}
					}
				}
			} else if (module === "5") {
				const m5Refs = await this.classifyModule5ReferenceSubsections(description)
				for (const secItem of m5Refs) {
					if (!referenceSections.includes(secItem.section)) {
						referenceSections.push(secItem.section)
						confidenceMap[secItem.section] = secItem.confidence
					}

					// Dive deeper: 5.3.x
					if (secItem.section === "5.3") {
						const m53Refs = await this.classifyModule53ReferenceSubsections(description)
						for (const subItem of m53Refs) {
							if (!referenceSections.includes(subItem.section)) {
								referenceSections.push(subItem.section)
								confidenceMap[subItem.section] = subItem.confidence
							}
						}
					}
				}
			}
		}

		return {
			reference_sections: referenceSections,
			confidence_map: confidenceMap,
			modules,
			classified_at: new Date().toISOString(),
		}
	}

	/**
	 * Parses classification data from classification.txt content
	 */
	private parseClassificationContent(content: string): {
		module: string | null
		placementSection: string | null
		referenceSections: string[]
		confidence: string
		isValid: boolean
	} {
		const result = {
			module: null as string | null,
			placementSection: null as string | null,
			referenceSections: [] as string[],
			confidence: "Low",
			isValid: false,
		}

		if (!content.trim()) {
			return result
		}

		// Extract module
		const moduleMatch = content.match(CLASSIFICATION_PATTERNS.module)
		if (moduleMatch && VALID_MODULES.includes(moduleMatch[1])) {
			result.module = moduleMatch[1]
		}

		// Extract placement section
		const placementMatch = content.match(CLASSIFICATION_PATTERNS.placementSection)
		if (placementMatch) {
			const section = placementMatch[1].trim()
			// Check if it's a valid section (not a placeholder)
			if (section && !CLASSIFICATION_PLACEHOLDER_VALUES.some((p) => section.toLowerCase().includes(p.toLowerCase()))) {
				// Basic validation: should start with a number like "1.", "3.2.", "5.3.1"
				if (/^\d+\./.test(section) || /^\d+$/.test(section)) {
					result.placementSection = section
				}
			}
		}

		// Extract reference sections
		const refMatch = content.match(CLASSIFICATION_PATTERNS.referenceSections)
		if (refMatch) {
			const refContent = refMatch[1]
			// Parse lines like "  - 3.2.P.5 (High)"
			const sectionMatches = refContent.matchAll(/- ([0-9.A-Z]+)/gi)
			for (const match of sectionMatches) {
				if (match[1] && /^\d+\./.test(match[1])) {
					result.referenceSections.push(match[1])
				}
			}
		}

		// Extract confidence
		const confMatch = content.match(CLASSIFICATION_PATTERNS.confidence)
		if (confMatch) {
			result.confidence = confMatch[1]
		}

		// Classification is valid if we have a module AND (a placement section OR reference sections)
		result.isValid = !!(result.module && (result.placementSection || result.referenceSections.length > 0))

		return result
	}

	/**
	 * Checks if a classification.txt file has valid (non-placeholder) content
	 */
	private isValidClassification(content: string): boolean {
		const parsed = this.parseClassificationContent(content)
		return parsed.isValid
	}

	/**
	 * Classifies a folder and saves placement & reference tags to classification.txt
	 * Also updates tags.md files in the dossier folder sections
	 * @param folderPath Full path to the processed PDF folder
	 * @param relativePath Relative path from documents folder
	 * @param workspaceRoot Optional workspace root for updating dossier tags
	 */
	async classifyFolder(folderPath: string, relativePath: string, workspaceRoot?: string): Promise<boolean> {
		const infoJsonPath = path.join(folderPath, "info.json")
		const classificationPath = path.join(folderPath, "classification.txt")

		// Check if classification.txt already exists with valid content
		try {
			const existingContent = await fs.promises.readFile(classificationPath, "utf-8")
			const parsedClassification = this.parseClassificationContent(existingContent)

			if (parsedClassification.isValid) {
				console.log(`classification.txt already exists with valid content for ${folderPath}`)

				// Still update dossier tags even if classification exists (tags might be missing)
				if (workspaceRoot) {
					try {
						const tagsService = new DossierTagsService(workspaceRoot)
						const pdfName = path.basename(folderPath) + ".pdf"
						const processedFolderRelativePath = path.join("documents", relativePath)

						// Build confidence map from reference sections (use parsed confidence as default)
						const confidenceMap: Record<string, string> = {}
						for (const sec of parsedClassification.referenceSections) {
							confidenceMap[sec] = parsedClassification.confidence
						}

						const tagResult = await tagsService.updateTagsForPdf(
							pdfName,
							processedFolderRelativePath,
							parsedClassification.placementSection,
							parsedClassification.confidence,
							parsedClassification.referenceSections,
							confidenceMap,
						)

						if (!tagResult.skipped) {
							console.log(
								`Updated dossier tags for ${pdfName}: ${tagResult.placementsAdded} placements, ${tagResult.referencesAdded} references added`,
							)
						}
					} catch (error) {
						console.error(`Failed to update dossier tags for ${folderPath}:`, error)
					}
				}

				return true
			}
			console.log(`classification.txt has invalid content for ${folderPath}, re-processing`)
		} catch {
			// File doesn't exist, proceed with classification
		}

		// Read info.json
		let metadata: InfoJsonMetadata
		try {
			const infoContent = await fs.promises.readFile(infoJsonPath, "utf-8")
			metadata = JSON.parse(infoContent) as InfoJsonMetadata
		} catch (error) {
			console.error(`No valid info.json found in ${folderPath}:`, error)
			return false
		}

		// Skip if metadata has placeholder values
		if (!metadata.source_of_file || !metadata.dossier_summary) {
			console.log(`Metadata incomplete in ${folderPath}, skipping classification`)
			return false
		}

		// Classify the file (placement - single best section)
		const placementClassification = await this.classifyFile(metadata, path.basename(folderPath))

		// Classify the file (references - ALL sections where file might be used)
		const referenceClassification = await this.classifyFileReferences(metadata, path.basename(folderPath))

		// Format reference sections for display
		const referenceSectionsDisplay =
			referenceClassification.reference_sections.length > 0
				? referenceClassification.reference_sections
						.map((sec) => `  - ${sec} (${referenceClassification.confidence_map[sec] || "Unknown"})`)
						.join("\n")
				: "  None identified"

		// Format classification as text
		const classificationText = `CTD Classification Results
==========================

PLACEMENT (Single Best Section)
-------------------------------
Module: ${placementClassification.module}
Placement Section: ${placementClassification.placement_section || "Not determined"}
Confidence: ${placementClassification.confidence}

REFERENCES (All Sections Where File May Be Used)
-------------------------------------------------
Modules: ${referenceClassification.modules.join(", ") || "None"}
Reference Sections:
${referenceSectionsDisplay}

METADATA
--------
Source File: ${relativePath}
Source of File: ${metadata.source_of_file}
Summary: ${metadata.dossier_summary}

Classified At: ${placementClassification.classified_at}
`

		// Write classification.txt
		try {
			await fs.promises.writeFile(classificationPath, classificationText, "utf-8")
			console.log(`Saved classification to ${classificationPath}`)
		} catch (error) {
			console.error(`Failed to write classification.txt for ${folderPath}:`, error)
			return false
		}

		// Update dossier tags.md files if workspace root is provided
		if (workspaceRoot) {
			try {
				const tagsService = new DossierTagsService(workspaceRoot)
				const pdfName = path.basename(folderPath) + ".pdf"
				const processedFolderRelativePath = path.join("documents", relativePath)

				await tagsService.updateTagsForPdf(
					pdfName,
					processedFolderRelativePath,
					placementClassification.placement_section,
					placementClassification.confidence,
					referenceClassification.reference_sections,
					referenceClassification.confidence_map,
				)
				console.log(`Updated dossier tags for ${pdfName}`)
			} catch (error) {
				console.error(`Failed to update dossier tags for ${folderPath}:`, error)
				// Don't fail the whole process for dossier tags errors
			}
		}

		return true
	}
}
