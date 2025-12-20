/**
 * Section 5.3 Paper Search Service
 * Orchestrates paper search for all Module 5.3 subsections using LangChain-JS + OpenAI
 */

import * as fs from "fs/promises"
import OpenAI from "openai"
import * as path from "path"
import { searchPubMed } from "./pubmedSearcher"
import { extractBaseDrugName, loadAllSection53Regulations, sanitizeFilename } from "./regulationParser"
import type {
	AssessSection53Response,
	CombinedPapersResult,
	Paper,
	RegulationSection,
	Section,
	SectionProcessingStatus,
} from "./types"

/**
 * Generate search queries for a section using OpenAI
 */
async function generateSearchQueries(
	openai: OpenAI,
	drugName: string,
	baseDrugName: string,
	section: RegulationSection,
): Promise<string[]> {
	const prompt = `You are a pharmaceutical research assistant. Generate 4-6 PubMed search queries to find research papers relevant to an ANDA (generic drug) submission.

Drug: ${drugName} (base name: ${baseDrugName})
Section: ${section.id} - ${section.title}
Description: ${section.description}

Generate PubMed search queries using proper PubMed syntax:
- Use field tags like [Title/Abstract], [MeSH Terms]
- Use quotes for exact phrases
- Combine terms with AND, OR

Focus on finding papers about:
1. ${baseDrugName} + section-specific terms
2. ${baseDrugName} + regulatory/ANDA-related terms
3. ${baseDrugName} + methodology specific to this section

Return ONLY a JSON array of query strings, nothing else:
["query1", "query2", "query3", ...]`

	try {
		const response = await openai.chat.completions.create({
			model: "gpt-4o",
			messages: [{ role: "user", content: prompt }],
			temperature: 0.3,
			max_tokens: 500,
		})

		const content = response.choices[0]?.message?.content || "[]"

		// Extract JSON array from response
		const jsonMatch = content.match(/\[[\s\S]*\]/)
		if (jsonMatch) {
			const queries = JSON.parse(jsonMatch[0]) as string[]
			return queries.slice(0, 6) // Max 6 queries
		}

		return []
	} catch (error) {
		console.error(`[Section53Service] Error generating queries for ${section.id}:`, error)
		// Fallback to basic queries
		return [
			`"${baseDrugName}"[Title/Abstract] AND "${section.title}"[Title/Abstract]`,
			`"${baseDrugName}"[Title/Abstract] AND "ANDA"[Title/Abstract]`,
		]
	}
}

/**
 * Validate and filter papers for relevance using OpenAI
 */
async function validatePapers(
	openai: OpenAI,
	drugName: string,
	baseDrugName: string,
	section: RegulationSection,
	papers: Paper[],
): Promise<Paper[]> {
	if (papers.length === 0) return []

	// Prepare paper summaries for validation
	const paperSummaries = papers.map((p, idx) => ({
		index: idx,
		title: p.title,
		abstract: p.abstract?.substring(0, 300) || "",
	}))

	const prompt = `You are a pharmaceutical regulatory expert. Evaluate the relevance of these research papers for an ANDA submission.

Drug: ${drugName} (base name: ${baseDrugName})
Section: ${section.id} - ${section.title}
Section Description: ${section.description}

Papers to evaluate:
${JSON.stringify(paperSummaries, null, 2)}

CRITERIA FOR RELEVANCE:
1. Paper must be directly about ${baseDrugName} (not just mentioned in passing)
2. Paper must address ${section.title} requirements
3. Paper should relate to generic drug development, ANDA submission, or regulatory requirements

Return a JSON array of indices of RELEVANT papers and a brief reason for each:
[{"index": 0, "reason": "..."}, {"index": 2, "reason": "..."}]

Only include papers that clearly meet ALL relevance criteria. Return [] if none are relevant.`

	try {
		const response = await openai.chat.completions.create({
			model: "gpt-4o",
			messages: [{ role: "user", content: prompt }],
			temperature: 0.2,
			max_tokens: 1000,
		})

		const content = response.choices[0]?.message?.content || "[]"

		// Extract JSON array from response
		const jsonMatch = content.match(/\[[\s\S]*\]/)
		if (jsonMatch) {
			const validations = JSON.parse(jsonMatch[0]) as Array<{ index: number; reason: string }>
			const validatedPapers: Paper[] = []

			for (const v of validations) {
				if (v.index >= 0 && v.index < papers.length) {
					const paper = papers[v.index]
					validatedPapers.push({
						...paper,
						relevanceReason: v.reason,
					})
				}
			}

			return validatedPapers
		}

		return papers // Return all if parsing fails
	} catch (error) {
		console.error(`[Section53Service] Error validating papers for ${section.id}:`, error)
		return papers // Return all on error
	}
}

/**
 * Process a single section: generate queries, search, and validate
 */
async function processSection(
	openai: OpenAI,
	drugName: string,
	baseDrugName: string,
	section: RegulationSection,
): Promise<Paper[]> {
	console.log(`[Section53Service] Processing section ${section.id}: ${section.title}`)

	// Generate search queries
	const queries = await generateSearchQueries(openai, drugName, baseDrugName, section)
	console.log(`[Section53Service] Generated ${queries.length} queries for ${section.id}`)

	// Execute searches and collect papers
	const allPapers: Paper[] = []
	const seenPmids = new Set<string>()

	for (const query of queries) {
		const result = await searchPubMed(query, 5)
		for (const paper of result.papers) {
			if (paper.pmid && !seenPmids.has(paper.pmid)) {
				seenPmids.add(paper.pmid)
				allPapers.push(paper)
			}
		}
	}

	console.log(`[Section53Service] Found ${allPapers.length} unique papers for ${section.id}`)

	// Validate papers for relevance
	const validatedPapers = await validatePapers(openai, drugName, baseDrugName, section, allPapers)
	console.log(`[Section53Service] Validated ${validatedPapers.length} relevant papers for ${section.id}`)

	return validatedPapers
}

