import { EmptyRequest, String } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import type { Controller } from "../index"

/**
 * Gets the list of existing regulatory products
 * @param controller The controller instance
 * @param request Empty request
 * @returns String response with JSON-encoded array of products
 */
export async function getRegulatoryProducts(controller: Controller, _request: EmptyRequest): Promise<String> {
	try {
		// Get products from extension global state (so they're visible across all workspaces)
		// This doesn't require package.json registration
		const products = controller.context.globalState.get<RegulatoryProductConfig[]>("regulatoryProducts", [])
		console.log("[DEBUG] getRegulatoryProducts: Found", products.length, "products from global state")
		if (products.length > 0) {
			console.log("[DEBUG] Products:", JSON.stringify(products, null, 2))
		}
		return String.create({ value: JSON.stringify(products) })
	} catch (error) {
		console.error("[DEBUG] Failed to get regulatory products:", error)
		return String.create({ value: "[]" })
	}
}
