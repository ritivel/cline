import { ClineMessage } from "@shared/ExtensionMessage"
import React from "react"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { cn } from "@/lib/utils"
import { MessageHandlers } from "../../types/chatTypes"

interface MessageRendererProps {
	index: number
	messageOrGroup: ClineMessage | ClineMessage[]
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
}

/**
 * Specialized component for rendering different message types
 * Handles browser sessions, regular messages, and checkpoint logic
 */
export const MessageRenderer: React.FC<MessageRendererProps> = ({
	index,
	messageOrGroup,
	groupedMessages,
	modifiedMessages,
	expandedRows,
	onToggleExpand,
	onHeightChange,
	onSetQuote,
	inputValue,
	messageHandlers,
}) => {
	// Browser session group
	if (Array.isArray(messageOrGroup)) {
		return (
			<BrowserSessionRow
				expandedRows={expandedRows}
				isLast={index === groupedMessages.length - 1}
				key={messageOrGroup[0]?.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				messages={messageOrGroup}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
			/>
		)
	}

	// Determine if this is the last message for status display purposes
	const nextMessage = index < groupedMessages.length - 1 && groupedMessages[index + 1]
	const isNextCheckpoint = !Array.isArray(nextMessage) && nextMessage && nextMessage?.say === "checkpoint_created"
	const isLastMessageGroup = isNextCheckpoint && index === groupedMessages.length - 2
	const isLast = index === groupedMessages.length - 1 || isLastMessageGroup

	// Get checkpoint message if it's the next message (for inline display with API request)
	// Only show checkpoint inline if the current message is an API request
	const nextCheckpointMessage =
		messageOrGroup.say === "api_req_started" &&
		isNextCheckpoint &&
		!Array.isArray(nextMessage) &&
		nextMessage?.say === "checkpoint_created"
			? nextMessage
			: undefined

	// Check if this API request resulted in tool calls by looking at subsequent messages
	// Also extract the tool names for display
	const { hasToolCalls, toolNames } = React.useMemo(() => {
		if (messageOrGroup.say !== "api_req_started") {
			return { hasToolCalls: false, toolNames: [] }
		}
		// Find the index of this message in modifiedMessages
		const currentIndex = modifiedMessages.findIndex((m) => m.ts === messageOrGroup.ts)
		if (currentIndex === -1) {
			return { hasToolCalls: false, toolNames: [] }
		}

		const toolNamesSet = new Set<string>()
		// Check if there are any tool messages after this API request (within next 10 messages to avoid checking too far)
		for (let i = currentIndex + 1; i < Math.min(currentIndex + 11, modifiedMessages.length); i++) {
			const msg = modifiedMessages[i]
			// Stop checking if we hit another API request
			if (msg.say === "api_req_started") {
				break
			}
			// Check if this is a tool message and extract tool name
			if (msg.ask === "tool" || msg.say === "tool") {
				try {
					const tool = JSON.parse(msg.text || "{}") as { tool?: string }
					if (tool.tool) {
						toolNamesSet.add(tool.tool)
					}
				} catch {
					// Ignore parse errors
				}
			} else if (msg.ask === "command") {
				toolNamesSet.add("command")
			} else if (msg.ask === "use_mcp_server") {
				toolNamesSet.add("use_mcp_server")
			} else if (msg.ask === "browser_action_launch") {
				toolNamesSet.add("browser_action_launch")
			}
		}

		return {
			hasToolCalls: toolNamesSet.size > 0,
			toolNames: Array.from(toolNamesSet),
		}
	}, [messageOrGroup, modifiedMessages])

	// Regular message
	return (
		<div
			className={cn({
				"pb-2.5": isLast,
			})}
			data-message-ts={messageOrGroup.ts}>
			<ChatRow
				hasToolCalls={hasToolCalls}
				inputValue={inputValue}
				isExpanded={expandedRows[messageOrGroup.ts] || false}
				isLast={isLast}
				key={messageOrGroup.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				message={messageOrGroup}
				nextCheckpointMessage={nextCheckpointMessage}
				onCancelCommand={() => messageHandlers.executeButtonAction("cancel")}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
				sendMessageFromChatRow={messageHandlers.handleSendMessage}
				toolNames={toolNames}
			/>
		</div>
	)
}

/**
 * Factory function to create the itemContent callback for Virtuoso
 * This allows us to encapsulate the rendering logic while maintaining performance
 */
export const createMessageRenderer = (
	groupedMessages: (ClineMessage | ClineMessage[])[],
	modifiedMessages: ClineMessage[],
	expandedRows: Record<number, boolean>,
	onToggleExpand: (ts: number) => void,
	onHeightChange: (isTaller: boolean) => void,
	onSetQuote: (quote: string | null) => void,
	inputValue: string,
	messageHandlers: MessageHandlers,
) => {
	return (index: number, messageOrGroup: ClineMessage | ClineMessage[]) => (
		<MessageRenderer
			expandedRows={expandedRows}
			groupedMessages={groupedMessages}
			index={index}
			inputValue={inputValue}
			messageHandlers={messageHandlers}
			messageOrGroup={messageOrGroup}
			modifiedMessages={modifiedMessages}
			onHeightChange={onHeightChange}
			onSetQuote={onSetQuote}
			onToggleExpand={onToggleExpand}
		/>
	)
}
