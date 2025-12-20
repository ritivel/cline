/**
 * EAC-NMRA CTD Template Definition
 *
 * This is the source of truth for:
 * - Dossier folder structure
 * - Classification prompts (via classification hints)
 * - Section parent-child relationships
 *
 * Run `npm run generate-ctd-prompts` after modifying this file.
 */

import { CTDModuleDef, CTDTemplate } from "../../types"

const MODULE_1: CTDModuleDef = {
	moduleNumber: 1,
	title: "Administrative Information and Product Information",
	description:
		"Administrative documents including cover letters, product information, labeling, GMP certificates, and regulatory status information",
	sections: {
		"1.1": {
			id: "1.1",
			title: "Comprehensive Table of Contents for all Modules",
			classification: {
				keywords: ["table of contents", "TOC", "index", "contents list"],
				documentTypes: ["table of contents", "index document"],
			},
		},
		"1.2": {
			id: "1.2",
			title: "Cover letter",
			classification: {
				keywords: ["cover letter", "application letter", "submission letter", "transmittal"],
				documentTypes: ["cover letter", "application form"],
			},
		},
		"1.3": {
			id: "1.3",
			title: "Comprehensive Table of Content",
			classification: {
				keywords: ["table of contents", "document list", "CTD structure"],
				documentTypes: ["table of contents"],
			},
		},
		"1.4": {
			id: "1.4",
			title: "Quality Information Summary (QIS)",
			classification: {
				keywords: ["quality summary", "QIS", "quality overview", "quality information"],
				documentTypes: ["quality summary", "QIS document"],
			},
		},
		"1.5": {
			id: "1.5",
			title: "Product Information",
			children: ["1.5.1", "1.5.2", "1.5.3", "1.5.4"],
			classification: {
				keywords: ["product information", "labeling", "prescribing", "package insert"],
				documentTypes: ["SPC", "PIL", "labeling"],
			},
		},
		"1.5.1": {
			id: "1.5.1",
			title: "Prescribing Information (Summary of Product Characteristics)",
			classification: {
				keywords: ["SPC", "SmPC", "prescribing information", "product characteristics", "summary of product"],
				documentTypes: ["SPC", "SmPC", "prescribing information"],
			},
		},
		"1.5.2": {
			id: "1.5.2",
			title: "Container Labelling",
			classification: {
				keywords: ["label", "container label", "packaging label", "carton", "blister"],
				documentTypes: ["label artwork", "container label"],
			},
		},
		"1.5.3": {
			id: "1.5.3",
			title: "Patient Information leaflet (PIL)",
			classification: {
				keywords: ["PIL", "patient leaflet", "package leaflet", "patient information"],
				documentTypes: ["PIL", "patient leaflet", "package insert"],
			},
		},
		"1.5.4": {
			id: "1.5.4",
			title: "Mock-ups and Specimens",
			classification: {
				keywords: ["mock-up", "specimen", "packaging mock", "artwork", "visual"],
				documentTypes: ["mock-up", "specimen", "artwork"],
			},
		},
		"1.6": {
			id: "1.6",
			title: "Information about the Experts",
			classification: {
				keywords: ["expert", "qualified person", "QP", "expert CV", "declaration"],
				documentTypes: ["expert CV", "expert declaration", "QP statement"],
			},
		},
		"1.7": {
			id: "1.7",
			title: "APIMFs and certificates of suitability to the monographs of the European Pharmacopoeia",
			classification: {
				keywords: ["APIMF", "CEP", "certificate of suitability", "TSE", "BSE", "pharmacopoeia"],
				documentTypes: ["APIMF", "CEP", "certificate"],
			},
		},
		"1.8": {
			id: "1.8",
			title: "Good Manufacturing Practice (GMP)",
			classification: {
				keywords: ["GMP", "manufacturing license", "manufacturing authorization", "WHO prequalification"],
				documentTypes: ["GMP certificate", "manufacturing license", "site master file"],
			},
		},
		"1.9": {
			id: "1.9",
			title: "Regulatory status within EAC and in Countries with SRAs",
			children: ["1.9.1", "1.9.2", "1.9.3", "1.9.4"],
			classification: {
				keywords: ["regulatory status", "marketing authorization", "approval status", "SRA"],
				documentTypes: ["regulatory status", "approval letter"],
			},
		},
		"1.9.1": {
			id: "1.9.1",
			title: "List of Countries in EAC and Countries With SRAs In Which A Similar Application has been Submitted",
			classification: {
				keywords: ["country list", "submission list", "application status", "filing status"],
				documentTypes: ["country list", "submission status"],
			},
		},
		"1.9.2": {
			id: "1.9.2",
			title: "Evaluation Reports from EAC-NMRA",
			classification: {
				keywords: ["EAC evaluation", "NMRA report", "assessment report", "EAC assessment"],
				documentTypes: ["evaluation report", "assessment report"],
			},
		},
		"1.9.3": {
			id: "1.9.3",
			title: "Evaluation Reports from SRAs",
			classification: {
				keywords: ["SRA evaluation", "FDA approval", "EMA assessment", "WHO PQ", "reference authority"],
				documentTypes: ["SRA evaluation report", "approval letter", "assessment report"],
			},
		},
		"1.9.4": {
			id: "1.9.4",
			title: "Manufacturing and Marketing Authorization",
			classification: {
				keywords: ["marketing authorization", "MA", "approval letter", "registration certificate"],
				documentTypes: ["marketing authorization", "registration certificate", "approval letter"],
			},
		},
		"1.10": {
			id: "1.10",
			title: "Paediatric Development Program",
			classification: {
				keywords: ["paediatric", "pediatric", "children", "PIP", "paediatric investigation"],
				documentTypes: ["paediatric plan", "PIP", "paediatric study"],
			},
		},
		"1.11": {
			id: "1.11",
			title: "Product Samples",
			classification: {
				keywords: ["sample", "product sample", "reference sample"],
				documentTypes: ["sample information", "sample list"],
			},
		},
		"1.13": {
			id: "1.13",
			title: "Submission of Risk Management (RMP)",
			classification: {
				keywords: ["RMP", "risk management", "pharmacovigilance", "risk minimization"],
				documentTypes: ["RMP", "risk management plan"],
			},
		},
	},
}

