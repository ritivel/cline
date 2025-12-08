import type { ApiProviderInfo } from "@core/api"
import { ClineRulesToggles } from "@shared/cline-rules"
import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ClineFileTracker } from "@/services/fileTracking/ClineFileTracker"
import { DossierGeneratorService } from "@/services/pdf/DossierGeneratorService"
import { PdfProcessingService } from "@/services/pdf/PdfProcessingService"
import { telemetryService } from "@/services/telemetry"
import { ShowMessageType } from "@/shared/proto/index.host"
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

// NOTE: New template system for classification is in @/core/ctd/templates/
// See: @/core/ctd/templates/index.ts for template registry

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

// Import CTD template from SINGLE SOURCE OF TRUTH
import { EAC_NMRA_TEMPLATE } from "@/core/ctd/templates/eac-nmra/definition"
import type { CTDModuleDef } from "@/core/ctd/types"

// ============================================================================
// CTD TEMPLATE - SINGLE SOURCE OF TRUTH: @/core/ctd/templates/eac-nmra/definition.ts
// ============================================================================
// The template is now imported from the definition file.
// This ensures consistency between:
// - Dossier folder creation
// - Classification prompts
// - Tags.md path building

/**
 * Gets a CTD template by name, or returns the default template
 * Uses the SINGLE SOURCE OF TRUTH from @/core/ctd/templates/
 */
function getCTDTemplate(templateName?: string): typeof EAC_NMRA_TEMPLATE {
	// Currently only EAC_NMRA_TEMPLATE is available
	// Add more templates to @/core/ctd/templates/ and import them here
	return EAC_NMRA_TEMPLATE
}

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
	const fileTracker = ClineFileTracker.getInstance()

	// Track the dossier folder itself (created by recursive mkdir)
	const dossierPath = path.join(workspaceRoot, "dossier")
	fileTracker.trackFile(dossierPath)

	for (const module of modules) {
		const moduleNum = module.moduleNumber

		// Create module folder
		const modulePath = path.join(workspaceRoot, "dossier", `module-${moduleNum}`)
		await fs.mkdir(modulePath, { recursive: true })
		createdPaths.push(path.relative(workspaceRoot, modulePath))
		fileTracker.trackFile(modulePath)

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
					fileTracker.trackFile(fullPath)
				}
			}
		}
	}

	return createdPaths
}

/**
 * Global service instance to allow cancellation
 */
let pdfProcessingService: PdfProcessingService | null = null
let dossierGeneratorService: DossierGeneratorService | null = null

/**
 * Starts cloud-based PDF processing in the background
 */
function startCloudPdfProcessing(workspaceRoot: string): void {
	// Cancel any existing processing
	if (pdfProcessingService) {
		pdfProcessingService.cancel()
		pdfProcessingService = null
		HostProvider.get().hostBridge.windowClient.showMessage({
			message: "Previous PDF processing job cancelled",
			type: ShowMessageType.INFORMATION,
		})
	}

	const service = new PdfProcessingService("https://isanthous-breccial-claire.ngrok-free.dev", "hellofromritivel")
	pdfProcessingService = service

	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "PDF Processing",
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				service.cancel()
			})

			await service
				.processPdfs(workspaceRoot, (stage, details) => {
					console.log(`[PDF Processing ${stage}] ${details || ""}`)

					// Update progress bar
					progress.report({ message: details || stage })

					// Show notification for each stage update (keep existing behavior)
					const message = details ? `PDF Processing: ${details}` : `PDF Processing: ${stage}`
					if (stage === "error") {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message,
							type: ShowMessageType.ERROR,
						})
					} else if (stage === "completed") {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message,
							type: ShowMessageType.INFORMATION,
						})
					} else {
						// Use showInformationMessage for progress updates as well
						HostProvider.get().hostBridge.windowClient.showMessage({
							message,
							type: ShowMessageType.INFORMATION,
						})
					}
				})
				.catch((error) => {
					const errorMessage = error instanceof Error ? error.message : String(error)
					if (errorMessage === "Operation cancelled by user") {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: "PDF Processing cancelled",
							type: ShowMessageType.INFORMATION,
						})
					} else {
						console.error("Error processing PDFs:", error)
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `PDF Processing Critical Error: ${errorMessage}`,
							type: ShowMessageType.ERROR,
						})
					}
				})
				.finally(() => {
					if (pdfProcessingService === service) {
						pdfProcessingService = null
					}
				})
		},
	)
}

/**
 * Executes the create-dossier command
 */
