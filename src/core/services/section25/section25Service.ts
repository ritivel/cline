/**
 * Section 2.5 (Clinical Overview) LaTeX Generation Service
 * Orchestrates paper search, guidance loading, and OpenAI-based LaTeX generation
 */

import * as fs from "fs/promises"
import OpenAI from "openai"
import * as path from "path"
import {
	getAllSectionInfo,
	getRelatedSections,
	loadAllSection25Guidance,
	loadSectionGuidance,
	topologicalSortSections,
} from "./guidanceParser"
import type { GenerateSection25Response, Paper, QualityReport, Section53PapersResult, SectionInfo } from "./types"
import { DEFAULT_QUALITY_THRESHOLDS, SECTION_25_TO_53_MAPPING, SECTION_TITLES } from "./types"

/**
 * Regulatory writing guidelines for the system prompt
 */
const REGULATORY_WRITING_GUIDELINES = `
REGULATORY WRITING STANDARDS (ICH M4E Compliance):

1. LANGUAGE AND TONE:
   - Use precise, unambiguous scientific language
   - Maintain objective, third-person perspective
   - Avoid promotional or biased language
   - Use active voice where appropriate for clarity
   - Define abbreviations on first use

2. STRUCTURE AND ORGANIZATION:
   - Follow a logical flow from general to specific
   - Use clear topic sentences for each paragraph
   - Ensure smooth transitions between sections
   - Include appropriate cross-references to other sections

3. DATA PRESENTATION:
   - Present data objectively with appropriate context
   - Include relevant statistics and confidence intervals
   - Discuss both positive and negative findings
   - Acknowledge limitations transparently

4. CITATION STANDARDS:
   - Reference Module 5 sections directly using \\modref{5.3.x}
   - Use consistent reference format
   - Prioritize peer-reviewed publications

5. REGULATORY COMPLIANCE:
   - Address all required elements per ICH guidelines
   - Use standardized terminology (MedDRA, WHO-DD)
   - Include required safety and efficacy summaries
   - Follow regional requirements as applicable
`

/**
 * Find papers relevant to a specific section 2.5.x
 */
function findRelevantPapers(sectionId: string, papersData: Section53PapersResult): Paper[] {
	const relevantPapers: Paper[] = []
	const sections = papersData.sections || {}

	// Get mapped sections for this 2.5.x section
	let mappedSections = SECTION_25_TO_53_MAPPING[sectionId] || []

	// For unknown sections, try to infer from parent
	if (mappedSections.length === 0) {
		const parts = sectionId.split(".")
		if (parts.length > 3) {
			const parentId = parts.slice(0, -1).join(".")
			mappedSections = SECTION_25_TO_53_MAPPING[parentId] || []
		}
	}

	// For 2.5.7 (References), include all papers
	if (sectionId === "2.5.7") {
		for (const sectionData of Object.values(sections)) {
			for (const paper of sectionData.papers || []) {
				if (!relevantPapers.some((p) => p.url === paper.url)) {
					relevantPapers.push(paper)
				}
			}
		}
		return relevantPapers
	}

	// Collect papers from mapped sections
	for (const mappedSection of mappedSections) {
		if (sections[mappedSection]) {
			const sectionPapers = sections[mappedSection].papers || []
			for (const paper of sectionPapers) {
				if (!relevantPapers.some((p) => p.url === paper.url)) {
					relevantPapers.push({
						...paper,
						sourceSection: mappedSection,
					})
				}
			}
		}
	}

	// Also check for papers marked as "alsoRelevantTo"
	for (const [sectionKey, sectionData] of Object.entries(sections)) {
		for (const paper of sectionData.papers || []) {
			const alsoRelevant = paper.alsoRelevantTo || []
			if (alsoRelevant.some((s) => mappedSections.includes(s))) {
				if (!relevantPapers.some((p) => p.url === paper.url)) {
					relevantPapers.push({
						...paper,
						sourceSection: sectionKey,
					})
				}
			}
		}
	}

	return relevantPapers
}

/**
 * Format papers for context in the prompt
 */
