import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.FUNCTION5

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "function5",
	description:
		"Query pharmaceutical safety and pharmacovigilance data including adverse event reports, safety profiles, and risk assessments. This tool is only available in PLAN MODE. Use this tool to gather safety information when planning pharmaceutical safety assessments or risk analysis tasks.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "drug_name",
			required: true,
			instruction: "The drug name or active ingredient to query safety information for",
			usage: "Drug name or ingredient",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "function5",
	description:
		"Query pharmaceutical safety and pharmacovigilance data including adverse event reports, safety profiles, and risk assessments. This tool is only available in PLAN MODE.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "drug_name",
			required: true,
			instruction: "The drug name or active ingredient to query safety information for",
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
	name: "function5",
	description:
		"Query pharmaceutical safety and pharmacovigilance data including adverse event reports, safety profiles, and risk assessments. This tool is only available in PLAN MODE.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "drug_name",
			required: true,
			instruction: "The drug name or active ingredient to query safety information for",
			usage: "Drug name or ingredient",
		},
	],
}

export const function5_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
