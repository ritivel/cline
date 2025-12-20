import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import * as fs from "fs/promises"
import * as path from "path"
import { sanitizeFilename } from "@/core/services/section53"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

interface GetSection53PapersRequest {
	drugName: string
	productPath: string
}

/**
 * Gets cached Section 5.3 papers result for a regulatory product
 * Returns the saved JSON file if it exists
 */
export async function getSection53Papers(_controller: Controller, request: StringRequest): Promise<ProtoString> {
	try {
		const { drugName, productPath } = JSON.parse(request.value || "{}") as GetSection53PapersRequest

		if (!drugName || !productPath) {
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "Drug name and product path are required",
				}),
			})
		}

		// Look for cached papers file (saved to extension global storage)
		const fileName = `${sanitizeFilename(drugName)}_5.3_papers.json`
		const globalStoragePath = path.join(HostProvider.get().globalStorageFsPath, "section53-papers")
		const filePath = path.join(globalStoragePath, fileName)

		try {
			const content = await fs.readFile(filePath, "utf-8")
			const result = JSON.parse(content)

			return ProtoString.create({
				value: JSON.stringify({
					success: true,
					result,
				}),
			})
		} catch {
			// File doesn't exist or can't be read
			return ProtoString.create({
				value: JSON.stringify({
					success: false,
					error: "No cached Section 5.3 papers found. Click 'Assess Papers' under Section 5.3 to search.",
				}),
			})
		}
	} catch (error) {
		console.error("[getSection53Papers] Error:", error)
		return ProtoString.create({
			value: JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}),
		})
	}
}