/**
 * Deduplicate papers across sections
 */
function deduplicatePapers(sections: Record<string, Section>): {
	sections: Record<string, Section>
	duplicatesFound: number
	papersRemoved: number
} {
	const paperSectionMap = new Map<string, { sectionId: string; paper: Paper }>()
	const duplicates: Array<{ pmid: string; sections: string[] }> = []
	let papersRemoved = 0

	// First pass: identify all papers and their sections
	for (const [sectionId, section] of Object.entries(sections)) {
		for (const paper of section.papers) {
			if (paper.pmid) {
				const existing = paperSectionMap.get(paper.pmid)
				if (existing) {
					// Found duplicate
					const existingDup = duplicates.find((d) => d.pmid === paper.pmid)
					if (existingDup) {
						existingDup.sections.push(sectionId)
					} else {
						duplicates.push({ pmid: paper.pmid, sections: [existing.sectionId, sectionId] })
					}
				} else {
					paperSectionMap.set(paper.pmid, { sectionId, paper })
				}
			}
		}
	}

	// Second pass: keep only first occurrence of each paper
	const deduplicatedSections: Record<string, Section> = {}
	const seenPmids = new Set<string>()

	for (const [sectionId, section] of Object.entries(sections)) {
		const uniquePapers: Paper[] = []
		for (const paper of section.papers) {
			if (paper.pmid) {
				if (!seenPmids.has(paper.pmid)) {
					seenPmids.add(paper.pmid)

					// Add also_relevant_to for duplicates
					const dup = duplicates.find((d) => d.pmid === paper.pmid)
					if (dup) {
						paper.alsoRelevantTo = dup.sections.filter((s) => s !== sectionId)
					}

					uniquePapers.push(paper)
				} else {
					papersRemoved++
				}
			} else {
				uniquePapers.push(paper)
			}
		}

		deduplicatedSections[sectionId] = {
			...section,
			papers: uniquePapers,
		}
	}

	return {
		sections: deduplicatedSections,
		duplicatesFound: duplicates.length,
		papersRemoved,
	}
}

/**
 * Main service function: Assess papers for all Section 5.3 subsections
 */
export async function assessSection53Papers(
	drugName: string,
	extensionPath: string,
	openAiApiKey: string,
	outputDir?: string,
): Promise<AssessSection53Response> {
	console.log(`[Section53Service] Starting paper assessment for ${drugName}`)

	if (!openAiApiKey) {
		return {
			success: false,
			error: "OpenAI API key is required. Please configure it in Ritivel settings.",
		}
	}

	try {
		// Initialize OpenAI client
		const openai = new OpenAI({
			apiKey: openAiApiKey,
		})

		// Load regulation sections
		const allSections = await loadAllSection53Regulations(extensionPath)
		const baseDrugName = extractBaseDrugName(drugName)

		console.log(`[Section53Service] Processing ${Object.keys(allSections).length} subsections for ${baseDrugName}`)

		// Process each section
		const sectionResults: Record<string, Section> = {}
		const sectionStatuses: SectionProcessingStatus[] = []
		let totalMentions = 0

		for (const [sectionId, regulation] of Object.entries(allSections)) {
			const status: SectionProcessingStatus = {
				sectionId,
				status: "searching",
			}
			sectionStatuses.push(status)

			try {
				const papers = await processSection(openai, drugName, baseDrugName, regulation)
				status.status = "completed"
				status.papersFound = papers.length
				totalMentions += papers.length

				sectionResults[sectionId] = {
					title: regulation.title,
					description: regulation.description,
					papers,
				}
			} catch (error) {
				status.status = "error"
				status.error = error instanceof Error ? error.message : String(error)

				sectionResults[sectionId] = {
					title: regulation.title,
					description: regulation.description,
					papers: [],
				}
			}
		}

		// Deduplicate papers across sections
		const { sections: deduplicatedSections, duplicatesFound, papersRemoved } = deduplicatePapers(sectionResults)

		// Calculate summary
		const papersBySection: Record<string, number> = {}
		let totalUniquePapers = 0
		for (const [sectionId, section] of Object.entries(deduplicatedSections)) {
			papersBySection[sectionId] = section.papers.length
			totalUniquePapers += section.papers.length
		}

		// Build result
		const result: CombinedPapersResult = {
			drugName,
			regulationSection: "5.3",
			sections: deduplicatedSections,
			summary: {
				totalUniquePapers,
				totalMentions,
				papersBySection,
				deduplicationStats: {
					duplicatesFound,
					papersRemoved,
				},
				sectionsProcessed: Object.keys(deduplicatedSections),
			},
			combinedAt: new Date().toISOString(),
		}

		// Optionally save to disk
		if (outputDir) {
			// Ensure output directory exists
			await fs.mkdir(outputDir, { recursive: true })
			const outputPath = path.join(outputDir, `${sanitizeFilename(drugName)}_5.3_papers.json`)
			await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8")
			console.log(`[Section53Service] Results saved to ${outputPath}`)
		}

		console.log(`[Section53Service] Assessment complete: ${totalUniquePapers} unique papers found`)

		return {
			success: true,
			result,
		}
	} catch (error) {
		console.error(`[Section53Service] Assessment failed:`, error)
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Export an index file
 */
export { searchPubMed } from "./pubmedSearcher"
export { extractBaseDrugName, loadAllSection53Regulations, sanitizeFilename } from "./regulationParser"
export * from "./types"
