import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import * as path from "path"
import { assessSection53Papers as assessPapers } from "@/core/services/section53"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

interface AssessSection53Request {
	drugName: string
	productPath: string
}

/**
 * Assesses Section 5.3 papers for a drug
 * Searches PubMed and returns papers grouped by subsection
 */
export async function assessSection53Papers(controller: Controller, request: StringRequest): Promise<ProtoString> {
	try {
		const { drugName } = JSON.parse(request.value || "{}") as AssessSection53Request

		if (!drugName) {
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "Drug name is required",
				}),
			})
		}

		// Get OpenAI API key from secrets
		const openAiApiKey = controller.stateManager.getSecretKey("openAiNativeApiKey")

		if (!openAiApiKey) {
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "OpenAI API key is required. Please configure it in Cline settings (OpenAI Native provider).",
				}),
			})
		}

		// Get extension path for bundled resources
		const extensionPath = HostProvider.get().extensionFsPath

		// Save to global storage instead of submissions folder (hides from sidebar)
		const globalStoragePath = path.join(HostProvider.get().globalStorageFsPath, "section53-papers")

		console.log(`[assessSection53Papers] Starting assessment for ${drugName}`)

		// Run the paper assessment - save to global storage, not submissions folder
		const result = await assessPapers(drugName, extensionPath, openAiApiKey, globalStoragePath)

		console.log(
			`[assessSection53Papers] Assessment complete: ${result.success ? `${result.result?.summary.totalUniquePapers} papers found` : result.error}`,
		)

		return ProtoString.create({
			value: JSON.stringify(result),
		})
	} catch (error) {
		console.error("[assessSection53Papers] Error:", error)
		return ProtoString.create({
			value: JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}),
		})
	}
}
