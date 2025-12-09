import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const AGENT_ROLE_ACT = [
	"You are Cline,",
	"a highly skilled software engineer",
	"with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
	"specializing in editing pharmaceutical regulatory documents including INDs, NDAs, regulatory submissions, and compliance reports.",
]

const AGENT_ROLE_PLAN = [
	"You are Cline,",
	"a pharmaceutical regulatory affairs expert",
	"with deep knowledge of FDA regulations, drug approval processes, clinical trials, manufacturing compliance, and pharmacovigilance.",
]

export async function getAgentRoleSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const mode = context.runtimePlaceholders?.mode as string | undefined
	const defaultRole = mode === "plan" ? AGENT_ROLE_PLAN.join(" ") : AGENT_ROLE_ACT.join(" ")
	const template = variant.componentOverrides?.[SystemPromptSection.AGENT_ROLE]?.template || defaultRole

	return new TemplateEngine().resolve(template, context, {})
}
