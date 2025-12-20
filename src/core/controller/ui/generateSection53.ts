import { StateManager } from "@core/storage/StateManager"
import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import * as fs from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

interface Section53Paper {
	title: string
	url: string
	pmid: string
	abstract: string
	authors: string[]
	journal: string
	year: string
	alsoRelevantTo?: string[]
	relevanceReason?: string
}

interface Section53Section {
	title: string
	description: string
	papers: Section53Paper[]
}

interface Section53Result {
	drugName: string
	regulationSection: string
	sections: Record<string, Section53Section>
	summary: {
		totalUniquePapers: number
		totalMentions: number
		papersBySection: Record<string, number>
		sectionsProcessed: string[]
	}
	combinedAt: string
}

interface GenerateSection53Request {
	drugName: string
	productPath: string
	result: Section53Result
	selectedPapers: Array<{ sectionId: string; pmid: string }>
}

/**
 * Escapes special LaTeX characters
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
 * Generates LaTeX content for a single paper
 */
function generatePaperLatex(paper: Section53Paper): string {
	const authors = paper.authors?.length > 0 ? paper.authors.join(", ") : "Authors not available"
	const journal = paper.journal || "Journal not specified"
	const year = paper.year || "Year not specified"

	return `
\\paragraph{${escapeLatex(paper.title)}}

\\textbf{Authors:} ${escapeLatex(authors)}

\\textbf{Journal:} ${escapeLatex(journal)} (${escapeLatex(year)})

\\textbf{PMID:} ${escapeLatex(paper.pmid)}

\\textbf{Abstract:}
${escapeLatex(paper.abstract || "Abstract not available.")}

\\vspace{1em}
`
}

/**
 * Generates LaTeX content for a subsection
 */
function generateSubsectionLatex(sectionId: string, sectionData: Section53Section, selectedPmids: Set<string>): string {
	// Filter papers to only include selected ones
	const selectedPapers = sectionData.papers.filter((p) => selectedPmids.has(p.pmid))

	if (selectedPapers.length === 0) {
		return `
\\noindent{\\Large\\textbf{${escapeLatex(sectionId)} ${escapeLatex(sectionData.title)}}}
\\vspace{1em}

\\textit{Not Applicable}

\\vspace{1em}
`
	}

	const papersContent = selectedPapers.map((paper) => generatePaperLatex(paper)).join("\n")

	return `
\\noindent{\\Large\\textbf{${escapeLatex(sectionId)} ${escapeLatex(sectionData.title)}}}
\\vspace{1em}

${escapeLatex(sectionData.description)}

\\textbf{Number of papers:} ${selectedPapers.length}

${papersContent}
`
}

/**
 * Generates the complete Section 5.3 LaTeX document
 * Header/footer styling matches 5.1 Table of Contents exactly
 */
function generateSection53Latex(
	drugName: string,
	companyName: string,
	result: Section53Result,
	selectedPapers: Array<{ sectionId: string; pmid: string }>,
): string {
	// Build a set of selected PMIDs per section
	const selectedBySection = new Map<string, Set<string>>()
	for (const { sectionId, pmid } of selectedPapers) {
		if (!selectedBySection.has(sectionId)) {
			selectedBySection.set(sectionId, new Set())
		}
		selectedBySection.get(sectionId)!.add(pmid)
	}

	// Get all section IDs sorted
	const sectionIds = Object.keys(result.sections).sort((a, b) => {
		const partsA = a.split(".").map(Number)
		const partsB = b.split(".").map(Number)
		for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
			const diff = (partsA[i] || 0) - (partsB[i] || 0)
			if (diff !== 0) return diff
		}
		return 0
	})

	// Generate subsections content
	const subsectionsContent = sectionIds
		.map((sectionId) => {
			const sectionData = result.sections[sectionId]
			const selectedPmids = selectedBySection.get(sectionId) || new Set()
			return generateSubsectionLatex(sectionId, sectionData, selectedPmids)
		})
		.join("\n")

	// Header/footer styling matching 5.1 TOC exactly
	return `\\documentclass[11pt,a4paper]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\geometry{margin=2.5cm, headheight=28pt}
\\usepackage{hyperref}
\\usepackage{fancyhdr}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    pdftitle={CTD Section 5.3: Clinical Study Reports},
    pdfauthor={Regulatory Affairs}
}

% Header and footer configuration - matching 5.1 TOC exactly
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[R]{${escapeLatex(drugName)}\\\\Module 5: Clinical Study Reports}
\\renewcommand{\\headrulewidth}{0.4pt}
\\fancyfoot[L]{Confidential}
\\fancyfoot[R]{${escapeLatex(companyName)}}
\\renewcommand{\\footrulewidth}{0.4pt}

\\begin{document}

${subsectionsContent}

\\end{document}
`
}