const MODULE_2: CTDModuleDef = {
	moduleNumber: 2,
	title: "Overview and Summaries",
	description:
		"Summaries and overviews of quality, nonclinical, and clinical information including QOS, clinical overview, and nonclinical summaries",
	sections: {
		"2.1": {
			id: "2.1",
			title: "Table of Contents of Module 2",
			classification: {
				keywords: ["table of contents", "module 2 contents", "summary contents"],
				documentTypes: ["table of contents"],
			},
		},
		"2.2": {
			id: "2.2",
			title: "CTD Introduction",
			classification: {
				keywords: ["introduction", "CTD introduction", "dossier introduction", "product introduction"],
				documentTypes: ["introduction document"],
			},
		},
		"2.3": {
			id: "2.3",
			title: "Quality Overall Summary - Product Dossiers (QOS-PD)",
			// children: ["2.3.S", "2.3.P", "2.3.A", "2.3.R"],
			classification: {
				keywords: ["QOS", "quality overall summary", "quality summary", "QOS-PD"],
				documentTypes: ["QOS", "quality overall summary"],
			},
		},
		// "2.3.S": {
		// 	id: "2.3.S",
		// 	title: "Drug Substance",
		// 	children: ["2.3.S.1", "2.3.S.2", "2.3.S.3", "2.3.S.4", "2.3.S.5", "2.3.S.6", "2.3.S.7"],
		// 	classification: {
		// 		keywords: ["QOS drug substance", "QOS API", "quality summary drug substance"],
		// 		documentTypes: ["QOS drug substance section"],
		// 	},
		// },
		// "2.3.S.1": {
		// 	id: "2.3.S.1",
		// 	title: "General Information",
		// 	classification: {
		// 		keywords: ["QOS general information", "drug substance general", "API general"],
		// 		documentTypes: ["QOS general information"],
		// 	},
		// },
		// "2.3.S.2": {
		// 	id: "2.3.S.2",
		// 	title: "Manufacture",
		// 	classification: {
		// 		keywords: ["QOS manufacture", "drug substance manufacture", "API manufacture"],
		// 		documentTypes: ["QOS manufacture"],
		// 	},
		// },
		// "2.3.S.3": {
		// 	id: "2.3.S.3",
		// 	title: "Characterisation",
		// 	classification: {
		// 		keywords: ["QOS characterisation", "drug substance characterisation", "API characterisation"],
		// 		documentTypes: ["QOS characterisation"],
		// 	},
		// },
		// "2.3.S.4": {
		// 	id: "2.3.S.4",
		// 	title: "Control of Drug Substance",
		// 	classification: {
		// 		keywords: ["QOS control", "drug substance control", "API control"],
		// 		documentTypes: ["QOS control of drug substance"],
		// 	},
		// },
		// "2.3.S.5": {
		// 	id: "2.3.S.5",
		// 	title: "Reference Standards or Materials",
		// 	classification: {
		// 		keywords: ["QOS reference standards", "drug substance reference standards", "API reference standards"],
		// 		documentTypes: ["QOS reference standards"],
		// 	},
		// },
		// "2.3.S.6": {
		// 	id: "2.3.S.6",
		// 	title: "Container Closure System",
		// 	classification: {
		// 		keywords: ["QOS container closure", "drug substance container", "API container"],
		// 		documentTypes: ["QOS container closure"],
		// 	},
		// },
		// "2.3.S.7": {
		// 	id: "2.3.S.7",
		// 	title: "Stability",
		// 	classification: {
		// 		keywords: ["QOS stability", "drug substance stability", "API stability"],
		// 		documentTypes: ["QOS stability"],
		// 	},
		// },
		// "2.3.P": {
		// 	id: "2.3.P",
		// 	title: "Drug Product",
		// 	children: ["2.3.P.1", "2.3.P.2", "2.3.P.3", "2.3.P.4", "2.3.P.5", "2.3.P.6", "2.3.P.7", "2.3.P.8"],
		// 	classification: {
		// 		keywords: ["QOS drug product", "QOS FPP", "quality summary drug product"],
		// 		documentTypes: ["QOS drug product section"],
		// 	},
		// },
		// "2.3.P.1": {
		// 	id: "2.3.P.1",
		// 	title: "Description and Composition of the Drug Product",
		// 	classification: {
		// 		keywords: ["QOS composition", "drug product composition", "FPP composition"],
		// 		documentTypes: ["QOS composition"],
		// 	},
		// },
		// "2.3.P.2": {
		// 	id: "2.3.P.2",
		// 	title: "Pharmaceutical Development",
		// 	classification: {
		// 		keywords: ["QOS pharmaceutical development", "drug product development", "FPP development"],
		// 		documentTypes: ["QOS pharmaceutical development"],
		// 	},
		// },
		// "2.3.P.3": {
		// 	id: "2.3.P.3",
		// 	title: "Manufacture",
		// 	classification: {
		// 		keywords: ["QOS manufacture", "drug product manufacture", "FPP manufacture"],
		// 		documentTypes: ["QOS manufacture"],
		// 	},
		// },
		// "2.3.P.4": {
		// 	id: "2.3.P.4",
		// 	title: "Control of Excipients",
		// 	classification: {
		// 		keywords: ["QOS excipients", "drug product excipients", "FPP excipients"],
		// 		documentTypes: ["QOS excipients"],
		// 	},
		// },
		// "2.3.P.5": {
		// 	id: "2.3.P.5",
		// 	title: "Control of Drug Product",
		// 	classification: {
		// 		keywords: ["QOS control", "drug product control", "FPP control"],
		// 		documentTypes: ["QOS control of drug product"],
		// 	},
		// },
		// "2.3.P.6": {
		// 	id: "2.3.P.6",
		// 	title: "Reference Standards or Materials",
		// 	classification: {
		// 		keywords: ["QOS reference standards", "drug product reference standards", "FPP reference standards"],
		// 		documentTypes: ["QOS reference standards"],
		// 	},
		// },
		// "2.3.P.7": {
		// 	id: "2.3.P.7",
		// 	title: "Container Closure System",
		// 	classification: {
		// 		keywords: ["QOS container closure", "drug product container", "FPP container"],
		// 		documentTypes: ["QOS container closure"],
		// 	},
		// },
		// "2.3.P.8": {
		// 	id: "2.3.P.8",
		// 	title: "Stability",
		// 	classification: {
		// 		keywords: ["QOS stability", "drug product stability", "FPP stability"],
		// 		documentTypes: ["QOS stability"],
		// 	},
		// },
		// "2.3.A": {
		// 	id: "2.3.A",
		// 	title: "Appendices",
		// 	children: ["2.3.A.1", "2.3.A.2", "2.3.A.3"],
		// 	classification: {
		// 		keywords: ["QOS appendices", "quality summary appendices"],
		// 		documentTypes: ["QOS appendices"],
		// 	},
		// },
		// "2.3.A.1": {
		// 	id: "2.3.A.1",
		// 	title: "Facilities and Equipment",
		// 	classification: {
		// 		keywords: ["QOS facilities", "QOS equipment", "manufacturing facilities"],
		// 		documentTypes: ["QOS facilities and equipment"],
		// 	},
		// },
		// "2.3.A.2": {
		// 	id: "2.3.A.2",
		// 	title: "Adventitious Agents Safety Evaluation",
		// 	classification: {
		// 		keywords: ["QOS adventitious agents", "safety evaluation", "viral safety"],
		// 		documentTypes: ["QOS adventitious agents"],
		// 	},
		// },
		// "2.3.A.3": {
		// 	id: "2.3.A.3",
		// 	title: "Excipients",
		// 	classification: {
		// 		keywords: ["QOS excipients appendix", "excipient information"],
		// 		documentTypes: ["QOS excipients appendix"],
		// 	},
		// },
		// "2.3.R": {
		// 	id: "2.3.R",
		// 	title: "Regional Information",
		// 	classification: {
		// 		keywords: ["QOS regional", "regional information", "country-specific QOS"],
		// 		documentTypes: ["QOS regional information"],
		// 	},
		// },
		"2.4": {
			id: "2.4",
			title: "Nonclinical Overview for New Chemical Entities",
			classification: {
				keywords: ["nonclinical overview", "preclinical overview", "toxicology overview", "pharmacology overview"],
				documentTypes: ["nonclinical overview"],
			},
		},
		"2.5": {
			id: "2.5",
			title: "Clinical Overview",
			children: ["2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.5", "2.5.6", "2.5.7"],
			classification: {
				keywords: ["clinical overview", "clinical summary", "efficacy overview", "safety overview"],
				documentTypes: ["clinical overview"],
			},
		},
		"2.5.1": {
			id: "2.5.1",
			title: "Product Development Rationale",
			classification: {
				keywords: ["development rationale", "product rationale", "therapeutic rationale"],
				documentTypes: ["development rationale"],
			},
		},
		"2.5.2": {
			id: "2.5.2",
			title: "Overview of Bio-pharmaceutics",
			classification: {
				keywords: ["biopharmaceutics overview", "BA overview", "BE overview", "formulation overview"],
				documentTypes: ["biopharmaceutics overview"],
			},
		},
		"2.5.3": {
			id: "2.5.3",
			title: "Overview of Clinical Pharmacology",
			classification: {
				keywords: ["clinical pharmacology", "PK overview", "PD overview", "pharmacology overview"],
				documentTypes: ["clinical pharmacology overview"],
			},
		},
		"2.5.4": {
			id: "2.5.4",
			title: "Overview of Efficacy",
			classification: {
				keywords: ["efficacy overview", "therapeutic efficacy", "clinical efficacy"],
				documentTypes: ["efficacy overview"],
			},
		},
		"2.5.5": {
			id: "2.5.5",
			title: "Overview of Safety",
			classification: {
				keywords: ["safety overview", "adverse events", "safety summary", "tolerability"],
				documentTypes: ["safety overview"],
			},
		},
		"2.5.6": {
			id: "2.5.6",
			title: "Benefits and Risks Conclusions",
			classification: {
				keywords: ["benefit-risk", "benefits and risks", "risk-benefit", "conclusions"],
				documentTypes: ["benefit-risk assessment"],
			},
		},
		"2.5.7": {
			id: "2.5.7",
			title: "Literature References",
			classification: {
				keywords: ["literature", "references", "bibliography", "citations"],
				documentTypes: ["literature references", "bibliography"],
			},
		},
		"2.6": {
			id: "2.6",
			title: "Nonclinical Written and Tabulated Summaries",
			children: ["2.6.1", "2.6.2", "2.6.3", "2.6.4", "2.6.5", "2.6.6", "2.6.7", "2.6.8"],
			classification: {
				keywords: ["nonclinical summary", "preclinical summary", "toxicology summary"],
				documentTypes: ["nonclinical summary"],
			},
		},
		"2.6.1": {
			id: "2.6.1",
			title: "Nonclinical Written Summaries",
			classification: {
				keywords: ["nonclinical written", "preclinical written summary"],
				documentTypes: ["nonclinical written summary"],
			},
		},
		"2.6.2": {
			id: "2.6.2",
			title: "Introduction",
			classification: {
				keywords: ["nonclinical introduction", "preclinical introduction"],
				documentTypes: ["nonclinical introduction"],
			},
		},
		"2.6.3": {
			id: "2.6.3",
			title: "Pharmacology Written Summary",
			classification: {
				keywords: ["pharmacology summary", "pharmacology written"],
				documentTypes: ["pharmacology summary"],
			},
		},
		"2.6.4": {
			id: "2.6.4",
			title: "Pharmacology Tabulated Summary",
			classification: {
				keywords: ["pharmacology tabulated", "pharmacology tables"],
				documentTypes: ["pharmacology tabulated summary"],
			},
		},
		"2.6.5": {
			id: "2.6.5",
			title: "Pharmacokinetics Written Summary",
			classification: {
				keywords: ["PK summary", "pharmacokinetics written", "ADME summary"],
				documentTypes: ["pharmacokinetics summary"],
			},
		},
		"2.6.6": {
			id: "2.6.6",
			title: "Pharmacokinetics Tabulated Summary",
			classification: {
				keywords: ["PK tabulated", "pharmacokinetics tables"],
				documentTypes: ["pharmacokinetics tabulated summary"],
			},
		},
		"2.6.7": {
			id: "2.6.7",
			title: "Toxicology Written Summary",
			classification: {
				keywords: ["toxicology summary", "toxicology written", "tox summary"],
				documentTypes: ["toxicology summary"],
			},
		},
		"2.6.8": {
			id: "2.6.8",
			title: "Toxicology Tabulated Summary Nonclinical Tabulated Summaries",
			classification: {
				keywords: ["toxicology tabulated", "toxicology tables", "nonclinical tables"],
				documentTypes: ["toxicology tabulated summary"],
			},
		},
		"2.7": {
			id: "2.7",
			title: "Clinical Summary",
			children: ["2.7.1"],
			classification: {
				keywords: ["clinical summary", "clinical data summary"],
				documentTypes: ["clinical summary"],
			},
		},
		"2.7.1": {
			id: "2.7.1",
			title: "Summary of Biopharmaceutical Studies and Associated Analytical Methods",
			children: ["2.7.1.1", "2.7.1.2", "2.7.1.3"],
			classification: {
				keywords: ["biopharmaceutical summary", "BA/BE summary", "bioanalytical summary"],
				documentTypes: ["biopharmaceutical summary"],
			},
		},
		"2.7.1.1": {
			id: "2.7.1.1",
			title: "Background and Overview",
			classification: {
				keywords: ["background", "overview", "biopharmaceutical background"],
				documentTypes: ["background document"],
			},
		},
		"2.7.1.2": {
			id: "2.7.1.2",
			title: "Summary of Results of Individual Studies",
			classification: {
				keywords: ["study results summary", "individual study summary", "results summary"],
				documentTypes: ["study results summary"],
			},
		},
		"2.7.1.3": {
			id: "2.7.1.3",
			title: "Comparison and Analyses of Results Across Studies",
			classification: {
				keywords: ["cross-study analysis", "comparison of results", "integrated analysis"],
				documentTypes: ["cross-study comparison"],
			},
		},
	},
}

