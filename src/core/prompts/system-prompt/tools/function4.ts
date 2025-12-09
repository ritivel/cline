import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.FUNCTION4

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "function4",
	description:
		"Retrieve pharmaceutical manufacturing and quality control information including batch records, quality specifications, and manufacturing processes. This tool is only available in PLAN MODE. Use this tool to understand manufacturing requirements when planning pharmaceutical production tasks.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "product_code",
			required: true,
			instruction: "The product code or SKU or name of the product to retrieve manufacturing information for",
			usage: "Product code or SKU or name of the product",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "function4",
	description:
		"Retrieve pharmaceutical manufacturing and quality control information including batch records, quality specifications, and manufacturing processes. This tool is only available in PLAN MODE.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "product_code",
			required: true,
			instruction: "The product code or SKU or name of the product to retrieve manufacturing information for",
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
	name: "function4",
	description:
		"Retrieve pharmaceutical manufacturing and quality control information including batch records, quality specifications, and manufacturing processes. This tool is only available in PLAN MODE.",
	contextRequirements: (context) => context.runtimePlaceholders?.mode === "plan",
	parameters: [
		{
			name: "product_code",
			required: true,
			instruction: "The product code or SKU or name of the product to retrieve manufacturing information for",
			usage: "Product code or SKU",
		},
	],
}

export const function4_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
