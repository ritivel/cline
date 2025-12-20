import { Empty, StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import type { Controller } from "../index"

interface UpdateRegulatoryProductRequest {
	/** The original product config to identify which product to update */
	originalProduct: RegulatoryProductConfig
	/** The updated product config with new values */
	updatedProduct: RegulatoryProductConfig
}

/**
 * Updates an existing regulatory product with new configuration
 * @param controller The controller instance
 * @param request String request containing JSON-encoded update request with originalProduct and updatedProduct
 * @returns Empty response
 */
export async function updateRegulatoryProduct(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const { originalProduct, updatedProduct }: UpdateRegulatoryProductRequest = JSON.parse(request.value || "{}")

		// Validate required fields
		if (!originalProduct || !updatedProduct) {
			throw new Error("Missing originalProduct or updatedProduct in request")
		}

		if (!updatedProduct.drugName || !updatedProduct.marketName) {
			throw new Error("Drug name and market name are required")
		}

		// Get existing products from global state
		const existingProducts = _controller.context.globalState.get<RegulatoryProductConfig[]>("regulatoryProducts", [])

		// Find the product to update by matching workspace path and submissions path (unique identifiers)
		const productIndex = existingProducts.findIndex(
			(p) => p.workspacePath === originalProduct.workspacePath && p.submissionsPath === originalProduct.submissionsPath,
		)

		if (productIndex === -1) {
			throw new Error("Product not found")
		}

		// Update the product
		existingProducts[productIndex] = {
			...existingProducts[productIndex],
			drugName: updatedProduct.drugName.trim(),
			marketName: updatedProduct.marketName.trim(),
		}

		// Save updated products list
		await _controller.context.globalState.update("regulatoryProducts", existingProducts)
		console.log("[updateRegulatoryProduct] Product updated successfully")

		// If this is the current active product, update that too
		const currentProduct = _controller.stateManager.getGlobalStateKey("currentRegulatoryProduct")
		if (
			currentProduct &&
			currentProduct.workspacePath === originalProduct.workspacePath &&
			currentProduct.submissionsPath === originalProduct.submissionsPath
		) {
			_controller.stateManager.setGlobalState("currentRegulatoryProduct", existingProducts[productIndex])
		}

		// Post updated state to webview
		await _controller.postStateToWebview()

		return Empty.create({})
	} catch (error) {
		console.error("Failed to update regulatory product:", error)
		throw error
	}
}
