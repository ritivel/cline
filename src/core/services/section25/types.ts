/**
 * TypeScript interfaces for Section 2.5 (Clinical Overview) generation
 * Ported from multi_agent_section_writer.py
 */

/**
 * Represents a research paper from Section 5.3
 */
export interface Paper {
	title: string
	url: string
	pmid: string
	abstract: string
	authors: string[]
	journal: string
	year: string
	alsoRelevantTo?: string[]
	relevanceReason?: string
	sourceSection?: string
}

/**
 * Represents a subsection within the papers data
 */
export interface PaperSection {
	title: string
	description: string
	papers: Paper[]
}

/**
 * Combined papers result from Section 5.3 assessment
 */
export interface Section53PapersResult {
	drugName: string
	regulationSection: string
	sections: Record<string, PaperSection>
	summary: {
		totalUniquePapers: number
		totalMentions: number
		papersBySection: Record<string, number>
		deduplicationStats?: {
			duplicatesFound: number
			papersRemoved: number
		}
		sectionsProcessed: string[]
	}
	combinedAt: string
}

/**
 * Guidance content for a Section 2.5 subsection
 */
export interface GuidanceSection {
	id: string
	title: string
	description: string
}

/**
 * Quality thresholds for LaTeX validation
 */
export interface QualityThresholds {
	minLength: number
	maxLength: number
	minCitations: number
	minSections: number
	requiredElements: string[]
}

/**
 * Quality report for generated LaTeX content
 */
export interface QualityReport {
	isValid: boolean
	score: number
	issues: string[]
	suggestions: string[]
	latexErrors: string[]
	citationCount: number
	sectionCount: number
	wordCount: number
}

/**
 * Section dependency mapping
 */
export interface SectionDependencies {
	[sectionId: string]: string[]
}

/**
 * Section information for cross-referencing
 */
export interface SectionInfo {
	title: string
	description: string
}

/**
 * Mapping of 2.5.x sections to 5.3.x sections
 */
export interface SectionMapping {
	[section25Id: string]: string[]
}

/**
 * Request for Section 2.5 generation
 */
export interface GenerateSection25Request {
	drugName: string
	productPath: string
}

/**
 * Response from Section 2.5 generation
 */
export interface GenerateSection25Response {
	success: boolean
	texPath?: string
	error?: string
	qualityReport?: QualityReport
}

/**
 * Generated subsection content
 */
export interface SubsectionContent {
	sectionId: string
	latex: string
	qualityReport: QualityReport
}

/**
 * Section 2.5 titles mapping
 */
export const SECTION_TITLES: Record<string, string> = {
	"2.5": "Clinical Overview",
	"2.5.1": "Product Development Rationale",
	"2.5.2": "Overview of Biopharmaceutics",
	"2.5.3": "Overview of Clinical Pharmacology",
	"2.5.4": "Overview of Efficacy",
	"2.5.5": "Overview of Safety",
	"2.5.6": "Benefits and Risks Conclusions",
	"2.5.6.1": "Therapeutic Context",
	"2.5.6.1.1": "Disease or Condition",
	"2.5.6.1.2": "Current Therapies",
	"2.5.6.2": "Benefits",
	"2.5.6.3": "Risks",
	"2.5.6.4": "Benefit-Risk Assessment",
	"2.5.7": "Literature References",
}

/**
 * Section dependencies - which sections depend on which
 */
export const SECTION_DEPENDENCIES: SectionDependencies = {
	"2.5": [],
	"2.5.1": [],
	"2.5.2": ["2.5.1"],
	"2.5.3": ["2.5.2"],
	"2.5.4": ["2.5.3"],
	"2.5.5": ["2.5.3", "2.5.4"],
	"2.5.6": ["2.5.4", "2.5.5"],
	"2.5.6.1": ["2.5.1", "2.5.6"],
	"2.5.6.1.1": ["2.5.6.1"],
	"2.5.6.1.2": ["2.5.6.1"],
	"2.5.6.2": ["2.5.4", "2.5.6"],
	"2.5.6.3": ["2.5.5", "2.5.6"],
	"2.5.6.4": ["2.5.4", "2.5.5", "2.5.6.2", "2.5.6.3", "2.5.6"],
	"2.5.7": [],
}

/**
 * Mapping of Section 2.5.x to corresponding 5.3.x sections for paper relevance
 */
export const SECTION_25_TO_53_MAPPING: SectionMapping = {
	"2.5": ["5.3.1", "5.3.5"], // Intro references key studies
	"2.5.1": ["5.3.1", "5.3.1.1", "5.3.1.2", "5.3.3", "5.3.3.1", "5.3.3.2"],
	"2.5.2": ["5.3.1", "5.3.1.1", "5.3.1.2", "5.3.1.3", "5.3.1.4"],
	"2.5.3": [
		"5.3.2",
		"5.3.2.1",
		"5.3.2.2",
		"5.3.2.3",
		"5.3.3",
		"5.3.3.1",
		"5.3.3.2",
		"5.3.3.3",
		"5.3.3.4",
		"5.3.3.5",
		"5.3.4",
		"5.3.4.1",
		"5.3.4.2",
	],
	"2.5.4": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
	"2.5.5": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
	"2.5.6": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
	"2.5.6.1": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
	"2.5.6.2": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3"],
	"2.5.6.3": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.6"],
	"2.5.6.4": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
	"2.5.7": [], // References section uses all papers
}

/**
 * Default quality thresholds
 */
export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
	minLength: 500,
	maxLength: 50000,
	minCitations: 1,
	minSections: 1,
	requiredElements: ["\\section*", "\\label"],
}
