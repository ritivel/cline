import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import styled from "styled-components"

const PreviewContainer = styled.div`
	background-color: var(--muted);
	border: 1px solid var(--border);
	padding: 8px 12px;
	margin: 0;
	border-radius: 0.5rem 0.5rem 0 0;
	display: flex;
	position: relative;
	transition: all 0.15s ease;
`

const ContentRow = styled.div`
	background-color: transparent;
	border-radius: 0;
	padding: 0;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	width: 100%;
	gap: 8px;
`

const TextContainer = styled.div`
	flex: 1;
	margin: 0;
	white-space: pre-wrap;
	word-break: break-word;
	overflow: hidden;
	text-overflow: ellipsis;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	font-size: var(--text-sm);
	color: var(--muted-foreground);
	line-height: 1.5;
	max-height: calc(1.5 * var(--text-sm) * 2);
`

const DismissButton = styled(VSCodeButton)`
	flex-shrink: 0;
	min-width: 20px;
	height: 20px;
	padding: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 0.25rem;
	transition: all 0.15s ease;
	&:hover {
		background-color: var(--muted);
	}
`

const ReplyIcon = styled.span`
	color: var(--muted-foreground);
	margin-right: 6px;
	flex-shrink: 0;
	font-size: 14px;
`

interface QuotedMessagePreviewProps {
	text: string
	onDismiss: () => void
	isFocused?: boolean
}

const QuotedMessagePreview: React.FC<QuotedMessagePreviewProps> = ({ text, onDismiss, isFocused }) => {
	const _cardClassName = `reply-card ${isFocused ? "reply-card--focused" : ""}`

	return (
		<PreviewContainer>
			{/* Removed Label */}
			<ContentRow>
				<ReplyIcon className="codicon codicon-reply"></ReplyIcon>
				<TextContainer title={text}>{text}</TextContainer>
				<DismissButton appearance="icon" aria-label="Dismiss quote" onClick={onDismiss}>
					<span className="codicon codicon-close"></span>
				</DismissButton>
			</ContentRow>
		</PreviewContainer>
	)
}

export default QuotedMessagePreview
