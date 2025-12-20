/**
 * ICH Guidelines for CTD Section 2.3 (Quality Overall Summary)
 *
 * This file contains the ICH M4Q guidelines for each subsection of 2.3.
 * These guidelines are used by TaskSection23xy to generate the appropriate
 * content for each section.
 *
 * Reference: ICH M4Q(R1) - The Common Technical Document for the Registration
 * of Pharmaceuticals for Human Use: Quality
 *
 * To add/modify guidelines:
 * 1. Update the corresponding entry in SECTION_23_GUIDELINES
 * 2. Ensure ichInstructions matches the ICH M4Q text
 * 3. Update contentRequirements to list what should be included
 */

import * as path from "path"

/**
 * Configuration for a CTD Section 2.3 subsection
 */
export interface Section23Guidelines {
	/** Section ID (e.g., "2.3.S.2", "2.3.P.1") */
	sectionId: string

	/** Human-readable title */
	title: string

	/** ICH M4Q instructions for this section (from guidelines-2.3.md) */
	ichInstructions: string

	/**
	 * The corresponding Module 3 section pattern
	 * e.g., "3.2.S.2" for 2.3.S.2 - the agent will look up 3.2.S.2.x subsections
	 */
	referenceModule3Pattern: string

	/**
	 * List of content requirements extracted from ICH guidelines
	 * Used in Step 2 of the prompt to guide the model
	 */
	contentRequirements: string[]

	/** Optional timeout override in milliseconds (default: 600000 = 10 min) */
	timeoutMs?: number
}

/**
 * ICH Guidelines for all Section 2.3 subsections
 *
 * TODO: Fill in the ichInstructions from guidelines-2.3.md for each section
 */
