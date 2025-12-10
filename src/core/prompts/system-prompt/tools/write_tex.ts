import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## write_tex
Description: Creates a LaTeX (.tex) file with the provided content, compiles it to PDF, and displays the PDF in VS Code. The .tex file is automatically compiled whenever it changes, and the PDF is updated in real-time. The .tex file itself is hidden from view - only the compiled PDF is shown.
Parameters:
- path: (required) The path of the .tex file to create (relative to the current working directory). If the path doesn't end with .tex, it will be automatically appended.
- content: (required) The LaTeX content to write to the file. ALWAYS provide the COMPLETE intended content of the file, including document class, packages, and all sections.
${focusChainSettings.enabled ? `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)` : "" }
Usage:
<write_tex>
<path>document.tex</path>
<content>
\documentclass{article}
\begin{document}
Your LaTeX content here
\end{document}
</content>
${focusChainSettings.enabled ? `<task_progress>
Checklist here (optional)
</task_progress>` : "" }
</write_tex>
 */

const id = ClineDefaultTool.WRITE_TEX

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "write_tex",
	description:
		"Creates a LaTeX (.tex) file with the provided content, compiles it to PDF, and displays the PDF in VS Code. The .tex file is automatically compiled whenever it changes, and the PDF is updated in real-time. The .tex file itself is hidden from view - only the compiled PDF is shown.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the .tex file to create (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}. If the path doesn't end with .tex, it will be automatically appended.`,
			usage: "document.tex",
		},
		{
			name: "content",
			required: true,
			instruction:
				"The LaTeX content to write to the file. ALWAYS provide the COMPLETE intended content of the file, including document class, packages, and all sections. This should be valid LaTeX code that can be compiled to PDF.",
			usage: "\\documentclass{article}\n\\begin{document}\nYour LaTeX content here\n\\end{document}",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "write_tex",
	description:
		"[IMPORTANT: Always output the absolutePath first] Creates a LaTeX (.tex) file with the provided content, compiles it to PDF, and displays the PDF in VS Code. The .tex file is automatically compiled whenever it changes, and the PDF is updated in real-time. The .tex file itself is hidden from view - only the compiled PDF is shown.",
	parameters: [
		{
			name: "absolutePath",
			required: true,
			instruction:
				"The absolute path to the .tex file to create. If the path doesn't end with .tex, it will be automatically appended.",
		},
		{
			name: "content",
			required: true,
			instruction:
				"After providing the path so a file can be created, then use this to provide the LaTeX content to write to the file. This should be valid LaTeX code that can be compiled to PDF.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const write_tex_variants = [GENERIC, NATIVE_NEXT_GEN, NATIVE_GPT_5]
