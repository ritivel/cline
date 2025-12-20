/**
 * Standalone runner for Section 2.3.xy generation
 *
 * This script can be used to trigger any CTD section 2.3.xy generation independently.
 *
 * Usage:
 * 1. Set the global variables before calling:
 *    ```
 *    import { Section23xyConfig, runSection23xyGeneration } from './runSection23xyGeneration'
 *
 *    Section23xyConfig.controller = myController
 *    Section23xyConfig.submissionsPath = "/path/to/submissions"
 *
 *    const result = await runSection23xyGeneration({ sectionId: "2.3.S.2" })
 *    ```
 *
 * 2. Via slash command: /generate-section 2.3.S.2
 */

import type { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import type { McpHub } from "@services/mcp/McpHub"
import * as fs from "fs"
import * as path from "path"
import type { Controller } from "../controller"
import type { StateManager } from "../storage/StateManager"
import {
	buildSectionFolderPath,
	getSectionTitle,
	isValidSectionId,
	// getSectionTimeout,
} from "./ich-guidelines-for-2.3.xy"
import { tryAcquireTaskLockWithRetry } from "./TaskLockUtils"
import { TaskSection23xy } from "./TaskSection23xy"

// ============================================================================
// GLOBAL CONFIGURATION - Set these values before calling runSection23xyGeneration()
// ============================================================================

/**
 * Global configuration for Section 2.3.xy generation
 * Set these values before calling runSection23xyGeneration()
 */
export const Section23xyConfig = {
	/** The controller instance (REQUIRED) */
	controller: undefined as Controller | undefined,

	/** The MCP Hub instance (optional - will use controller.mcpHub if not set) */
	mcpHub: undefined as McpHub | undefined,

	/** The StateManager instance (optional - will auto-detect if not set) */
	stateManager: undefined as StateManager | undefined,

	/** The WorkspaceRootManager instance (optional) */
	workspaceManager: undefined as WorkspaceRootManager | undefined,

	/** Path to the submissions folder (REQUIRED) */
	submissionsPath: undefined as string | undefined,

	/** Current working directory (optional - defaults to submissionsPath) */
	cwd: undefined as string | undefined,

	/** Drug name override (optional - will read from tags.md if not set) */
	drugName: undefined as string | undefined,

	/** Shell integration timeout in ms (optional - default: 15000) */
	shellIntegrationTimeout: 15000,

	/** Terminal reuse enabled (optional - default: true) */
	terminalReuseEnabled: true,

	/** Terminal output line limit (optional - default: 500) */
	terminalOutputLineLimit: 500,

	/** Subagent terminal output line limit (optional - default: 2000) */
	subagentTerminalOutputLineLimit: 2000,

	/** Default terminal profile (optional - default: "default") */
	defaultTerminalProfile: "default",

	/** VS Code terminal execution mode (optional - default: "backgroundExec") */
	vscodeTerminalExecutionMode: "backgroundExec" as "vscodeTerminal" | "backgroundExec",
}

// ============================================================================

export interface RunSection23xyOptions {
	/** The section ID to generate (REQUIRED) - e.g., "2.3.S.2", "2.3.P.1" */
	sectionId: string
	/** The controller instance (will use Section23xyConfig.controller if not provided) */
	controller?: Controller
	/** Custom submissions path (will use Section23xyConfig.submissionsPath if not provided) */
	submissionsPath?: string
	/** Progress callback */
	onProgress?: (status: string) => void
	/** Drug name override (will use Section23xyConfig.drugName if not provided) */
	drugName?: string
	/** Optional ICH instructions override */
	ichInstructionsOverride?: string
}

export interface RunSection23xyResult {
	success: boolean
	error?: string
	outputFile?: string
	sectionId?: string
}

/**
 * Gets the submissions folder path from SubmissionsPaneProvider (fallback)
 */
function getSubmissionsFolder(): string | undefined {
	// First check global config
	if (Section23xyConfig.submissionsPath) {
		return Section23xyConfig.submissionsPath
	}

	// Try to get from SubmissionsPaneProvider
	try {
		const { SubmissionsPaneProvider } = require("@/hosts/vscode/SubmissionsPaneProvider")
		const submissionsProvider = SubmissionsPaneProvider.getInstance()
		return submissionsProvider?.getSubmissionsFolder()
	} catch (error) {
		console.warn(`[runSection23xyGeneration] Failed to get submissions folder: ${error}`)
		return undefined
	}
}

/**
 * Gets the controller from WebviewProvider (fallback)
 */
function getController(): Controller | undefined {
	// First check global config
	if (Section23xyConfig.controller) {
		return Section23xyConfig.controller
	}

	// Try to get from WebviewProvider
	try {
		const { WebviewProvider } = require("@/hosts/vscode/WebviewProvider")
		const webview = WebviewProvider.getVisibleInstance()
		return webview?.controller
	} catch (error) {
		console.warn(`[runSection23xyGeneration] Failed to get controller: ${error}`)
		return undefined
	}
}

/**
 * Gets the StateManager (fallback)
 */
function getStateManager(): StateManager | undefined {
	// First check global config
	if (Section23xyConfig.stateManager) {
		return Section23xyConfig.stateManager
	}

	// Try to get from StateManager.get()
	try {
		const { StateManager } = require("../storage/StateManager")
		return StateManager.get()
	} catch (error) {
		console.warn(`[runSection23xyGeneration] Failed to get StateManager: ${error}`)
		return undefined
	}
}

/**
 * Runs section 2.3.xy generation for any supported section
 *
 * Uses values from Section23xyConfig global object, with options as overrides.
 *
 * @param options - Configuration options (overrides global config)
 * @returns Result indicating success or failure
 */
export async function runSection23xyGeneration(options: RunSection23xyOptions): Promise<RunSection23xyResult> {
	const { sectionId, onProgress, ichInstructionsOverride } = options

	const log = (message: string) => {
		console.log(`[runSection23xyGeneration:${sectionId}] ${message}`)
		onProgress?.(message)
	}

	try {
		// Validate section ID
		if (!isValidSectionId(sectionId)) {
			return {
				success: false,
				error: `Invalid section ID: ${sectionId}. Valid sections are 2.3.S.1-S.7, 2.3.P.1-P.8, 2.3.A.1-A.3, 2.3.R`,
				sectionId,
			}
		}

		const sectionTitle = getSectionTitle(sectionId)
		log(`Starting section ${sectionId} (${sectionTitle}) generation...`)

		// Get controller (options > global config > auto-detect)
		const controller = options.controller || getController()
		if (!controller) {
			return {
				success: false,
				error: "No controller available. Set Section23xyConfig.controller or pass via options.",
				sectionId,
			}
		}

		// Get submissions path (options > global config > auto-detect)
		const submissionsPath = options.submissionsPath || getSubmissionsFolder()
		if (!submissionsPath) {
			return {
				success: false,
				error: "No submissions folder set. Set Section23xyConfig.submissionsPath or pass via options.",
				sectionId,
			}
		}

		log(`Using submissions path: ${submissionsPath}`)

		// Build paths
		const dossierPath = path.join(submissionsPath, "dossier")
		const sectionFolderPath = buildSectionFolderPath(sectionId, dossierPath)
		const tagsPath = path.join(sectionFolderPath, "tags.md")
		const expectedOutputFile = path.join(sectionFolderPath, "content.tex")

		log(`Section folder: ${sectionFolderPath}`)

		// Verify section folder exists
		try {
			const stat = await fs.promises.stat(sectionFolderPath)
			if (!stat.isDirectory()) {
				return {
					success: false,
					error: `Section folder is not a directory: ${sectionFolderPath}`,
					sectionId,
				}
			}
		} catch {
			return {
				success: false,
				error: `Section folder does not exist: ${sectionFolderPath}. Please create the dossier structure first.`,
				sectionId,
			}
		}

		// Get state manager from global config or auto-detect
		const stateManager = getStateManager()

		// Get settings from global config (with fallbacks)
		const shellIntegrationTimeout = Section23xyConfig.shellIntegrationTimeout
		const terminalReuseEnabled = Section23xyConfig.terminalReuseEnabled
		const vscodeTerminalExecutionMode = Section23xyConfig.vscodeTerminalExecutionMode
		const terminalOutputLineLimit = Section23xyConfig.terminalOutputLineLimit
		const subagentTerminalOutputLineLimit = Section23xyConfig.subagentTerminalOutputLineLimit
		const defaultTerminalProfile = Section23xyConfig.defaultTerminalProfile

		// Get workspace manager from global config
		const workspaceManager = Section23xyConfig.workspaceManager

		// Get cwd from global config or use submissions path
		const cwd = Section23xyConfig.cwd || submissionsPath
		const taskId = `section23xy-${sectionId.replace(/\./g, "-")}-${Date.now()}`

		// Acquire task lock
		log("Acquiring task lock...")
		const lockResult = await tryAcquireTaskLockWithRetry(taskId)
		const taskLockAcquired = !!(lockResult.acquired || lockResult.skipped)

		// Get McpHub from global config or controller
		const mcpHub = Section23xyConfig.mcpHub || controller.mcpHub

		// Create TaskSection23xy instance
		log("Creating TaskSection23xy instance...")
		const task = new TaskSection23xy({
			controller,
			mcpHub,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			terminalOutputLineLimit,
			subagentTerminalOutputLineLimit,
			defaultTerminalProfile,
			vscodeTerminalExecutionMode,
			cwd,
			stateManager: stateManager!,
			workspaceManager,
			task: `Generate section ${sectionId} (${sectionTitle})`,
			taskId,
			taskLockAcquired,
			sectionId,
			sectionFolderPath,
			expectedOutputFile,
			tagsPath,
			ichInstructionsOverride,
			onProgress: (status) => log(status),
		})

		// Set mode to "act" for subagents (if stateManager available)
		if (stateManager) {
			stateManager.setGlobalState("mode", "act")
			stateManager.setGlobalState("strictPlanModeEnabled", false)
		}

		// Run section generation
		log("Running section generation...")
		const result = await task.runSectionGeneration()

		if (result.success) {
			log(`Section ${sectionId} generated successfully: ${expectedOutputFile}`)
			return {
				success: true,
				outputFile: expectedOutputFile,
				sectionId,
			}
		} else {
			log(`Section generation failed: ${result.error}`)
			return {
				success: false,
				error: result.error,
				sectionId,
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error)
		log(`Error: ${errorMsg}`)
		return {
			success: false,
			error: errorMsg,
			sectionId,
		}
	}
}

/**
 * Quick helper to run section generation with minimal configuration
 * Uses values from Section23xyConfig global object
 *
 * @param sectionId - The section ID to generate (e.g., "2.3.S.2")
 */
export async function generateSection23xy(sectionId: string): Promise<RunSection23xyResult> {
	return runSection23xyGeneration({ sectionId })
}

/**
 * Resets the global configuration to defaults
 */
export function resetSection23xyConfig(): void {
	Section23xyConfig.controller = undefined
	Section23xyConfig.mcpHub = undefined
	Section23xyConfig.stateManager = undefined
	Section23xyConfig.workspaceManager = undefined
	Section23xyConfig.submissionsPath = undefined
	Section23xyConfig.cwd = undefined
	Section23xyConfig.drugName = undefined
	Section23xyConfig.shellIntegrationTimeout = 15000
	Section23xyConfig.terminalReuseEnabled = true
	Section23xyConfig.terminalOutputLineLimit = 500
	Section23xyConfig.subagentTerminalOutputLineLimit = 2000
	Section23xyConfig.defaultTerminalProfile = "default"
	Section23xyConfig.vscodeTerminalExecutionMode = "backgroundExec"
}

/**
 * Gets all available section IDs that can be generated
 */
export function getAvailableSections(): string[] {
	return [
		// Drug Substance
		"2.3.S.1",
		"2.3.S.2",
		"2.3.S.3",
		"2.3.S.4",
		"2.3.S.5",
		"2.3.S.6",
		"2.3.S.7",
		// Drug Product
		"2.3.P.1",
		"2.3.P.2",
		"2.3.P.3",
		"2.3.P.4",
		"2.3.P.5",
		"2.3.P.6",
		"2.3.P.7",
		"2.3.P.8",
		// Appendices
		"2.3.A.1",
		"2.3.A.2",
		"2.3.A.3",
		// Regional
		"2.3.R",
	]
}

// Export default for convenience
export default runSection23xyGeneration
