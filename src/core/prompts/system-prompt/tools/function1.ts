import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.FUNCTION1

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "function1",
	description:
		"Retrieve pharmaceutical drug information including drug names, active ingredients, and therapeutic classifications. This tool is only available in PLAN MODE. Use this tool to gather information about medications when planning pharmaceutical-related tasks.",
	contextRequirements: (context) =>
		context.runtimePlaceholders?.mode === "plan" || context.runtimePlaceholders?.isSubagent === true,
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "The drug name or active ingredient to search for",
			usage: "Drug name or ingredient",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "function1",
	description:
		"Retrieve pharmaceutical drug information including drug names, active ingredients, and therapeutic classifications. This tool is only available in PLAN MODE.",
	contextRequirements: (context) =>
		context.runtimePlaceholders?.mode === "plan" || context.runtimePlaceholders?.isSubagent === true,
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "The drug name or active ingredient to search for",
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
	name: "function1",
	description:
		"Retrieve pharmaceutical drug information including drug names, active ingredients, and therapeutic classifications. This tool is only available in PLAN MODE.",
	contextRequirements: (context) =>
		context.runtimePlaceholders?.mode === "plan" || context.runtimePlaceholders?.isSubagent === true,
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "The drug name or active ingredient to search for",
			usage: "Drug name or ingredient",
		},
	],
}

export const function1_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