const MODULE_3: CTDModuleDef = {
	moduleNumber: 3,
	title: "Quality",
	description:
		"Quality documentation for drug substance (API) and drug product (FPP) including specifications, manufacturing, stability, and analytical methods",
	sections: {
		"3.1": {
			id: "3.1",
			title: "Table of Contents of Module 3",
			classification: {
				keywords: ["table of contents", "module 3 contents", "quality contents"],
				documentTypes: ["table of contents"],
			},
		},
		"3.2": {
			id: "3.2",
			title: "Body of Data",
			children: ["3.2.S", "3.2.P", "3.2.R"],
			classification: {
				keywords: ["quality data", "body of data"],
				documentTypes: ["quality data"],
			},
		},
		"3.2.S": {
			id: "3.2.S",
			title: "Drug Substance (Active Pharmaceutical Ingredient (API))",
			children: ["3.2.S.1", "3.2.S.2", "3.2.S.3", "3.2.S.4", "3.2.S.5", "3.2.S.6", "3.2.S.7"],
			classification: {
				keywords: ["API", "drug substance", "active ingredient", "active pharmaceutical"],
				documentTypes: ["API documentation", "drug substance data"],
				excludeFrom: ["3.2.P"],
				description: "Information about the active pharmaceutical ingredient",
			},
		},
		"3.2.S.1": {
			id: "3.2.S.1",
			title: "General Information",
			children: ["3.2.S.1.1", "3.2.S.1.2", "3.2.S.1.3"],
			classification: {
				keywords: ["API general", "nomenclature", "structure", "general properties"],
				documentTypes: ["API general information"],
			},
		},
		"3.2.S.1.1": {
			id: "3.2.S.1.1",
			title: "Nomenclature",
			classification: {
				keywords: ["nomenclature", "INN", "chemical name", "CAS number", "API name"],
				documentTypes: ["nomenclature document"],
			},
		},
		"3.2.S.1.2": {
			id: "3.2.S.1.2",
			title: "Structure",
			classification: {
				keywords: ["structure", "molecular structure", "stereochemistry", "polymorphism"],
				documentTypes: ["structure elucidation", "molecular structure"],
			},
		},
		"3.2.S.1.3": {
			id: "3.2.S.1.3",
			title: "General Properties",
			classification: {
				keywords: ["general properties", "physicochemical", "solubility", "pKa", "partition coefficient"],
				documentTypes: ["general properties document"],
			},
		},
		"3.2.S.2": {
			id: "3.2.S.2",
			title: "Manufacture",
			children: ["3.2.S.2.1", "3.2.S.2.2", "3.2.S.2.3", "3.2.S.2.4", "3.2.S.2.5"],
			classification: {
				keywords: ["API manufacture", "synthesis", "API production", "manufacturing process"],
				documentTypes: ["API manufacturing documentation"],
			},
		},
		"3.2.S.2.1": {
			id: "3.2.S.2.1",
			title: "Manufacturer(s) (Name, Physical Address)",
			classification: {
				keywords: ["API manufacturer", "manufacturer address", "manufacturing site"],
				documentTypes: ["manufacturer information"],
			},
		},
		"3.2.S.2.2": {
			id: "3.2.S.2.2",
			title: "Description of Manufacturing Process and Process Controls",
			classification: {
				keywords: ["synthesis", "manufacturing process", "process description", "API synthesis"],
				documentTypes: ["process description", "synthesis route"],
			},
		},
		"3.2.S.2.3": {
			id: "3.2.S.2.3",
			title: "Control of Materials",
			classification: {
				keywords: ["starting materials", "raw materials", "reagents", "solvents", "material control"],
				documentTypes: ["material control document"],
			},
		},
		"3.2.S.2.4": {
			id: "3.2.S.2.4",
			title: "Controls of Critical Steps and Intermediates",
			classification: {
				keywords: ["critical steps", "intermediates", "in-process controls", "IPC"],
				documentTypes: ["critical steps document", "intermediate specifications"],
			},
		},
		"3.2.S.2.5": {
			id: "3.2.S.2.5",
			title: "Process Validation and/or Evaluation",
			classification: {
				keywords: ["process validation", "API validation", "process evaluation"],
				documentTypes: ["process validation report"],
			},
		},
		"3.2.S.3": {
			id: "3.2.S.3",
			title: "Characterization",
			children: ["3.2.S.3.1", "3.2.S.3.2"],
			classification: {
				keywords: ["characterization", "structure elucidation", "API characterization"],
				documentTypes: ["characterization data"],
			},
		},
		"3.2.S.3.1": {
			id: "3.2.S.3.1",
			title: "Elucidation of Structure and Other Characteristics",
			classification: {
				keywords: ["structure elucidation", "NMR", "IR", "MS", "spectroscopy", "X-ray"],
				documentTypes: ["structure elucidation report"],
			},
		},
		"3.2.S.3.2": {
			id: "3.2.S.3.2",
			title: "Impurities",
			classification: {
				keywords: ["API impurities", "impurity profile", "degradation products", "genotoxic impurities"],
				documentTypes: ["impurity profile", "impurity report"],
			},
		},
		"3.2.S.4": {
			id: "3.2.S.4",
			title: "Control of the API",
			children: ["3.2.S.4.1", "3.2.S.4.2", "3.2.S.4.3", "3.2.S.4.4", "3.2.S.4.5"],
			classification: {
				keywords: ["API control", "API specifications", "API testing", "quality control"],
				documentTypes: ["API control documentation"],
				excludeFrom: ["3.2.P.5"],
			},
		},
		"3.2.S.4.1": {
			id: "3.2.S.4.1",
			title: "Specifications",
			classification: {
				keywords: ["API specifications", "drug substance specifications", "release specifications"],
				documentTypes: ["API specification sheet"],
			},
		},
		"3.2.S.4.2": {
			id: "3.2.S.4.2",
			title: "Analytical Procedures",
			classification: {
				keywords: ["API analytical procedures", "test methods", "analytical methods"],
				documentTypes: ["analytical procedure", "test method"],
			},
		},
		"3.2.S.4.3": {
			id: "3.2.S.4.3",
			title: "Validation of Analytical Procedures",
			classification: {
				keywords: ["method validation", "analytical validation", "API method validation"],
				documentTypes: ["validation report"],
			},
		},
		"3.2.S.4.4": {
			id: "3.2.S.4.4",
			title: "Batch Analyses",
			classification: {
				keywords: ["API batch analysis", "COA", "batch results", "lot analysis"],
				documentTypes: ["batch analysis", "certificate of analysis"],
			},
		},
		"3.2.S.4.5": {
			id: "3.2.S.4.5",
			title: "Justification of Specification",
			classification: {
				keywords: ["specification justification", "limit justification", "acceptance criteria justification"],
				documentTypes: ["specification justification"],
			},
		},
		"3.2.S.5": {
			id: "3.2.S.5",
			title: "Reference Standards or Materials",
			classification: {
				keywords: ["reference standard", "working standard", "API standard", "reference material"],
				documentTypes: ["reference standard documentation"],
			},
		},
		"3.2.S.6": {
			id: "3.2.S.6",
			title: "Container Closure Systems",
			classification: {
				keywords: ["API container", "API packaging", "container closure", "primary packaging"],
				documentTypes: ["container closure documentation"],
			},
		},
		"3.2.S.7": {
			id: "3.2.S.7",
			title: "Stability",
			classification: {
				keywords: ["API stability", "drug substance stability", "stability data", "retest period"],
				documentTypes: ["stability report", "stability data"],
			},
		},
		"3.2.P": {
			id: "3.2.P",
			title: "Drug product (or finished pharmaceutical product (FPP))",
			children: ["3.2.P.1", "3.2.P.2", "3.2.P.3", "3.2.P.4", "3.2.P.5", "3.2.P.6", "3.2.P.7", "3.2.P.8"],
			classification: {
				keywords: ["drug product", "FPP", "finished product", "formulation", "dosage form"],
				documentTypes: ["drug product documentation"],
				excludeFrom: ["3.2.S"],
				description: "Information about the finished pharmaceutical product",
			},
		},
		"3.2.P.1": {
			id: "3.2.P.1",
			title: "Description and Composition of the FPP",
			classification: {
				keywords: ["composition", "formulation", "product description", "excipients list"],
				documentTypes: ["product composition", "formulation document"],
			},
		},
		"3.2.P.2": {
			id: "3.2.P.2",
			title: "Pharmaceutical Development",
			children: ["3.2.P.2.1", "3.2.P.2.2", "3.2.P.2.3", "3.2.P.2.4", "3.2.P.2.5", "3.2.P.2.6"],
			classification: {
				keywords: ["pharmaceutical development", "formulation development", "product development"],
				documentTypes: ["development report"],
			},
		},
		"3.2.P.2.1": {
			id: "3.2.P.2.1",
			title: "Components of the FPP",
			classification: {
				keywords: ["FPP components", "excipient selection", "API selection", "component rationale"],
				documentTypes: ["components document"],
			},
		},
		"3.2.P.2.2": {
			id: "3.2.P.2.2",
			title: "Finished Pharmaceutical Product",
			classification: {
				keywords: ["FPP development", "formulation optimization", "dosage form development"],
				documentTypes: ["FPP development document"],
			},
		},
		"3.2.P.2.3": {
			id: "3.2.P.2.3",
			title: "Manufacturing Process Development",
			classification: {
				keywords: ["process development", "scale-up", "manufacturing optimization"],
				documentTypes: ["process development report"],
			},
		},
		"3.2.P.2.4": {
			id: "3.2.P.2.4",
			title: "Container Closure System",
			classification: {
				keywords: ["container closure development", "packaging development", "compatibility"],
				documentTypes: ["container closure document"],
			},
		},
		"3.2.P.2.5": {
			id: "3.2.P.2.5",
			title: "Microbiological Attributes",
			classification: {
				keywords: ["microbiological", "microbial limits", "sterility", "preservative efficacy"],
				documentTypes: ["microbiological document"],
			},
		},
		"3.2.P.2.6": {
			id: "3.2.P.2.6",
			title: "Compatibility",
			classification: {
				keywords: ["compatibility", "excipient compatibility", "drug-excipient"],
				documentTypes: ["compatibility study"],
			},
		},
		"3.2.P.3": {
			id: "3.2.P.3",
			title: "Manufacture",
			children: ["3.2.P.3.1", "3.2.P.3.2", "3.2.P.3.3", "3.2.P.3.4", "3.2.P.3.5"],
			classification: {
				keywords: ["FPP manufacture", "product manufacturing", "batch production"],
				documentTypes: ["manufacturing documentation"],
			},
		},
		"3.2.P.3.1": {
			id: "3.2.P.3.1",
			title: "Manufacturer(s)",
			classification: {
				keywords: ["FPP manufacturer", "production site", "manufacturing facility"],
				documentTypes: ["manufacturer information"],
			},
		},
		"3.2.P.3.2": {
			id: "3.2.P.3.2",
			title: "Batch Formula",
			classification: {
				keywords: ["batch formula", "master formula", "manufacturing formula"],
				documentTypes: ["batch formula", "master batch record"],
			},
		},
		"3.2.P.3.3": {
			id: "3.2.P.3.3",
			title: "Description of Manufacturing Process and Process Controls",
			classification: {
				keywords: ["manufacturing process", "process description", "unit operations", "process flow"],
				documentTypes: ["process description"],
			},
		},
		"3.2.P.3.4": {
			id: "3.2.P.3.4",
			title: "Controls of Critical Steps and Intermediates",
			classification: {
				keywords: ["critical steps", "IPC", "in-process controls", "critical process parameters"],
				documentTypes: ["critical steps document"],
			},
		},
		"3.2.P.3.5": {
			id: "3.2.P.3.5",
			title: "Process Validation and/or Evaluation",
			classification: {
				keywords: ["process validation", "PPQ", "production validation", "process qualification"],
				documentTypes: ["process validation report"],
			},
		},
		"3.2.P.4": {
			id: "3.2.P.4",
			title: "Control of excipients",
			children: ["3.2.P.4.1", "3.2.P.4.2", "3.2.P.4.3", "3.2.P.4.4", "3.2.P.4.5", "3.2.P.4.6"],
			classification: {
				keywords: ["excipient control", "excipient specifications", "inactive ingredients"],
				documentTypes: ["excipient documentation"],
			},
		},
		"3.2.P.4.1": {
			id: "3.2.P.4.1",
			title: "Specifications",
			classification: {
				keywords: ["excipient specifications", "excipient limits", "inactive ingredient specs"],
				documentTypes: ["excipient specification"],
			},
		},
		"3.2.P.4.2": {
			id: "3.2.P.4.2",
			title: "Analytical Procedures",
			classification: {
				keywords: ["excipient testing", "excipient methods", "excipient analysis"],
				documentTypes: ["excipient analytical procedure"],
			},
		},
		"3.2.P.4.3": {
			id: "3.2.P.4.3",
			title: "Validation of Analytical Procedures",
			classification: {
				keywords: ["excipient method validation", "excipient validation"],
				documentTypes: ["excipient validation report"],
			},
		},
		"3.2.P.4.4": {
			id: "3.2.P.4.4",
			title: "Justification of Specifications",
			classification: {
				keywords: ["excipient justification", "excipient limit justification"],
				documentTypes: ["excipient specification justification"],
			},
		},
		"3.2.P.4.5": {
			id: "3.2.P.4.5",
			title: "Excipients of Human or Animal Origin",
			classification: {
				keywords: ["animal origin", "human origin", "TSE/BSE", "gelatin", "lactose"],
				documentTypes: ["excipient origin document"],
			},
		},
		"3.2.P.4.6": {
			id: "3.2.P.4.6",
			title: "Novel Excipients",
			classification: {
				keywords: ["novel excipient", "new excipient", "non-compendial excipient"],
				documentTypes: ["novel excipient documentation"],
			},
		},
		"3.2.P.5": {
			id: "3.2.P.5",
			title: "Control of FPP",
			children: ["3.2.P.5.1", "3.2.P.5.2", "3.2.P.5.3", "3.2.P.5.4", "3.2.P.5.5", "3.2.P.5.6"],
			classification: {
				keywords: ["FPP control", "product specifications", "product testing", "release testing"],
				documentTypes: ["FPP control documentation"],
				excludeFrom: ["3.2.S.4"],
			},
		},
		"3.2.P.5.1": {
			id: "3.2.P.5.1",
			title: "Specifications (S)",
			classification: {
				keywords: ["FPP specifications", "product specifications", "release specifications", "shelf-life specs"],
				documentTypes: ["product specification sheet"],
			},
		},
		"3.2.P.5.2": {
			id: "3.2.P.5.2",
			title: "Analytical Procedures",
			classification: {
				keywords: ["FPP analytical procedures", "product test methods", "assay method", "dissolution method"],
				documentTypes: ["analytical procedure"],
			},
		},
		"3.2.P.5.3": {
			id: "3.2.P.5.3",
			title: "Validation of Analytical Procedures",
			classification: {
				keywords: ["FPP method validation", "product method validation", "assay validation"],
				documentTypes: ["method validation report"],
			},
		},
		"3.2.P.5.4": {
			id: "3.2.P.5.4",
			title: "Batch Analyses",
			classification: {
				keywords: ["FPP batch analysis", "product COA", "batch results", "release data"],
				documentTypes: ["batch analysis", "certificate of analysis"],
			},
		},
		"3.2.P.5.5": {
			id: "3.2.P.5.5",
			title: "Characterization of Impurities",
			classification: {
				keywords: ["FPP impurities", "degradation products", "product impurities"],
				documentTypes: ["impurity characterization"],
			},
		},
		"3.2.P.5.6": {
			id: "3.2.P.5.6",
			title: "Justification of Specifications",
			classification: {
				keywords: ["FPP specification justification", "product limit justification"],
				documentTypes: ["specification justification"],
			},
		},
		"3.2.P.6": {
			id: "3.2.P.6",
			title: "Reference Standards or Materials",
			classification: {
				keywords: ["FPP reference standard", "product standard", "working standard"],
				documentTypes: ["reference standard documentation"],
			},
		},
		"3.2.P.7": {
			id: "3.2.P.7",
			title: "Container Closure System",
			classification: {
				keywords: ["FPP container", "product packaging", "primary packaging", "secondary packaging"],
				documentTypes: ["container closure documentation"],
			},
		},
		"3.2.P.8": {
			id: "3.2.P.8",
			title: "Stability",
			classification: {
				keywords: ["FPP stability", "product stability", "shelf life", "expiry", "accelerated stability"],
				documentTypes: ["stability report", "stability data"],
			},
		},
		"3.2.R": {
			id: "3.2.R",
			title: "Regional Information",
			children: ["3.2.R.1", "3.2.R.2"],
			classification: {
				keywords: ["regional", "regional information", "country-specific"],
				documentTypes: ["regional documentation"],
			},
		},
		"3.2.R.1": {
			id: "3.2.R.1",
			title: "Production documentation",
			children: ["3.2.R.1.1", "3.2.R.1.2"],
			classification: {
				keywords: ["production documents", "batch records", "manufacturing records"],
				documentTypes: ["production documentation"],
			},
		},
		"3.2.R.1.1": {
			id: "3.2.R.1.1",
			title: "Executed Production Documents",
			classification: {
				keywords: ["executed batch record", "production batch record", "completed batch record"],
				documentTypes: ["executed batch record"],
			},
		},
		"3.2.R.1.2": {
			id: "3.2.R.1.2",
			title: "Master Production Documents",
			classification: {
				keywords: ["master batch record", "MBR", "master formula"],
				documentTypes: ["master batch record"],
			},
		},
		"3.2.R.2": {
			id: "3.2.R.2",
			title: "Analytical Procedures and Validation Information",
			classification: {
				keywords: ["regional analytical", "regional validation", "regional methods"],
				documentTypes: ["regional analytical documentation"],
			},
		},
		"3.3": {
			id: "3.3",
			title: "Literature References",
			classification: {
				keywords: ["literature", "references", "publications", "scientific literature"],
				documentTypes: ["literature references", "bibliography"],
			},
		},
	},
}

