import React from "react"
import { ClineError, ClineErrorType } from "../../../../src/services/error/ClineError"
import { ProgressIndicator } from "./ChatRow"

interface ErrorBlockTitleProps {
	cost?: number
	apiReqCancelReason?: string
	apiRequestFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec?: number
		errorSnippet?: string
	}
	hasToolCalls?: boolean
	toolNames?: string[]
}

// Helper function to format tool names for display
const formatToolName = (toolName: string): string => {
	const toolNameMap: Record<string, string> = {
		readFile: "Reading file",
		editedExistingFile: "Editing file",
		newFileCreated: "Creating file",
		fileDeleted: "Deleting file",
		listFilesTopLevel: "Listing files",
		listFilesRecursive: "Listing files recursively",
		listCodeDefinitionNames: "Listing code definitions",
		searchFiles: "Searching files",
		webFetch: "Fetching from web",
		summarizeTask: "Summarizing task",
		command: "Executing command",
		use_mcp_server: "Using MCP server",
		browser_action_launch: "Launching browser",
	}
	return toolNameMap[toolName] || toolName
}

export const ErrorBlockTitle = ({
	cost,
	apiReqCancelReason,
	apiRequestFailedMessage,
	retryStatus,
	hasToolCalls = false,
	toolNames = [],
}: ErrorBlockTitleProps): [React.ReactElement, React.ReactElement] => {
	const getIconSpan = (iconName: string, colorClass: string) => (
		<div className="w-4 h-4 flex items-center justify-center">
			<span className={`codicon codicon-${iconName} text-base -mb-0.5 ${colorClass}`}></span>
		</div>
	)

	const icon =
		apiReqCancelReason != null ? (
			apiReqCancelReason === "user_cancelled" ? (
				getIconSpan("error", "text-(--vscode-descriptionForeground)")
			) : (
				getIconSpan("error", "text-(--vscode-errorForeground)")
			)
		) : cost != null ? (
			getIconSpan("check", "text-(--vscode-charts-green)")
		) : apiRequestFailedMessage ? (
			getIconSpan("error", "text-(--vscode-errorForeground)")
		) : (
			<ProgressIndicator />
		)

	const title = (() => {
		// Determine base title based on whether there are tool calls
		let baseTitle = "Thinking"
		if (hasToolCalls && toolNames.length > 0) {
			// Format tool names for display
			const formattedToolNames = toolNames.map(formatToolName)
			if (formattedToolNames.length === 1) {
				baseTitle = formattedToolNames[0]
			} else if (formattedToolNames.length === 2) {
				baseTitle = `${formattedToolNames[0]} and ${formattedToolNames[1]}`
			} else {
				baseTitle = `${formattedToolNames.slice(0, -1).join(", ")}, and ${formattedToolNames[formattedToolNames.length - 1]}`
			}
		} else if (hasToolCalls) {
			baseTitle = "Calling tool"
		}

		// Default loading state
		const details = { title: `${baseTitle}...`, classNames: ["font-bold"] }
		// Handle cancellation states first
		if (apiReqCancelReason === "user_cancelled") {
			details.title = `${baseTitle} (Cancelled)`
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiReqCancelReason != null) {
			details.title = `${baseTitle} (Failed)`
			details.classNames.push("text-(--vscode-errorForeground)")
		} else if (cost != null) {
			// Handle completed request
			details.title = baseTitle
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiRequestFailedMessage) {
			// Handle failed request
			const clineError = ClineError.parse(apiRequestFailedMessage)
			const titleText = clineError?.isErrorType(ClineErrorType.Balance) ? "Credit Limit Reached" : `${baseTitle} (Failed)`
			details.title = titleText
			details.classNames.push("font-bold text-(--vscode-errorForeground)")
		} else if (retryStatus) {
			// Handle retry state
			details.title = `${baseTitle}...`
			details.classNames.push("text-(--vscode-foreground)")
		}

		return <span className={details.classNames.join(" ")}>{details.title}</span>
	})()

	return [icon, title]
}
