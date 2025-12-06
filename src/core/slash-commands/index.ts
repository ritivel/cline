import type { ApiProviderInfo } from "@core/api"
import { ClineRulesToggles } from "@shared/cline-rules"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { isNativeToolCallingConfig } from "@/utils/model-utils"
import {
	condenseToolResponse,
	deepPlanningToolResponse,
	explainChangesToolResponse,
	newRuleToolResponse,
	newTaskToolResponse,
	reportBugToolResponse,
	subagentToolResponse,
} from "../prompts/commands"
import { StateManager } from "../storage/StateManager"

type FileBasedWorkflow = {
	fullPath: string
	fileName: string
	isRemote: false
}

type RemoteWorkflow = {
	fullPath: string
	fileName: string
	isRemote: true
	contents: string
}

type Workflow = FileBasedWorkflow | RemoteWorkflow

// CTD Module Definitions
interface CTDSection {
	title: string
	children?: string[]
}

interface CTDModuleDef {
	title: string
	sections: Record<string, CTDSection>
}

const MODULE_1: CTDModuleDef = {
	title: "Administrative Information and Product Information",
	sections: {
		"1.1": { title: "Comprehensive Table of Contents for all Modules." },
		"1.2": { title: "Cover letter" },
		"1.3": { title: "Comprehensive Table of Content" },
		"1.4": { title: "Quality Information Summary (QIS)" },
		"1.5": {
			title: "Product Information",
			children: ["1.5.1", "1.5.2", "1.5.3", "1.5.4"],
		},
		"1.5.1": { title: "Prescribing Information (Summary of Product Characteristics)" },
		"1.5.2": { title: "Container Labelling" },
		"1.5.3": { title: "Patient Information leaflet (PIL)" },
		"1.5.4": { title: "Mock-ups and Specimens" },
		"1.6": { title: "Information about the Experts" },
		"1.7": { title: "APIMFs and certificates of suitability to the monographs of the European Pharmacopoeia" },
		"1.8": { title: "Good Manufacturing Practice (GMP)" },
		"1.9": {
			title: "Regulatory status within EAC and in Countries with SRAs",
			children: ["1.9.1", "1.9.2", "1.9.3", "1.9.4"],
		},
		"1.9.1": { title: "List of Countries in EAC and Countries With SRAs In Which A Similar Application has been Submitted" },
		"1.9.2": { title: "Evaluation Reports from EAC-NMRA" },
		"1.9.3": { title: "Evaluation Reports from SRAs" },
		"1.9.4": { title: "Manufacturing and Marketing Authorization" },
		"1.10": { title: "Paediatric Development Program" },
		"1.11": { title: "Product Samples" },
		"1.12": { title: "Requirement for Submission of a Risk Mitigation Plan" },
		"1.13": { title: "Submission of Risk Management (RMP)" },
	},
}

