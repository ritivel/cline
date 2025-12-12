import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { useEffect } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import CtdChecklistView from "./components/ctd-checklist/CtdChecklistView"
import HistoryView from "./components/history/HistoryView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import NoProductTabsView from "./components/no-product/NoProductTabsView"
import OnboardingView from "./components/onboarding/OnboardingView"
import ProductsView from "./components/products/ProductsView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import { useClineAuth } from "./context/ClineAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showHistory,
		showProducts,
		showAccount,
		showAnnouncement,
		onboardingModels,
		showRegulatoryOnboarding,
		currentRegulatoryProduct,
		noProductInitialTab,
		showCtdChecklist,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideProducts,
		hideAccount,
		hideAnnouncement,
		hideCtdChecklist,
	} = useExtensionState()

	const { clineUser, organizations, activeOrganization } = useClineAuth()

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)

			// Use the gRPC client instead of direct WebviewMessage
			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement, setShowAnnouncement])

	if (!didHydrateState) {
		return null
	}

	if (showWelcome) {
		return onboardingModels ? <OnboardingView onboardingModels={onboardingModels} /> : <WelcomeView />
	}

	// Check if there's an active product
	const hasActiveProduct = !!currentRegulatoryProduct

	// If no product is active and no other views are shown, show the three-tab interface
	// Include showRegulatoryOnboarding case - when true, show tabs with "create" tab active
	const shouldShowNoProductTabs =
		!hasActiveProduct && !showSettings && !showHistory && !showProducts && !showMcp && !showAccount && !showCtdChecklist

	console.log("[PAVAN] shouldShowNoProductTabs:", shouldShowNoProductTabs)
	console.log("[PAVAN] showCtdChecklist:", showCtdChecklist)
	console.log("[PAVAN] showRegulatoryOnboarding:", showRegulatoryOnboarding)
	console.log("[PAVAN] showSettings:", showSettings)
	console.log("[PAVAN] showHistory:", showHistory)
	console.log("[PAVAN] showProducts:", showProducts)
	console.log("[PAVAN] showMcp:", showMcp)
	console.log("[PAVAN] showAccount:", showAccount)

	return (
		<div className="flex h-screen w-full flex-col">
			{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{showProducts && <ProductsView onDone={hideProducts} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showAccount && (
				<AccountView
					activeOrganization={activeOrganization}
					clineUser={clineUser}
					onDone={hideAccount}
					organizations={organizations}
				/>
			)}
			{showCtdChecklist && <CtdChecklistView onDone={hideCtdChecklist} />}
			{shouldShowNoProductTabs && (
				<NoProductTabsView initialTab={showRegulatoryOnboarding ? "create" : noProductInitialTab} />
			)}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={
					showSettings ||
					showHistory ||
					showProducts ||
					showMcp ||
					showAccount ||
					showCtdChecklist ||
					showRegulatoryOnboarding ||
					shouldShowNoProductTabs
				}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</div>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