function formatPapersForContext(papers: Paper[], maxPapers: number = 15): string {
	if (papers.length === 0) {
		return ""
	}

	let context = `\n\nCLINICAL STUDY DATA FROM MODULE 5 (${Math.min(papers.length, maxPapers)} of ${papers.length} studies):\n`
	context += "=".repeat(60) + "\n"
	context += `
IMPORTANT: Reference these using \\modref{5.3.X.X} format, NOT \\cite{}!
For the tabular listing of all studies, use \\modref{5.2}.
`
	context += "=".repeat(60) + "\n"

	// Group papers by section
	const sectionGroups: Record<string, { name: string; papers: Paper[] }> = {
		"5.3.1": { name: "Biopharmaceutic Studies", papers: [] },
		"5.3.2": { name: "PK Using Human Biomaterials", papers: [] },
		"5.3.3": { name: "Human PK Studies", papers: [] },
		"5.3.4": { name: "Human PD Studies", papers: [] },
		"5.3.5": { name: "Efficacy and Safety Studies", papers: [] },
		"5.3.6": { name: "Post-marketing Experience", papers: [] },
	}

	for (const paper of papers.slice(0, maxPapers)) {
		const sourceSection = paper.sourceSection || "5.3.5"
		for (const secKey of Object.keys(sectionGroups)) {
			if (sourceSection.startsWith(secKey)) {
				sectionGroups[secKey].papers.push(paper)
				break
			}
		}
	}

	let idx = 1
	for (const [secKey, secData] of Object.entries(sectionGroups)) {
		if (secData.papers.length === 0) continue

		context += `\n--- Section ${secKey}: ${secData.name} ---\n`
		context += `Reference as: \\modref{${secKey}} or \\modref{${secKey}.X} for subsections\n\n`

		for (const paper of secData.papers) {
			context += `[${idx}] ${paper.title}\n`
			if (paper.authors && paper.authors.length > 0) {
				const authorStr =
					paper.authors.length > 3 ? paper.authors.slice(0, 3).join(", ") + " et al." : paper.authors.join(", ")
				context += `    Authors: ${authorStr}\n`
			}
			if (paper.journal && paper.year) {
				context += `    Published: ${paper.journal} (${paper.year})\n`
			}
			context += `    Module 5 Location: Section ${paper.sourceSection || secKey}\n`
			context += `    Reference: \\modref{${paper.sourceSection || secKey}}\n`

			if (paper.abstract) {
				const firstSentence = paper.abstract.split(".")[0] + "."
				const keyFinding = firstSentence.length > 200 ? paper.abstract.substring(0, 200) + "..." : firstSentence
				context += `    Key Finding: ${keyFinding}\n`
			}
			context += "\n"
			idx++
		}
	}

	context += "=".repeat(60) + "\n"
	context += `
REMINDER: Use these reference formats:
  - \\modref{5.3.1} - for biopharmaceutic studies
  - \\modref{5.3.5.1} - for specific efficacy study reports
  - \\modref{5.2} - for the tabular listing of all clinical studies
  - \\secref{2.5.X} - for cross-references to other 2.5 sections
`
	context += "=".repeat(60) + "\n"

	return context
}

/**
 * Build the system prompt for LaTeX generation
 */
