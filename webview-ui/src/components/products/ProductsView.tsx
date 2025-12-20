import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Pencil, X } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

type ProductsViewProps = {
	onDone: () => void
	hideHeader?: boolean
}

const ProductsView = ({ onDone, hideHeader = false }: ProductsViewProps) => {
	const { navigateToChat } = useExtensionState()
	const [products, setProducts] = useState<RegulatoryProductConfig[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	// Edit mode state
	const [editingProduct, setEditingProduct] = useState<RegulatoryProductConfig | null>(null)
	const [editDrugName, setEditDrugName] = useState("")
	const [editMarketName, setEditMarketName] = useState("")
	const [isSaving, setIsSaving] = useState(false)

	// Load products on mount
	useEffect(() => {
		const loadProducts = async () => {
			try {
				setIsLoading(true)
				setError(null)
				console.log("[DEBUG] ProductsView: Loading regulatory products...")
				const response = await UiServiceClient.getRegulatoryProducts(EmptyRequest.create({}))
				console.log("[DEBUG] ProductsView: getRegulatoryProducts response:", response.value)
				if (response.value) {
					const parsedProducts = JSON.parse(response.value) as RegulatoryProductConfig[]
					console.log("[DEBUG] ProductsView: Parsed products:", parsedProducts)
					setProducts(parsedProducts)
				} else {
					console.log("[DEBUG] ProductsView: No response value from getRegulatoryProducts")
				}
			} catch (error) {
				console.error("[DEBUG] ProductsView: Error loading regulatory products:", error)
				setError("Failed to load products. Please try again.")
			} finally {
				setIsLoading(false)
			}
		}
		loadProducts()
	}, [])

	// Handle product selection
	const handleProductSelect = useCallback(
		async (product: RegulatoryProductConfig) => {
			try {
				console.log("[DEBUG] ProductsView: Opening product:", product)
				await UiServiceClient.openRegulatoryProduct(StringRequest.create({ value: JSON.stringify(product) }))
				// The openRegulatoryProduct RPC updates the state and posts to webview
				// The UI will automatically update based on currentRegulatoryProduct state
				// Navigate to chat view after opening the product
				navigateToChat()
			} catch (error) {
				console.error("[DEBUG] ProductsView: Error opening regulatory product:", error)
				setError("Failed to open product. Please try again.")
			}
		},
		[navigateToChat],
	)

	// Start editing a product
	const handleEditClick = useCallback((e: React.MouseEvent, product: RegulatoryProductConfig) => {
		e.stopPropagation() // Prevent product selection
		setEditingProduct(product)
		setEditDrugName(product.drugName)
		setEditMarketName(product.marketName)
		setError(null)
	}, [])

	// Cancel editing
	const handleCancelEdit = useCallback(() => {
		setEditingProduct(null)
		setEditDrugName("")
		setEditMarketName("")
		setError(null)
	}, [])

	// Save edited product
	const handleSaveEdit = useCallback(async () => {
		if (!editingProduct) return

		if (!editDrugName.trim() || !editMarketName.trim()) {
			setError("Drug name and market name are required.")
			return
		}

		setIsSaving(true)
		setError(null)

		try {
			const updateRequest = {
				originalProduct: editingProduct,
				updatedProduct: {
					...editingProduct,
					drugName: editDrugName.trim(),
					marketName: editMarketName.trim(),
				},
			}

			await UiServiceClient.updateRegulatoryProduct(StringRequest.create({ value: JSON.stringify(updateRequest) }))

			// Update local state
			setProducts((prev) =>
				prev.map((p) =>
					p.workspacePath === editingProduct.workspacePath && p.submissionsPath === editingProduct.submissionsPath
						? { ...p, drugName: editDrugName.trim(), marketName: editMarketName.trim() }
						: p,
				),
			)

			handleCancelEdit()
		} catch (error: any) {
			console.error("[DEBUG] ProductsView: Error updating product:", error)
			setError(error?.message || "Failed to update product. Please try again.")
		} finally {
			setIsSaving(false)
		}
	}, [editingProduct, editDrugName, editMarketName, handleCancelEdit])

	return (
		<div className={`flex flex-col ${hideHeader ? "h-full" : "fixed inset-0"}`}>
			{!hideHeader && (
				<div className="flex justify-between items-center p-4 border-b border-(--vscode-panel-border)">
					<h2 className="text-lg font-semibold">Products</h2>
					<VSCodeButton onClick={onDone}>Done</VSCodeButton>
				</div>
			)}

			<div className={`overflow-auto p-4 ${hideHeader ? "flex-1" : "flex-1"}`}>
				{isLoading && (
					<div className="flex justify-center items-center h-full">
						<p className="text-sm text-(--vscode-descriptionForeground)">Loading products...</p>
					</div>
				)}

				{error && (
					<div className="p-3 mb-4 bg-(--vscode-inputValidation-errorBackground) border border-(--vscode-inputValidation-errorBorder) rounded">
						<p className="text-sm text-(--vscode-inputValidation-errorForeground)">❌ {error}</p>
					</div>
				)}

				{!isLoading && !error && products.length === 0 && (
					<div className="flex flex-col items-center justify-center h-full text-center">
						<p className="text-lg font-medium mb-2">No products found</p>
						<p className="text-sm text-(--vscode-descriptionForeground) mb-4">
							Create a new product to get started with your regulatory workflow.
						</p>
					</div>
				)}

				{!isLoading && products.length > 0 && (
					<div className="grid grid-cols-1 gap-3">
						{products.map((product, index) => (
							<div
								className="relative p-4 rounded border border-(--vscode-panel-border) hover:bg-(--vscode-list-hoverBackground) transition-colors"
								key={index}>
								{/* Edit button */}
								<button
									className="absolute top-2 right-2 p-1.5 rounded hover:bg-(--vscode-toolbar-hoverBackground) text-(--vscode-descriptionForeground) hover:text-(--vscode-foreground)"
									onClick={(e) => handleEditClick(e, product)}
									title="Edit product">
									<Pencil className="w-4 h-4" />
								</button>

								{/* Product content - clickable to select */}
								<button className="text-left w-full pr-8" onClick={() => handleProductSelect(product)}>
									<div className="font-medium text-base mb-1">{product.drugName}</div>
									<div className="text-sm text-(--vscode-descriptionForeground) mb-2">{product.marketName}</div>
									<div
										className="text-xs text-(--vscode-descriptionForeground) truncate"
										title={product.workspacePath}>
										Workspace: {product.workspacePath}
									</div>
									<div
										className="text-xs text-(--vscode-descriptionForeground) truncate mt-1"
										title={product.submissionsPath}>
										Submissions: {product.submissionsPath}
									</div>
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Edit Modal */}
			{editingProduct && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
					<div className="bg-(--vscode-editor-background) border border-(--vscode-panel-border) rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
						<div className="flex justify-between items-center mb-4">
							<h3 className="text-lg font-semibold">Edit Product</h3>
							<button
								className="p-1 rounded hover:bg-(--vscode-toolbar-hoverBackground)"
								onClick={handleCancelEdit}>
								<X className="w-5 h-5" />
							</button>
						</div>

						<div className="space-y-4">
							<div>
								<label className="block text-sm font-medium mb-1">Drug Name</label>
								<VSCodeTextField
									className="w-full"
									onInput={(e: any) => setEditDrugName(e.target.value)}
									placeholder="e.g., Levofloxacin USP 500mg"
									value={editDrugName}
								/>
							</div>

							<div>
								<label className="block text-sm font-medium mb-1">Market Name</label>
								<VSCodeTextField
									className="w-full"
									onInput={(e: any) => setEditMarketName(e.target.value)}
									placeholder="e.g., US FDA"
									value={editMarketName}
								/>
							</div>

							<div className="text-xs text-(--vscode-descriptionForeground)">
								<p>Workspace: {editingProduct.workspacePath}</p>
								<p className="mt-1">Submissions: {editingProduct.submissionsPath}</p>
							</div>

							{error && (
								<div className="p-2 bg-(--vscode-inputValidation-errorBackground) border border-(--vscode-inputValidation-errorBorder) rounded">
									<p className="text-sm text-(--vscode-inputValidation-errorForeground)">{error}</p>
								</div>
							)}

							<div className="flex gap-2 justify-end pt-2">
								<VSCodeButton appearance="secondary" disabled={isSaving} onClick={handleCancelEdit}>
									Cancel
								</VSCodeButton>
								<VSCodeButton disabled={isSaving} onClick={handleSaveEdit}>
									{isSaving ? "Saving..." : "Save Changes"}
								</VSCodeButton>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default memo(ProductsView)
