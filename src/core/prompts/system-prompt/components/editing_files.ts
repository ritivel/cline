import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const EDITING_FILES_TEMPLATE_TEXT = `EDITING FILES

You have access to tools for working with pharmaceutical regulatory documents: **write_to_file**, **replace_in_file**, **write_tex**, and **replace_in_tex**. Understanding their roles and selecting the right one for the job will help ensure efficient and accurate modifications to regulatory documents such as INDs (Investigational New Drug applications), NDAs (New Drug Applications), regulatory submissions, compliance reports, and other regulatory documentation.

# write_tex

## Purpose

- Create LaTeX (.tex) files that are automatically compiled to PDF and displayed in VS Code.

## When to Use

- **ALWAYS use write_tex** when creating new LaTeX documents (.tex files).
- When the user requests a scientific document, research paper, academic paper, or any LaTeX-based document.
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
- Use SEARCH/REPLACE blocks just like replace_in_file, but for .tex files.

# write_to_file

## Purpose

- Create a new file, or overwrite the entire contents of an existing file.

## When to Use

- Initial regulatory document creation, such as when creating new IND or NDA submissions.
- Overwriting large regulatory document sections where you want to replace the entire content at once.
- When the complexity or number of changes would make replace_in_file unwieldy or error-prone.
- When you need to completely restructure a regulatory document's content or change its fundamental organization.

## Important Considerations

- Using write_to_file requires providing the file's complete final content.
- If you only need to make small changes to an existing file, consider using replace_in_file instead to avoid unnecessarily rewriting the entire file.
- While write_to_file should not be your default choice, don't hesitate to use it when the situation truly calls for it.

# replace_in_file

## Purpose

- Make targeted edits to specific parts of an existing file without overwriting the entire file.

## When to Use

- Small, localized changes like updating specific sections of regulatory documents, modifying compliance information, changing regulatory references, updating clinical trial data sections, etc.
- Targeted improvements where only specific portions of the regulatory document's content needs to be altered.
- Especially useful for long regulatory documents where much of the document will remain unchanged.

## Advantages

- More efficient for minor edits, since you don't need to supply the entire file content.
- Reduces the chance of errors that can occur when overwriting large files.

# Choosing the Appropriate Tool

## CRITICAL: Detecting LaTeX Files

**IMPORTANT**: When determining which tool to use, you MUST check if you're working with LaTeX files. Use the LaTeX-specific tools in the following cases:

1. **File path ends with .tex** - Always use write_tex or replace_in_tex (NEVER use write_to_file or replace_in_file for .tex files)
2. **User mentions or provides content from a PDF file** - PDFs are typically generated from LaTeX documents. When the user mentions a PDF or provides PDF content:
   - Look for a corresponding .tex file with the same name (e.g., document.pdf becomes document.tex)
   - Use write_tex if the .tex file doesn't exist yet
   - Use replace_in_tex if the .tex file already exists
   - **NEVER use write_to_file or replace_in_file when working with PDFs or their source LaTeX files**
3. **User requests scientific/academic documents** - These are typically LaTeX, use write_tex or replace_in_tex
4. **Content contains LaTeX commands** (e.g., \\documentclass, \\section, \\begin{document}, \\end{document}, \\usepackage, etc.) - Use write_tex or replace_in_tex
5. **User mentions "LaTeX", "TeX", "scientific document", "research paper", "academic paper"** - Use write_tex or replace_in_tex
6. **File context shows LaTeX syntax** - If you see LaTeX commands in file mentions or user content, use the LaTeX-specific tools

## Tool Selection Rules

- **Use write_tex** when:
  - Creating new LaTeX documents (.tex files)
  - The file path ends with .tex and the file doesn't exist yet
  - User requests a scientific document, research paper, academic paper, or any LaTeX-based document
  - User provides LaTeX content and wants to create a new document

- **Use replace_in_tex** when:
  - Editing existing LaTeX documents (.tex files)
  - The file path ends with .tex and the file already exists
  - User mentions a PDF file that was generated from a .tex file (use the corresponding .tex file path)
  - User wants to modify LaTeX content in an existing document
  - **NEVER use replace_in_file for .tex files - always use replace_in_tex instead**

- **Default to replace_in_file** for most other regulatory document changes (that are NOT LaTeX files). It's the safer, more precise option that minimizes potential issues and maintains document integrity.

- **Use write_to_file** when:
  - Creating new regulatory documents (that are NOT LaTeX files)
  - The changes are so extensive that using replace_in_file would be more complex or risky
  - You need to completely reorganize or restructure a regulatory document
  - The document is relatively small and the changes affect most of its content
  - You're generating regulatory document templates or boilerplate sections

# Auto-formatting Considerations

- After using either write_to_file or replace_in_file, the user's editor may automatically format the file
- This auto-formatting may modify the file contents, for example:
  - Breaking single lines into multiple lines
  - Adjusting indentation to match project style (e.g. 2 spaces vs 4 spaces vs tabs)
  - Converting single quotes to double quotes (or vice versa based on project preferences)
  - Organizing imports (e.g. sorting, grouping by type)
  - Adding/removing trailing commas in objects and arrays
  - Enforcing consistent brace style (e.g. same-line vs new-line)
  - Standardizing semicolon usage (adding or removing based on style)
- The write_to_file and replace_in_file tool responses will include the final state of the file after any auto-formatting
- Use this final state as your reference point for any subsequent edits. This is ESPECIALLY important when crafting SEARCH blocks for replace_in_file which require the content to match what's in the file exactly.

# Workflow Tips

1. **FIRST**: Check if you're working with a LaTeX file (.tex extension) or LaTeX content. If yes, use write_tex or replace_in_tex - NEVER use write_to_file or replace_in_file for LaTeX files.
2. Before editing, assess the scope of your changes and decide which tool to use.
3. For targeted edits to non-LaTeX files, apply replace_in_file with carefully crafted SEARCH/REPLACE blocks. If you need multiple changes, you can stack multiple SEARCH/REPLACE blocks within a single replace_in_file call.
4. For targeted edits to LaTeX files, apply replace_in_tex with carefully crafted SEARCH/REPLACE blocks. If you need multiple changes, you can stack multiple SEARCH/REPLACE blocks within a single replace_in_tex call.
5. IMPORTANT: When you determine that you need to make several changes to the same file, prefer to use a single tool call with multiple SEARCH/REPLACE blocks. DO NOT prefer to make multiple successive tool calls for the same file. For example, if you were to add a component to a file, you would use a single replace_in_file (or replace_in_tex for LaTeX) call with a SEARCH/REPLACE block to add the import statement and another SEARCH/REPLACE block to add the component usage, rather than making one tool call for the import statement and then another separate tool call for the component usage.
6. For major overhauls or initial file creation of non-LaTeX files, rely on write_to_file.
7. For major overhauls or initial file creation of LaTeX files, rely on write_tex.
8. Once the file has been edited, the system will provide you with the final state of the modified file. Use this updated content as the reference point for any subsequent SEARCH/REPLACE operations, since it reflects any auto-formatting or user-applied changes.
By thoughtfully selecting between the appropriate tools based on file type, you can make your file editing process smoother, safer, and more efficient.`

export async function getEditingFilesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = variant.componentOverrides?.[SystemPromptSection.EDITING_FILES]?.template || EDITING_FILES_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, context, {})
}
