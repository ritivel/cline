import { Empty, StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

/**
 * Deletes a regulatory product from the stored list
 * @param controller The controller instance
 * @param request String request containing JSON-encoded product configuration to delete
 * @returns Empty response
 */
export async function deleteRegulatoryProduct(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const configToDelete: RegulatoryProductConfig = JSON.parse(request.value || "{}")

		// Validate required fields
		if (
			!configToDelete.workspacePath ||
			!configToDelete.submissionsPath ||
			!configToDelete.drugName ||
			!configToDelete.marketName
		) {
			throw new Error("Missing required fields in product configuration")
		}

		// Get existing products from extension global state
		const existingProducts = controller.context.globalState.get<RegulatoryProductConfig[]>("regulatoryProducts", [])

		console.log("[DEBUG] deleteRegulatoryProduct: Existing products count:", existingProducts.length)

		// Find and remove the product (match by all 4 fields)
		const updatedProducts = existingProducts.filter(
			(p) =>
				!(
					p.workspacePath === configToDelete.workspacePath &&
					p.submissionsPath === configToDelete.submissionsPath &&
					p.drugName === configToDelete.drugName &&
					p.marketName === configToDelete.marketName
				),
		)

		if (updatedProducts.length === existingProducts.length) {
			console.log("[DEBUG] deleteRegulatoryProduct: Product not found, nothing to delete")
		} else {
			console.log("[DEBUG] deleteRegulatoryProduct: Saving", updatedProducts.length, "products to global state")
			await controller.context.globalState.update("regulatoryProducts", updatedProducts)
			console.log("[DEBUG] deleteRegulatoryProduct: Product deleted successfully")
		}

		// If the deleted product was the current active product, clear it
		const currentProduct = controller.stateManager.getGlobalStateKey("currentRegulatoryProduct")
		if (
			currentProduct &&
			currentProduct.workspacePath === configToDelete.workspacePath &&
			currentProduct.submissionsPath === configToDelete.submissionsPath &&
			currentProduct.drugName === configToDelete.drugName &&
			currentProduct.marketName === configToDelete.marketName
		) {
			controller.stateManager.setGlobalState("currentRegulatoryProduct", undefined)
			// Set context to hide navbar icons
			HostProvider.get().setContext("cline.hasActiveProduct", false)
			await controller.postStateToWebview()
		}

		return Empty.create({})
	} catch (error) {
		console.error("Failed to delete regulatory product:", error)
		throw error
	}
}
