import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const EDITING_FILES_TEMPLATE_TEXT = `EDITING FILES

You have access to tools for working with files: **write_tex**, **write_to_file**, **replace_in_tex**, and **replace_in_file**. Understanding their roles and selecting the right one for the job will help ensure efficient and accurate modifications to files.

**IMPORTANT: DEFAULT TOOL FOR NEW FILES**
- **DEFAULT: Use write_tex as the default tool for creating new files.**
- **MANDATORY: ALWAYS use write_tex for technical documentation writing.**
- **Use write_to_file for code files, configuration files, and other non-LaTeX files.**

# write_tex

## Purpose

- Create LaTeX (.tex) files that are automatically compiled to PDF and displayed in VS Code.

## When to Use

- **DEFAULT: Use write_tex as the default tool for creating new files.**
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

# write_to_file

## Purpose

- Create or overwrite files with complete content.
- Use for code files, configuration files, and other non-LaTeX files.

## When to Use

- **Use write_to_file** when:
  - Creating new code files (e.g., .js, .ts, .py, .java, .cpp, etc.)
  - Creating configuration files (e.g., .json, .yaml, .toml, .ini, etc.)
  - Creating plain text files or markdown files (when not using LaTeX)
  - When the file is not a LaTeX document (.tex file)
  - When you need to provide the complete file content

## Important Considerations

- write_to_file requires providing the file's complete final content.
- If you only need to make small changes to an existing file, consider using replace_in_file instead.
- The tool will automatically create any directories needed to write the file.

# replace_in_file

## Purpose

- Edit existing files using SEARCH/REPLACE blocks for targeted modifications.
- Use for code files, configuration files, and other non-LaTeX files.

## When to Use

- **Use replace_in_file** when:
  - Editing existing code files (e.g., .js, .ts, .py, .java, .cpp, etc.)
  - Editing configuration files (e.g., .json, .yaml, .toml, .ini, etc.)
  - Editing plain text files or markdown files (when not using LaTeX)
  - When the file is not a LaTeX document (.tex file)
  - When you need to make targeted changes to specific parts of a file
  - When you want to preserve most of the existing file content

## Important Considerations

- replace_in_file uses SEARCH/REPLACE blocks following this exact format:
  \`\`\`
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE
  \`\`\`
- You can include multiple SEARCH/REPLACE blocks in a single call.
- SEARCH blocks must match the exact content in the file, including whitespace.
- Always include complete lines in SEARCH blocks, not partial lines.
- List multiple SEARCH/REPLACE blocks in the order they appear in the file.

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

- **Use write_to_file** when:
  - Creating new code files, configuration files, or other non-LaTeX files
  - The file path does NOT end with .tex
  - Creating files that don't require LaTeX formatting

- **Use replace_in_file** when:
  - Editing existing code files, configuration files, or other non-LaTeX files
  - The file path does NOT end with .tex
  - Making targeted edits to non-LaTeX files

# Auto-formatting Considerations

- After using write_tex, replace_in_tex, write_to_file, or replace_in_file, the user's editor may automatically format the file
- This auto-formatting may modify the file contents, for example:
  - Breaking single lines into multiple lines
  - Adjusting indentation to match project style (e.g. 2 spaces vs 4 spaces vs tabs)
  - Converting single quotes to double quotes (or vice versa based on project preferences)
  - Organizing imports (e.g. sorting, grouping by type)
  - Adding/removing trailing commas in objects and arrays
  - Enforcing consistent brace style (e.g. same-line vs new-line)
  - Standardizing semicolon usage (adding or removing based on style)
- The tool responses will include the final state of the file after any auto-formatting
- Use this final state as your reference point for any subsequent edits. This is ESPECIALLY important when crafting SEARCH blocks for replace_in_tex and replace_in_file which require the content to match what's in the file exactly.

# Workflow Tips

1. **FIRST**: Check if you're working with a LaTeX file (.tex extension) or LaTeX content.
   - If LaTeX: Use write_tex for new files, replace_in_tex for edits
   - If not LaTeX: Use write_to_file for new files, replace_in_file for edits

2. **DEFAULT FOR NEW FILES**: Use write_tex as the default tool for creating new files (especially for documentation). Use write_to_file for code and configuration files.

3. Before editing, assess the scope of your changes and decide which tool to use.

4. For targeted edits, apply replace_in_tex (for .tex files) or replace_in_file (for other files) with carefully crafted SEARCH/REPLACE blocks. If you need multiple changes, you can stack multiple SEARCH/REPLACE blocks within a single tool call.

5. IMPORTANT: When you determine that you need to make several changes to the same file, prefer to use a single tool call with multiple SEARCH/REPLACE blocks. DO NOT prefer to make multiple successive tool calls for the same file. For example, if you were to add a component to a file, you would use a single replace_in_file call with a SEARCH/REPLACE block to add the import statement and another SEARCH/REPLACE block to add the component usage, rather than making one tool call for the import statement and then another separate tool call for the component usage.

6. For major overhauls or initial file creation:
   - Use write_tex for LaTeX documents and technical documentation
   - Use write_to_file for code files and configuration files

7. Once the file has been edited, the system will provide you with the final state of the modified file. Use this updated content as the reference point for any subsequent SEARCH/REPLACE operations, since it reflects any auto-formatting or user-applied changes.

By thoughtfully selecting between write_tex, write_to_file, replace_in_tex, and replace_in_file based on the file type and whether you're creating or editing files, you can make your file editing process smoother, safer, and more efficient.`

export async function getEditingFilesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = variant.componentOverrides?.[SystemPromptSection.EDITING_FILES]?.template || EDITING_FILES_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, context, {})
}
