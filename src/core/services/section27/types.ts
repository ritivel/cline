/**
 * TypeScript interfaces for Section 2.7 (Clinical Summary) generation
 * Ported from multi_agent_section_writer_2_7.py
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
 * Guidance content for a Section 2.7 subsection
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
 * Mapping of 2.7.x sections to 5.3.x sections
 */
export interface SectionMapping {
	[section27Id: string]: string[]
}

/**
 * Request for Section 2.7 generation
 */
export interface GenerateSection27Request {
	drugName: string
	productPath: string
}

/**
 * Response from Section 2.7 generation
 */
export interface GenerateSection27Response {
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
 * Section 2.7 titles mapping - all 27 sections
 */
export const SECTION_TITLES: Record<string, string> = {
	"2.7": "Clinical Summary",
	"2.7.1": "Summary of Biopharmaceutic Studies and Associated Analytical Methods",
	"2.7.1.1": "Background and Overview",
	"2.7.1.2": "Summary of Results of Individual Studies",
	"2.7.1.3": "Comparison and Analyses of Results Across Studies",
	"2.7.1.4": "Appendix",
	"2.7.2": "Summary of Clinical Pharmacology Studies",
	"2.7.2.1": "Background and Overview",
	"2.7.2.2": "Summary of Results of Individual Studies",
	"2.7.2.3": "Comparison and Analyses of Results Across Studies",
	"2.7.2.4": "Special Studies",
	"2.7.2.5": "Appendix",
	"2.7.3": "Summary of Clinical Efficacy",
	"2.7.3.1": "Background and Overview of Clinical Efficacy",
	"2.7.3.2": "Summary of Results of Individual Studies",
	"2.7.3.3": "Comparison and Analyses of Results Across Studies",
	"2.7.3.4": "Analysis of Clinical Information Relevant to Dosing Recommendations",
	"2.7.3.5": "Persistence of Efficacy and/or Tolerance Effects",
	"2.7.3.6": "Appendix",
	"2.7.4": "Summary of Clinical Safety",
	"2.7.4.1": "Exposure to the Drug",
	"2.7.4.2": "Adverse Events",
	"2.7.4.3": "Clinical Laboratory Evaluations",
	"2.7.4.4": "Vital Signs, Physical Findings, and Other Observations Related to Safety",
	"2.7.4.5": "Safety in Special Groups and Situations",
	"2.7.4.6": "Post-marketing Data",
	"2.7.4.7": "Appendix",
	"2.7.5": "Literature References",
	"2.7.6": "Synopses of Individual Studies",
}

/**
 * Section dependencies - which sections depend on which
 */
export const SECTION_DEPENDENCIES: SectionDependencies = {
	"2.7": [], // Preamble - no dependencies
	// Section 2.7.1 - Biopharmaceutics
	"2.7.1": [], // Standalone section
	"2.7.1.1": ["2.7.1"], // Background depends on parent
	"2.7.1.2": ["2.7.1.1"], // Individual studies depends on background
	"2.7.1.3": ["2.7.1.1", "2.7.1.2"], // Cross-study analysis depends on background and individual studies
	"2.7.1.4": ["2.7.1.1", "2.7.1.2", "2.7.1.3"], // Appendix depends on all prior subsections
	// Section 2.7.2 - Clinical Pharmacology
	"2.7.2": ["2.7.1"], // Depends on biopharmaceutics section
	"2.7.2.1": ["2.7.2"], // Background depends on parent
	"2.7.2.2": ["2.7.2.1"], // Individual studies depends on background
	"2.7.2.3": ["2.7.2.1", "2.7.2.2"], // Cross-study analysis
	"2.7.2.4": ["2.7.2.1", "2.7.2.2"], // Special studies
	"2.7.2.5": ["2.7.2.1", "2.7.2.2", "2.7.2.3", "2.7.2.4"], // Appendix
	// Section 2.7.3 - Clinical Efficacy
	"2.7.3": ["2.7.2"], // Depends on clinical pharmacology
	"2.7.3.1": ["2.7.3"], // Background depends on parent
	"2.7.3.2": ["2.7.3.1"], // Individual studies
	"2.7.3.3": ["2.7.3.1", "2.7.3.2"], // Cross-study analysis
	"2.7.3.4": ["2.7.3.1", "2.7.3.2", "2.7.3.3"], // Dosing recommendations
	"2.7.3.5": ["2.7.3.1", "2.7.3.2", "2.7.3.3"], // Persistence of efficacy
	"2.7.3.6": ["2.7.3.1", "2.7.3.2", "2.7.3.3", "2.7.3.4", "2.7.3.5"], // Appendix
	// Section 2.7.4 - Clinical Safety
	"2.7.4": ["2.7.3"], // Safety depends on efficacy
	"2.7.4.1": ["2.7.4"], // Exposure depends on parent
	"2.7.4.2": ["2.7.4.1"], // Adverse events depends on exposure
	"2.7.4.3": ["2.7.4.1", "2.7.4.2"], // Lab evaluations
	"2.7.4.4": ["2.7.4.1", "2.7.4.2"], // Vital signs
	"2.7.4.5": ["2.7.4.1", "2.7.4.2", "2.7.4.3"], // Special groups
	"2.7.4.6": ["2.7.4.1", "2.7.4.2"], // Post-marketing
	"2.7.4.7": ["2.7.4.1", "2.7.4.2", "2.7.4.3", "2.7.4.4", "2.7.4.5", "2.7.4.6"], // Appendix
	// Section 2.7.5 - Literature References (can be written anytime)
	"2.7.5": [],
	// Section 2.7.6 - Synopses (depends on all prior sections)
	"2.7.6": ["2.7.1", "2.7.2", "2.7.3", "2.7.4"],
}

/**
 * Mapping of Section 2.7.x to corresponding 5.3.x sections for paper relevance
 */
export const SECTION_27_TO_53_MAPPING: SectionMapping = {
	// Main section mappings
	"2.7": ["5.3.1", "5.3.5"], // Intro references key studies
	"2.7.1": ["5.3.1", "5.3.1.1", "5.3.1.2", "5.3.1.3", "5.3.1.4"], // Biopharmaceutics
	"2.7.2": [
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
	], // Clinical Pharmacology
	"2.7.3": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"], // Clinical Efficacy
	"2.7.4": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"], // Clinical Safety
	"2.7.5": [], // References section - all papers are relevant
	"2.7.6": [], // Synopses - all papers are relevant

	// 2.7.1.x - Biopharmaceutics subsections
	"2.7.1.1": ["5.3.1", "5.3.1.1", "5.3.1.2"],
	"2.7.1.2": ["5.3.1", "5.3.1.1", "5.3.1.2", "5.3.1.3", "5.3.1.4"],
	"2.7.1.3": ["5.3.1", "5.3.1.1", "5.3.1.2", "5.3.1.3", "5.3.1.4"],
	"2.7.1.4": ["5.3.1", "5.3.1.1", "5.3.1.2", "5.3.1.3", "5.3.1.4"],

	// 2.7.2.x - Clinical Pharmacology subsections
	"2.7.2.1": ["5.3.2", "5.3.2.1", "5.3.2.2", "5.3.2.3", "5.3.3", "5.3.3.1", "5.3.4", "5.3.4.1"],
	"2.7.2.2": [
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
	"2.7.2.3": [
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
	"2.7.2.4": ["5.3.2", "5.3.3", "5.3.4"], // Special studies (immunogenicity, etc.)
	"2.7.2.5": ["5.3.2", "5.3.3", "5.3.4"],

	// 2.7.3.x - Clinical Efficacy subsections
	"2.7.3.1": ["5.3.5", "5.3.5.1"],
	"2.7.3.2": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
	"2.7.3.3": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
	"2.7.3.4": ["5.3.3", "5.3.3.5", "5.3.5", "5.3.5.1", "5.3.5.2"], // Dosing - includes PK/PD
	"2.7.3.5": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
	"2.7.3.6": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],

	// 2.7.4.x - Clinical Safety subsections
	"2.7.4.1": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
	"2.7.4.2": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
	"2.7.4.3": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
	"2.7.4.4": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
	"2.7.4.5": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
	"2.7.4.6": ["5.3.6"],
	"2.7.4.7": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
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