async function executeCreateDossier(
	workspaceRoot: string,
	templateName?: string,
): Promise<{ success: boolean; message: string }> {
	try {
		// Get the CTD template (default if not specified)
		const template = getCTDTemplate(templateName)

		// Create dossier folder structure
		const createdPaths = await createDossierFolders(workspaceRoot, template.modules)

		// Create documents folder only if it doesn't exist
		const documentsPath = path.join(workspaceRoot, "documents")
		const fileTracker = ClineFileTracker.getInstance()
		try {
			await fs.access(documentsPath)
			// Documents folder already exists, skip creation
		} catch {
			// Documents folder doesn't exist, create it
			await fs.mkdir(documentsPath, { recursive: true })
			fileTracker.trackFile(documentsPath)
		}

		// Start cloud-based PDF processing in the background
		startCloudPdfProcessing(workspaceRoot)

		const templateInfo = templateName ? ` using template "${template.name}"` : ""
		const message = `Successfully created dossier folder structure${templateInfo} with ${createdPaths.length} folders and documents folder. Cloud-based PDF processing has been started in the background. Results will be saved to documents/results.zip when complete.`
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
 * Starts dossier content generation in the background
 */
function startDossierGeneration(workspaceRoot: string): void {
	const service = new DossierGeneratorService(workspaceRoot)
	dossierGeneratorService = service

	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Generating Dossier Content",
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				// Note: DossierGeneratorService doesn't have cancel yet, but we can set it to null
				dossierGeneratorService = null
			})

			await service
				.generateAllSections(
					(stage, details) => {
						console.log(`[Dossier Generation ${stage}] ${details || ""}`)

						// Update progress bar
						progress.report({ message: details || stage })

						// Show notification for section completions
						if (stage === "section" && details) {
							HostProvider.get().hostBridge.windowClient.showMessage({
								message: `Dossier Generation: ${details}`,
								type: ShowMessageType.INFORMATION,
							})
						}
					},
					(sectionId, moduleNum) => {
						// Section completed callback
						console.log(`Completed section ${sectionId} in Module ${moduleNum}`)
					},
				)
				.then((result) => {
					if (result.success) {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `Dossier generation completed: ${result.sectionsGenerated} sections generated`,
							type: ShowMessageType.INFORMATION,
						})
					} else {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `Dossier generation completed with ${result.errors.length} errors. ${result.sectionsGenerated} sections generated.`,
							type: ShowMessageType.ERROR,
						})
					}
				})
				.catch((error) => {
					const errorMessage = error instanceof Error ? error.message : String(error)
					console.error("Error generating dossier content:", error)
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Dossier Generation Error: ${errorMessage}`,
						type: ShowMessageType.ERROR,
					})
				})
				.finally(() => {
					if (dossierGeneratorService === service) {
						dossierGeneratorService = null
					}
				})
		},
	)
}

/**
 * Executes the generate-dossier command
 */
async function executeGenerateDossier(workspaceRoot: string): Promise<{ success: boolean; message: string }> {
	try {
		// Start dossier content generation in the background
		startDossierGeneration(workspaceRoot)

		const message = `Dossier content generation has been started in the background. Content will be generated for all leaf sections in regulatory order (Module 3 → 5 → 2 → 1). Progress notifications will appear as sections are completed.`
		return { success: true, message }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return {
			success: false,
			message: `Failed to start dossier generation: ${errorMessage}`,
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
		"generate-dossier",
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

			// Special handling for generate-dossier: execute directly
			if (commandName === "generate-dossier") {
				try {
					// Get workspace root
					const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
					const workspaceRoot = workspacePaths.paths?.[0] || process.cwd()

					// Execute the command
					const result = await executeGenerateDossier(workspaceRoot)

					// Remove slash command from text
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)

					// Return message for AI to report to user
					const processedText = `<explicit_instructions type="generate-dossier-result">
The /generate-dossier command has been executed. ${result.message}

Please inform the user about the result: ${result.success ? "Success" : "Error"} - ${result.message}
</explicit_instructions>

${textWithoutSlashCommand}`

					// Track telemetry for builtin slash command usage
					telemetryService.captureSlashCommandUsed(ulid, commandName, "builtin")

					return { processedText, needsClinerulesFileCheck: false }
				} catch (error) {
					console.error(`Error executing generate-dossier command: ${error}`)
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
					const processedText = `<explicit_instructions type="generate-dossier-result">
The /generate-dossier command failed to execute. Please inform the user about the error: ${error instanceof Error ? error.message : String(error)}
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
