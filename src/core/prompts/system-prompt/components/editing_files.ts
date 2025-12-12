import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const EDITING_FILES_TEMPLATE_TEXT = `EDITING FILES

**IMPORTANT: DEFAULT TOOL FOR NEW FILES**
- **DEFAULT: Use write_tex as the default tool for creating new files.**
- **MANDATORY: ALWAYS use write_tex for technical documentation writing.**
- **NOTE: write_to_file and replace_in_file are currently disabled. Use write_tex and replace_in_tex instead.**

You have access to tools for working with pharmaceutical regulatory documents: **write_tex** and **replace_in_tex**. Understanding their roles and selecting the right one for the job will help ensure efficient and accurate modifications to regulatory documents such as INDs (Investigational New Drug applications), NDAs (New Drug Applications), regulatory submissions, compliance reports, and other regulatory documentation.

**TEMPORARILY DISABLED TOOLS:**
- **write_to_file** - Currently disabled. Use write_tex instead for creating new files.
- **replace_in_file** - Currently disabled. Use replace_in_tex instead for editing existing files.

# write_tex

## Purpose

- Create LaTeX (.tex) files that are automatically compiled to PDF and displayed in VS Code.

## When to Use

- **DEFAULT: Use write_tex as the default tool for creating new files.** This is the only available tool for creating new files (write_to_file is currently disabled).
- **MANDATORY: ALWAYS use write_tex for technical documentation writing** (API documentation, user guides, technical specifications, architecture documents, etc.).
- **ALWAYS use write_tex** when creating new LaTeX documents (.tex files).
- When the user requests a scientific document, research paper, academic paper, or any LaTeX-based document.
- When creating any new document that could benefit from LaTeX formatting and PDF output.
- The tool automatically compiles the LaTeX to PDF, displays the PDF in VS Code, and hides the .tex file from view.
- The PDF automatically updates whenever the .tex file is modified.

## Important Considerations

- write_tex handles the entire LaTeX workflow: file creation, PDF compilation, and PDF display.
- The .tex file is automatically compiled using LaTeX Workshop whenever it changes.
- Only the compiled PDF is shown to the user - the .tex file remains hidden but is kept up-to-date.

# replace_in_tex

## Purpose

- Edit existing LaTeX (.tex) files using SEARCH/REPLACE blocks, automatically recompile to PDF, and update the PDF viewer.

## When to Use

- **ALWAYS use replace_in_tex** when editing existing LaTeX documents (.tex files).
- When you need to make targeted changes to specific parts of a LaTeX document.
- The tool automatically recompiles the LaTeX to PDF after each edit and updates the PDF viewer.
- The .tex file remains hidden - only the compiled PDF is shown.

## Important Considerations

- replace_in_tex handles the entire LaTeX workflow: file editing, PDF recompilation, and PDF display updates.
- The .tex file is automatically recompiled using LaTeX Workshop whenever it changes.
- Only the compiled PDF is shown to the user - the .tex file remains hidden but is kept up-to-date.
- Use SEARCH/REPLACE blocks just like you would with file editing tools, but for .tex files.

# write_to_file (TEMPORARILY DISABLED)

**This tool is currently disabled. Use write_tex instead for creating new files.**

# replace_in_file (TEMPORARILY DISABLED)

**This tool is currently disabled. Use replace_in_tex instead for editing existing files.**

# Choosing the Appropriate Tool

## CRITICAL: Detecting LaTeX Files

**IMPORTANT**: When determining which tool to use, you MUST check if you're working with LaTeX files. Use the LaTeX-specific tools in the following cases:

1. **File path ends with .tex** - Always use write_tex or replace_in_tex
2. **User mentions or provides content from a PDF file** - PDFs are typically generated from LaTeX documents. When the user mentions a PDF or provides PDF content:
   - Look for a corresponding .tex file with the same name (e.g., document.pdf becomes document.tex)
   - Use write_tex if the .tex file doesn't exist yet
   - Use replace_in_tex if the .tex file already exists
3. **User requests technical documentation** - ALWAYS use write_tex for technical documentation (API docs, user guides, technical specs, architecture docs, etc.)
4. **User requests scientific/academic documents** - These are typically LaTeX, use write_tex or replace_in_tex
5. **Content contains LaTeX commands** (e.g., \\documentclass, \\section, \\begin{document}, \\end{document}, \\usepackage, etc.) - Use write_tex or replace_in_tex
6. **User mentions "LaTeX", "TeX", "scientific document", "research paper", "academic paper", "technical documentation", "documentation"** - Use write_tex or replace_in_tex
7. **File context shows LaTeX syntax** - If you see LaTeX commands in file mentions or user content, use the LaTeX-specific tools

## Tool Selection Rules

- **DEFAULT: Use write_tex** when:
  - **Creating any new file** (this is the default preference)
  - **Creating technical documentation** (API documentation, user guides, technical specifications, architecture documents, etc.) - MANDATORY
  - Creating new LaTeX documents (.tex files)
  - The file path ends with .tex and the file doesn't exist yet
  - User requests a scientific document, research paper, academic paper, or any LaTeX-based document
  - User provides LaTeX content and wants to create a new document
  - Creating new regulatory documents, reports, or any document that would benefit from LaTeX formatting

- **Use replace_in_tex** when:
  - Editing existing LaTeX documents (.tex files)
  - The file path ends with .tex and the file already exists
  - User mentions a PDF file that was generated from a .tex file (use the corresponding .tex file path)
  - User wants to modify LaTeX content in an existing document
  - Editing any existing files (since replace_in_file is disabled, use replace_in_tex for all file edits)

**NOTE: Since write_to_file and replace_in_file are disabled, you must use write_tex and replace_in_tex for all file operations.**

# Auto-formatting Considerations

- After using write_tex or replace_in_tex, the user's editor may automatically format the file
- This auto-formatting may modify the file contents, for example:
  - Breaking single lines into multiple lines
  - Adjusting indentation to match project style (e.g. 2 spaces vs 4 spaces vs tabs)
  - Converting single quotes to double quotes (or vice versa based on project preferences)
  - Organizing imports (e.g. sorting, grouping by type)
  - Adding/removing trailing commas in objects and arrays
  - Enforcing consistent brace style (e.g. same-line vs new-line)
  - Standardizing semicolon usage (adding or removing based on style)
- The tool responses will include the final state of the file after any auto-formatting
- Use this final state as your reference point for any subsequent edits. This is ESPECIALLY important when crafting SEARCH blocks for replace_in_tex which require the content to match what's in the file exactly.

# Workflow Tips

1. **DEFAULT FOR NEW FILES: Use write_tex as the default tool for creating new files.** This is the only available tool for creating files (write_to_file is disabled).
2. **FIRST**: Check if you're working with a LaTeX file (.tex extension) or LaTeX content. Use write_tex or replace_in_tex for all file operations.
3. Before editing, assess the scope of your changes and decide which tool to use.
4. For targeted edits to any files, apply replace_in_tex with carefully crafted SEARCH/REPLACE blocks. If you need multiple changes, you can stack multiple SEARCH/REPLACE blocks within a single replace_in_tex call.
5. IMPORTANT: When you determine that you need to make several changes to the same file, prefer to use a single tool call with multiple SEARCH/REPLACE blocks. DO NOT prefer to make multiple successive tool calls for the same file. For example, if you were to add a component to a file, you would use a single replace_in_tex call with a SEARCH/REPLACE block to add the import statement and another SEARCH/REPLACE block to add the component usage, rather than making one tool call for the import statement and then another separate tool call for the component usage.
6. For major overhauls or initial file creation, use write_tex.
7. Once the file has been edited, the system will provide you with the final state of the modified file. Use this updated content as the reference point for any subsequent SEARCH/REPLACE operations, since it reflects any auto-formatting or user-applied changes.

**IMPORTANT: write_to_file and replace_in_file are currently disabled. You must use write_tex and replace_in_tex for all file operations.**
By thoughtfully selecting between write_tex and replace_in_tex based on whether you're creating or editing files, you can make your file editing process smoother, safer, and more efficient.`

export async function getEditingFilesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = variant.componentOverrides?.[SystemPromptSection.EDITING_FILES]?.template || EDITING_FILES_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, context, {})
}
