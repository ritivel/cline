import { Empty, StringRequest } from "@shared/proto/cline/common"
import { OpenInFileExplorerPanelRequest } from "@shared/proto/host/workspace"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import * as fs from "fs/promises"
import * as path from "path"
import { createDossierFolders, getCTDTemplate } from "@/core/slash-commands/index"
import { HostProvider } from "@/hosts/host-provider"
import { SubmissionsPaneProvider } from "@/hosts/vscode/SubmissionsPaneProvider"
import { ClineFileTracker } from "@/services/fileTracking/ClineFileTracker"
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
		if (!config.workspacePath || !config.drugName || !config.marketName) {
			throw new Error("Missing required fields in product configuration")
		}

		// Ensure workspace folder exists
		try {
			await fs.access(config.workspacePath)
		} catch {
			throw new Error(`Workspace folder does not exist: ${config.workspacePath}`)
		}

		// Create submission folder inside workspace folder
		const submissionFolderPath = path.join(config.workspacePath, "submission")
		try {
			await fs.mkdir(submissionFolderPath, { recursive: true })
			console.log("[createRegulatoryProduct] Created submission folder:", submissionFolderPath)
		} catch (error) {
			console.error("[createRegulatoryProduct] Failed to create submission folder:", error)
			throw new Error(`Failed to create submission folder: ${submissionFolderPath}`)
		}

		// Set submissionsPath to the created folder
		config.submissionsPath = submissionFolderPath

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

		// Create CTD dossier folder structure automatically
		try {
			const template = getCTDTemplate()
			const dossierPath = path.join(config.submissionsPath, "dossier")

			// Check if dossier folder already exists (backward compatibility)
			try {
				await fs.access(dossierPath)
				console.log("[createRegulatoryProduct] Dossier folder already exists, skipping creation")
			} catch {
				// Dossier folder doesn't exist, create it
				console.log("[createRegulatoryProduct] Creating CTD dossier folder structure...")
				const createdPaths = await createDossierFolders(config.submissionsPath, template.modules)
				console.log(
					`[createRegulatoryProduct] Successfully created dossier folder structure with ${createdPaths.length} folders`,
				)
			}

			// Create documents folder if it doesn't exist
			const documentsPath = path.join(config.submissionsPath, "documents")
			const fileTracker = ClineFileTracker.getInstance()
			try {
				await fs.access(documentsPath)
				// Documents folder already exists, skip creation
			} catch {
				// Documents folder doesn't exist, create it
				await fs.mkdir(documentsPath, { recursive: true })
				fileTracker.trackFile(documentsPath)
				console.log("[createRegulatoryProduct] Created documents folder")
			}
		} catch (error) {
			// Log error but don't fail product creation
			console.error("[createRegulatoryProduct] Failed to create dossier folder structure:", error)
		}

		// Clear the regulatory onboarding flag in global state
		_controller.stateManager.setGlobalState("showRegulatoryOnboarding", false)

		// Set flag to show CTD checklist (will be auto-cleared after showing once)
		_controller.stateManager.setGlobalState("showCtdChecklist", true)

		await _controller.postStateToWebview()

		// Clear the flag immediately after posting state to prevent it from persisting
		_controller.stateManager.setGlobalState("showCtdChecklist", false)

		return Empty.create({})
	} catch (error) {
		console.error("Failed to create regulatory product:", error)
		throw error
	}
}
