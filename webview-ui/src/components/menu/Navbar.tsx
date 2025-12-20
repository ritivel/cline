import { HistoryIcon, PlusIcon } from "lucide-react"
import type React from "react"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TaskServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "../../context/ExtensionStateContext"

// Custom MCP Server Icon component using VSCode codicon
const McpServerIcon = ({ className, size }: { className?: string; size?: number | string }) => {
	const fontSize = size ? (typeof size === "string" ? size : `${size}px`) : "12.5px"
	return (
		<span
			className={`codicon codicon-server flex items-center ${className || ""}`}
			style={{ fontSize, marginBottom: "1px" }}
		/>
	)
}

type NavbarTab = {
	id: string
	name: string
	tooltip: string
	icon: React.ComponentType<{ className?: string; size?: number | string }>
	navigate: () => void
	showWhen?: boolean
}

export const Navbar = () => {
	const { navigateToHistory, navigateToSettings, navigateToAccount, navigateToMcp, navigateToChat, navigateToCtdChecklist } =
		useExtensionState()

	// Log navigation functions to verify they're properly defined
	console.log("[Navbar] Navigation functions check:", {
		navigateToHistory: typeof navigateToHistory === "function" ? "✓ defined" : "✗ undefined",
		navigateToSettings: typeof navigateToSettings === "function" ? "✓ defined" : "✗ undefined",
		navigateToAccount: typeof navigateToAccount === "function" ? "✓ defined" : "✗ undefined",
		navigateToMcp: typeof navigateToMcp === "function" ? "✓ defined" : "✗ undefined",
		navigateToChat: typeof navigateToChat === "function" ? "✓ defined" : "✗ undefined",
		navigateToCtdChecklist: typeof navigateToCtdChecklist === "function" ? "✓ defined" : "✗ undefined",
	})

	const SETTINGS_TABS = useMemo<NavbarTab[]>(
		() => [
			{
				id: "chat",
				name: "Chat",
				tooltip: "New",
				icon: PlusIcon,
				navigate: () => {
					console.log("[Navbar] navigateToChat called (clearing task first)")
					TaskServiceClient.clearTask({})
						.catch((error) => {
							console.error("Failed to clear task:", error)
						})
						.finally(() => {
							console.log("[Navbar] Task cleared, calling navigateToChat")
							navigateToChat()
						})
				},
			},
			// Hidden: MCP Servers tab
			// {
			// 	id: "mcp",
			// 	name: "MCP",
			// 	tooltip: "MCP Servers",
			// 	icon: McpServerIcon,
			// 	navigate: () => {
			// 		console.log("[Navbar] navigateToMcp called")
			// 		navigateToMcp()
			// 	},
			// },
			{
				id: "ctdchecklist",
				name: "CTDChecklist",
				tooltip: "CTD Checklist",
				icon: HistoryIcon,
				navigate: () => {
					console.log("[Navbar] navigateToCtdChecklist called")
					navigateToCtdChecklist()
				},
			},
			{
				id: "history",
				name: "History",
				tooltip: "History",
				icon: HistoryIcon,
				navigate: () => {
					console.log("[Navbar] navigateToHistory called")
					navigateToHistory()
				},
			},
			// Hidden: Account tab
			// {
			// 	id: "account",
			// 	name: "Account",
			// 	tooltip: "Account",
			// 	icon: UserCircleIcon,
			// 	navigate: () => {
			// 		console.log("[Navbar] navigateToAccount called")
			// 		navigateToAccount()
			// 	},
			// },
			// Hidden: Settings tab
			// {
			// 	id: "settings",
			// 	name: "Settings",
			// 	tooltip: "Settings",
			// 	icon: SettingsIcon,
			// 	navigate: () => {
			// 		console.log("[Navbar] navigateToSettings called")
			// 		navigateToSettings()
			// 	},
			// },
		],
		[navigateToAccount, navigateToChat, navigateToHistory, navigateToMcp, navigateToSettings, navigateToCtdChecklist],
	)

	const filteredTabs = SETTINGS_TABS.filter((tab) => tab.showWhen === undefined || tab.showWhen === true)

	// Debug: Log tabs to console
	if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
		console.log(
			"[Navbar] All tabs:",
			SETTINGS_TABS.map((t) => t.id),
		)
		console.log(
			"[Navbar] Filtered tabs:",
			filteredTabs.map((t) => t.id),
		)
		console.log(
			"[Navbar] CTD Checklist tab:",
			filteredTabs.find((t) => t.id === "ctd-checklist"),
		)
	}

	return (
		<nav
			className="flex-none inline-flex justify-end bg-transparent gap-2 mb-1 z-10 border-none items-center mr-4!"
			id="cline-navbar-container">
			{filteredTabs.map((tab) => (
				<Tooltip key={`navbar-tooltip-${tab.id}`}>
					<TooltipContent side="bottom">{tab.tooltip}</TooltipContent>
					<TooltipTrigger asChild>
						<Button
							aria-label={tab.tooltip}
							className="p-0 h-7"
							data-testid={`tab-${tab.id}`}
							key={`navbar-button-${tab.id}`}
							onClick={() => tab.navigate()}
							size="icon"
							variant="icon">
							<tab.icon className="stroke-1 [svg]:size-4" size={18} />
						</Button>
					</TooltipTrigger>
				</Tooltip>
			))}
		</nav>
	)
}