function buildSystemPrompt(
	sectionId: string,
	sectionGuidance: string,
	papersContext: string,
	relatedSections: Record<string, SectionInfo>,
): string {
	let sectionsContext = ""
	if (Object.keys(relatedSections).length > 0) {
		sectionsContext = "\n\nRELATED SECTIONS IN 2.5 FOR CROSS-REFERENCING:\n"
		sectionsContext += "=".repeat(60) + "\n"
		sectionsContext += "Cross-reference these sections using \\secref{2.5.X} command.\n\n"

		for (const [relatedId, info] of Object.entries(relatedSections)) {
			sectionsContext += `\n[${relatedId}] ${info.title}\n`
			sectionsContext += `    Cross-ref: \\secref{${relatedId}}\n`
		}
		sectionsContext += "=".repeat(60) + "\n"
	}

	const sectionTitle = SECTION_TITLES[sectionId] || sectionId

	return `You are an expert regulatory medical writer specializing in ICH Module 5 Section 2.5: Clinical Overview.

You are writing Section ${sectionId} (${sectionTitle}) as part of a regulatory submission.

${REGULATORY_WRITING_GUIDELINES}

SECTION GUIDANCE FROM REGULATORY REQUIREMENTS:
${"=".repeat(60)}
${sectionGuidance}
${"=".repeat(60)}

${papersContext}

${sectionsContext}

LATEX FORMATTING REQUIREMENTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Section commands: Use UNNUMBERED sections with \\section*{${sectionId} ${sectionTitle}} - the * prevents auto-numbering!
• Labels: \\label{sec:${sectionId.replace(/\./g, "_")}} immediately after section commands
• Cross-references to OTHER 2.5 sections: \\secref{2.5.X} (e.g., \\secref{2.5.3})
• Bold: \\textbf{text}, Italic: \\textit{text}
• Lists: \\begin{itemize}...\\end{itemize} or \\begin{enumerate}...\\end{enumerate}
• Math: $x = y$ for inline, \\[x = y\\] for display
• Special characters: Escape %, $, &, #, _ as \\%, \\$, \\&, \\#, \\_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REFERENCING MODULE 5 CLINICAL STUDY DATA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT: Do NOT use \\cite{PMID...} for citations!

Instead, reference Module 5 sections directly using these formats:
• For clinical study reports: \\modref{5.3.5.1} or (see Section 5.3.5.1)
• For specific studies: \\studyref{Study-001} or (see Section 5.2, Study XYZ-001)

Examples:
• "The pharmacokinetic parameters are detailed in \\modref{5.3.1.1}."
• "Clinical efficacy was demonstrated in pivotal trials \\modref{5.3.5.1}."
• "Adverse event data are summarized in \\modref{5.3.5.3}."
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT REQUIREMENTS:
1. Return ONLY LaTeX code (no markdown code blocks, no explanations)
2. Start with \\section*{${sectionId} ${sectionTitle}} - use \\section* (with asterisk) to prevent auto-numbering!
3. Include \\label{sec:${sectionId.replace(/\./g, "_")}} after the section command
4. Do NOT include document preamble (\\documentclass, \\begin{document}, etc.)
5. Ensure all braces are balanced and environments are properly closed
6. Use \\modref{}, or \\studyref{} for references to Module 5 data
7. Use \\secref{2.5.X} for cross-references to other 2.5 sections

QUALITY STANDARDS:
✓ Comprehensive coverage of all guidance topics
✓ At least 3-5 references to Module 5 sections (5.2 or 5.3.x)
✓ Cross-references to related 2.5 sections using \\secref{2.5.X}
✓ Professional regulatory language
✓ Clear, logical structure with section numbers in titles
✓ Accurate scientific content
✓ No promotional language
✓ Proper abbreviation definitions`
}

/**
 * Validate the quality of generated LaTeX content
 */
