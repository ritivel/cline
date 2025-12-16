import type { ApiProviderInfo } from "@core/api"
import { ClineRulesToggles } from "@shared/cline-rules"
import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"
import { WebviewProvider } from "@/core/webview"
import { HostProvider } from "@/hosts/host-provider"
import { SubmissionsPaneProvider } from "@/hosts/vscode/SubmissionsPaneProvider"
import { ClineFileTracker } from "@/services/fileTracking/ClineFileTracker"
import { CtdClassifierServiceV2 } from "@/services/pdf/CtdClassifierServiceV2"
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
import type { CTDModuleDef, CTDSectionDef } from "@/core/ctd/types"

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
export function getCTDTemplate(templateName?: string): typeof EAC_NMRA_TEMPLATE {
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
export async function createDossierFolders(submissionsPath: string, modules: CTDModuleDef[]): Promise<string[]> {
	const createdPaths: string[] = []
	const fileTracker = ClineFileTracker.getInstance()

	// Track the dossier folder itself (created by recursive mkdir)
	const dossierPath = path.join(submissionsPath, "dossier")
	fileTracker.trackFile(dossierPath)

	for (const module of modules) {
		const moduleNum = module.moduleNumber

		// Create module folder
		const modulePath = path.join(submissionsPath, "dossier", `module-${moduleNum}`)
		await fs.mkdir(modulePath, { recursive: true })
		createdPaths.push(path.relative(submissionsPath, modulePath))
		fileTracker.trackFile(modulePath)

		// Process all sections
		for (const sectionId of Object.keys(module.sections)) {
			// Only process top-level sections (those without a parent in the children arrays)
			const isTopLevel = !Object.values(module.sections).some((s) => s.children?.includes(sectionId))

			if (isTopLevel) {
				const sectionPaths = buildFolderPaths(module, moduleNum, sectionId, [])
				for (const folderPath of sectionPaths) {
					const fullPath = path.join(submissionsPath, folderPath)
					await fs.mkdir(fullPath, { recursive: true })
					createdPaths.push(path.relative(submissionsPath, folderPath))
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
let dossierSectionGeneratorService: DossierGeneratorService | null = null

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
				.processPdfs(workspaceRoot, workspaceRoot, (stage, details) => {
					// Note: For /create-dossier, we now use submissions folder path (must be set first)
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
 * Classifies all documents in the documents folder that have info.json
 */
export async function classifyAllDocuments(
	documentsPath: string,
	workspaceRoot: string,
): Promise<{ classified: number; total: number; errors: string[] }> {
	const classifier = new CtdClassifierServiceV2(workspaceRoot)

	const errors: string[] = []
	let classified = 0
	let total = 0

	try {
		const entries = await fs.readdir(documentsPath, { withFileTypes: true })

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue
			}

			const folderPath = path.join(documentsPath, entry.name)
			const infoJsonPath = path.join(folderPath, "info.json")

			// Check if info.json exists
			try {
				await fs.access(infoJsonPath)
				total++

				// Classify this folder
				const relativePath = path.relative(documentsPath, folderPath)
				try {
					const success = await classifier.classifyFolder(folderPath, relativePath, workspaceRoot)
					if (success) {
						classified++
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					errors.push(`Failed to classify ${entry.name}: ${errorMessage}`)
					console.error(`Failed to classify ${folderPath}:`, error)
				}
			} catch {}
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		errors.push(`Failed to scan documents folder: ${errorMessage}`)
		console.error(`Failed to scan documents folder ${documentsPath}:`, error)
	}

	return { classified, total, errors }
}

/**
 * Starts dossier creation in the background
 */
function startDossierCreation(
	submissionsPath: string,
	templateName?: string,
	onComplete?: (result: { success: boolean; message: string }) => void,
): void {
	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Creating Dossier Structure",
			cancellable: false,
		},
		async (progress) => {
			try {
				// Get the CTD template (default if not specified)
				const template = getCTDTemplate(templateName)

				// Create dossier folder structure in submissions path
				progress.report({ message: "Creating folder structure..." })
				const createdPaths = await createDossierFolders(submissionsPath, template.modules)

				// Create documents folder only if it doesn't exist (in submissions path)
				const documentsPath = path.join(submissionsPath, "documents")
				const fileTracker = ClineFileTracker.getInstance()
				try {
					await fs.access(documentsPath)
					// Documents folder already exists, skip creation
				} catch {
					// Documents folder doesn't exist, create it
					await fs.mkdir(documentsPath, { recursive: true })
					fileTracker.trackFile(documentsPath)
				}

				// Classify all documents that have info.json
				progress.report({ message: "Classifying documents..." })
				// Pass submissionsPath as the root for DossierTagsService (it expects dossier and documents to be relative to this path)
				const classificationResult = await classifyAllDocuments(documentsPath, submissionsPath)

				const templateInfo = templateName ? ` using template "${template.name}"` : ""
				let message = `Successfully created dossier folder structure${templateInfo} in submissions folder with ${createdPaths.length} folders and documents folder.`

				if (classificationResult.total > 0) {
					message += ` Classified ${classificationResult.classified}/${classificationResult.total} document(s).`
					if (classificationResult.errors.length > 0) {
						message += ` ${classificationResult.errors.length} error(s) occurred during classification.`
					}
				}

				const result = { success: true, message }
				onComplete?.(result)

				HostProvider.get().hostBridge.windowClient.showMessage({
					message: result.message,
					type: ShowMessageType.INFORMATION,
				})

				return result
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				const result = {
					success: false,
					message: `Failed to create dossier structure: ${errorMessage}`,
				}
				onComplete?.(result)

				HostProvider.get().hostBridge.windowClient.showMessage({
					message: result.message,
					type: ShowMessageType.ERROR,
				})

				return result
			}
		},
	)
}

/**
 * Executes the create-dossier command (legacy synchronous version, kept for compatibility)
 * @deprecated Use startDossierCreation for background processing
 */
async function executeCreateDossier(
	workspaceRoot: string,
	templateName?: string,
): Promise<{ success: boolean; message: string }> {
	// Get submissions folder path
	const submissionsProvider = SubmissionsPaneProvider.getInstance()
	const submissionsPath = submissionsProvider?.getSubmissionsFolder()

	if (!submissionsPath) {
		return {
			success: false,
			message: "No submissions folder set. Please set a submissions folder in the left pane before creating a dossier.",
		}
	}

	// For synchronous execution, we still need to await the result
	// This is a simplified version that doesn't show progress
	try {
		const template = getCTDTemplate(templateName)
		const createdPaths = await createDossierFolders(submissionsPath, template.modules)

		const documentsPath = path.join(submissionsPath, "documents")
		const fileTracker = ClineFileTracker.getInstance()
		try {
			await fs.access(documentsPath)
		} catch {
			await fs.mkdir(documentsPath, { recursive: true })
			fileTracker.trackFile(documentsPath)
		}

		const classificationResult = await classifyAllDocuments(documentsPath, submissionsPath)

		const templateInfo = templateName ? ` using template "${template.name}"` : ""
		let message = `Successfully created dossier folder structure${templateInfo} in submissions folder with ${createdPaths.length} folders and documents folder.`

		if (classificationResult.total > 0) {
			message += ` Classified ${classificationResult.classified}/${classificationResult.total} document(s).`
			if (classificationResult.errors.length > 0) {
				message += ` ${classificationResult.errors.length} error(s) occurred during classification.`
			}
		}

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
	// Get controller from webview provider for subagents
	const webview = WebviewProvider.getVisibleInstance()
	const controller = webview?.controller

	if (!controller) {
		console.error("Cannot start dossier generation: No controller available")
		HostProvider.get().hostBridge.windowClient.showMessage({
			message: "Cannot start dossier generation: No controller available. Please ensure Cline is properly initialized.",
			type: ShowMessageType.ERROR,
		})
		return
	}

	// Check if submissions folder is set
	const submissionsProvider = SubmissionsPaneProvider.getInstance()
	const submissionsPath = submissionsProvider?.getSubmissionsFolder()
	if (!submissionsPath) {
		HostProvider.get().hostBridge.windowClient.showMessage({
			message:
				"Cannot start dossier generation: No submissions folder set. Please set a submissions folder in the left pane before generating dossier content.",
			type: ShowMessageType.ERROR,
		})
		return
	}

	const service = new DossierGeneratorService(workspaceRoot, controller)
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

		const message = `Dossier content generation has been started in the background. AI subagents will work in parallel to generate standalone LaTeX documents for all leaf sections in regulatory order (Module 3 → 5 → 2 → 1). Progress notifications will appear as sections are completed.`
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
 * Starts dossier section generation in the background
 */
function startDossierSectionGeneration(workspaceRoot: string, sectionNameOrId: string): void {
	// Get controller from webview provider for subagents
	const webview = WebviewProvider.getVisibleInstance()
	const controller = webview?.controller

	if (!controller) {
		console.error("Cannot start section generation: No controller available")
		HostProvider.get().hostBridge.windowClient.showMessage({
			message: "Cannot start section generation: No controller available. Please ensure Cline is properly initialized.",
			type: ShowMessageType.ERROR,
		})
		return
	}

	// Check if submissions folder is set
	const submissionsProvider = SubmissionsPaneProvider.getInstance()
	const submissionsPath = submissionsProvider?.getSubmissionsFolder()
	if (!submissionsPath) {
		HostProvider.get().hostBridge.windowClient.showMessage({
			message:
				"Cannot start section generation: No submissions folder set. Please set a submissions folder in the left pane before generating sections.",
			type: ShowMessageType.ERROR,
		})
		return
	}

	const service = new DossierGeneratorService(workspaceRoot, controller)
	dossierSectionGeneratorService = service

	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Generating Section: ${sectionNameOrId}`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				// Note: DossierGeneratorService doesn't have cancel yet, but we can set it to null
				dossierSectionGeneratorService = null
			})

			await service
				.generateSectionByName(sectionNameOrId, (status) => {
					console.log(`[Section Generation ${sectionNameOrId}] ${status}`)

					// Update progress bar
					progress.report({ message: status })

					// Show notification for progress updates
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Section Generation (${sectionNameOrId}): ${status}`,
						type: ShowMessageType.INFORMATION,
					})
				})
				.then((result) => {
					if (result.success) {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `Section generation completed: ${sectionNameOrId}`,
							type: ShowMessageType.INFORMATION,
						})
					} else {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `Section generation failed for ${sectionNameOrId}: ${result.error || "Unknown error"}`,
							type: ShowMessageType.ERROR,
						})
					}
				})
				.catch((error) => {
					const errorMessage = error instanceof Error ? error.message : String(error)
					console.error(`Error generating section ${sectionNameOrId}:`, error)
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Section Generation Error (${sectionNameOrId}): ${errorMessage}`,
						type: ShowMessageType.ERROR,
					})
				})
				.finally(() => {
					if (dossierSectionGeneratorService === service) {
						dossierSectionGeneratorService = null
					}
				})
		},
	)
}

/**
 * Executes the generate-section command
 */
export async function executeGenerateDossierSection(
	workspaceRoot: string,
	sectionNameOrId: string,
): Promise<{ success: boolean; message: string }> {
	try {
		// Start section generation in the background
		startDossierSectionGeneration(workspaceRoot, sectionNameOrId)

		const message = `Section generation for "${sectionNameOrId}" has been started in the background. An AI subagent will generate a standalone LaTeX document for this section. Progress notifications will appear as the section is generated.`
		return { success: true, message }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return {
			success: false,
			message: `Failed to start section generation: ${errorMessage}`,
		}
	}
}

// Global variable to track checklist updation service
let checklistUpdationService: any = null
let outputChecklistUpdationService: any = null

/**
 * Starts checklist updation in the background
 */
function startChecklistUpdation(workspaceRoot: string, sectionNameOrId: string): void {
	// Get controller from webview provider for subagents
	const webview = WebviewProvider.getVisibleInstance()
	const controller = webview?.controller

	if (!controller) {
		console.error("Cannot start checklist updation: No controller available")
		HostProvider.get().hostBridge.windowClient.showMessage({
			message: "Cannot start checklist updation: No controller available. Please ensure Cline is properly initialized.",
			type: ShowMessageType.ERROR,
		})
		return
	}

	// Check if submissions folder is set
	const submissionsProvider = SubmissionsPaneProvider.getInstance()
	const submissionsPath = submissionsProvider?.getSubmissionsFolder()
	if (!submissionsPath) {
		HostProvider.get().hostBridge.windowClient.showMessage({
			message:
				"Cannot start checklist updation: No submissions folder set. Please set a submissions folder in the left pane before updating checklists.",
			type: ShowMessageType.ERROR,
		})
		return
	}

	const service = new DossierGeneratorService(workspaceRoot, controller)
	checklistUpdationService = service

	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Updating Checklist: ${sectionNameOrId}`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				checklistUpdationService = null
			})

			try {
				// Find section by name or ID
				const searchTerm = sectionNameOrId.toLowerCase().trim()
				let sectionId: string | null = null
				let section: CTDSectionDef | null = null

				// First, try exact ID match
				for (const module of EAC_NMRA_TEMPLATE.modules) {
					if (module.sections[sectionNameOrId]) {
						sectionId = sectionNameOrId
						section = module.sections[sectionNameOrId]
						break
					}
				}

				// Then, try case-insensitive partial match on section IDs
				if (!sectionId) {
					for (const module of EAC_NMRA_TEMPLATE.modules) {
						for (const [id, sec] of Object.entries(module.sections)) {
							if (id.toLowerCase().includes(searchTerm)) {
								sectionId = id
								section = sec
								break
							}
						}
						if (sectionId) break
					}
				}

				// Finally, try case-insensitive partial match on section titles
				if (!sectionId) {
					for (const module of EAC_NMRA_TEMPLATE.modules) {
						for (const [id, sec] of Object.entries(module.sections)) {
							if (sec.title.toLowerCase().includes(searchTerm)) {
								sectionId = id
								section = sec
								break
							}
						}
						if (sectionId) break
					}
				}

				if (!sectionId || !section) {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Section not found: "${sectionNameOrId}". Please provide a valid section ID (e.g., "1.1") or section name.`,
						type: ShowMessageType.ERROR,
					})
					return
				}

				// Get section folder path
				const { SECTION_PARENT_MAP } = await import("@/core/ctd/templates/eac-nmra/prompts")
				const moduleNum = sectionId.charAt(0)
				const basePath = submissionsPath || workspaceRoot
				const dossierPath = path.join(basePath, "dossier")

				if (!(sectionId in SECTION_PARENT_MAP)) {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Cannot determine folder path for section ${sectionId}`,
						type: ShowMessageType.ERROR,
					})
					return
				}

				const ancestors: string[] = []
				let current: string | null = sectionId

				while (current !== null) {
					ancestors.unshift(current)
					current = SECTION_PARENT_MAP[current] ?? null
				}

				const sectionFolders = ancestors.map((s) => `section-${s}`)
				const sectionFolderPath = path.join(dossierPath, `module-${moduleNum}`, ...sectionFolders)

				// Check if section folder exists
				try {
					const stat = await fs.stat(sectionFolderPath)
					if (!stat.isDirectory()) {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `Section folder is not a directory: ${sectionFolderPath}`,
							type: ShowMessageType.ERROR,
						})
						return
					}
				} catch {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Section folder does not exist: ${sectionFolderPath}. Please create the dossier structure first.`,
						type: ShowMessageType.ERROR,
					})
					return
				}

				const tagsPath = path.join(sectionFolderPath, "tags.md")
				const checklistPath = path.join(sectionFolderPath, "checklist.md")

				// Dynamic import to avoid circular dependency
				const { InputChecklistUpdation } = await import("@/core/task/InputChecklistUpdation")
				const stateManager = StateManager.get()
				const shellIntegrationTimeout = stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
				const terminalReuseEnabled = stateManager.getGlobalStateKey("terminalReuseEnabled")
				const vscodeTerminalExecutionMode = stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
				const terminalOutputLineLimit = stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
				const subagentTerminalOutputLineLimit = stateManager.getGlobalSettingsKey("subagentTerminalOutputLineLimit")
				const defaultTerminalProfile = stateManager.getGlobalSettingsKey("defaultTerminalProfile")

				// Setup workspace manager
				const { setupWorkspaceManager } = await import("@/core/workspace/setup")
				const { detectWorkspaceRoots } = await import("@/core/workspace/detection")
				const workspaceManager = await setupWorkspaceManager({
					stateManager,
					detectRoots: detectWorkspaceRoots,
				})

				const cwd = workspaceManager?.getPrimaryRoot()?.path || workspaceRoot
				const taskId = `checklist-updation-${sectionId}-${Date.now()}`

				// Acquire task lock
				const { tryAcquireTaskLockWithRetry } = await import("@/core/task/TaskLockUtils")
				const lockResult = await tryAcquireTaskLockWithRetry(taskId)
				const taskLockAcquired = !!(lockResult.acquired || lockResult.skipped)

				// Create InputChecklistUpdation instance
				const task = new InputChecklistUpdation({
					controller,
					mcpHub: controller.mcpHub,
					shellIntegrationTimeout,
					terminalReuseEnabled: terminalReuseEnabled ?? true,
					terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
					subagentTerminalOutputLineLimit: subagentTerminalOutputLineLimit ?? 2000,
					defaultTerminalProfile: defaultTerminalProfile ?? "default",
					vscodeTerminalExecutionMode: vscodeTerminalExecutionMode || "backgroundExec",
					cwd,
					stateManager,
					workspaceManager,
					task: `Update checklist for section ${sectionId}`,
					taskId,
					taskLockAcquired,
					sectionId,
					sectionFolderPath,
					tagsPath,
					checklistPath,
					onProgress: (sectionId: string, status: string) => {
						console.log(`[Checklist Updation ${sectionId}] ${status}`)
						progress.report({ message: status })
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `Checklist Updation (${sectionId}): ${status}`,
							type: ShowMessageType.INFORMATION,
						})
					},
				})

				// Set mode to "act" and disable strict plan mode for subagents
				stateManager.setGlobalState("mode", "act")
				stateManager.setGlobalState("strictPlanModeEnabled", false)

				// Run checklist updation
				const result = await task.runChecklistUpdation()

				if (result.success) {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Checklist updation completed for ${sectionId}: ${result.newlyCheckedCount} features checked`,
						type: ShowMessageType.INFORMATION,
					})
				} else {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Checklist updation failed for ${sectionId}: ${result.error || "Unknown error"}`,
						type: ShowMessageType.ERROR,
					})
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				console.error(`Error updating checklist for ${sectionNameOrId}:`, error)
				HostProvider.get().hostBridge.windowClient.showMessage({
					message: `Checklist Updation Error (${sectionNameOrId}): ${errorMessage}`,
					type: ShowMessageType.ERROR,
				})
			} finally {
				if (checklistUpdationService === service) {
					checklistUpdationService = null
				}
			}
		},
	)
}

/**
 * Executes the update-checklist command
 */
export async function executeUpdateChecklist(
	workspaceRoot: string,
	sectionNameOrId: string,
): Promise<{ success: boolean; message: string }> {
	try {
		// Start checklist updation in the background
		startChecklistUpdation(workspaceRoot, sectionNameOrId)

		const message = `Checklist updation for "${sectionNameOrId}" has been started in the background. The system will check input features against document info.json files and update the checklist. Progress notifications will appear as the checklist is updated.`
		return { success: true, message }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return {
			success: false,
			message: `Failed to start checklist updation: ${errorMessage}`,
		}
	}
}

/**
 * Starts output checklist updation in the background
 */
function startOutputChecklistUpdation(workspaceRoot: string, sectionNameOrId: string): void {
	// Get controller from webview provider for subagents
	const webview = WebviewProvider.getVisibleInstance()
	const controller = webview?.controller

	if (!controller) {
		console.error("Cannot start output checklist updation: No controller available")
		HostProvider.get().hostBridge.windowClient.showMessage({
			message:
				"Cannot start output checklist updation: No controller available. Please ensure Cline is properly initialized.",
			type: ShowMessageType.ERROR,
		})
		return
	}

	// Check if submissions folder is set
	const submissionsProvider = SubmissionsPaneProvider.getInstance()
	const submissionsPath = submissionsProvider?.getSubmissionsFolder()
	if (!submissionsPath) {
		HostProvider.get().hostBridge.windowClient.showMessage({
			message:
				"Cannot start output checklist updation: No submissions folder set. Please set a submissions folder in the left pane before updating checklists.",
			type: ShowMessageType.ERROR,
		})
		return
	}

	const service = new DossierGeneratorService(workspaceRoot, controller)
	outputChecklistUpdationService = service

	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Updating Output Checklist: ${sectionNameOrId}`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				outputChecklistUpdationService = null
			})

			try {
				// Find section by name or ID
				const searchTerm = sectionNameOrId.toLowerCase().trim()
				let sectionId: string | null = null
				let section: CTDSectionDef | null = null

				// First, try exact ID match
				for (const module of EAC_NMRA_TEMPLATE.modules) {
					if (module.sections[sectionNameOrId]) {
						sectionId = sectionNameOrId
						section = module.sections[sectionNameOrId]
						break
					}
				}

				// Then, try case-insensitive partial match on section IDs
				if (!sectionId) {
					for (const module of EAC_NMRA_TEMPLATE.modules) {
						for (const [id, sec] of Object.entries(module.sections)) {
							if (id.toLowerCase().includes(searchTerm)) {
								sectionId = id
								section = sec
								break
							}
						}
						if (sectionId) break
					}
				}

				// Finally, try case-insensitive partial match on section titles
				if (!sectionId) {
					for (const module of EAC_NMRA_TEMPLATE.modules) {
						for (const [id, sec] of Object.entries(module.sections)) {
							if (sec.title.toLowerCase().includes(searchTerm)) {
								sectionId = id
								section = sec
								break
							}
						}
						if (sectionId) break
					}
				}

				if (!sectionId || !section) {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Section not found: "${sectionNameOrId}". Please provide a valid section ID (e.g., "1.1") or section name.`,
						type: ShowMessageType.ERROR,
					})
					return
				}

				// Get section folder path
				const { SECTION_PARENT_MAP } = await import("@/core/ctd/templates/eac-nmra/prompts")
				const moduleNum = sectionId.charAt(0)
				const basePath = submissionsPath || workspaceRoot
				const dossierPath = path.join(basePath, "dossier")

				if (!(sectionId in SECTION_PARENT_MAP)) {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Cannot determine folder path for section ${sectionId}`,
						type: ShowMessageType.ERROR,
					})
					return
				}

				const ancestors: string[] = []
				let current: string | null = sectionId

				while (current !== null) {
					ancestors.unshift(current)
					current = SECTION_PARENT_MAP[current] ?? null
				}

				const sectionFolders = ancestors.map((s) => `section-${s}`)
				const sectionFolderPath = path.join(dossierPath, `module-${moduleNum}`, ...sectionFolders)

				// Check if section folder exists
				try {
					const stat = await fs.stat(sectionFolderPath)
					if (!stat.isDirectory()) {
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `Section folder is not a directory: ${sectionFolderPath}`,
							type: ShowMessageType.ERROR,
						})
						return
					}
				} catch {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Section folder does not exist: ${sectionFolderPath}. Please create the dossier structure first.`,
						type: ShowMessageType.ERROR,
					})
					return
				}

				const checklistPath = path.join(sectionFolderPath, "checklist.md")

				// Dynamic import to avoid circular dependency
				const { OutputChecklistUpdation } = await import("@/core/task/OutputChecklistUpdation")
				const stateManager = StateManager.get()
				const shellIntegrationTimeout = stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
				const terminalReuseEnabled = stateManager.getGlobalStateKey("terminalReuseEnabled")
				const vscodeTerminalExecutionMode = stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
				const terminalOutputLineLimit = stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
				const subagentTerminalOutputLineLimit = stateManager.getGlobalSettingsKey("subagentTerminalOutputLineLimit")
				const defaultTerminalProfile = stateManager.getGlobalSettingsKey("defaultTerminalProfile")

				// Setup workspace manager
				const { setupWorkspaceManager } = await import("@/core/workspace/setup")
				const { detectWorkspaceRoots } = await import("@/core/workspace/detection")
				const workspaceManager = await setupWorkspaceManager({
					stateManager,
					detectRoots: detectWorkspaceRoots,
				})

				const cwd = workspaceManager?.getPrimaryRoot()?.path || workspaceRoot
				const taskId = `output-checklist-updation-${sectionId}-${Date.now()}`

				// Acquire task lock
				const { tryAcquireTaskLockWithRetry } = await import("@/core/task/TaskLockUtils")
				const lockResult = await tryAcquireTaskLockWithRetry(taskId)
				const taskLockAcquired = !!(lockResult.acquired || lockResult.skipped)

				// Create OutputChecklistUpdation instance
				const task = new OutputChecklistUpdation({
					controller,
					mcpHub: controller.mcpHub,
					shellIntegrationTimeout,
					terminalReuseEnabled: terminalReuseEnabled ?? true,
					terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
					subagentTerminalOutputLineLimit: subagentTerminalOutputLineLimit ?? 2000,
					defaultTerminalProfile: defaultTerminalProfile ?? "default",
					vscodeTerminalExecutionMode: vscodeTerminalExecutionMode || "backgroundExec",
					cwd,
					stateManager,
					workspaceManager,
					task: `Update output checklist for section ${sectionId}`,
					taskId,
					taskLockAcquired,
					sectionId,
					sectionFolderPath,
					checklistPath,
					onProgress: (sectionId: string, status: string) => {
						console.log(`[Output Checklist Updation ${sectionId}] ${status}`)
						progress.report({ message: status })
						HostProvider.get().hostBridge.windowClient.showMessage({
							message: `Output Checklist Updation (${sectionId}): ${status}`,
							type: ShowMessageType.INFORMATION,
						})
					},
				})

				// Set mode to "act" and disable strict plan mode for subagents
				stateManager.setGlobalState("mode", "act")
				stateManager.setGlobalState("strictPlanModeEnabled", false)

				// Run output checklist updation
				const result = await task.runChecklistUpdation()

				if (result.success) {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Output checklist updation completed for ${sectionId}: ${result.newlyCheckedCount} features checked`,
						type: ShowMessageType.INFORMATION,
					})
				} else {
					HostProvider.get().hostBridge.windowClient.showMessage({
						message: `Output checklist updation failed for ${sectionId}: ${result.error || "Unknown error"}`,
						type: ShowMessageType.ERROR,
					})
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				console.error(`Error updating output checklist for ${sectionNameOrId}:`, error)
				HostProvider.get().hostBridge.windowClient.showMessage({
					message: `Output Checklist Updation Error (${sectionNameOrId}): ${errorMessage}`,
					type: ShowMessageType.ERROR,
				})
			} finally {
				if (outputChecklistUpdationService === service) {
					outputChecklistUpdationService = null
				}
			}
		},
	)
}

