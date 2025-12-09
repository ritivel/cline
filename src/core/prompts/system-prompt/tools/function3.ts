import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.FUNCTION3

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "function3",
	description:
		"Access clinical trial data including trial phases, endpoints, patient populations, and study outcomes. This tool is only available in PLAN MODE. Use this tool to gather clinical evidence when planning pharmaceutical research or development tasks.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "query",
			required: true,
			instruction:
				"The query for clinical trial identifier (e.g., NCT number or drug name or other relevant information) to retrieve information for",
			usage: "Query",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "function3",
	description:
		"Access clinical trial data including trial phases, endpoints, patient populations, and study outcomes. This tool is only available in PLAN MODE.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "query",
			required: true,
			instruction:
				"The query for clinical trial identifier (e.g., NCT number or drug name or other relevant information) to retrieve information for",
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id,
	name: "function3",
	description:
		"Access clinical trial data including trial phases, endpoints, patient populations, and study outcomes. This tool is only available in PLAN MODE.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "query",
			required: true,
			instruction:
				"The query for clinical trial identifier (e.g., NCT number or drug name or other relevant information) to retrieve information for",
			usage: "Query",
		},
	],
}

export const function3_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
