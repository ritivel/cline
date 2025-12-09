import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * ## plan_mode_respond
Description: Respond to the user's pharmaceutical regulatory inquiry. This tool should ONLY be used when you have already gathered the necessary information using the specialized pharmaceutical tools (function1-function5) or read_file to read regulatory documents. DO NOT use this tool to announce what tools you're going to use - just use them first. This tool is only available in PLAN MODE. The environment_details will specify the current mode; if it is not PLAN_MODE then you should not use this tool.
However, if while writing your response you realize you actually need to gather more information before providing a complete answer, you can add the optional needs_more_exploration parameter to indicate this. This allows you to acknowledge that you should have gathered more information first, and signals that your next message will use pharmaceutical tools or read_file instead.
Parameters:
- response: (required) The response to provide to the user. Do not try to use tools in this parameter, this is simply a chat response. (You MUST use the response parameter, do not simply place the response text directly within <plan_mode_respond> tags.)
- needs_more_exploration: (optional) Set to true if while formulating your response that you found you need to do more exploration with tools, for example reading files. (Remember, you can explore the project with tools like read_file in PLAN MODE without the user having to toggle to ACT MODE.) Defaults to false if not specified.
${focusChainSettings.enabled ? `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)` : "" }
Usage:
<plan_mode_respond>
<response>Your response here</response>
<needs_more_exploration>true or false (optional, but you MUST set to true if in <response> you need to read files or use other exploration tools)</needs_more_exploration>
${focusChainSettings.enabled ? `<task_progress>
Checklist here (If you have presented the user with concrete steps or requirements, you can optionally include a todo list outlining these steps.)
</task_progress>` : "" }
</plan_mode_respond>
 */

const id = ClineDefaultTool.PLAN_MODE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "plan_mode_respond",
	description: `Respond to the user's pharmaceutical regulatory inquiry. This tool should ONLY be used when you have already gathered the necessary information using the specialized pharmaceutical tools (function1-function5) or read_file to read regulatory documents. DO NOT use this tool to announce what tools you're going to use - just use them first. This tool is only available in PLAN MODE. The environment_details will specify the current mode; if it is not PLAN_MODE then you should not use this tool.
However, if while writing your response you realize you actually need to gather more information before providing a complete answer, you can add the optional needs_more_exploration parameter to indicate this. This allows you to acknowledge that you should have gathered more information first, and signals that your next message will use pharmaceutical tools or read_file instead.`,
	parameters: [
		{
			name: "response",
			required: true,
			instruction: `The response to provide to the user. Do not try to use tools in this parameter, this is simply a chat response. (You MUST use the response parameter, do not simply place the response text directly within <plan_mode_respond> tags.)`,
			usage: "Your response here",
		},
		{
			name: "needs_more_exploration",
			required: false,
			instruction:
				"Set to true if while formulating your response that you found you need to gather more information with tools, for example using function1-function5 tools or reading regulatory documents with read_file. (Remember, you can gather information with pharmaceutical tools or read_file in PLAN MODE without the user having to toggle to ACT MODE.) Defaults to false if not specified.",
			usage: "true or false (optional, but you MUST set to true if in <response> you need to use pharmaceutical tools or read files)",
			type: "boolean",
		},
		// Different than the vanilla TASK_PROGRESS_PARAMETER
		{
			name: "task_progress",
			required: false,
			instruction:
				" A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)",
			usage: "Checklist here (If you have presented the user with concrete steps or requirements, you can optionally include a todo list outlining these steps.)",
			dependencies: [ClineDefaultTool.TODO],
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "plan_mode_respond",
	description: `Respond to the user's pharmaceutical regulatory inquiry. This tool should ONLY be used when you have already gathered the necessary information using the specialized pharmaceutical tools (function1-function5) or read_file to read regulatory documents. DO NOT use this tool to announce what tools you're going to use - just use them first. This tool is only available in PLAN MODE. The environment_details will specify the current mode; if it is not PLAN_MODE then you should not use this tool.
However, if while writing your response you realize you actually need to gather more information before providing a complete answer, you can add the optional needs_more_exploration parameter to indicate this. This allows you to acknowledge that you should have gathered more information first, and signals that your next message will use pharmaceutical tools or read_file instead.`,
	parameters: [
		{
			name: "response",
			required: true,
			instruction: `The response to provide to the user.`,
		},
		{
			name: "task_progress",
			required: false,
			instruction: "A checklist showing task progress with the latest status of each subtasks included previously if any.",
		},
	],
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id,
	name: "plan_mode_respond",
	description: `Respond to the user's pharmaceutical regulatory inquiry. This tool should ONLY be used when you have already gathered the necessary information using the specialized pharmaceutical tools (function1-function5) or read_file to read regulatory documents. Only use this tool after you have gathered sufficient information to provide a detailed, accurate answer about the drug or regulatory question. This tool is only available in PLAN MODE, as indicated by the environment_details.
If it becomes apparent that additional information gathering is required while the plan_mode_respond response is being generated, the optional needs_more_exploration parameter can be toggled to enable further research. This allows you to acknowledge that more information gathering is required before the final plan_mode_respond is generated, and signals that your next message will use pharmaceutical tools or read_file instead.`,
	parameters: [
		{
			name: "response",
			required: true,
			instruction: `A chat message response to the user.`,
			usage: "Your response here",
		},
		{
			name: "needs_more_exploration",
			required: false,
			instruction: `needs_more_exploration can be set to true if it is determined that further information gathering with pharmaceutical tools (function1-function5) or read_file is necessary to formulate a complete answer. This determination can be reached during the response generation process, but should not be acknowledged until this parameter is set to true if required.`,
			usage: "true or false (optional, but you MUST set to true if in <response> you need to use pharmaceutical tools or read files)",
			type: "boolean",
		},
		{
			name: "task_progress",
			required: false,
			instruction:
				"A checklist showing task progress after this tool use is completed. If you are providing a comprehensive answer about a drug or regulatory question with needs_more_exploration set to false, you can optionally include a checklist if the user's query involves multiple aspects that need to be addressed. (See 'Updating Task Progress' section for more details)",
			usage: "Checklist here (If you have provided information about multiple aspects of a drug or regulatory question, you can optionally include a todo list outlining these aspects.)",
			dependencies: [ClineDefaultTool.TODO],
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const plan_mode_respond_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