/**
 * Generates Section 5.3 LaTeX document with papers
 */
export async function generateSection53(controller: Controller, request: StringRequest): Promise<ProtoString> {
	try {
		const { drugName, productPath, result, selectedPapers } = JSON.parse(request.value || "{}") as GenerateSection53Request

		if (!drugName || !productPath || !result) {
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "Missing required parameters (drugName, productPath, or result)",
				}),
			})
		}

		if (!selectedPapers || selectedPapers.length === 0) {
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "No papers selected for generation",
				}),
			})
		}

		console.log(`[generateSection53] Generating LaTeX for ${drugName} with ${selectedPapers.length} papers`)

		// Get company name from state (matching 5.1 TOC)
		const stateManager = StateManager.get()
		const currentProduct = stateManager.getGlobalStateKey("currentRegulatoryProduct") as { companyName?: string } | undefined
		const companyName = currentProduct?.companyName || ""

		// Build set of selected PMIDs for quick lookup
		const selectedPmidSet = new Set(selectedPapers.map((p) => p.pmid))

		// Create a filtered result with only selected papers for Section 5.2 to use
		const filteredSections: Record<string, Section53Section> = {}
		let totalSelectedPapers = 0

		for (const [sectionId, section] of Object.entries(result.sections)) {
			const filteredPapers = section.papers.filter((p) => selectedPmidSet.has(p.pmid))
			filteredSections[sectionId] = {
				...section,
				papers: filteredPapers,
			}
			totalSelectedPapers += filteredPapers.length
		}

		const filteredResult: Section53Result = {
			...result,
			sections: filteredSections,
			summary: {
				...result.summary,
				totalUniquePapers: totalSelectedPapers,
			},
			combinedAt: new Date().toISOString(),
		}

		// Save the filtered result to global storage for Section 5.2 to use
		const globalStoragePath = path.join(HostProvider.get().globalStorageFsPath, "section53-papers")
		await fs.mkdir(globalStoragePath, { recursive: true })

		// Sanitize drug name for filename
		const sanitizedDrugName = drugName
			.replace(/[^\w\-_.]/g, "_")
			.replace(/_+/g, "_")
			.replace(/^_+|_+$/g, "")
		const selectedPapersPath = path.join(globalStoragePath, `${sanitizedDrugName}_5.3_papers.json`)

		// Overwrite the papers JSON with only selected papers
		await fs.writeFile(selectedPapersPath, JSON.stringify(filteredResult, null, 2), "utf-8")
		console.log(`[generateSection53] Updated papers JSON with ${totalSelectedPapers} selected papers: ${selectedPapersPath}`)

		// Generate LaTeX content with company name for footer
		const latexContent = generateSection53Latex(drugName, companyName, result, selectedPapers)

		// Determine output path
		const dossierPath = path.join(productPath, "dossier")
		const section53Path = path.join(dossierPath, "module-5", "section-5.3")
		const texPath = path.join(section53Path, "content.tex")

		// Ensure directory exists
		await fs.mkdir(section53Path, { recursive: true })

		// Write the LaTeX file
		await fs.writeFile(texPath, latexContent, "utf-8")
		console.log(`[generateSection53] LaTeX file written to: ${texPath}`)

		// Open the .tex file - LaTeX Workshop will auto-compile and show PDF
		try {
			await HostProvider.window.openFile({ filePath: texPath })
			console.log(`[generateSection53] Opened file: ${texPath}`)
		} catch (openError) {
			console.error(`[generateSection53] Failed to open file: ${openError}`)
		}

		return ProtoString.create({
			value: JSON.stringify({
				success: true,
				texPath,
				papersIncluded: selectedPapers.length,
			}),
		})
	} catch (error) {
		console.error("[generateSection53] Error:", error)
		return ProtoString.create({
			value: JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}),
		})
	}
}
