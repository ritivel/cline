import { Empty, StringRequest } from "@shared/proto/cline/common"
import { OpenInFileExplorerPanelRequest } from "@shared/proto/host/workspace"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import * as fs from "fs/promises"
import { HostProvider } from "@/hosts/host-provider"
import { SubmissionsPaneProvider } from "@/hosts/vscode/SubmissionsPaneProvider"
import type { Controller } from "../index"

/**
 * Creates a new regulatory product with the provided configuration
 * @param controller The controller instance
 * @param request String request containing JSON-encoded product configuration
 * @returns Empty response
 */
export async function createRegulatoryProduct(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const config: RegulatoryProductConfig = JSON.parse(request.value || "{}")

		// Validate required fields
		if (!config.workspacePath || !config.submissionsPath || !config.drugName || !config.marketName) {
			throw new Error("Missing required fields in product configuration")
		}

		// Ensure workspace folder exists
		try {
			await fs.access(config.workspacePath)
		} catch {
			throw new Error(`Workspace folder does not exist: ${config.workspacePath}`)
		}

		// Ensure submissions folder exists
		try {
			await fs.access(config.submissionsPath)
		} catch {
			throw new Error(`Submissions folder does not exist: ${config.submissionsPath}`)
		}

		// Save product to extension global state (so it's visible across all workspaces)
		// This doesn't require package.json registration
		const existingProducts = _controller.context.globalState.get<RegulatoryProductConfig[]>("regulatoryProducts", [])

		console.log("[DEBUG] createRegulatoryProduct: Existing products count:", existingProducts.length)

		// Check if product already exists (by all 4 fields)
		const productExists = existingProducts.some(
			(p) =>
				p.workspacePath === config.workspacePath &&
				p.submissionsPath === config.submissionsPath &&
				p.drugName === config.drugName &&
				p.marketName === config.marketName,
		)

		if (!productExists) {
			existingProducts.push(config)
			console.log("[DEBUG] createRegulatoryProduct: Saving", existingProducts.length, "products to global state")
			await _controller.context.globalState.update("regulatoryProducts", existingProducts)
			console.log("[DEBUG] createRegulatoryProduct: Products saved successfully")
		} else {
			console.log("[DEBUG] createRegulatoryProduct: Product already exists, skipping save")
		}

		// Set as current active product
		_controller.stateManager.setGlobalState("currentRegulatoryProduct", config)

		// Set context to show navbar icons
		HostProvider.get().setContext("cline.hasActiveProduct", true)

		// Open the workspace folder using host bridge
		await HostProvider.get().hostBridge.workspaceClient.openInFileExplorerPanel(
			OpenInFileExplorerPanelRequest.create({ path: config.workspacePath }),
		)

		// Set the submissions folder in the submissions pane
		const submissionsProvider = SubmissionsPaneProvider.getInstance()
		if (submissionsProvider) {
			await submissionsProvider.setSubmissionsFolder(config.submissionsPath)
		}

		// Clear the regulatory onboarding flag in global state
		_controller.stateManager.setGlobalState("showRegulatoryOnboarding", false)
		await _controller.postStateToWebview()

		return Empty.create({})
	} catch (error) {
		console.error("Failed to create regulatory product:", error)
		throw error
	}
}
