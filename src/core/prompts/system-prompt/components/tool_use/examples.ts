import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

const FOCUS_CHAIN_EXAMPLE_BASH = `<task_progress>
- [x] Review existing regulatory document structure
- [x] Gather required regulatory information
- [ ] Process document formatting
- [ ] Verify regulatory compliance
</task_progress>
`

const FOCUS_CHAIN_EXAMPLE_NEW_FILE = `<task_progress>
- [x] Review existing regulatory document structure
- [x] Gather required regulatory information
- [ ] Create new regulatory document section
- [ ] Verify regulatory compliance
</task_progress>
`

const FOCUS_CHAIN_EXAMPLE_EDIT = `<task_progress>
- [x] Review existing regulatory document structure
- [x] Gather required regulatory information
- [ ] Update regulatory document sections
- [ ] Verify regulatory compliance
</task_progress>
`

const TOOL_USE_EXAMPLES_TEMPLATE_TEXT = `# Tool Use Examples

## Example 1: Requesting to execute a command

<execute_command>
<command>validate-regulatory-format IND_submission.md</command>
<requires_approval>false</requires_approval>
{{FOCUS_CHAIN_EXAMPLE_BASH}}</execute_command>

## Example 2: Requesting to create a new file

<write_to_file>
<path>IND_submission_template.md</path>
<content>
# IND Submission Document

## Drug Information
- Drug Name: [Name]
- Active Ingredient: [Ingredient]
- Therapeutic Classification: [Classification]

## Clinical Trial Information
- Phase: [Phase]
- Endpoints: [Endpoints]
- Patient Population: [Population]

## Manufacturing Information
- Manufacturing Site: [Site]
- Quality Control: [QC Details]

## Safety Information
- Adverse Events: [Events]
- Risk Assessment: [Assessment]
</content>
{{FOCUS_CHAIN_EXAMPLE_NEW_FILE}}</write_to_file>

## Example 3: Creating a new task

<new_task>
<context>
1. Current Work:
   [Detailed description]

2. Key Regulatory Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Relevant Regulatory Documents:
   - [Document Name 1]
      - [Summary of why this document is important]
      - [Summary of the changes made to this document, if any]
      - [Important Regulatory Information]
   - [Document Name 2]
      - [Important Regulatory Information]
   - [...]

4. Problem Solving:
   [Detailed description]

5. Pending Tasks and Next Steps:
   - [Task 1 details & next steps]
   - [Task 2 details & next steps]
   - [...]
</context>
</new_task>

## Example 4: Requesting to make targeted edits to a file

<replace_in_file>
<path>IND_submission.md</path>
<diff>
------- SEARCH
## Clinical Trial Information
- Phase: Phase I
- Endpoints: Safety and tolerability
=======
## Clinical Trial Information
- Phase: Phase I
- Endpoints: Safety and tolerability
- Patient Population: Adults aged 18-65
+++++++ REPLACE

------- SEARCH
## Manufacturing Information
- Manufacturing Site: Site A
=======
+++++++ REPLACE

------- SEARCH
## Safety Information
- Adverse Events: None reported
=======
## Manufacturing Information
- Manufacturing Site: Site A
- Quality Control: GMP compliant

## Safety Information
- Adverse Events: None reported
+++++++ REPLACE
</diff>
{{FOCUS_CHAIN_EXAMPLE_EDIT}}</replace_in_file>


## Example 5: Requesting to use an MCP tool

<use_mcp_tool>
<server_name>weather-server</server_name>
<tool_name>get_forecast</tool_name>
<arguments>
{
  "city": "San Francisco",
  "days": 5
}
</arguments>
</use_mcp_tool>

## Example 6: Another example of using an MCP tool (where the server name is a unique identifier such as a URL)

<use_mcp_tool>
<server_name>github.com/modelcontextprotocol/servers/tree/main/src/github</server_name>
<tool_name>create_issue</tool_name>
<arguments>
{
  "owner": "octocat2",
  "repo": "hello-world",
  "title": "Found a bug",
  "body": "I'm having a problem with this.",
  "labels": ["bug", "help wanted"],
  "assignees": ["octocat"]
}
</arguments>
</use_mcp_tool>`

export async function getToolUseExamplesSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	// Return the placeholder that will be replaced with actual tools
	const focusChainEnabled = context.focusChainSettings?.enabled

	return new TemplateEngine().resolve(TOOL_USE_EXAMPLES_TEMPLATE_TEXT, context, {
		FOCUS_CHAIN_EXAMPLE_BASH: focusChainEnabled ? FOCUS_CHAIN_EXAMPLE_BASH : "",
		FOCUS_CHAIN_EXAMPLE_NEW_FILE: focusChainEnabled ? FOCUS_CHAIN_EXAMPLE_NEW_FILE : "",
		FOCUS_CHAIN_EXAMPLE_EDIT: focusChainEnabled ? FOCUS_CHAIN_EXAMPLE_EDIT : "",
	})
}