export const SECTION_23_GUIDELINES: Record<string, Section23Guidelines> = {
	// ============================================================================
	// 2.3.S - DRUG SUBSTANCE
	// ============================================================================

	"2.3.S.1": {
		sectionId: "2.3.S.1",
		title: "General Information",
		referenceModule3Pattern: "3.2.S.1",
		ichInstructions: `General Information (name, manufacturer)
Information from 3.2.S.1 should be included.`,
		contentRequirements: [
			"Nomenclature (INN, chemical name, CAS number)",
			"Structure information",
			"General properties (physicochemical characteristics)",
		],
	},

	"2.3.S.2": {
		sectionId: "2.3.S.2",
		title: "Manufacture",
		referenceModule3Pattern: "3.2.S.2",
		ichInstructions: `Manufacture (name, manufacturer)
Information from 3.2.S.2 should be included:

Information on the manufacturer;

A brief description of the manufacturing process (including, for example, reference to
starting materials, critical steps, and reprocessing) and the controls that are intended to
result in the routine and consistent production of material(s) of appropriate quality;

A flow diagram, as provided in 3.2.S.2.2;

A description of the Source and Starting Material and raw materials of biological origin
used in the manufacture of the drug substance, as described in 3.2.S.2.3;

A discussion of the selection and justification of critical manufacturing steps, process
controls, and acceptance criteria. Highlight critical process intermediates, as described
in 3.2.S.2.4;

A description of process validation and/or evaluation, as described in 3.2.S.2.5.

A brief summary of major manufacturing changes made throughout development and
conclusions from the assessment used to evaluate product consistency, as described in
3.2.S.2.6. The QOS should also cross-refer to the non-clinical and clinical studies that
used batches affected by these manufacturing changes, as provided in the CTD-S and
CTD-E modules of the dossier.`,
		contentRequirements: [
			"Manufacturer information (name, address, responsibilities)",
			"Manufacturing process description and controls",
			"Flow diagram reference (from 3.2.S.2.2)",
			"Source and starting materials (including biological origin if applicable)",
			"Critical steps, process controls, and acceptance criteria",
			"Critical process intermediates",
			"Process validation/evaluation",
			"Manufacturing changes and product consistency assessment",
			"Cross-references to non-clinical and clinical studies using affected batches",
		],
	},

	"2.3.S.3": {
		sectionId: "2.3.S.3",
		title: "Characterisation",
		referenceModule3Pattern: "3.2.S.3",
		ichInstructions: `Characterisation (name, manufacturer)

For NCE:
A summary of the interpretation of evidence of structure and isomerism, as described
in 3.2.S.3.1, should be included.

When a drug substance is chiral, it should be specified whether specific stereoisomers
or a mixture of stereoisomers have been used in the nonclinical and clinical studies,
and information should be given as to the stereoisomer of the drug substance that is to
be used in the final product intended for marketing.

For Biotech:
A description of the desired product and product-related substances and a summary of
general properties, characteristic features and characterisation data (for example,
primary and higher order structure and biological activity), as described in 3.2.S.3.1,
should be included.

For NCE and Biotech:
The QOS should summarise the data on potential and actual impurities arising from
the synthesis, manufacture and/or degradation, and should summarise the basis for
setting the acceptance criteria for individual and total impurities. The QOS should also
summarise the impurity levels in batches of the drug substance used in the non-clinical
studies, in the clinical trials, and in typical batches manufactured by the proposed
commercial process. The QOS should state how the proposed impurity limits are
qualified.

A tabulated summary of the data provided in 3.2.S.3.2, with graphical representation, where
appropriate should be included.`,
		contentRequirements: [
			"Structure elucidation and isomerism evidence (NCE)",
			"Stereochemistry information for chiral substances",
			"Desired product and product-related substances (Biotech)",
			"Impurity data and acceptance criteria justification",
			"Impurity levels in non-clinical, clinical, and commercial batches",
			"Qualification of impurity limits",
			"Tabulated summary with graphical representation",
		],
	},

	"2.3.S.4": {
		sectionId: "2.3.S.4",
		title: "Control of Drug Substance",
		referenceModule3Pattern: "3.2.S.4",
		ichInstructions: `Control of Drug Substance (name, manufacturer)

A brief summary of the justification of the specification(s), the analytical procedures, and
validation should be included.

Specification from 3.2.S.4.1 should be provided.

A tabulated summary of the batch analyses from 3.2.S.4.4, with graphical representation
where appropriate, should be provided.`,
		contentRequirements: [
			"Justification of specifications",
			"Summary of analytical procedures and validation",
			"Specification table (from 3.2.S.4.1)",
			"Batch analyses tabulated summary with graphical representation",
		],
	},

	"2.3.S.5": {
		sectionId: "2.3.S.5",
		title: "Reference Standards or Materials",
		referenceModule3Pattern: "3.2.S.5",
		ichInstructions: `Reference Standards or Materials (name, manufacturer)

Information from 3.2.S.5 (tabulated presentation, where appropriate) should be included.`,
		contentRequirements: ["Reference standard information", "Tabulated presentation of reference materials"],
	},

	"2.3.S.6": {
		sectionId: "2.3.S.6",
		title: "Container Closure System",
		referenceModule3Pattern: "3.2.S.6",
		ichInstructions: `Container Closure System (name, manufacturer)

A brief description and discussion of the information, from 3.2.S.6 should be included.`,
		contentRequirements: ["Container closure system description", "Discussion of container closure suitability"],
	},

	"2.3.S.7": {
		sectionId: "2.3.S.7",
		title: "Stability",
		referenceModule3Pattern: "3.2.S.7",
		ichInstructions: `Stability (name, manufacturer)

This section should include a summary of the studies undertaken (conditions, batches,
analytical procedures) and a brief discussion of the results and conclusions, the proposed
storage conditions, retest date or shelf-life, where relevant, as described in 3.2.S.7.1.

The post-approval stability protocol, as described in 3.2.S.7.2, should be included.

A tabulated summary of the stability results from 3.2.S.7.3, with graphical representation
where appropriate, should be provided.`,
		contentRequirements: [
			"Summary of stability studies (conditions, batches, methods)",
			"Results and conclusions discussion",
			"Proposed storage conditions and retest date/shelf-life",
			"Post-approval stability protocol",
			"Tabulated stability results with graphical representation",
		],
	},

	// ============================================================================
	// 2.3.P - DRUG PRODUCT
	// ============================================================================

	"2.3.P.1": {
		sectionId: "2.3.P.1",
		title: "Description and Composition of the Drug Product",
		referenceModule3Pattern: "3.2.P.1",
		ichInstructions: `Description and Composition of the Drug Product (name, dosage form)

Information from 3.2.P.1 should be provided.

Composition from 3.2.P.1 should be provided.`,
		contentRequirements: ["Drug product description", "Composition table (qualitative and quantitative)"],
	},

	"2.3.P.2": {
		sectionId: "2.3.P.2",
		title: "Pharmaceutical Development",
		referenceModule3Pattern: "3.2.P.2",
		ichInstructions: `Pharmaceutical Development (name, dosage form)

A discussion of the information and data from 3.2.P.2 should be presented.

A tabulated summary of the composition of the formulations used in clinical trials and a
presentation of dissolution profiles should be provided, where relevant.`,
		contentRequirements: [
			"Pharmaceutical development discussion",
			"Formulation development rationale",
			"Clinical trial formulations composition (tabulated)",
			"Dissolution profiles (where relevant)",
		],
	},

	"2.3.P.3": {
		sectionId: "2.3.P.3",
		title: "Manufacture",
		referenceModule3Pattern: "3.2.P.3",
		ichInstructions: `Manufacture (name, dosage form)

Information from 3.2.P.3 should include:

Information on the manufacturer.

A brief description of the manufacturing process and the controls that are intended to
result in the routine and consistent production of product of appropriate quality.

A flow diagram, as provided under 3.2.P.3.3.

A brief description of the process validation and/or evaluation, as described in 3.2.P.3.5.`,
		contentRequirements: [
			"Manufacturer information",
			"Manufacturing process description",
			"Process controls for consistent quality",
			"Flow diagram (from 3.2.P.3.3)",
			"Process validation/evaluation description",
		],
	},

	"2.3.P.4": {
		sectionId: "2.3.P.4",
		title: "Control of Excipients",
		referenceModule3Pattern: "3.2.P.4",
		ichInstructions: `Control of Excipients (name, dosage form)

A brief summary on the quality of excipients, as described in 3.2.P.4, should be included.`,
		contentRequirements: ["Excipient quality summary", "Excipient specifications overview"],
	},

	"2.3.P.5": {
		sectionId: "2.3.P.5",
		title: "Control of Drug Product",
		referenceModule3Pattern: "3.2.P.5",
		ichInstructions: `Control of Drug Product (name, dosage form)

A brief summary of the justification of the specification(s), a summary of the analytical
procedures and validation, and characterisation of impurities should be provided.

Specification(s) from 3.2.P.5.1 should be provided.

A tabulated summary of the batch analyses provided under 3.2.P.5.4, with graphical
representation where appropriate should be included.`,
		contentRequirements: [
			"Justification of specifications",
			"Analytical procedures and validation summary",
			"Impurity characterisation",
			"Specifications table (from 3.2.P.5.1)",
			"Batch analyses tabulated summary with graphical representation",
		],
	},

	"2.3.P.6": {
		sectionId: "2.3.P.6",
		title: "Reference Standards or Materials",
		referenceModule3Pattern: "3.2.P.6",
		ichInstructions: `Reference Standards or Materials (name, dosage form)

Information from 3.2.P.6 (tabulated presentation, where appropriate) should be included.`,
		contentRequirements: ["Reference standard information", "Tabulated presentation of reference materials"],
	},

	"2.3.P.7": {
		sectionId: "2.3.P.7",
		title: "Container Closure System",
		referenceModule3Pattern: "3.2.P.7",
		ichInstructions: `Container Closure System (name, dosage form)

A brief description and discussion of the information in 3.2.P.7 should be included.`,
		contentRequirements: ["Container closure system description", "Suitability discussion"],
	},

	"2.3.P.8": {
		sectionId: "2.3.P.8",
		title: "Stability",
		referenceModule3Pattern: "3.2.P.8",
		ichInstructions: `Stability (name, dosage form)

A summary of the studies undertaken (conditions, batches, analytical procedures) and a
brief discussion of the results and conclusions of the stability studies and analysis of data
should be included. Conclusions with respect to storage conditions and shelf-life and, if
applicable, in-use storage conditions and shelf-life should be given.

A tabulated summary of the stability results from 3.2.P.8.3, with graphical representation
where appropriate, should be included.

The post-approval stability protocol, as described in 3.2.P.8.2, should be provided.`,
		contentRequirements: [
			"Stability studies summary (conditions, batches, methods)",
			"Results and conclusions discussion",
			"Storage conditions and shelf-life",
			"In-use storage conditions and shelf-life (if applicable)",
			"Tabulated stability results with graphical representation",
			"Post-approval stability protocol",
		],
	},

	// ============================================================================
	// 2.3.A - APPENDICES
	// ============================================================================

	"2.3.A.1": {
		sectionId: "2.3.A.1",
		title: "Facilities and Equipment",
		referenceModule3Pattern: "3.2.A.1",
		ichInstructions: `Facilities and Equipment (name, manufacturer)

Biotech:
A summary of facility information described under 3.2.A.1 should be included.`,
		contentRequirements: ["Facility information summary (for biotech products)", "Equipment overview"],
	},

	"2.3.A.2": {
		sectionId: "2.3.A.2",
		title: "Adventitious Agents Safety Evaluation",
		referenceModule3Pattern: "3.2.A.2",
		ichInstructions: `Adventitious Agents Safety Evaluation (name, dosage form, manufacturer)

A discussion on measures implemented to control endogenous and adventitious agents in
production should be included.

A tabulated summary of the reduction factors for viral clearance from 3.2.A.2, should be
provided.`,
		contentRequirements: [
			"Measures to control endogenous agents",
			"Measures to control adventitious agents",
			"Viral clearance reduction factors (tabulated)",
		],
	},

	"2.3.A.3": {
		sectionId: "2.3.A.3",
		title: "Excipients",
		referenceModule3Pattern: "3.2.A.3",
		ichInstructions: `Excipients

Information on novel excipients or excipients used for the first time in a pharmaceutical
product should be included.`,
		contentRequirements: ["Novel excipient information", "First-time use excipient details"],
	},

	// ============================================================================
	// 2.3.R - REGIONAL INFORMATION
	// ============================================================================

	"2.3.R": {
		sectionId: "2.3.R",
		title: "Regional Information",
		referenceModule3Pattern: "3.2.R",
		ichInstructions: `REGIONAL INFORMATION

A brief description of the information specific for the region, as provided under "3.2.R"
should be included, where appropriate.`,
		contentRequirements: ["Region-specific quality information"],
	},
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets the guidelines configuration for a specific section
 * @param sectionId - The section ID (e.g., "2.3.S.2")
 * @returns The section guidelines or undefined if not found
 */
export function getSectionGuidelines(sectionId: string): Section23Guidelines | undefined {
	return SECTION_23_GUIDELINES[sectionId]
}

/**
 * Gets the title for a section
 * @param sectionId - The section ID (e.g., "2.3.S.2")
 * @returns The section title or the section ID if not found
 */
export function getSectionTitle(sectionId: string): string {
	return SECTION_23_GUIDELINES[sectionId]?.title ?? sectionId
}

/**
 * Gets all available section IDs
 * @returns Array of all section IDs
 */
export function getAllSectionIds(): string[] {
	return Object.keys(SECTION_23_GUIDELINES)
}

/**
 * Builds the folder path for a section within the dossier
 * @param sectionId - The section ID (e.g., "2.3.S.2")
 * @param dossierPath - The base dossier path
 * @returns The full folder path for the section
 */
export function buildSectionFolderPath(sectionId: string, dossierPath: string): string {
	// Parse the section ID to build the path
	// e.g., "2.3.S.2" -> module-2/section-2.3/section-2.3.S/section-2.3.S.2
	const parts = sectionId.split(".")
	const moduleNum = parts[0] // "2"

	// Build the path incrementally
	const pathParts = [`module-${moduleNum}`]

	// Add each section level
	let currentSection = parts[0]
	for (let i = 1; i < parts.length; i++) {
		currentSection += "." + parts[i]
		pathParts.push(`section-${currentSection}`)
	}

	return path.join(dossierPath, ...pathParts)
}

/**
 * Gets the corresponding Module 3 section pattern for a 2.3 section
 * @param sectionId - The section ID (e.g., "2.3.S.2")
 * @returns The Module 3 pattern (e.g., "3.2.S.2")
 */
export function getModule3Pattern(sectionId: string): string {
	const guidelines = getSectionGuidelines(sectionId)
	if (guidelines) {
		return guidelines.referenceModule3Pattern
	}

	// Fallback: derive from section ID
	// 2.3.S.2 -> 3.2.S.2, 2.3.P.1 -> 3.2.P.1
	if (sectionId.startsWith("2.3.")) {
		const suffix = sectionId.substring(4) // Remove "2.3."
		return `3.2.${suffix}`
	}

	return sectionId
}

/**
 * Checks if a section ID is valid (exists in guidelines)
 * @param sectionId - The section ID to check
 * @returns True if the section exists in guidelines
 */
export function isValidSectionId(sectionId: string): boolean {
	return sectionId in SECTION_23_GUIDELINES
}

/**
 * Gets the timeout for a section (with default fallback)
 * @param sectionId - The section ID
 * @returns Timeout in milliseconds
 */
export function getSectionTimeout(sectionId: string): number {
	const guidelines = getSectionGuidelines(sectionId)
	return guidelines?.timeoutMs ?? 600000 // Default 10 minutes
}
