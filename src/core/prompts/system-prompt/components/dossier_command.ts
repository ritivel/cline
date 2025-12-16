import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const DOSSIER_COMMAND_INSTRUCTIONS = `DOSSIER GENERATION MODE

When the user has executed a /generate-dossier or /generate-section command, the generation process runs in the background.

**CRITICAL: NO TOOL CALLS ALLOWED**
- You MUST NOT use any tools when a dossier generation command has been executed
- Do NOT call read_file, write_to_file, replace_in_file, execute_command, or any other tools
- Do NOT attempt to perform file operations or check file contents
- Do NOT try to verify or validate the generation process
- The generation is handled entirely by background processes

**Your role in this mode:**
- Inform the user that the dossier/section generation process has been initiated
- Direct the user to check notifications for progress updates
- Simply acknowledge the command execution and guide the user to monitor notifications
- Provide a brief, conversational response without any tool usage

**Important:** The actual generation work is performed asynchronously by background processes. Your only responsibility is to inform the user about the process status and where to find progress updates. Any tool calls will interfere with the background process and are strictly forbidden.`

export async function getDossierCommandSection(
	variant: PromptVariant,
	context: SystemPromptContext,
): Promise<string | undefined> {
	const activeDossierCommand = context.runtimePlaceholders?.activeDossierCommand as string | undefined

	if (activeDossierCommand === "generate-dossier" || activeDossierCommand === "generate-section") {
		return new TemplateEngine().resolve(DOSSIER_COMMAND_INSTRUCTIONS, context, {})
	}

	return undefined
}