function validateLatexQuality(latexContent: string, sectionId: string, expectedCitations: number = 3): QualityReport {
	const issues: string[] = []
	const suggestions: string[] = []
	const latexErrors: string[] = []
	let score = 100

	// Basic content checks
	if (!latexContent || latexContent.trim().length === 0) {
		return {
			isValid: false,
			score: 0,
			issues: ["Empty content"],
			suggestions: ["Generate content"],
			latexErrors: [],
			citationCount: 0,
			sectionCount: 0,
			wordCount: 0,
		}
	}

	const contentLength = latexContent.length
	const wordCount = latexContent.split(/\s+/).length

	// Check minimum length
	if (contentLength < DEFAULT_QUALITY_THRESHOLDS.minLength) {
		issues.push(`Content too short (${contentLength} chars, minimum ${DEFAULT_QUALITY_THRESHOLDS.minLength})`)
		score -= 20
		suggestions.push("Expand content with more details and explanations")
	}

	// Check maximum length
	if (contentLength > DEFAULT_QUALITY_THRESHOLDS.maxLength) {
		issues.push(`Content too long (${contentLength} chars), may cause context issues`)
		score -= 10
	}

	// Count citations (modref, studyref patterns)
	const citationPattern = /\\modref\{[^}]+\}|\\studyref\{[^}]+\}|\\secref\{[^}]+\}/g
	const citations = latexContent.match(citationPattern) || []
	const citationCount = citations.length

	if (citationCount < expectedCitations) {
		issues.push(`Low citation count (${citationCount}, expected at least ${expectedCitations})`)
		score -= 15
		suggestions.push("Add more references to Module 5 sections")
	}

	// Count section commands (including starred versions)
	const sectionPattern = /\\(section|subsection|subsubsection)\*?\{[^}]+\}/g
	const sections = latexContent.match(sectionPattern) || []
	const sectionCount = sections.length

	if (sectionCount < DEFAULT_QUALITY_THRESHOLDS.minSections) {
		issues.push(`Missing section structure (found ${sectionCount} sections)`)
		score -= 15
		suggestions.push("Add proper section and subsection structure")
	}

	// Check for required elements
	for (const element of DEFAULT_QUALITY_THRESHOLDS.requiredElements) {
		if (!latexContent.includes(element)) {
			issues.push(`Missing required LaTeX element: ${element}`)
			score -= 10
			suggestions.push(`Add ${element} command to the content`)
		}
	}

	// Check for label after section
	if (latexContent.includes("\\section*") && !latexContent.includes("\\label")) {
		issues.push("Section without \\label - cross-referencing won't work")
		score -= 10
		suggestions.push("Add \\label{sec:...} after each section command")
	}

	// LaTeX syntax validation
	const openBraces = (latexContent.match(/\{/g) || []).length
	const closeBraces = (latexContent.match(/\}/g) || []).length
	if (openBraces !== closeBraces) {
		latexErrors.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`)
		score -= 20
	}

	// Check for unbalanced environments
	const beginCount = (latexContent.match(/\\begin\{(\w+)\}/g) || []).length
	const endCount = (latexContent.match(/\\end\{(\w+)\}/g) || []).length
	if (beginCount !== endCount) {
		latexErrors.push(`Unbalanced environments: ${beginCount} \\begin, ${endCount} \\end`)
		score -= 15
	}

	// Check for itemize/enumerate structure
	if (latexContent.includes("\\item")) {
		if (!latexContent.includes("\\begin{itemize}") && !latexContent.includes("\\begin{enumerate}")) {
			latexErrors.push("\\item used without itemize or enumerate environment")
			score -= 10
		}
	}

	// Content quality checks - promotional language
	const promotionalWords = ["breakthrough", "revolutionary", "best", "guaranteed", "miracle"]
	const foundPromotional = promotionalWords.filter((w) => latexContent.toLowerCase().includes(w))
	if (foundPromotional.length > 0) {
		issues.push(`Promotional language detected: ${foundPromotional.join(", ")}`)
		score -= 10
		suggestions.push("Use objective, scientific language instead of promotional terms")
	}

	// Ensure score doesn't go below 0
	score = Math.max(0, score)

	// Determine validity
	const isValid = score >= 60 && latexErrors.length === 0

	return {
		isValid,
		score,
		issues,
		suggestions,
		latexErrors,
		citationCount,
		sectionCount,
		wordCount,
	}
}

/**
 * Generate LaTeX content for a single section using OpenAI
 */
async function generateSectionLatex(
	openai: OpenAI,
	sectionId: string,
	sectionGuidance: string,
	relevantPapers: Paper[],
	relatedSections: Record<string, SectionInfo>,
	drugName: string,
): Promise<{ latex: string; qualityReport: QualityReport }> {
	const papersContext = formatPapersForContext(relevantPapers, 15)
	const systemPrompt = buildSystemPrompt(sectionId, sectionGuidance, papersContext, relatedSections)

	const sectionTitle = SECTION_TITLES[sectionId] || sectionId
	const userPrompt = `Write the LaTeX content for Section ${sectionId} (${sectionTitle}) for ${drugName} based on the guidance provided.

Ensure that:
1. All key points from the guidance are addressed
2. Relevant papers are cross-referenced appropriately using \\modref{5.3.x}
3. The LaTeX is properly formatted and structured
4. The content is comprehensive and suitable for regulatory submission

Return ONLY the LaTeX code starting with the appropriate sectioning command.`

	console.log(`[Section25Service] Generating LaTeX for section ${sectionId}...`)

	try {
		const response = await openai.chat.completions.create({
			model: "gpt-4o",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			temperature: 0.3,
			max_tokens: 4000,
		})

		let latexContent = response.choices[0]?.message?.content || ""

		// Clean up the response - remove markdown code blocks if present
		latexContent = latexContent
			.replace(/^```(?:latex)?\s*/m, "")
			.replace(/\s*```$/m, "")
			.trim()

		// Validate quality
		const qualityReport = validateLatexQuality(latexContent, sectionId, Math.min(relevantPapers.length, 5))

		console.log(`[Section25Service] Generated ${latexContent.length} chars for ${sectionId}, score: ${qualityReport.score}`)

		return { latex: latexContent, qualityReport }
	} catch (error) {
		console.error(`[Section25Service] Error generating LaTeX for ${sectionId}:`, error)
		throw error
	}
}

/**
 * Escape LaTeX special characters
 */
function escapeLatex(text: string): string {
	if (!text) return ""
	return text
		.replace(/\\/g, "\\textbackslash{}")
		.replace(/&/g, "\\&")
		.replace(/%/g, "\\%")
		.replace(/\$/g, "\\$")
		.replace(/#/g, "\\#")
		.replace(/_/g, "\\_")
		.replace(/\{/g, "\\{")
		.replace(/\}/g, "\\}")
		.replace(/~/g, "\\textasciitilde{}")
		.replace(/\^/g, "\\textasciicircum{}")
}

/**
 * Generate the complete Section 2.5 document
 */
function generateCompleteDocument(drugName: string, subsectionContents: Record<string, string>): string {
	// Sort sections by ID
	const sortedSectionIds = Object.keys(subsectionContents).sort((a, b) => {
		const partsA = a.split(".").map(Number)
		const partsB = b.split(".").map(Number)
		for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
			const diff = (partsA[i] || 0) - (partsB[i] || 0)
			if (diff !== 0) return diff
		}
		return 0
	})

	const subsectionsContent = sortedSectionIds.map((id) => subsectionContents[id]).join("\n\n")

	return `\\documentclass[12pt]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{geometry}
\\usepackage{hyperref}
\\usepackage{fancyhdr}
\\usepackage{titlesec}
\\usepackage{booktabs}
\\usepackage{longtable}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\geometry{margin=1in}

% Custom commands for references
\\newcommand{\\modref}[1]{(see Module 5, Section #1)}
\\newcommand{\\studyref}[1]{(see Section 5.2, Study #1)}
\\newcommand{\\secref}[1]{(see Section #1)}

% Header and footer configuration
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0.4pt}
\\renewcommand{\\footrulewidth}{0.4pt}
\\fancyhead[L]{\\small ICH Module 2 Section 2.5}
\\fancyhead[R]{\\small ${escapeLatex(drugName)}}
\\fancyfoot[L]{\\small Confidential}
\\fancyfoot[C]{\\thepage}
\\fancyfoot[R]{\\small Clinical Overview}

% Apply same style to first page
\\fancypagestyle{plain}{
  \\fancyhf{}
  \\renewcommand{\\headrulewidth}{0.4pt}
  \\renewcommand{\\footrulewidth}{0.4pt}
  \\fancyhead[L]{\\small ICH Module 2 Section 2.5}
  \\fancyhead[R]{\\small ${escapeLatex(drugName)}}
  \\fancyfoot[L]{\\small Confidential}
  \\fancyfoot[C]{\\thepage}
  \\fancyfoot[R]{\\small Clinical Overview}
}

\\begin{document}

${subsectionsContent}

\\end{document}
`
}

/**
 * Main service function: Generate Section 2.5 LaTeX document
 */
export async function generateSection25(
	drugName: string,
	extensionPath: string,
	openAiApiKey: string,
	section53PapersPath: string,
	outputPath: string,
): Promise<GenerateSection25Response> {
	console.log(`[Section25Service] Starting Section 2.5 generation for ${drugName}`)

	if (!openAiApiKey) {
		return {
			success: false,
			error: "OpenAI API key is required. Please configure it in Cline settings.",
		}
	}

	try {
		// Initialize OpenAI client
		const openai = new OpenAI({
			apiKey: openAiApiKey,
		})

		// Load Section 5.3 papers
		let papersData: Section53PapersResult
		try {
			const papersJson = await fs.readFile(section53PapersPath, "utf-8")
			papersData = JSON.parse(papersJson)
			console.log(`[Section25Service] Loaded ${papersData.summary?.totalUniquePapers || 0} papers from Section 5.3`)
		} catch (error) {
			return {
				success: false,
				error: `Section 5.3 papers not found. Please assess Section 5.3 first. Path: ${section53PapersPath}`,
			}
		}

		// Load all guidance
		const allGuidance = await loadAllSection25Guidance(extensionPath)
		const allSectionInfo = await getAllSectionInfo(extensionPath)

		// Get sections to generate (including 2.5 intro)
		const sectionsToGenerate = ["2.5", "2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.5", "2.5.6", "2.5.7"]
		const sortedSections = topologicalSortSections(sectionsToGenerate)

		console.log(`[Section25Service] Generating ${sortedSections.length} sections in order: ${sortedSections.join(", ")}`)

		// Generate each section
		const subsectionContents: Record<string, string> = {}
		const qualityReports: Record<string, QualityReport> = {}

		for (const sectionId of sortedSections) {
			// Load guidance for this section
			let sectionGuidance = ""
			try {
				sectionGuidance = await loadSectionGuidance(sectionId, extensionPath)
			} catch {
				// Use guidance from allGuidance if direct load fails
				const guidance = allGuidance[sectionId]
				if (guidance) {
					sectionGuidance = `${sectionId} ${guidance.title}\n\n${guidance.description}`
				}
			}

			if (!sectionGuidance) {
				console.warn(`[Section25Service] No guidance found for ${sectionId}, skipping`)
				continue
			}

			// Find relevant papers
			const relevantPapers = findRelevantPapers(sectionId, papersData)
			console.log(`[Section25Service] Found ${relevantPapers.length} relevant papers for ${sectionId}`)

			// Get related sections for cross-referencing
			const relatedSections = getRelatedSections(sectionId, allSectionInfo)

			// Generate LaTeX
			const { latex, qualityReport } = await generateSectionLatex(
				openai,
				sectionId,
				sectionGuidance,
				relevantPapers,
				relatedSections,
				drugName,
			)

			subsectionContents[sectionId] = latex
			qualityReports[sectionId] = qualityReport

			// Small delay between sections to avoid rate limits
			await new Promise((resolve) => setTimeout(resolve, 1000))
		}

		// Generate complete document
		const completeDocument = generateCompleteDocument(drugName, subsectionContents)

		// Ensure output directory exists
		const outputDir = path.dirname(outputPath)
		await fs.mkdir(outputDir, { recursive: true })

		// Write the LaTeX file
		await fs.writeFile(outputPath, completeDocument, "utf-8")
		console.log(`[Section25Service] LaTeX file written to: ${outputPath}`)

		// Calculate overall quality
		const overallScore =
			Object.values(qualityReports).reduce((sum, r) => sum + r.score, 0) / Object.keys(qualityReports).length

		return {
			success: true,
			texPath: outputPath,
			qualityReport: {
				isValid: overallScore >= 60,
				score: overallScore,
				issues: Object.entries(qualityReports)
					.filter(([, r]) => r.issues.length > 0)
					.map(([id, r]) => `${id}: ${r.issues.join(", ")}`),
				suggestions: [],
				latexErrors: [],
				citationCount: Object.values(qualityReports).reduce((sum, r) => sum + r.citationCount, 0),
				sectionCount: Object.values(qualityReports).reduce((sum, r) => sum + r.sectionCount, 0),
				wordCount: Object.values(qualityReports).reduce((sum, r) => sum + r.wordCount, 0),
			},
		}
	} catch (error) {
		console.error(`[Section25Service] Generation failed:`, error)
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Check if Section 5.3 papers exist
 */
export async function checkSection53PapersExist(section53PapersPath: string): Promise<boolean> {
	try {
		await fs.access(section53PapersPath)
		return true
	} catch {
		return false
	}
}

/**
 * Get the expected Section 5.3 papers path
 */
export function getSection53PapersPath(globalStoragePath: string, drugName: string): string {
	const sanitizedDrugName = drugName
		.replace(/[^\w\-_.]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
	return path.join(globalStoragePath, "section53-papers", `${sanitizedDrugName}_5.3_papers.json`)
}
