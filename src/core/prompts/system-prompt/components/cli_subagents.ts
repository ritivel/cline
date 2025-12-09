import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const getCliSubagentsTemplateText = (_context: SystemPromptContext) => `USING THE CLINE CLI TOOL

The Cline CLI tool can be used to assign Cline AI agents with focused tasks. This can be used to keep you focused by delegating information-gathering and exploration to separate Cline instances. Use the Cline CLI tool to research large regulatory document collections, explore document structures, gather information from multiple regulatory documents, analyze document relationships, or summarize regulatory document sections when the complete context may be too large or overwhelming.

## Creating Cline AI agents

Cline AI agents may be referred to as agents, subagents, or subtasks. Requests may not specifically invoke agents, but you may invoke them directly if warranted. Unless you are specifically asked to use this tool, only create agents when it seems likely you may be exploring across 10 or more files. If users specifically ask that you use this tool, you then must use this tool. Do not use subagents for editing regulatory documents or executing commands- they should only be used for reading and research to help you better answer questions or build useful context for future regulatory document editing tasks. If you are performing a search via search_files or the terminal (grep etc.), and the results are long and overwhleming, it is reccomended that you switch to use Cline CLI agents to perform this task. You may perform regulatory document edits directly using the write_to_file and replace_in_file tools, and commands using the execute_command tool.

## Command Syntax

You must use the following command syntax for creating Cline AI agents:

\`\`\`bash
cline "your prompt here"
\`\`\`

## Examples of how you might use this tool

\`\`\`bash
# Find specific patterns
cline "find all IND documents and list their submission dates"

# Analyze regulatory document structure
cline "analyze the clinical trial data sections across all NDA submissions. Trace through all relevant sections and provide a summary of how they are structured. Include document/file references in your summary."

# Gather targeted information
cline "list all regulatory compliance requirements mentioned across the document collection"

# Summarize directories
cline "summarize the purpose of all regulatory documents in the submissions/IND directory"

# Research regulatory information
cline "find how manufacturing compliance information is documented across all regulatory submissions"
\`\`\`

## Tips
- Request brief, technically dense summaries over full document dumps.
- Be specific with your instructions to get focused results.
- Request summaries rather than full document contents. Encourage the agent to be brief, but specific and technically dense with their response.
- If regulatory documents you want to read are large or complicated, use Cline CLI agents for exploration before instead of reading these documents.`

export async function getCliSubagentsSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	// If this is a CLI subagent, don't include CLI subagent instructions to prevent nesting/allignment concerns
	if (context.isCliSubagent) {
		return undefined
	}

	// Only include this section if CLI is installed and subagents are enabled
	if (!context.isSubagentsEnabledAndCliInstalled) {
		return undefined
	}

	const template = variant.componentOverrides?.[SystemPromptSection.CLI_SUBAGENTS]?.template || getCliSubagentsTemplateText

	return new TemplateEngine().resolve(template, context, {})
}