/**
 * Executes the update-output-checklist command
 */
export async function executeUpdateOutputChecklist(
	workspaceRoot: string,
	sectionNameOrId: string,
): Promise<{ success: boolean; message: string }> {
	try {
		// Start output checklist updation in the background
		startOutputChecklistUpdation(workspaceRoot, sectionNameOrId)

		const message = `Output checklist updation for "${sectionNameOrId}" has been started in the background. The system will check output features against content.tex and update the checklist. Progress notifications will appear as the checklist is updated.`
		return { success: true, message }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return {
			success: false,
			message: `Failed to start output checklist updation: ${errorMessage}`,
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
): Promise<{ processedText: string; needsClinerulesFileCheck: boolean; detectedSlashCommand?: string }> {
	const SUPPORTED_DEFAULT_COMMANDS = [
		"newtask",
		"smol",
		"compact",
		"newrule",
		"reportbug",
		"deep-planning",
		"subagent",
		"explain-changes",
		"generate-dossier",
		"generate-section",
		"update-checklist",
		"update-output-checklist",
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
					return { processedText, needsClinerulesFileCheck: false, detectedSlashCommand: commandName }
				}
			}

			// Special handling for update-checklist: execute directly with section name parameter
			if (commandName === "update-checklist") {
				try {
					// Extract section name/ID from the command
					// The command format is: /update-checklist <section-name-or-id>
					const commandEndPosition = slashMatch.index + slashMatch[1].length + slashMatch[2].length + 1 // +1 for the slash
					const remainingText = tagContent.substring(commandEndPosition).trim()

					// Extract the section parameter (could be quoted or unquoted)
					let sectionName: string | undefined
					if (remainingText) {
						// Check if it's quoted
						const quotedMatch = remainingText.match(/^["']([^"']+)["']/)
						if (quotedMatch) {
							sectionName = quotedMatch[1]
						} else {
							// Take the first word/token
							const firstToken = remainingText.split(/\s+/)[0]
							sectionName = firstToken || undefined
						}
					}

					if (!sectionName) {
						const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
						const processedText = `<explicit_instructions type="update-checklist-result">
The /update-checklist command requires a section name or ID as a parameter. Usage: /update-checklist <section-name-or-id>

Example: /update-checklist "1.1" or /update-checklist 1.1
</explicit_instructions>

${textWithoutSlashCommand}`
						return { processedText, needsClinerulesFileCheck: false }
					}

					// Get workspace root
					const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
					const workspaceRoot = workspacePaths.paths?.[0] || process.cwd()

					// Execute the command
					const result = await executeUpdateChecklist(workspaceRoot, sectionName)

					// Remove slash command from text
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)

					// Return message for AI to report to user
					const processedText = `<explicit_instructions type="update-checklist-result">
The /update-checklist command has been executed for section "${sectionName}". ${result.message}

Please inform the user about the result: ${result.success ? "Success" : "Error"} - ${result.message}
</explicit_instructions>

${textWithoutSlashCommand}`

					// Track telemetry for builtin slash command usage
					telemetryService.captureSlashCommandUsed(ulid, commandName, "builtin")

					return { processedText, needsClinerulesFileCheck: false }
				} catch (error) {
					console.error(`Error executing update-checklist command: ${error}`)
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
					const processedText = `<explicit_instructions type="update-checklist-result">
The /update-checklist command failed to execute. Please inform the user about the error: ${error instanceof Error ? error.message : String(error)}
</explicit_instructions>

${textWithoutSlashCommand}`
					return { processedText, needsClinerulesFileCheck: false }
				}
			}

			// Special handling for update-output-checklist: execute directly with section name parameter
			if (commandName === "update-output-checklist") {
				try {
					// Extract section name/ID from the command
					// The command format is: /update-output-checklist <section-name-or-id>
					const commandEndPosition = slashMatch.index + slashMatch[1].length + slashMatch[2].length + 1 // +1 for the slash
					const remainingText = tagContent.substring(commandEndPosition).trim()

					// Extract the section parameter (could be quoted or unquoted)
					let sectionName: string | undefined
					if (remainingText) {
						// Check if it's quoted
						const quotedMatch = remainingText.match(/^["']([^"']+)["']/)
						if (quotedMatch) {
							sectionName = quotedMatch[1]
						} else {
							// Take the first word/token
							const firstToken = remainingText.split(/\s+/)[0]
							sectionName = firstToken || undefined
						}
					}

					if (!sectionName) {
						const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
						const processedText = `<explicit_instructions type="update-output-checklist-result">
The /update-output-checklist command requires a section name or ID as a parameter. Usage: /update-output-checklist <section-name-or-id>

Example: /update-output-checklist "1.1" or /update-output-checklist 1.1
</explicit_instructions>

${textWithoutSlashCommand}`
						return { processedText, needsClinerulesFileCheck: false }
					}

					// Get workspace root
					const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
					const workspaceRoot = workspacePaths.paths?.[0] || process.cwd()

					// Execute the command
					const result = await executeUpdateOutputChecklist(workspaceRoot, sectionName)

					// Remove slash command from text
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)

					// Return message for AI to report to user
					const processedText = `<explicit_instructions type="update-output-checklist-result">
The /update-output-checklist command has been executed for section "${sectionName}". ${result.message}

Please inform the user about the result: ${result.success ? "Success" : "Error"} - ${result.message}
</explicit_instructions>

${textWithoutSlashCommand}`

					// Track telemetry for builtin slash command usage
					telemetryService.captureSlashCommandUsed(ulid, commandName, "builtin")

					return { processedText, needsClinerulesFileCheck: false }
				} catch (error) {
					console.error(`Error executing update-output-checklist command: ${error}`)
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
					const processedText = `<explicit_instructions type="update-output-checklist-result">
The /update-output-checklist command failed to execute. Please inform the user about the error: ${error instanceof Error ? error.message : String(error)}
</explicit_instructions>

${textWithoutSlashCommand}`
					return { processedText, needsClinerulesFileCheck: false }
				}
			}

			// Special handling for generate-section: execute directly with section name parameter
			if (commandName === "generate-section") {
				try {
					// Extract section name/ID from the command
					// The command format is: /generate-section <section-name-or-id>
					const commandEndPosition = slashMatch.index + slashMatch[1].length + slashMatch[2].length + 1 // +1 for the slash
					const remainingText = tagContent.substring(commandEndPosition).trim()

					// Extract the section parameter (could be quoted or unquoted)
					let sectionName: string | undefined
					if (remainingText) {
						// Check if it's quoted
						const quotedMatch = remainingText.match(/^["']([^"']+)["']/)
						if (quotedMatch) {
							sectionName = quotedMatch[1]
						} else {
							// Take the first word/token
							const firstToken = remainingText.split(/\s+/)[0]
							sectionName = firstToken || undefined
						}
					}

					if (!sectionName) {
						const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
						const processedText = `<explicit_instructions type="generate-section-result">
The /generate-section command requires a section name or ID as a parameter. Usage: /generate-section <section-name-or-id>

Example: /generate-section "3.2.P.5" or /generate-section 3.2.P.5
</explicit_instructions>

${textWithoutSlashCommand}`
						return { processedText, needsClinerulesFileCheck: false, detectedSlashCommand: commandName }
					}

					// Get workspace root
					const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
					const workspaceRoot = workspacePaths.paths?.[0] || process.cwd()

					// Execute the command
					const result = await executeGenerateDossierSection(workspaceRoot, sectionName)

					// Remove slash command from text
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)

					// Return message for AI to report to user
					const processedText = `<explicit_instructions type="generate-section-result">
The /generate-section command has been executed for section "${sectionName}". ${result.message}

Please inform the user about the result: ${result.success ? "Success" : "Error"} - ${result.message}
</explicit_instructions>

${textWithoutSlashCommand}`

					// Track telemetry for builtin slash command usage
					telemetryService.captureSlashCommandUsed(ulid, commandName, "builtin")

					return { processedText, needsClinerulesFileCheck: false, detectedSlashCommand: commandName }
				} catch (error) {
					console.error(`Error executing generate-section command: ${error}`)
					const textWithoutSlashCommand = removeSlashCommand(text, tagContent, contentStartIndex, slashMatch)
					const processedText = `<explicit_instructions type="generate-section-result">
The /generate-section command failed to execute. Please inform the user about the error: ${error instanceof Error ? error.message : String(error)}
</explicit_instructions>

${textWithoutSlashCommand}`
					return { processedText, needsClinerulesFileCheck: false, detectedSlashCommand: commandName }
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
