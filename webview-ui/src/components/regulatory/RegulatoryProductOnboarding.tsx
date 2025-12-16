import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

export const RegulatoryProductOnboarding = () => {
	const { navigateToChat, setShowRegulatoryOnboarding } = useExtensionState()
	const [drugName, setDrugName] = useState("")
	const [marketName, setMarketName] = useState("")
	const [workspacePath, setWorkspacePath] = useState("")
	const [isCreating, setIsCreating] = useState(false)
	const [foldersLoaded, setFoldersLoaded] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Auto-populate workspace folder from left pane when component mounts
	useEffect(() => {
		const loadWorkspaceFolder = async () => {
			try {
				console.log("[DEBUG] Loading workspace folder from left pane...")
				// Get current workspace folder from left pane
				const workspaceResponse = await UiServiceClient.getCurrentWorkspaceFolder(EmptyRequest.create())
				console.log("[DEBUG] Workspace folder response:", workspaceResponse.value)
				if (workspaceResponse.value) {
					setWorkspacePath(workspaceResponse.value)
				}

				setFoldersLoaded(true)
				console.log("[DEBUG] Workspace folder loaded:", workspaceResponse.value)
			} catch (error) {
				console.error("[DEBUG] Failed to load workspace folder from left pane:", error)
				setFoldersLoaded(true)
			}
		}

		loadWorkspaceFolder()
	}, [])

	const handleCreate = async () => {
		console.log("[DEBUG] handleCreate called", { drugName, marketName, workspacePath, isFormValid })

		// Clear any previous errors
		setError(null)

		// Validate inputs
		if (!drugName.trim() || !marketName.trim() || !workspacePath) {
			if (!workspacePath) {
				const errorMsg = "Please ensure workspace folder is set in the left pane"
				console.error("[DEBUG] Validation failed - missing workspace folder:", workspacePath)
				setError(errorMsg)
			} else {
				const errorMsg = "Please fill in all required fields (Drug Name and Market Name)"
				console.error("[DEBUG] Validation failed - missing text fields:", { drugName, marketName })
				setError(errorMsg)
			}
			return
		}

		console.log("[DEBUG] Starting product creation...")
		setIsCreating(true)

		try {
			const config: RegulatoryProductConfig = {
				workspacePath,
				submissionsPath: "", // Backend will create and set this
				drugName: drugName.trim(),
				marketName: marketName.trim(),
			}

			console.log("[DEBUG] Calling createRegulatoryProduct with config:", config)

			// Save the product configuration
			await UiServiceClient.createRegulatoryProduct(StringRequest.create({ value: JSON.stringify(config) }))

			console.log("[DEBUG] Product created successfully, navigating to chat")

			// Clear the regulatory onboarding flag
			setShowRegulatoryOnboarding(false)

			// Navigate to chat view
			navigateToChat()
		} catch (error: any) {
			const errorMessage = error?.message || "Failed to create regulatory product. Please check the console for details."
			console.error("[DEBUG] Failed to create regulatory product:", error)
			setError(errorMessage)
		} finally {
			setIsCreating(false)
		}
	}

	const isFormValid = drugName.trim() && marketName.trim() && workspacePath

	return (
		<div className="h-full p-0 flex flex-col">
			<div className="h-full px-5 overflow-auto flex flex-col gap-4">
				<h2 className="text-lg font-semibold">Create New Regulatory Product</h2>
				<p className="text-sm text-(--vscode-descriptionForeground)">
					Enter product information. Workspace folder is automatically loaded from the left pane. A submission folder
					will be created automatically.
				</p>

				{!foldersLoaded && (
					<p className="text-xs text-(--vscode-descriptionForeground)">Loading folders from left pane...</p>
				)}

				{foldersLoaded && !workspacePath && (
					<div className="p-3 bg-(--vscode-inputValidation-warningBackground) border border-(--vscode-inputValidation-warningBorder) rounded">
						<p className="text-sm text-(--vscode-inputValidation-warningForeground)">
							⚠️ Please ensure workspace folder is set in the left pane before creating a product.
						</p>
					</div>
				)}

				{error && (
					<div className="p-3 bg-(--vscode-inputValidation-errorBackground) border border-(--vscode-inputValidation-errorBorder) rounded">
						<p className="text-sm text-(--vscode-inputValidation-errorForeground)">❌ {error}</p>
					</div>
				)}

				{workspacePath && (
					<div className="flex flex-col gap-1">
						<label className="text-xs font-medium text-(--vscode-descriptionForeground)">
							Workspace Folder (from left pane)
						</label>
						<p className="text-xs text-(--vscode-descriptionForeground) break-all">{workspacePath}</p>
					</div>
				)}

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium">Drug Name</label>
						<VSCodeTextField
							className="w-full"
							onInput={(e: any) => setDrugName(e.target.value)}
							placeholder="Enter drug name (e.g., Levofloxacin)"
							value={drugName}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium">Market Name</label>
						<VSCodeTextField
							className="w-full"
							onInput={(e: any) => setMarketName(e.target.value)}
							placeholder="Enter market name"
							value={marketName}
						/>
					</div>

					<VSCodeButton
						appearance="primary"
						className="w-full mt-2"
						disabled={!isFormValid || isCreating}
						onClick={(e) => {
							console.log("[DEBUG] Create Product button clicked", {
								isFormValid,
								isCreating,
								drugName,
								marketName,
								workspacePath,
							})
							e.preventDefault()
							e.stopPropagation()
							handleCreate()
						}}>
						{isCreating ? "Creating..." : "Create Product"}
					</VSCodeButton>

					{/* Debug info */}
					{process.env.NODE_ENV === "development" && (
						<div className="text-xs text-(--vscode-descriptionForeground) mt-2">
							Debug: Form valid: {isFormValid ? "Yes" : "No"} | Creating: {isCreating ? "Yes" : "No"} | Workspace:{" "}
							{workspacePath ? "✓" : "✗"}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
