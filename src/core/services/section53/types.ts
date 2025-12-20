/**
 * TypeScript interfaces for Section 5.3 Paper Search functionality
 */

/**
 * Represents a single research paper from PubMed
 */
export interface Paper {
	title: string
	url: string
	pmid: string
	abstract: string
	authors: string[]
	journal: string
	year: string
	/** Optional: sections this paper is also relevant to */
	alsoRelevantTo?: string[]
	/** Optional: reason why this paper is relevant */
	relevanceReason?: string
}

/**
 * Represents a subsection within Module 5.3
 */
export interface Section {
	title: string
	description: string
	papers: Paper[]
}

/**
 * Parsed regulation structure from .txt files
 */
export interface RegulationSection {
	id: string
	title: string
	description: string
}

/**
 * Combined result structure for all 5.3 sections
 */
export interface CombinedPapersResult {
	drugName: string
	regulationSection: string
	sections: Record<string, Section>
	summary: {
		totalUniquePapers: number
		totalMentions: number
		papersBySection: Record<string, number>
		deduplicationStats: {
			duplicatesFound: number
			papersRemoved: number
		}
		sectionsProcessed: string[]
	}
	combinedAt: string
}

/**
 * Request for paper assessment
 */
export interface AssessSection53Request {
	drugName: string
	productPath: string
}

/**
 * Response from paper assessment
 */
export interface AssessSection53Response {
	success: boolean
	result?: CombinedPapersResult
	error?: string
}

/**
 * Paper selection state for UI
 */
export interface PaperSelection {
	sectionId: string
	pmid: string
	selected: boolean
}

/**
 * Generate request with selected papers
 */
export interface GenerateSection53Request {
	drugName: string
	productPath: string
	selectedPapers: PaperSelection[]
}

/**
 * PubMed search result
 */
export interface PubMedSearchResult {
	query: string
	count: number
	papers: Paper[]
}

/**
 * Section processing status for progress tracking
 */
export interface SectionProcessingStatus {
	sectionId: string
	status: "pending" | "searching" | "completed" | "error"
	papersFound?: number
	error?: string
}

/**
 * Overall assessment progress
 */
export interface AssessmentProgress {
	totalSections: number
	completedSections: number
	currentSection?: string
	sectionStatuses: SectionProcessingStatus[]
}
