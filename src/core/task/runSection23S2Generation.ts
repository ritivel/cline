/**
 * Standalone runner for Section 2.3.S.2 (Manufacture) generation
 *
 * This script can be used to trigger section 2.3.S.2 generation independently.
 *
 * Usage:
 * 1. Set the global variables before calling:
 *    ```
 *    import { Section23S2Config, runSection23S2Generation } from './runSection23S2Generation'
 *
 *    Section23S2Config.controller = myController
 *    Section23S2Config.submissionsPath = "/path/to/submissions"
 *
 *    const result = await runSection23S2Generation()
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
import { tryAcquireTaskLockWithRetry } from "./TaskLockUtils"
import { TaskSection23S2 } from "./TaskSection23S2"

// ============================================================================
// GLOBAL CONFIGURATION - Set these values before calling runSection23S2Generation()
// ============================================================================

/**
 * Global configuration for Section 2.3.S.2 generation
 * Set these values before calling runSection23S2Generation()
 */
export const Section23S2Config = {
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

export interface RunSection23S2Options {
	/** The controller instance (will use Section23S2Config.controller if not provided) */
	controller?: Controller
	/** Custom submissions path (will use Section23S2Config.submissionsPath if not provided) */
	submissionsPath?: string
	/** Progress callback */
	onProgress?: (status: string) => void
	/** Drug name override (will use Section23S2Config.drugName if not provided) */
	drugName?: string
}

export interface RunSection23S2Result {
	success: boolean
	error?: string
	outputFile?: string
}

/**
 * Gets the submissions folder path from SubmissionsPaneProvider (fallback)
 */
function getSubmissionsFolder(): string | undefined {
	// First check global config
	if (Section23S2Config.submissionsPath) {
		return Section23S2Config.submissionsPath
	}

	// Try to get from SubmissionsPaneProvider
	try {
		const { SubmissionsPaneProvider } = require("@/hosts/vscode/SubmissionsPaneProvider")
		const submissionsProvider = SubmissionsPaneProvider.getInstance()
		return submissionsProvider?.getSubmissionsFolder()
	} catch (error) {
		console.warn(`[runSection23S2Generation] Failed to get submissions folder: ${error}`)
		return undefined
	}
}

/**
 * Gets the controller from WebviewProvider (fallback)
 */
function getController(): Controller | undefined {
	// First check global config
	if (Section23S2Config.controller) {
		return Section23S2Config.controller
	}

	// Try to get from WebviewProvider
	try {
		const { WebviewProvider } = require("@/hosts/vscode/WebviewProvider")
		const webview = WebviewProvider.getVisibleInstance()
		return webview?.controller
	} catch (error) {
		console.warn(`[runSection23S2Generation] Failed to get controller: ${error}`)
		return undefined
	}
}

/**
 * Gets the StateManager (fallback)
 */
function getStateManager(): StateManager | undefined {
	// First check global config
	if (Section23S2Config.stateManager) {
		return Section23S2Config.stateManager
	}

	// Try to get from StateManager.get()
	try {
		const { StateManager } = require("../storage/StateManager")
		return StateManager.get()
	} catch (error) {
		console.warn(`[runSection23S2Generation] Failed to get StateManager: ${error}`)
		return undefined
	}
}

/**
 * Builds the section folder path for 2.3.S.2
 */
function buildSectionFolderPath(dossierPath: string): string {
	// Section 2.3.S.2 path: module-2/section-2.3/section-2.3.S/section-2.3.S.2
	return path.join(dossierPath, "module-2", "section-2.3", "section-2.3.S", "section-2.3.S.2")
}

/**
 * Runs section 2.3.S.2 (Manufacture) generation
 *
 * Uses values from Section23S2Config global object, with options as overrides.
 *
 * @param options - Configuration options (overrides global config)
 * @returns Result indicating success or failure
 */
export async function runSection23S2Generation(options: RunSection23S2Options = {}): Promise<RunSection23S2Result> {
	const { onProgress } = options

	const log = (message: string) => {
		console.log(`[runSection23S2Generation] ${message}`)
		onProgress?.(message)
	}

	try {
		log("Starting section 2.3.S.2 generation...")

		// Get controller (options > global config > auto-detect)
		const controller = options.controller || getController()
		if (!controller) {
			return {
				success: false,
				error: "No controller available. Set Section23S2Config.controller or pass via options.",
			}
		}

		// Get submissions path (options > global config > auto-detect)
		const submissionsPath = options.submissionsPath || getSubmissionsFolder()
		if (!submissionsPath) {
			return {
				success: false,
				error: "No submissions folder set. Set Section23S2Config.submissionsPath or pass via options.",
			}
		}

		log(`Using submissions path: ${submissionsPath}`)

		// Build paths
		const dossierPath = path.join(submissionsPath, "dossier")
		const sectionFolderPath = buildSectionFolderPath(dossierPath)
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
				}
			}
		} catch {
			return {
				success: false,
				error: `Section folder does not exist: ${sectionFolderPath}. Please create the dossier structure first.`,
			}
		}

		// Get state manager from global config or auto-detect
		const stateManager = getStateManager()

		// Get settings from global config (with fallbacks)
		const shellIntegrationTimeout = Section23S2Config.shellIntegrationTimeout
		const terminalReuseEnabled = Section23S2Config.terminalReuseEnabled
		const vscodeTerminalExecutionMode = Section23S2Config.vscodeTerminalExecutionMode
		const terminalOutputLineLimit = Section23S2Config.terminalOutputLineLimit
		const subagentTerminalOutputLineLimit = Section23S2Config.subagentTerminalOutputLineLimit
		const defaultTerminalProfile = Section23S2Config.defaultTerminalProfile

		// Get workspace manager from global config
		const workspaceManager = Section23S2Config.workspaceManager

		// Get cwd from global config or use submissions path
		const cwd = Section23S2Config.cwd || submissionsPath
		const taskId = `section23s2-standalone-${Date.now()}`

		// Acquire task lock
		log("Acquiring task lock...")
		const lockResult = await tryAcquireTaskLockWithRetry(taskId)
		const taskLockAcquired = !!(lockResult.acquired || lockResult.skipped)

		// Get McpHub from global config or controller
		const mcpHub = Section23S2Config.mcpHub || controller.mcpHub

		// Create TaskSection23S2 instance
		log("Creating TaskSection23S2 instance...")
		const task = new TaskSection23S2({
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
			task: "Generate section 2.3.S.2 (Manufacture)",
			taskId,
			taskLockAcquired,
			sectionFolderPath,
			expectedOutputFile,
			tagsPath,
			ichInstructions: undefined, // Use default ICH instructions
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
			log(`Section 2.3.S.2 generated successfully: ${expectedOutputFile}`)
			return {
				success: true,
				outputFile: expectedOutputFile,
			}
		} else {
			log(`Section generation failed: ${result.error}`)
			return {
				success: false,
				error: result.error,
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error)
		log(`Error: ${errorMsg}`)
		return {
			success: false,
			error: errorMsg,
		}
	}
}

/**
 * Quick helper to run section 2.3.S.2 generation with minimal configuration
 * Uses values from Section23S2Config global object
 */
export async function generateSection23S2(): Promise<RunSection23S2Result> {
	return runSection23S2Generation()
}

/**
 * Resets the global configuration to defaults
 */
export function resetSection23S2Config(): void {
	Section23S2Config.controller = undefined
	Section23S2Config.mcpHub = undefined
	Section23S2Config.stateManager = undefined
	Section23S2Config.workspaceManager = undefined
	Section23S2Config.submissionsPath = undefined
	Section23S2Config.cwd = undefined
	Section23S2Config.drugName = undefined
	Section23S2Config.shellIntegrationTimeout = 15000
	Section23S2Config.terminalReuseEnabled = true
	Section23S2Config.terminalOutputLineLimit = 500
	Section23S2Config.subagentTerminalOutputLineLimit = 2000
	Section23S2Config.defaultTerminalProfile = "default"
	Section23S2Config.vscodeTerminalExecutionMode = "backgroundExec"
}

// Export default for convenience
export default runSection23S2Generation