const MODULE_2: CTDModuleDef = {
	title: "Overview and Summaries",
	sections: {
		"2.1": { title: "Table of Contents of Module 2" },
		"2.2": { title: "CTD Introduction" },
		"2.3": { title: "Quality Overall Summary - Product Dossiers (QOS-PD)" },
		"2.4": { title: "Nonclinical Overview for New Chemical Entities" },
		"2.5": {
			title: "Clinical Overview",
			children: ["2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.5", "2.5.6", "2.5.7"],
		},
		"2.5.1": { title: "Product Development Rationale" },
		"2.5.2": { title: "Overview of Bio-pharmaceutics" },
		"2.5.3": { title: "Overview of Clinical Pharmacology" },
		"2.5.4": { title: "Overview of Efficacy" },
		"2.5.5": { title: "Overview of Safety" },
		"2.5.6": { title: "Benefits and Risks Conclusions" },
		"2.5.7": { title: "Literature References" },
		"2.6": {
			title: "Nonclinical Written and Tabulated Summaries",
			children: ["2.6.1", "2.6.2", "2.6.3", "2.6.4", "2.6.5", "2.6.6", "2.6.7", "2.6.8"],
		},
		"2.6.1": { title: "Nonclinical Written Summaries" },
		"2.6.2": { title: "Introduction" },
		"2.6.3": { title: "Pharmacology Written Summary" },
		"2.6.4": { title: "Pharmacology Tabulated Summary" },
		"2.6.5": { title: "Pharmacokinetics Written Summary" },
		"2.6.6": { title: "Pharmacokinetics Tabulated Summary" },
		"2.6.7": { title: "Toxicology Written Summary" },
		"2.6.8": { title: "Toxicology Tabulated Summary Nonclinical Tabulated Summaries" },
		"2.7": {
			title: "Clinical Summary",
			children: ["2.7.1"],
		},
		"2.7.1": {
			title: "Summary of Biopharmaceutical Studies and Associated Analytical Methods",
			children: ["2.7.1.1", "2.7.1.2", "2.7.1.3"],
		},
		"2.7.1.1": { title: "Background and Overview" },
		"2.7.1.2": { title: "Summary of Results of Individual Studies" },
		"2.7.1.3": { title: "Comparison and Analyses of Results Across Studies" },
	},
}

