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
	const [submissionsPath, setSubmissionsPath] = useState("")
	const [isCreating, setIsCreating] = useState(false)
	const [foldersLoaded, setFoldersLoaded] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Auto-populate folders from left pane when component mounts
	useEffect(() => {
		const loadFolders = async () => {
			try {
				console.log("[DEBUG] Loading folders from left pane...")
				// Get current workspace folder from left pane
				const workspaceResponse = await UiServiceClient.getCurrentWorkspaceFolder(EmptyRequest.create())
				console.log("[DEBUG] Workspace folder response:", workspaceResponse.value)
				if (workspaceResponse.value) {
					setWorkspacePath(workspaceResponse.value)
				}

				// Get current submissions folder from left pane
				const submissionsResponse = await UiServiceClient.getCurrentSubmissionsFolder(EmptyRequest.create())
				console.log("[DEBUG] Submissions folder response:", submissionsResponse.value)
				if (submissionsResponse.value) {
					setSubmissionsPath(submissionsResponse.value)
				}

				setFoldersLoaded(true)
				console.log("[DEBUG] Folders loaded:", {
					workspacePath: workspaceResponse.value,
					submissionsPath: submissionsResponse.value,
				})
			} catch (error) {
				console.error("[DEBUG] Failed to load folders from left pane:", error)
				setFoldersLoaded(true)
			}
		}

		loadFolders()
	}, [])

	const handleCreate = async () => {
		console.log("[DEBUG] handleCreate called", { drugName, marketName, workspacePath, submissionsPath, isFormValid })

		// Clear any previous errors
		setError(null)

		// Validate inputs - folders must be loaded from left pane
		if (!drugName.trim() || !marketName.trim() || !workspacePath || !submissionsPath) {
			if (!workspacePath || !submissionsPath) {
				const errorMsg = "Please ensure workspace and submissions folders are set in the left pane"
				console.error("[DEBUG] Validation failed - missing folders:", { workspacePath, submissionsPath })
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
				submissionsPath,
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

	const isFormValid = drugName.trim() && marketName.trim() && workspacePath && submissionsPath

	return (
		<div className="h-full p-0 flex flex-col">
			<div className="h-full px-5 overflow-auto flex flex-col gap-4">
				<h2 className="text-lg font-semibold">Create New Regulatory Product</h2>
				<p className="text-sm text-(--vscode-descriptionForeground)">
					Enter product information. Workspace and submissions folders are automatically loaded from the left pane.
				</p>

				{!foldersLoaded && (
					<p className="text-xs text-(--vscode-descriptionForeground)">Loading folders from left pane...</p>
				)}

				{foldersLoaded && (!workspacePath || !submissionsPath) && (
					<div className="p-3 bg-(--vscode-inputValidation-warningBackground) border border-(--vscode-inputValidation-warningBorder) rounded">
						<p className="text-sm text-(--vscode-inputValidation-warningForeground)">
							⚠️ Please ensure both workspace and submissions folders are set in the left pane before creating a
							product.
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

				{submissionsPath && (
					<div className="flex flex-col gap-1">
						<label className="text-xs font-medium text-(--vscode-descriptionForeground)">
							Submissions Folder (from left pane)
						</label>
						<p className="text-xs text-(--vscode-descriptionForeground) break-all">{submissionsPath}</p>
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
								submissionsPath,
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
							{workspacePath ? "✓" : "✗"} | Submissions: {submissionsPath ? "✓" : "✗"}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
