import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.FUNCTION2

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "function2",
	description:
		"Query regulatory compliance information for pharmaceutical products including FDA approval status, regulatory pathways, and compliance requirements. This tool is only available in PLAN MODE. Use this tool to understand regulatory constraints when planning pharmaceutical projects.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "drug_name",
			required: true,
			instruction: "The drug name to query",
			usage: "Drug name",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "function2",
	description:
		"Query regulatory compliance information for pharmaceutical products including FDA approval status, regulatory pathways, and compliance requirements. This tool is only available in PLAN MODE.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "drug_name",
			required: true,
			instruction: "The drug name to query",
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
	name: "function2",
	description:
		"Query regulatory compliance information for pharmaceutical products including FDA approval status, regulatory pathways, and compliance requirements. This tool is only available in PLAN MODE.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "drug_name",
			required: true,
			instruction: "The drug name to query",
			usage: "Drug name",
		},
	],
}

export const function2_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
