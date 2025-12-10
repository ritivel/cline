import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## replace_in_tex
Description: Edits an existing LaTeX (.tex) file using SEARCH/REPLACE blocks, automatically recompiles it to PDF, and updates the PDF viewer. The .tex file is automatically recompiled whenever it changes, and the PDF is updated in real-time. The .tex file itself is hidden from view - only the compiled PDF is shown.
Parameters:
- path: (required) The path of the .tex file to edit (relative to the current working directory). If the path doesn't end with .tex, it will be automatically appended.
- diff: (required) One or more SEARCH/REPLACE blocks following this exact format:
  \`\`\`
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE
  \`\`\`
  Critical rules:
  1. SEARCH content must match the associated file section to find EXACTLY:
     * Match character-for-character including whitespace, indentation, line endings
     * Include all comments, docstrings, etc.
  2. SEARCH/REPLACE blocks will ONLY replace the first match occurrence.
     * Including multiple unique SEARCH/REPLACE blocks if you need to make multiple changes.
     * Include *just* enough lines in each SEARCH section to uniquely match each set of lines that need to change.
     * When using multiple SEARCH/REPLACE blocks, list them in the order they appear in the file.
  3. Keep SEARCH/REPLACE blocks concise:
     * Break large SEARCH/REPLACE blocks into a series of smaller blocks that each change a small portion of the file.
     * Include just the changing lines, and a few surrounding lines if needed for uniqueness.
     * Do not include long runs of unchanging lines in SEARCH/REPLACE blocks.
     * Each line must be complete. Never truncate lines mid-way through as this can cause matching failures.
  4. Special operations:
     * To move code: Use two SEARCH/REPLACE blocks (one to delete from original + one to insert at new location)
     * To delete code: Use empty REPLACE section
${focusChainSettings.enabled ? `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)` : "" }
Usage:
<replace_in_tex>
<path>document.tex</path>
<diff>
------- SEARCH
\section{Introduction}
Old content here
=======
\section{Introduction}
New content here
+++++++ REPLACE
</diff>
${focusChainSettings.enabled ? `<task_progress>
Checklist here (optional)
</task_progress>` : "" }
</replace_in_tex>
 */

const id = ClineDefaultTool.REPLACE_IN_TEX

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "replace_in_tex",
	description:
		"Edits an existing LaTeX (.tex) file using SEARCH/REPLACE blocks, automatically recompiles it to PDF, and updates the PDF viewer. The .tex file is automatically recompiled whenever it changes, and the PDF is updated in real-time. The .tex file itself is hidden from view - only the compiled PDF is shown.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the .tex file to edit (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}. If the path doesn't end with .tex, it will be automatically appended.`,
			usage: "document.tex",
		},
		{
			name: "diff",
			required: true,
			instruction: `One or more SEARCH/REPLACE blocks following this exact format:
  \`\`\`
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE
  \`\`\`
  Critical rules:
  1. SEARCH content must match the associated file section to find EXACTLY:
     * Match character-for-character including whitespace, indentation, line endings
     * Include all comments, docstrings, etc.
  2. SEARCH/REPLACE blocks will ONLY replace the first match occurrence.
     * Including multiple unique SEARCH/REPLACE blocks if you need to make multiple changes.
     * Include *just* enough lines in each SEARCH section to uniquely match each set of lines that need to change.
     * When using multiple SEARCH/REPLACE blocks, list them in the order they appear in the file.
  3. Keep SEARCH/REPLACE blocks concise:
     * Break large SEARCH/REPLACE blocks into a series of smaller blocks that each change a small portion of the file.
     * Include just the changing lines, and a few surrounding lines if needed for uniqueness.
     * Do not include long runs of unchanging lines in SEARCH/REPLACE blocks.
     * Each line must be complete. Never truncate lines mid-way through as this can cause matching failures.
  4. Special operations:
     * To move code: Use two SEARCH/REPLACE blocks (one to delete from original + one to insert at new location)
     * To delete code: Use empty REPLACE section`,
			usage: "------- SEARCH\n[content]\n=======\n[new content]\n+++++++ REPLACE",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "replace_in_tex",
	description:
		"[IMPORTANT: Always output the absolutePath first] Edits an existing LaTeX (.tex) file using SEARCH/REPLACE blocks, automatically recompiles it to PDF, and updates the PDF viewer. The .tex file is automatically recompiled whenever it changes, and the PDF is updated in real-time. The .tex file itself is hidden from view - only the compiled PDF is shown.",
	parameters: [
		{
			name: "absolutePath",
			required: true,
			instruction:
				"The absolute path to the .tex file to edit. If the path doesn't end with .tex, it will be automatically appended.",
		},
		{
			name: "diff",
			required: true,
			instruction: `After providing the path, use this to provide one or more SEARCH/REPLACE blocks to edit the LaTeX file.`,
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const replace_in_tex_variants = [GENERIC, NATIVE_NEXT_GEN, NATIVE_GPT_5]
