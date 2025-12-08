import { cn } from "@heroui/react"
import { StringRequest } from "@shared/proto/cline/common"
import React, { memo, useLayoutEffect, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { FileServiceClient } from "@/services/grpc-client"

interface ThumbnailsProps {
	images: string[]
	files: string[]
	style?: React.CSSProperties
	setImages?: React.Dispatch<React.SetStateAction<string[]>>
	setFiles?: React.Dispatch<React.SetStateAction<string[]>>
	onHeightChange?: (height: number) => void
	className?: string
}

const Thumbnails = ({ images, files, style, setImages, setFiles, onHeightChange, className }: ThumbnailsProps) => {
	const [hoveredIndex, setHoveredIndex] = useState<string | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const { width } = useWindowSize()

	useLayoutEffect(() => {
		if (containerRef.current) {
			let height = containerRef.current.clientHeight
			// some browsers return 0 for clientHeight
			if (!height) {
				height = containerRef.current.getBoundingClientRect().height
			}
			onHeightChange?.(height)
		}
		setHoveredIndex(null)
	}, [images, files, width, onHeightChange])

	const handleDeleteImages = (index: number) => {
		setImages?.((prevImages) => prevImages.filter((_, i) => i !== index))
	}

	const handleDeleteFiles = (index: number) => {
		const fileToRemove = files[index]
		setFiles?.((prevFiles) => prevFiles.filter((_, i) => i !== index))

		// If this is a markdown file with line range (added from markdown editor),
		// notify the markdown editor to clear the selection highlight
		if (fileToRemove && fileToRemove.includes(":") && fileToRemove.includes("|")) {
			const pipeIndex = fileToRemove.indexOf("|")
			const pathWithRange = fileToRemove.substring(0, pipeIndex)
			const colonIndex = pathWithRange.lastIndexOf(":")
			if (colonIndex !== -1) {
				const filePath = pathWithRange.substring(0, colonIndex)
				// Check if it's a markdown file
				if (filePath.endsWith(".md") || filePath.endsWith(".markdown")) {
					// Notify markdown editor to clear highlights for this file
					if (PLATFORM_CONFIG.type === PlatformType.VSCODE && PLATFORM_CONFIG.postMessage) {
						PLATFORM_CONFIG.postMessage({
							type: "clearMarkdownSelectionHighlights",
							filePath: filePath,
						})
					}
				}
			}
		}
	}

	const isDeletableImages = setImages !== undefined
	const isDeletableFiles = setFiles !== undefined

	const handleImageClick = (image: string) => {
		FileServiceClient.openImage(StringRequest.create({ value: image })).catch((err) =>
			console.error("Failed to open image:", err),
		)
	}

	const handleFileClick = (filePath: string) => {
		FileServiceClient.openFile(StringRequest.create({ value: filePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}

	return (
		<div
			className={cn("flex flex-wrap", className)}
			ref={containerRef}
			style={{
				gap: 5,
				rowGap: 3,
				...style,
			}}>
			{images.map((image, index) => (
				<div
					key={`image-${index}`}
					onMouseEnter={() => setHoveredIndex(`image-${index}`)}
					onMouseLeave={() => setHoveredIndex(null)}
					style={{ position: "relative" }}>
					<img
						alt={`Thumbnail image-${index + 1}`}
						onClick={() => handleImageClick(image)}
						src={image}
						style={{
							width: 34,
							height: 34,
							objectFit: "cover",
							borderRadius: 4,
							cursor: "pointer",
						}}
					/>
					{isDeletableImages && hoveredIndex === `image-${index}` && (
						<div
							onClick={() => handleDeleteImages(index)}
							style={{
								position: "absolute",
								top: -4,
								right: -4,
								width: 13,
								height: 13,
								borderRadius: "50%",
								backgroundColor: "var(--vscode-badge-background)",
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
								cursor: "pointer",
							}}>
							<span
								className="codicon codicon-close"
								style={{
									color: "var(--vscode-foreground)",
									fontSize: 10,
									fontWeight: "bold",
								}}></span>
						</div>
					)}
				</div>
			))}

			{files.map((fileEntry, index) => {
				// Parse file entry - supports formats:
				// - "filepath" (simple file)
				// - "filepath:startLine-endLine|text" (file with line range and text)
				const hasLineRange = fileEntry.includes(":") && fileEntry.includes("|")
				let filePath = fileEntry
				let lineRange = ""
				let selectedText = ""

				if (hasLineRange) {
					const pipeIndex = fileEntry.indexOf("|")
					const pathWithRange = fileEntry.substring(0, pipeIndex)
					selectedText = fileEntry.substring(pipeIndex + 1)

					const colonIndex = pathWithRange.lastIndexOf(":")
					if (colonIndex !== -1) {
						filePath = pathWithRange.substring(0, colonIndex)
						lineRange = pathWithRange.substring(colonIndex + 1)
					}
				}

				const fileName = filePath.split(/[\\/]/).pop() || filePath
				const displayName = lineRange ? `${fileName} (${lineRange})` : fileName

				// For files with line ranges, show as a pill/badge
				if (hasLineRange) {
					return (
						<div
							key={`file-${index}`}
							onMouseEnter={() => setHoveredIndex(`file-${index}`)}
							onMouseLeave={() => setHoveredIndex(null)}
							style={{ position: "relative" }}>
							<div
								onClick={() => handleFileClick(filePath)}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 6,
									padding: "4px 10px",
									borderRadius: 4,
									cursor: "pointer",
									backgroundColor: "var(--vscode-badge-background)",
									border: "1px solid var(--vscode-input-border)",
									maxWidth: 200,
								}}
								title={
									selectedText
										? `${filePath}\n\n${selectedText.substring(0, 200)}${selectedText.length > 200 ? "..." : ""}`
										: filePath
								}>
								<span
									className="codicon codicon-file-code"
									style={{
										fontSize: 14,
										color: "var(--vscode-badge-foreground)",
										flexShrink: 0,
									}}></span>
								<span
									style={{
										fontSize: 12,
										color: "var(--vscode-badge-foreground)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}>
									{displayName}
								</span>
							</div>
							{isDeletableFiles && hoveredIndex === `file-${index}` && (
								<div
									onClick={() => handleDeleteFiles(index)}
									style={{
										position: "absolute",
										top: -4,
										right: -4,
										width: 13,
										height: 13,
										borderRadius: "50%",
										backgroundColor: "var(--vscode-errorForeground)",
										display: "flex",
										justifyContent: "center",
										alignItems: "center",
										cursor: "pointer",
									}}>
									<span
										className="codicon codicon-close"
										style={{
											color: "var(--vscode-editor-background)",
											fontSize: 10,
											fontWeight: "bold",
										}}></span>
								</div>
							)}
						</div>
					)
				}

				// Regular file display (no line range)
				return (
					<div
						key={`file-${index}`}
						onMouseEnter={() => setHoveredIndex(`file-${index}`)}
						onMouseLeave={() => setHoveredIndex(null)}
						style={{ position: "relative" }}>
						<div
							onClick={() => handleFileClick(filePath)}
							style={{
								width: 34,
								height: 34,
								borderRadius: 4,
								cursor: "pointer",
								backgroundColor: "var(--vscode-editor-background)",
								border: "1px solid var(--vscode-input-border)",
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								justifyContent: "center",
							}}>
							<span
								className="codicon codicon-file"
								style={{
									fontSize: 16,
									color: "var(--vscode-foreground)",
								}}></span>
							<span
								style={{
									fontSize: 7,
									marginTop: 1,
									overflow: "hidden",
									textOverflow: "ellipsis",
									maxWidth: "90%",
									whiteSpace: "nowrap",
									textAlign: "center",
								}}
								title={fileName}>
								{fileName}
							</span>
						</div>
						{isDeletableFiles && hoveredIndex === `file-${index}` && (
							<div
								onClick={() => handleDeleteFiles(index)}
								style={{
									position: "absolute",
									top: -4,
									right: -4,
									width: 13,
									height: 13,
									borderRadius: "50%",
									backgroundColor: "var(--vscode-badge-background)",
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									cursor: "pointer",
								}}>
								<span
									className="codicon codicon-close"
									style={{
										color: "var(--vscode-foreground)",
										fontSize: 10,
										fontWeight: "bold",
									}}></span>
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}

export default memo(Thumbnails)
