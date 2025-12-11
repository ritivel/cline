import { EmptyRequest } from "@shared/proto/cline/common"
import { memo, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"
import ProductsView from "../products/ProductsView"
import { RegulatoryProductOnboarding } from "../regulatory/RegulatoryProductOnboarding"

type TabType = "create" | "products"

type NoProductTabsViewProps = {
	initialTab?: TabType
}

const NoProductTabsView = memo(({ initialTab = "create" }: NoProductTabsViewProps) => {
	const { setNoProductInitialTab } = useExtensionState()
	const [activeTab, setActiveTab] = useState<TabType>(initialTab)
	const [products, setProducts] = useState<any[]>([])
	const [isLoadingProducts, setIsLoadingProducts] = useState(false)

	// Update activeTab when initialTab changes (e.g., from navigation)
	useEffect(() => {
		setActiveTab(initialTab)
	}, [initialTab])

	// Sync tab changes with shared state
	const handleTabChange = (tab: TabType) => {
		setActiveTab(tab)
		setNoProductInitialTab(tab)
	}

	// Load products count for display
	useEffect(() => {
		const loadProducts = async () => {
			try {
				setIsLoadingProducts(true)
				const response = await UiServiceClient.getRegulatoryProducts(EmptyRequest.create({}))
				if (response.value) {
					const parsedProducts = JSON.parse(response.value)
					setProducts(parsedProducts || [])
				}
			} catch (error) {
				console.error("Error loading products:", error)
			} finally {
				setIsLoadingProducts(false)
			}
		}
		loadProducts()
	}, [])

	return (
		<div className="fixed inset-0 flex flex-col">
			{/* Tabs Header */}
			<div className="flex border-b border-(--vscode-panel-border) bg-(--vscode-editor-background)">
				<button
					className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
						activeTab === "create"
							? "border-(--vscode-button-background) text-(--vscode-foreground)"
							: "border-transparent text-(--vscode-descriptionForeground) hover:text-(--vscode-foreground)"
					}`}
					onClick={() => handleTabChange("create")}>
					Create Product
				</button>
				<button
					className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors relative ${
						activeTab === "products"
							? "border-(--vscode-button-background) text-(--vscode-foreground)"
							: "border-transparent text-(--vscode-descriptionForeground) hover:text-(--vscode-foreground)"
					}`}
					onClick={() => handleTabChange("products")}>
					Products
					{products.length > 0 && (
						<span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-(--vscode-badge-background) text-(--vscode-badge-foreground)">
							{products.length}
						</span>
					)}
				</button>
			</div>

			{/* Tab Content */}
			<div className="flex-1 overflow-hidden">
				{activeTab === "create" && (
					<div className="h-full">
						<RegulatoryProductOnboarding />
					</div>
				)}
				{activeTab === "products" && (
					<div className="h-full">
						<ProductsView
							hideHeader={true}
							onDone={() => {
								// When done, switch to create tab
								handleTabChange("create")
							}}
						/>
					</div>
				)}
			</div>
		</div>
	)
})

NoProductTabsView.displayName = "NoProductTabsView"

export default NoProductTabsView