const MODULE_3: CTDModuleDef = {
	title: "Quality",
	sections: {
		"3.1": { title: "Table of Contents of Module 3" },
		"3.2": {
			title: "Body of Data",
			children: ["3.2.S", "3.2.P", "3.2.R"],
		},
		"3.2.S": {
			title: "Drug Substance (Active Pharmaceutical Ingredient (API))",
			children: ["3.2.S.1", "3.2.S.2", "3.2.S.3", "3.2.S.4", "3.2.S.5", "3.2.S.6", "3.2.S.7"],
		},
		"3.2.S.1": {
			title: "General Information",
			children: ["3.2.S.1.1", "3.2.S.1.2", "3.2.S.1.3"],
		},
		"3.2.S.1.1": { title: "Nomenclature" },
		"3.2.S.1.2": { title: "Structure" },
		"3.2.S.1.3": { title: "General Properties" },
		"3.2.S.2": {
			title: "Manufacture",
			children: ["3.2.S.2.1", "3.2.S.2.2", "3.2.S.2.3", "3.2.S.2.4", "3.2.S.2.5"],
		},
		"3.2.S.2.1": { title: "Manufacturer(s) (Name, Physical Address)" },
		"3.2.S.2.2": { title: "Description of Manufacturing Process and Process Controls" },
		"3.2.S.2.3": { title: "Control of Materials" },
		"3.2.S.2.4": { title: "Controls of Critical Steps and Intermediates" },
		"3.2.S.2.5": { title: "Process Validation and/or Evaluation" },
		"3.2.S.3": {
			title: "Characterization",
			children: ["3.2.S.3.1", "3.2.S.3.2"],
		},
		"3.2.S.3.1": { title: "Elucidation of Structure and Other Characteristics" },
		"3.2.S.3.2": { title: "Impurities" },
		"3.2.S.4": {
			title: "Control of the API",
			children: ["3.2.S.4.1", "3.2.S.4.2", "3.2.S.4.3", "3.2.S.4.4", "3.2.S.4.5"],
		},
		"3.2.S.4.1": { title: "Specifications" },
		"3.2.S.4.2": { title: "Analytical Procedures" },
		"3.2.S.4.3": { title: "Validation of Analytical Procedures" },
		"3.2.S.4.4": { title: "Batch Analyses" },
		"3.2.S.4.5": { title: "Justification of Specification" },
		"3.2.S.5": { title: "Reference Standards or Materials" },
		"3.2.S.6": { title: "Container Closure Systems" },
		"3.2.S.7": { title: "Stability" },
		"3.2.P": {
			title: "Drug product (or finished pharmaceutical product (FPP))",
			children: ["3.2.P.1", "3.2.P.2", "3.2.P.3", "3.2.P.4", "3.2.P.5", "3.2.P.6", "3.2.P.7", "3.2.P.8"],
		},
		"3.2.P.1": { title: "Description and Composition of the FPP" },
		"3.2.P.2": {
			title: "Pharmaceutical Development",
			children: ["3.2.P.2.1", "3.2.P.2.2", "3.2.P.2.3", "3.2.P.2.4", "3.2.P.2.5", "3.2.P.2.6"],
		},
		"3.2.P.2.1": { title: "Components of the FPP" },
		"3.2.P.2.2": { title: "Finished Pharmaceutical Product" },
		"3.2.P.2.3": { title: "Manufacturing Process Development" },
		"3.2.P.2.4": { title: "Container Closure System" },
		"3.2.P.2.5": { title: "Microbiological Attributes" },
		"3.2.P.2.6": { title: "Compatibility" },
		"3.2.P.3": {
			title: "Manufacture",
			children: ["3.2.P.3.1", "3.2.P.3.2", "3.2.P.3.3", "3.2.P.3.4", "3.2.P.3.5"],
		},
		"3.2.P.3.1": { title: "Manufacturer(s)" },
		"3.2.P.3.2": { title: "Batch Formula" },
		"3.2.P.3.3": { title: "Description of Manufacturing Process and Process Controls" },
		"3.2.P.3.4": { title: "Controls of Critical Steps and Intermediates" },
		"3.2.P.3.5": { title: "Process Validation and/or Evaluation" },
		"3.2.P.4": {
			title: "Control of excipients",
			children: ["3.2.P.4.1", "3.2.P.4.2", "3.2.P.4.3", "3.2.P.4.4", "3.2.P.4.5", "3.2.P.4.6"],
		},
		"3.2.P.4.1": { title: "Specifications" },
		"3.2.P.4.2": { title: "Analytical Procedures" },
		"3.2.P.4.3": { title: "Validation of Analytical Procedures" },
		"3.2.P.4.4": { title: "Justification of Specifications" },
		"3.2.P.4.5": { title: "Excipients of Human or Animal Origin" },
		"3.2.P.4.6": { title: "Novel Excipients" },
		"3.2.P.5": {
			title: "Control of FPP",
			children: ["3.2.P.5.1", "3.2.P.5.2", "3.2.P.5.3", "3.2.P.5.4", "3.2.P.5.5", "3.2.P.5.6"],
		},
		"3.2.P.5.1": { title: "Specifications (S)" },
		"3.2.P.5.2": { title: "Analytical Procedures" },
		"3.2.P.5.3": { title: "Validation of Analytical Procedures" },
		"3.2.P.5.4": { title: "Batch Analyses" },
		"3.2.P.5.5": { title: "Characterization of Impurities" },
		"3.2.P.5.6": { title: "Justification of Specifications" },
		"3.2.P.6": { title: "Reference Standards or Materials" },
		"3.2.P.7": { title: "Container Closure System" },
		"3.2.P.8": { title: "Stability" },
		"3.2.R": {
			title: "Regional Information",
			children: ["3.2.R.1", "3.2.R.2"],
		},
		"3.2.R.1": {
			title: "Production documentation",
			children: ["3.2.R.1.1", "3.2.R.1.2"],
		},
		"3.2.R.1.1": { title: "Executed Production Documents" },
		"3.2.R.1.2": { title: "Master Production Documents" },
		"3.2.R.2": { title: "Analytical Procedures and Validation Information" },
		"3.3": { title: "Literature References" },
	},
}

