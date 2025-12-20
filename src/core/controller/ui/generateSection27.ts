import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import * as path from "path"
import {
	checkSection53PapersExist,
	generateSection27 as generateSection27Service,
	getSection53PapersPath,
} from "@/core/services/section27"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

interface GenerateSection27Request {
	drugName: string
	productPath: string
	companyName?: string
}

/**
 * Generates Section 2.7 (Clinical Summary) LaTeX document
 * Requires Section 5.3 to be assessed first
 */
export async function generateSection27(controller: Controller, request: StringRequest): Promise<ProtoString> {
	try {
		const { drugName, productPath, companyName } = JSON.parse(request.value || "{}") as GenerateSection27Request

		if (!drugName || !productPath) {
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "Missing required parameters (drugName or productPath)",
				}),
			})
		}

		// Get OpenAI API key from secrets
		const openAiApiKey = controller.stateManager.getSecretKey("openAiNativeApiKey")

		if (!openAiApiKey) {
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "OpenAI API key is required. Please configure it in Ritivel settings (OpenAI Native provider).",
				}),
			})
		}

		// Get paths
		const extensionPath = HostProvider.get().extensionFsPath
		const globalStoragePath = HostProvider.get().globalStorageFsPath

		// Check if Section 5.3 papers exist
		const section53PapersPath = getSection53PapersPath(globalStoragePath, drugName)
		const papersExist = await checkSection53PapersExist(section53PapersPath)

		if (!papersExist) {
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "Section 5.3 has not been assessed yet. Please assess Section 5.3 first before generating Section 2.7.",
					requiresSection53: true,
				}),
			})
		}

		// Determine output path
		const dossierPath = path.join(productPath, "dossier")
		const section27Path = path.join(dossierPath, "module-2", "section-2.7")
		const texPath = path.join(section27Path, "content.tex")

		console.log(`[generateSection27] Generating Section 2.7 for ${drugName}`)
		console.log(`[generateSection27] Section 5.3 papers path: ${section53PapersPath}`)
		console.log(`[generateSection27] Output path: ${texPath}`)

		// Run the generation service
		const result = await generateSection27Service(
			drugName,
			extensionPath,
			openAiApiKey,
			section53PapersPath,
			texPath,
			companyName || "",
		)

		if (result.success && result.texPath) {
			// Open the .tex file - LaTeX Workshop will auto-compile and show PDF
			try {
				await HostProvider.window.openFile({ filePath: result.texPath })
				console.log(`[generateSection27] Opened file: ${result.texPath}`)
			} catch (openError) {
				console.error(`[generateSection27] Failed to open file: ${openError}`)
			}
		}

		console.log(
			`[generateSection27] Generation ${result.success ? "completed successfully" : "failed"}: ${result.error || ""}`,
		)

		return ProtoString.create({
			value: JSON.stringify(result),
		})
	} catch (error) {
		console.error("[generateSection27] Error:", error)
		return ProtoString.create({
			value: JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}),
		})
	}
}