const MODULE_5: CTDModuleDef = {
	moduleNumber: 5,
	title: "Clinical Study Reports",
	description:
		"Clinical study reports including bioequivalence studies, pharmacokinetic studies, pharmacodynamic studies, and efficacy/safety studies",
	sections: {
		"5.1": {
			id: "5.1",
			title: "Table of Contents of Module 5",
			classification: {
				keywords: ["table of contents", "module 5 contents", "clinical contents"],
				documentTypes: ["table of contents"],
			},
		},
		"5.2": {
			id: "5.2",
			title: "Tabular Listing of All Clinical Studies",
			classification: {
				keywords: ["study listing", "clinical study list", "study table"],
				documentTypes: ["study listing"],
			},
		},
		"5.3": {
			id: "5.3",
			title: "Clinical Study Reports",
			children: ["5.3.1", "5.3.2", "5.3.3", "5.3.4", "5.3.5", "5.3.6", "5.3.7"],
			classification: {
				keywords: ["clinical study report", "CSR", "study report"],
				documentTypes: ["clinical study report"],
			},
		},
		"5.3.1": {
			id: "5.3.1",
			title: "Reports of Biopharmaceutic Studies",
			children: ["5.3.1.1", "5.3.1.2", "5.3.1.3", "5.3.1.4"],
			classification: {
				keywords: ["biopharmaceutic", "BA", "BE", "bioequivalence", "bioavailability"],
				documentTypes: ["biopharmaceutic study report"],
			},
		},
		"5.3.1.1": {
			id: "5.3.1.1",
			title: "Bioavailability (BA) Study Reports",
			classification: {
				keywords: ["bioavailability", "BA study", "absolute BA", "relative BA"],
				documentTypes: ["bioavailability study report"],
			},
		},
		"5.3.1.2": {
			id: "5.3.1.2",
			title: "Comparative BA and Bioequivalence (BE) Study reports",
			classification: {
				keywords: ["bioequivalence", "BE study", "comparative BA", "pivotal BE", "fasting", "fed"],
				documentTypes: ["bioequivalence study report"],
			},
		},
		"5.3.1.3": {
			id: "5.3.1.3",
			title: "In vitro-In vivo Correlation Study Reports",
			classification: {
				keywords: ["IVIVC", "in vitro in vivo", "correlation study"],
				documentTypes: ["IVIVC report"],
			},
		},
		"5.3.1.4": {
			id: "5.3.1.4",
			title: "Reports of Bioanalytical and Analytical Methods for Human Studies",
			classification: {
				keywords: ["bioanalytical", "bioanalytical method", "plasma assay", "LC-MS"],
				documentTypes: ["bioanalytical method report", "bioanalytical validation"],
			},
		},
		"5.3.2": {
			id: "5.3.2",
			title: "Reports of Studies Pertinent to Pharmacokinetics Using Human Biomaterials",
			children: ["5.3.2.1", "5.3.2.2", "5.3.2.3"],
			classification: {
				keywords: ["human biomaterials", "in vitro PK", "metabolism", "protein binding"],
				documentTypes: ["biomaterials study report"],
			},
		},
		"5.3.2.1": {
			id: "5.3.2.1",
			title: "Plasma Protein Binding Study Reports",
			classification: {
				keywords: ["protein binding", "plasma binding", "albumin binding"],
				documentTypes: ["protein binding report"],
			},
		},
		"5.3.2.2": {
			id: "5.3.2.2",
			title: "Reports of Hepatic Metabolism and Drug Interaction Studies",
			classification: {
				keywords: ["hepatic metabolism", "CYP", "drug interaction", "DDI", "microsome"],
				documentTypes: ["metabolism study report", "DDI report"],
			},
		},
		"5.3.2.3": {
			id: "5.3.2.3",
			title: "Reports of Studies Using Other Human Biomaterials",
			classification: {
				keywords: ["human biomaterials", "human tissue", "ex vivo"],
				documentTypes: ["biomaterials study report"],
			},
		},
		"5.3.3": {
			id: "5.3.3",
			title: "Reports of Human Pharmacokinetic (PK) Studies",
			children: ["5.3.3.1", "5.3.3.2", "5.3.3.3", "5.3.3.4", "5.3.3.5"],
			classification: {
				keywords: ["pharmacokinetic", "PK study", "human PK", "ADME"],
				documentTypes: ["PK study report"],
			},
		},
		"5.3.3.1": {
			id: "5.3.3.1",
			title: "Healthy Subject PK and Initial Tolerability Study Reports",
			classification: {
				keywords: ["healthy volunteer", "phase 1", "first in human", "tolerability"],
				documentTypes: ["phase 1 study report", "healthy volunteer PK"],
			},
		},
		"5.3.3.2": {
			id: "5.3.3.2",
			title: "Patient PK and Initial Tolerability Study Reports",
			classification: {
				keywords: ["patient PK", "patient pharmacokinetics", "special population"],
				documentTypes: ["patient PK report"],
			},
		},
		"5.3.3.3": {
			id: "5.3.3.3",
			title: "Intrinsic Factor PK Study Reports",
			classification: {
				keywords: ["intrinsic factor", "renal impairment", "hepatic impairment", "age", "gender"],
				documentTypes: ["intrinsic factor PK report"],
			},
		},
		"5.3.3.4": {
			id: "5.3.3.4",
			title: "Extrinsic Factor PK Study Reports",
			classification: {
				keywords: ["extrinsic factor", "food effect", "drug interaction", "DDI"],
				documentTypes: ["extrinsic factor PK report"],
			},
		},
		"5.3.3.5": {
			id: "5.3.3.5",
			title: "Population PK Study Reports",
			classification: {
				keywords: ["population PK", "popPK", "NONMEM", "PK modeling"],
				documentTypes: ["population PK report"],
			},
		},
		"5.3.4": {
			id: "5.3.4",
			title: "Reports of Human Pharmacodynamic (PD) Studies",
			children: ["5.3.4.1", "5.3.4.2"],
			classification: {
				keywords: ["pharmacodynamic", "PD study", "PK/PD"],
				documentTypes: ["PD study report"],
			},
		},
		"5.3.4.1": {
			id: "5.3.4.1",
			title: "Healthy Subject PD and PK/PD Study Reports",
			classification: {
				keywords: ["healthy volunteer PD", "PK/PD healthy", "pharmacodynamic healthy"],
				documentTypes: ["healthy volunteer PD report"],
			},
		},
		"5.3.4.2": {
			id: "5.3.4.2",
			title: "Patient PD and PK/PD Study Reports",
			classification: {
				keywords: ["patient PD", "PK/PD patient", "pharmacodynamic patient"],
				documentTypes: ["patient PD report"],
			},
		},
		"5.3.5": {
			id: "5.3.5",
			title: "Reports of Efficacy and Safety Studies",
			children: ["5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
			classification: {
				keywords: ["efficacy", "safety", "clinical trial", "phase 2", "phase 3"],
				documentTypes: ["efficacy study report", "safety study report"],
			},
		},
		"5.3.5.1": {
			id: "5.3.5.1",
			title: "Study Reports of Controlled Clinical Studies Pertinent to the Claimed Indication",
			classification: {
				keywords: ["controlled study", "pivotal study", "randomized controlled", "RCT"],
				documentTypes: ["pivotal study report"],
			},
		},
		"5.3.5.2": {
			id: "5.3.5.2",
			title: "Study Reports of Uncontrolled Clinical Studies",
			classification: {
				keywords: ["uncontrolled study", "open-label", "single-arm"],
				documentTypes: ["uncontrolled study report"],
			},
		},
		"5.3.5.3": {
			id: "5.3.5.3",
			title: "Reports of Analyses of Data from More than One Study",
			classification: {
				keywords: ["integrated analysis", "pooled analysis", "meta-analysis", "ISS", "ISE"],
				documentTypes: ["integrated analysis report"],
			},
		},
		"5.3.5.4": {
			id: "5.3.5.4",
			title: "Other Clinical Study Reports",
			classification: {
				keywords: ["other clinical", "supportive study", "exploratory study"],
				documentTypes: ["other clinical study report"],
			},
		},
		"5.3.6": {
			id: "5.3.6",
			title: "Reports of Post-Marketing Experience if Available",
			classification: {
				keywords: ["post-marketing", "pharmacovigilance", "PSUR", "adverse event report"],
				documentTypes: ["post-marketing report", "PSUR"],
			},
		},
		"5.3.7": {
			id: "5.3.7",
			title: "Case Reports Forms and Individual Patient Listings",
			classification: {
				keywords: ["CRF", "case report form", "patient listing", "individual patient"],
				documentTypes: ["CRF", "patient listing"],
			},
		},
	},
}

/**
 * EAC-NMRA CTD Template
 * Standard template for East African Community National Medicines Regulatory Authorities
 */
export const EAC_NMRA_TEMPLATE: CTDTemplate = {
	name: "eac-nmra",
	description: "EAC-NMRA CTD Template for generic drug submissions",
	region: "EAC",
	modules: [MODULE_1, MODULE_2, MODULE_3, MODULE_5],
}

export default EAC_NMRA_TEMPLATE