const MODULE_5: CTDModuleDef = {
	title: "Clinical Study Reports",
	sections: {
		"5.1": { title: "Table of Contents of Module 5" },
		"5.2": { title: "Tabular Listing of All Clinical Studies" },
		"5.3": {
			title: "Clinical Study Reports",
			children: ["5.3.1", "5.3.2", "5.3.3", "5.3.4", "5.3.5", "5.3.6", "5.3.7"],
		},
		"5.3.1": {
			title: "Reports of Biopharmaceutic Studies",
			children: ["5.3.1.1", "5.3.1.2", "5.3.1.3", "5.3.1.4"],
		},
		"5.3.1.1": { title: "Bioavailability (BA) Study Reports" },
		"5.3.1.2": { title: "Comparative BA and Bioequivalence (BE) Study reports" },
		"5.3.1.3": { title: "In vitro-In vivo Correlation Study Reports" },
		"5.3.1.4": { title: "Reports of Bioanalytical and Analytical Methods for Human Studies" },
		"5.3.2": {
			title: "Reports of Studies Pertinent to Pharmacokinetics Using Human Biomaterials",
			children: ["5.3.2.1", "5.3.2.2", "5.3.2.3"],
		},
		"5.3.2.1": { title: "Plasma Protein Binding Study Reports" },
		"5.3.2.2": { title: "Reports of Hepatic Metabolism and Drug Interaction Studies" },
		"5.3.2.3": { title: "Reports of Studies Using Other Human Biomaterials" },
		"5.3.3": {
			title: "Reports of Human Pharmacokinetic (PK) Studies",
			children: ["5.3.3.1", "5.3.3.2", "5.3.3.3", "5.3.3.4", "5.3.3.5"],
		},
		"5.3.3.1": { title: "Healthy Subject PK and Initial Tolerability Study Reports" },
		"5.3.3.2": { title: "Patient PK and Initial Tolerability Study Reports" },
		"5.3.3.3": { title: "Intrinsic Factor PK Study Reports" },
		"5.3.3.4": { title: "Extrinsic Factor PK Study Reports" },
		"5.3.3.5": { title: "Population PK Study Reports" },
		"5.3.4": {
			title: "Reports of Human Pharmacodynamic (PD) Studies",
			children: ["5.3.4.1", "5.3.4.2"],
		},
		"5.3.4.1": { title: "Healthy Subject PD and PK/PD Study Reports" },
		"5.3.4.2": { title: "Patient PD and PK/PD Study Reports" },
		"5.3.5": {
			title: "Reports of Efficacy and Safety Studies",
			children: ["5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
		},
		"5.3.5.1": { title: "Study Reports of Controlled Clinical Studies Pertinent to the Claimed Indication" },
		"5.3.5.2": { title: "Study Reports of Uncontrolled Clinical Studies" },
		"5.3.5.3": { title: "Reports of Analyses of Data from More than One Study" },
		"5.3.5.4": { title: "Other Clinical Study Reports" },
		"5.3.6": { title: "Reports of Post-Marketing Experience if Available" },
		"5.3.7": { title: "Case Reports Forms and Individual Patient Listings" },
	},
}

const CTD_MODULES: CTDModuleDef[] = [MODULE_1, MODULE_2, MODULE_3, MODULE_5]

/**
 * Recursively builds folder paths from CTD module structure
 */
function buildFolderPaths(module: CTDModuleDef, moduleNum: number, sectionId: string, parentPath: string[]): string[] {
	const paths: string[] = []
	const currentPath = [...parentPath, `section-${sectionId}`]
	const fullPath = path.join("dossier", `module-${moduleNum}`, ...currentPath)
	paths.push(fullPath)

	const section = module.sections[sectionId]
	if (section?.children) {
		for (const childId of section.children) {
			paths.push(...buildFolderPaths(module, moduleNum, childId, currentPath))
		}
	}

	return paths
}

/**
 * Creates dossier folder structure from CTD modules
 */
async function createDossierFolders(workspaceRoot: string, modules: CTDModuleDef[]): Promise<string[]> {
	const createdPaths: string[] = []

	for (let i = 0; i < modules.length; i++) {
		const module = modules[i]
		const moduleNum = i + 1

		// Create module folder
		const modulePath = path.join(workspaceRoot, "dossier", `module-${moduleNum}`)
		await fs.mkdir(modulePath, { recursive: true })
		createdPaths.push(path.relative(workspaceRoot, modulePath))

		// Process all sections
		for (const sectionId of Object.keys(module.sections)) {
			// Only process top-level sections (those without a parent in the children arrays)
			const isTopLevel = !Object.values(module.sections).some((s) => s.children?.includes(sectionId))

			if (isTopLevel) {
				const sectionPaths = buildFolderPaths(module, moduleNum, sectionId, [])
				for (const folderPath of sectionPaths) {
					const fullPath = path.join(workspaceRoot, folderPath)
					await fs.mkdir(fullPath, { recursive: true })
					createdPaths.push(folderPath)
				}
			}
		}
	}

	return createdPaths
}

/**
 * Spawns background process to organize PDFs into document folders
 */
function spawnPdfProcessingProcess(workspaceRoot: string): void {
	const isWindows = process.platform === "win32"

	let command: string
	if (isWindows) {
		// Windows PowerShell command
		command = `powershell -Command "Get-ChildItem -Path . -Recurse -Filter *.pdf -File | Where-Object { $_.FullName -notlike '*\\dossier\\*' -and $_.FullName -notlike '*\\documents\\*' } | ForEach-Object { $basename = [System.IO.Path]::GetFileNameWithoutExtension($_.Name); $folderPath = Join-Path 'documents' $basename; if (-not (Test-Path $folderPath)) { New-Item -ItemType Directory -Path $folderPath -Force | Out-Null } }"`
	} else {
		// Unix/Linux/macOS command
		command = `find . -type f -name "*.pdf" -not -path "./dossier/*" -not -path "./documents/*" | while read pdf; do basename=$(basename "$pdf" .pdf); mkdir -p "documents/$basename"; done`
	}

	// Spawn process in background
	const child = spawn(isWindows ? "powershell" : "sh", isWindows ? ["-Command", command] : ["-c", command], {
		cwd: workspaceRoot,
		detached: true,
		stdio: "ignore",
	})

	// Unref to allow parent process to exit independently
	child.unref()
}

/**
 * Executes the create-dossier command
 */
async function executeCreateDossier(workspaceRoot: string): Promise<{ success: boolean; message: string }> {
	try {
		// Create dossier folder structure
		const createdPaths = await createDossierFolders(workspaceRoot, CTD_MODULES)

		// Create documents folder
		const documentsPath = path.join(workspaceRoot, "documents")
		await fs.mkdir(documentsPath, { recursive: true })

		// Spawn background PDF processing
		spawnPdfProcessingProcess(workspaceRoot)

		const message = `Successfully created dossier folder structure with ${createdPaths.length} folders and documents folder. PDF processing has been started in the background.`
		return { success: true, message }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return {
			success: false,
			message: `Failed to create dossier structure: ${errorMessage}`,
		}
	}
}

/**
 * Processes text for slash commands and transforms them with appropriate instructions
 * This is called after parseMentions() to process any slash commands in the user's message
 */
export async function parseSlashCommands(
	text: string,
	localWorkflowToggles: ClineRulesToggles,
	globalWorkflowToggles: ClineRulesToggles,
	ulid: string,
	focusChainSettings?: { enabled: boolean },
	enableNativeToolCalls?: boolean,
	providerInfo?: ApiProviderInfo,
): Promise<{ processedText: string; needsClinerulesFileCheck: boolean }> {
	const SUPPORTED_DEFAULT_COMMANDS = [
		"newtask",
		"smol",
		"compact",
		"newrule",
		"reportbug",
		"deep-planning",
		"subagent",
		"explain-changes",
		"create-dossier",
	]

	// Determine if the current provider/model/setting actually uses native tool calling
	const willUseNativeTools = isNativeToolCallingConfig(providerInfo!, enableNativeToolCalls || false)

	const commandReplacements: Record<string, string> = {
		newtask: newTaskToolResponse(willUseNativeTools),
		smol: condenseToolResponse(focusChainSettings),
		compact: condenseToolResponse(focusChainSettings),
		newrule: newRuleToolResponse(),
		reportbug: reportBugToolResponse(),
		"deep-planning": deepPlanningToolResponse(focusChainSettings, providerInfo, willUseNativeTools),
		subagent: subagentToolResponse(),
		"explain-changes": explainChangesToolResponse(),
	}

	// Regex patterns to extract content from different XML tags
	const tagPatterns = [
		{ tag: "task", regex: /<task>([\s\S]*?)<\/task>/i },
		{ tag: "feedback", regex: /<feedback>([\s\S]*?)<\/feedback>/i },
		{ tag: "answer", regex: /<answer>([\s\S]*?)<\/answer>/i },
		{ tag: "user_message", regex: /<user_message>([\s\S]*?)<\/user_message>/i },
	]

	// Regex to find slash commands anywhere in text (not just at the beginning).
	// This mirrors how @ mentions work - they can appear anywhere in a message.
	//
	// Pattern breakdown: /(^|\s)\/([a-zA-Z0-9_.-]+)(?=\s|$)/
	//   - (^|\s)  : Must be at start of string OR preceded by whitespace
	//   - \/      : The literal slash character
	//   - ([a-zA-Z0-9_.-]+) : The command name (letters, numbers, underscore, dot, hyphen)
	//   - (?=\s|$): Must be followed by whitespace or end of string (lookahead)
	//
	// This safely avoids false matches in:
	//   - URLs: "http://example.com/newtask" - slash not preceded by whitespace
	//   - File paths: "some/path/newtask" - same reason
	//   - Partial words: "foo/bar" - same reason
	//
	// Only ONE slash command per message is processed (first match found).
	const slashCommandInTextRegex = /(^|\s)\/([a-zA-Z0-9_.-]+)(?=\s|$)/

	// Helper function to calculate positions and remove slash command from text
	const removeSlashCommand = (
		fullText: string,
		_tagContent: string, // kept for clarity about the context
		contentStartIndex: number,
		slashMatch: RegExpExecArray,
	): string => {
		// slashMatch.index is where the match starts (could include whitespace before /)
		// slashMatch[1] is the whitespace or empty string before the slash
		// slashMatch[2] is the command name
		const slashPositionInContent = slashMatch.index + slashMatch[1].length
		const slashPositionInFullText = contentStartIndex + slashPositionInContent
		const commandText = "/" + slashMatch[2]
		const commandEndPosition = slashPositionInFullText + commandText.length

		return fullText.substring(0, slashPositionInFullText) + fullText.substring(commandEndPosition)
	}

	// if we find a valid match, we will return inside that block
	for (const { regex } of tagPatterns) {
		const regexObj = new RegExp(regex.source, regex.flags)
		const tagMatch = regexObj.exec(text)

		if (tagMatch) {
			const tagContent = tagMatch[1]
			const tagStartIndex = tagMatch.index
			const contentStartIndex = text.indexOf(tagContent, tagStartIndex)

			// Find slash command within the tag content
			const slashMatch = slashCommandInTextRegex.exec(tagContent)

			if (!slashMatch) {
				continue
			}

			// slashMatch[1] is the whitespace or empty string before the slash
			// slashMatch[2] is the command name
			const commandName = slashMatch[2] // casing matters

			// Special handling for create-dossier: execute directly
			if (commandName === "create-dossier") {
				try {
					// Get workspace root
					const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
					const workspaceRoot = workspacePaths.paths?.[0] || process.cwd()

					// Execute the command
					const result = await executeCreateDossier(workspaceRoot)

					// Remove slash command from text
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)

					// Return message for AI to report to user
					const processedText = `<explicit_instructions type="create-dossier-result">
The /create-dossier command has been executed. ${result.message}

Please inform the user about the result: ${result.success ? "Success" : "Error"} - ${result.message}
</explicit_instructions>

${textWithoutSlashCommand}`

					// Track telemetry for builtin slash command usage
					telemetryService.captureSlashCommandUsed(ulid, commandName, "builtin")

					return { processedText, needsClinerulesFileCheck: false }
				} catch (error) {
					console.error(`Error executing create-dossier command: ${error}`)
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
					const processedText = `<explicit_instructions type="create-dossier-result">
The /create-dossier command failed to execute. Please inform the user about the error: ${error instanceof Error ? error.message : String(error)}
</explicit_instructions>

${textWithoutSlashCommand}`
					return { processedText, needsClinerulesFileCheck: false }
				}
			}

			// we give preference to the default commands if the user has a file with the same name
			if (SUPPORTED_DEFAULT_COMMANDS.includes(commandName)) {
				// remove the slash command and add custom instructions at the top of this message
				const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
				const processedText = commandReplacements[commandName] + textWithoutSlashCommand

				// Track telemetry for builtin slash command usage
				telemetryService.captureSlashCommandUsed(ulid, commandName, "builtin")

				return { processedText: processedText, needsClinerulesFileCheck: commandName === "newrule" }
			}

			const globalWorkflows: Workflow[] = Object.entries(globalWorkflowToggles)
				.filter(([_, enabled]) => enabled)
				.map(([filePath, _]) => ({
					fullPath: filePath,
					fileName: filePath.replace(/^.*[/\\]/, ""),
					isRemote: false,
				}))

			const localWorkflows: Workflow[] = Object.entries(localWorkflowToggles)
				.filter(([_, enabled]) => enabled)
				.map(([filePath, _]) => ({
					fullPath: filePath,
					fileName: filePath.replace(/^.*[/\\]/, ""),
					isRemote: false,
				}))

			// Get remote workflows from remote config
			const stateManager = StateManager.get()
			const remoteConfigSettings = stateManager.getRemoteConfigSettings()
			const remoteWorkflows = remoteConfigSettings.remoteGlobalWorkflows || []
			const remoteWorkflowToggles = stateManager.getGlobalStateKey("remoteWorkflowToggles") || {}

			const enabledRemoteWorkflows: Workflow[] = remoteWorkflows
				.filter((workflow) => {
					// If alwaysEnabled, always include; otherwise check toggle
					return workflow.alwaysEnabled || remoteWorkflowToggles[workflow.name] !== false
				})
				.map((workflow) => ({
					fullPath: "",
					fileName: workflow.name,
					isRemote: true,
					contents: workflow.contents,
				}))

			// local workflows have precedence over global workflows, which have precedence over remote workflows
			const enabledWorkflows: Workflow[] = [...localWorkflows, ...globalWorkflows, ...enabledRemoteWorkflows]

			// Then check if the command matches any enabled workflow filename
			const matchingWorkflow = enabledWorkflows.find((workflow) => workflow.fileName === commandName)

			if (matchingWorkflow) {
				try {
					// Get workflow content - either from file or from remote config
					let workflowContent: string
					if (matchingWorkflow.isRemote) {
						workflowContent = matchingWorkflow.contents.trim()
					} else {
						workflowContent = (await fs.readFile(matchingWorkflow.fullPath, "utf8")).trim()
					}

					// remove the slash command and add custom instructions at the top of this message
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
					const processedText =
						`<explicit_instructions type="${matchingWorkflow.fileName}">\n${workflowContent}\n</explicit_instructions>\n` +
						textWithoutSlashCommand

					// Track telemetry for workflow command usage
					telemetryService.captureSlashCommandUsed(ulid, commandName, "workflow")

					return { processedText, needsClinerulesFileCheck: false }
				} catch (error) {
					console.error(`Error reading workflow file ${matchingWorkflow.fullPath}: ${error}`)
				}
			}
		}
	}

	// if no supported commands are found, return the original text
	return { processedText: text, needsClinerulesFileCheck: false }
}
