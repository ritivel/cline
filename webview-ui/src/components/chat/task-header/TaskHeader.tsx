import { ClineMessage } from "@shared/ExtensionMessage"
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { getEnvironmentColor } from "@/utils/environmentColors"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import NewTaskButton from "./buttons/NewTaskButton"
import OpenDiskConversationHistoryButton from "./buttons/OpenDiskConversationHistoryButton"
import { CheckpointError } from "./CheckpointError"
import { FocusChain } from "./FocusChain"
import { highlightText } from "./Highlights"

const IS_DEV = process.env.IS_DEV === '"true"'
interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	lastApiReqTotalTokens?: number
	lastProgressMessageText?: string
	onClose: () => void
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const BUTTON_CLASS =
	"h-7 px-2.5 border-0 font-medium bg-transparent hover:bg-muted/50 rounded-md text-foreground transition-all duration-150 text-base"

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	lastProgressMessageText,
	onClose,
	onSendMessage,
}) => {
	const {
		currentTaskItem,
		checkpointManagerErrorMessage,
		navigateToSettings,
		expandTaskHeader: isTaskExpanded,
		setExpandTaskHeader: setIsTaskExpanded,
		environment,
	} = useExtensionState()

	const [isHighlightedTextExpanded, setIsHighlightedTextExpanded] = useState(false)
	const [isTextOverflowing, setIsTextOverflowing] = useState(false)
	const highlightedTextRef = React.useRef<HTMLDivElement>(null)

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])

	// Check if text overflows the container (i.e., needs clamping)
	useLayoutEffect(() => {
		const el = highlightedTextRef.current
		if (el && isTaskExpanded && !isHighlightedTextExpanded) {
			// Check if content height exceeds the max-height
			setIsTextOverflowing(el.scrollHeight > el.clientHeight)
		}
	}, [task.text, isTaskExpanded, isHighlightedTextExpanded])

	// Handle click outside to collapse
	React.useEffect(() => {
		if (!isHighlightedTextExpanded) {
			return
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (highlightedTextRef.current && !highlightedTextRef.current.contains(event.target as Node)) {
				setIsHighlightedTextExpanded(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [isHighlightedTextExpanded])

	// Event handlers
	const toggleTaskExpanded = () => setIsTaskExpanded(!isTaskExpanded)

	const handleCheckpointSettingsClick = useCallback(() => {
		navigateToSettings("features")
	}, [navigateToSettings])

	const environmentBorderColor = getEnvironmentColor(environment, "border")

	return (
		<div className="px-4 py-2 flex flex-col gap-2">
			{/* Display Checkpoint Error */}
			<CheckpointError
				checkpointManagerErrorMessage={checkpointManagerErrorMessage}
				handleCheckpointSettingsClick={handleCheckpointSettingsClick}
			/>
			{/* Task Header */}
			<div
				className={cn("relative overflow-hidden rounded-md flex flex-col transition-all duration-200", {
					"bg-card border border-border/50 shadow-sm": isTaskExpanded,
					"hover:bg-muted/30 cursor-pointer": !isTaskExpanded,
				})}
				style={
					!isTaskExpanded
						? {
								borderLeft: `3px solid ${environmentBorderColor}`,
							}
						: {
								borderColor: environmentBorderColor,
							}
				}>
				{/* Task Title and Actions - All on one line */}
				<div className="flex items-center gap-3 px-3 py-2">
					{/* Task text */}
					<div
						className={cn(
							"ph-no-capture text-md text-foreground/90 leading-relaxed flex-1 min-w-0",
							isTaskExpanded
								? "whitespace-pre-wrap break-words max-h-[4rem] overflow-hidden"
								: "whitespace-nowrap overflow-hidden text-ellipsis",
							{
								"max-h-[25vh] overflow-y-auto scroll-smooth": isHighlightedTextExpanded && isTaskExpanded,
								"cursor-pointer": isTextOverflowing && isTaskExpanded,
							},
						)}
						onClick={() => isTaskExpanded && isTextOverflowing && setIsHighlightedTextExpanded(true)}
						ref={highlightedTextRef}
						style={
							isTaskExpanded && !isHighlightedTextExpanded && isTextOverflowing
								? {
										WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
										maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
									}
								: undefined
						}>
						<span className={isTaskExpanded ? "" : "font-medium"}>{highlightedText}</span>
					</div>

					{/* Action buttons and thumbnails */}
					<div className="flex items-center gap-2 shrink-0">
						{isTaskExpanded && (
							<>
								{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
									<Thumbnails files={task.files ?? []} images={task.images ?? []} />
								)}
								<CopyTaskButton className={BUTTON_CLASS} taskText={task.text} />
								<DeleteTaskButton
									className={BUTTON_CLASS}
									taskId={currentTaskItem?.id}
									taskSize={currentTaskItem?.size}
								/>
								{/* Only visible in development mode */}
								{IS_DEV && (
									<OpenDiskConversationHistoryButton className={BUTTON_CLASS} taskId={currentTaskItem?.id} />
								)}
							</>
						)}
						<NewTaskButton className={BUTTON_CLASS} onClick={onClose} />
					</div>
				</div>
			</div>

			{/* Display Focus Chain To-Do List */}
			<FocusChain currentTaskItemId={currentTaskItem?.id} lastProgressMessageText={lastProgressMessageText} />
		</div>
	)
}

export default TaskHeader
