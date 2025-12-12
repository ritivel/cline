import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

/**
 * Executes a slash command programmatically
 * Supports: /update-checklist <sectionId> and /generate-section <sectionId>
 */
export async function executeSlashCommand(controller: Controller, request: StringRequest): Promise<ProtoString> {
	try {
		const { command } = JSON.parse(request.value || "{}") as { command: string }

		if (!command) {
			throw new Error("Command is required")
		}

		// Parse command string (e.g., "/update-checklist 1.1" or "/generate-section 3.2.P.5")
		const trimmedCommand = command.trim()
		const parts = trimmedCommand.split(/\s+/)
		const commandName = parts[0]?.replace(/^\//, "") // Remove leading slash
		const sectionId = parts
			.slice(1)
			.join(" ")
			.replace(/^["']|["']$/g, "") // Remove quotes if present

		if (!commandName) {
			throw new Error("Invalid command format")
		}

		// Get workspace root
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const workspaceRoot = workspacePaths.paths?.[0] || process.cwd()

		let result: { success: boolean; message: string }

		// Execute the appropriate command
		if (commandName === "update-checklist") {
			if (!sectionId) {
				throw new Error("Section ID is required for /update-checklist command")
			}
			// Dynamic import to avoid circular dependency
			const { executeUpdateChecklist } = await import("@/core/slash-commands/index")
			result = await executeUpdateChecklist(workspaceRoot, sectionId)
		} else if (commandName === "generate-section") {
			if (!sectionId) {
				throw new Error("Section ID is required for /generate-section command")
			}
			// Dynamic import to avoid circular dependency
			const { executeGenerateDossierSection } = await import("@/core/slash-commands/index")
			result = await executeGenerateDossierSection(workspaceRoot, sectionId)
		} else {
			throw new Error(`Unsupported command: ${commandName}. Only /update-checklist and /generate-section are supported.`)
		}

		return ProtoString.create({ value: JSON.stringify(result) })
	} catch (error) {
		console.error("Failed to execute slash command:", error)
		const errorMessage = error instanceof Error ? error.message : String(error)
		return ProtoString.create({
			value: JSON.stringify({
				success: false,
				message: `Failed to execute command: ${errorMessage}`,
			}),
		})
	}
}
