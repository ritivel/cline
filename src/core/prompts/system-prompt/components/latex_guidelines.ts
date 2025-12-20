import { LATEX_FORMATTING_GUIDELINES } from "@/core/task/constants/latexGuidelines"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getLatexGuidelinesSection(
	_variant: PromptVariant,
	context: SystemPromptContext,
): Promise<string | undefined> {
	const isDossierSubagent = context.runtimePlaceholders?.isSubagent === true
	const isDossierCommand =
		context.runtimePlaceholders?.activeDossierCommand === "generate-section" ||
		context.runtimePlaceholders?.activeDossierCommand === "generate-dossier"

	if (!isDossierSubagent && !isDossierCommand) {
		return undefined
	}

	return `LATEX GUIDELINES

${LATEX_FORMATTING_GUIDELINES}`
}
