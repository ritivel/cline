import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
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

				{!isLoading && !error && products.length > 0 && (
					<div className="grid grid-cols-1 gap-3">
						{products.map((product, index) => (
							<button
								className="text-left p-4 rounded border border-(--vscode-panel-border) hover:bg-(--vscode-list-hoverBackground) transition-colors"
								key={index}
								onClick={() => handleProductSelect(product)}>
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
						))}
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(ProductsView)
