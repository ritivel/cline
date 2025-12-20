import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ChevronDown, ChevronRight, FileText, Loader2 } from "lucide-react"
import { useCallback, useState } from "react"

interface CtdSection {
	id: string
	title: string
	children: string[]
}

interface CtdModule {
	moduleNumber: number
	title: string
	description: string
	sections: CtdSection[]
}

interface CtdStructure {
	name: string
	description: string
	region: string
	modules: CtdModule[]
}

interface CtdFolderTreeProps {
	structure: CtdStructure | null
	onSectionSelect?: (sectionId: string) => void
	onAssess?: (sectionId: string) => void
	onAssessOutput?: (sectionId: string) => void
	onGenerate?: (sectionId: string) => void
	onAssessSection53?: () => void
	onGenerateSection53?: () => void
	onGenerateSection25?: () => void
	onGenerateSection27?: () => void
	assessingSections?: Set<string>
	assessingOutputSections?: Set<string>
	generatingSections?: Set<string>
	isAssessingSection53?: boolean
	isGeneratingSection53?: boolean
	isGeneratingSection25?: boolean
	isGeneratingSection27?: boolean
	section53PaperCount?: number // Total papers assessed for section 5.3
	section53Assessed?: boolean // Whether section 5.3 has been assessed
}

interface SectionNodeProps {
	section: CtdSection
	allSections: Map<string, CtdSection>
	level: number
	onSectionSelect?: (sectionId: string) => void
	onAssess?: (sectionId: string) => void
	onAssessOutput?: (sectionId: string) => void
	onGenerate?: (sectionId: string) => void
	onAssessSection53?: () => void
	onGenerateSection53?: () => void
	onGenerateSection25?: () => void
	onGenerateSection27?: () => void
	assessingSections?: Set<string>
	assessingOutputSections?: Set<string>
	generatingSections?: Set<string>
	isAssessingSection53?: boolean
	isGeneratingSection53?: boolean
	isGeneratingSection25?: boolean
	isGeneratingSection27?: boolean
	section53PaperCount?: number
	section53Assessed?: boolean
}

const SectionNode = ({
	section,
	allSections,
	level,
	onSectionSelect,
	onAssess,
	onAssessOutput,
	onGenerate,
	onAssessSection53,
	onGenerateSection53,
	onGenerateSection25,
	onGenerateSection27,
	assessingSections,
	assessingOutputSections,
	generatingSections,
	isAssessingSection53,
	isGeneratingSection53,
	isGeneratingSection25,
	isGeneratingSection27,
	section53PaperCount,
	section53Assessed,
}: SectionNodeProps) => {
	const [isExpanded, setIsExpanded] = useState(level < 2) // Auto-expand first 2 levels
	const isLeaf = !section.children || section.children.length === 0
	const hasChildren = section.children && section.children.length > 0
	// Sections that should show buttons even if they're not leaf nodes
	const intermediateSectionsWithButtons = ["2.3", "2.5"]
	// Section 5.3 has special handling - show buttons on parent
	const isSection53Parent = section.id === "5.3"
	const isSection53Child = section.id.startsWith("5.3.") && section.id !== "5.3"
	// Section 2.5 has special handling - single generate button
	const isSection25Parent = section.id === "2.5"
	const isSection25Child = section.id.startsWith("2.5.") && section.id !== "2.5"
	// Section 2.7 has special handling - single generate button
	const isSection27Parent = section.id === "2.7"
	const isSection27Child = section.id.startsWith("2.7.") && section.id !== "2.7"
	// Sections that should never show buttons
	const isSection1 = section.id === "1" || section.id.startsWith("1.")
	const isSection24 = section.id === "2.4" || section.id.startsWith("2.4.")
	const isSection26 = section.id === "2.6" || section.id.startsWith("2.6.")
	const hideButtonsCompletely = isSection1 || isSection24 || isSection26
	const showButtons = isLeaf || intermediateSectionsWithButtons.includes(section.id) || isSection53Parent
	// Hide buttons for 5.3.x, 2.5.x, and 2.7.x subsections (they use parent's generate)
	const hideButtonsFor53Child = isSection53Child
	const hideButtonsFor25Child = isSection25Child
	const hideButtonsFor27Child = isSection27Child
	const isAssessing = assessingSections?.has(section.id) || false
	const isAssessingOutput = assessingOutputSections?.has(section.id) || false
	const isGenerating = generatingSections?.has(section.id) || false

	const handleToggle = useCallback(() => {
		if (hasChildren) {
			setIsExpanded(!isExpanded)
		}
	}, [hasChildren, isExpanded])

	const handleClick = useCallback(() => {
		if (onSectionSelect) {
			onSectionSelect(section.id)
		}
	}, [onSectionSelect, section.id])

	const handleAssess = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (onAssess) {
				onAssess(section.id)
			}
		},
		[onAssess, section.id],
	)

	const handleAssessOutput = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (onAssessOutput) {
				onAssessOutput(section.id)
			}
		},
		[onAssessOutput, section.id],
	)

	const handleGenerate = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (onGenerate) {
				onGenerate(section.id)
			}
		},
		[onGenerate, section.id],
	)

	const indent = level * 20

	return (
		<div>
			<div
				className="flex items-center gap-2 py-1 px-2 hover:bg-(--vscode-list-hoverBackground) cursor-pointer rounded"
				onClick={handleClick}
				style={{ paddingLeft: `${indent + 8}px` }}>
				{hasChildren ? (
					<button
						className="flex items-center justify-center w-5 h-5 hover:bg-(--vscode-button-hoverBackground) rounded"
						onClick={(e) => {
							e.stopPropagation()
							handleToggle()
						}}>
						{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
					</button>
				) : (
					<div className="w-5" />
				)}
				<FileText className="w-5 h-5 text-(--vscode-icon-foreground)" />
				<span className="font-medium text-base">{section.id}</span>
				<span className="text-sm text-(--vscode-descriptionForeground) flex-1 truncate">{section.title}</span>
				{/* Section 5.3 parent has special Assess button for paper search */}
				{isSection53Parent && onGenerateSection53 && (
					<div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
						{/* Only show Assess Papers button if papers haven't been assessed yet */}
						{!section53PaperCount && onAssessSection53 && (
							<VSCodeButton
								appearance="secondary"
								disabled={isAssessingSection53 || isGeneratingSection53}
								onClick={(e: React.MouseEvent) => {
									e.stopPropagation()
									onAssessSection53()
								}}
								style={{ minWidth: "120px", height: "28px", fontSize: "13px" }}>
								{isAssessingSection53 ? (
									<>
										<Loader2 className="w-4 h-4 mr-1 animate-spin" />
										Searching Papers...
									</>
								) : (
									"Assess Papers"
								)}
							</VSCodeButton>
						)}
						<VSCodeButton
							appearance="secondary"
							disabled={isAssessingSection53 || isGeneratingSection53}
							onClick={(e: React.MouseEvent) => {
								e.stopPropagation()
								onGenerateSection53()
							}}
							style={{ minWidth: section53PaperCount ? "160px" : "90px", height: "28px", fontSize: "13px" }}>
							{isAssessingSection53 ? (
								<>
									<Loader2 className="w-4 h-4 mr-1 animate-spin" />
									Searching Papers...
								</>
							) : isGeneratingSection53 ? (
								<>
									<Loader2 className="w-4 h-4 mr-1 animate-spin" />
									Generating...
								</>
							) : section53PaperCount ? (
								`Generate using ${section53PaperCount} papers`
							) : (
								"Generate"
							)}
						</VSCodeButton>
					</div>
				)}
				{/* Section 2.5 parent has special Generate button that uses Section 5.3 papers */}
				{isSection25Parent && onGenerateSection25 && (
					<div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
						<VSCodeButton
							appearance="secondary"
							disabled={isGeneratingSection25}
							onClick={(e: React.MouseEvent) => {
								e.stopPropagation()
								onGenerateSection25()
							}}
							style={{ minWidth: "180px", height: "28px", fontSize: "13px" }}>
							{isGeneratingSection25 ? (
								<>
									<Loader2 className="w-4 h-4 mr-1 animate-spin" />
									Generating...
								</>
							) : section53Assessed ? (
								"Generate Clinical Overview"
							) : (
								"Generate (Assess 5.3 first)"
							)}
						</VSCodeButton>
					</div>
				)}
				{/* Section 2.7 parent has special Generate button that uses Section 5.3 papers */}
				{isSection27Parent && onGenerateSection27 && (
					<div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
						<VSCodeButton
							appearance="secondary"
							disabled={isGeneratingSection27}
							onClick={(e: React.MouseEvent) => {
								e.stopPropagation()
								onGenerateSection27()
							}}
							style={{ minWidth: "180px", height: "28px", fontSize: "13px" }}>
							{isGeneratingSection27 ? (
								<>
									<Loader2 className="w-4 h-4 mr-1 animate-spin" />
									Generating...
								</>
							) : section53Assessed ? (
								"Generate Clinical Summary"
							) : (
								"Generate (Assess 5.3 first)"
							)}
						</VSCodeButton>
					</div>
				)}
				{/* Regular sections (not 5.3 parent or 5.3.x children or 2.5 parent or 2.5.x children or 2.7 parent or 2.7.x children or sections without buttons) show normal buttons */}
				{showButtons &&
					!isSection53Parent &&
					!hideButtonsFor53Child &&
					!isSection25Parent &&
					!hideButtonsFor25Child &&
					!isSection27Parent &&
					!hideButtonsFor27Child &&
					!hideButtonsCompletely && (
						<div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
							<VSCodeButton
								appearance="secondary"
								disabled={isAssessing || isAssessingOutput || isGenerating}
								onClick={handleAssess}
								style={{ minWidth: "90px", height: "28px", fontSize: "13px" }}>
								{isAssessing ? (
									<>
										<Loader2 className="w-4 h-4 mr-1 animate-spin" />
										Assessing...
									</>
								) : (
									"Assess"
								)}
							</VSCodeButton>
							<VSCodeButton
								appearance="secondary"
								disabled={isAssessing || isAssessingOutput || isGenerating}
								onClick={handleGenerate}
								style={{ minWidth: "90px", height: "28px", fontSize: "13px" }}>
								{isGenerating ? (
									<>
										<Loader2 className="w-4 h-4 mr-1 animate-spin" />
										Generating...
									</>
								) : (
									"Generate"
								)}
							</VSCodeButton>
							{onAssessOutput && (
								<VSCodeButton
									appearance="secondary"
									disabled={isAssessing || isAssessingOutput || isGenerating}
									onClick={handleAssessOutput}
									style={{ minWidth: "90px", height: "28px", fontSize: "13px" }}>
									{isAssessingOutput ? (
										<>
											<Loader2 className="w-4 h-4 mr-1 animate-spin" />
											Reviewing...
										</>
									) : (
										"Review"
									)}
								</VSCodeButton>
							)}
						</div>
					)}
			</div>
			{hasChildren && isExpanded && (
				<div>
					{section.children.map((childId) => {
						const childSection = allSections.get(childId)
						if (!childSection) return null
						return (
							<SectionNode
								allSections={allSections}
								assessingOutputSections={assessingOutputSections}
								assessingSections={assessingSections}
								generatingSections={generatingSections}
								isAssessingSection53={isAssessingSection53}
								isGeneratingSection25={isGeneratingSection25}
								isGeneratingSection27={isGeneratingSection27}
								isGeneratingSection53={isGeneratingSection53}
								key={childId}
								level={level + 1}
								onAssess={onAssess}
								onAssessOutput={onAssessOutput}
								onAssessSection53={onAssessSection53}
								onGenerate={onGenerate}
								onGenerateSection25={onGenerateSection25}
								onGenerateSection27={onGenerateSection27}
								onGenerateSection53={onGenerateSection53}
								onSectionSelect={onSectionSelect}
								section={childSection}
								section53Assessed={section53Assessed}
								section53PaperCount={section53PaperCount}
							/>
						)
					})}
				</div>
			)}
		</div>
	)
}

export const CtdFolderTree = ({
	structure,
	onSectionSelect,
	onAssess,
	onAssessOutput,
	onGenerate,
	onAssessSection53,
	onGenerateSection53,
	onGenerateSection25,
	onGenerateSection27,
	assessingSections,
	assessingOutputSections,
	generatingSections,
	isAssessingSection53,
	isGeneratingSection53,
	isGeneratingSection25,
	isGeneratingSection27,
	section53PaperCount,
	section53Assessed,
}: CtdFolderTreeProps) => {
	if (!structure) {
		return <div className="p-4 text-base text-(--vscode-descriptionForeground)">Loading CTD structure...</div>
	}

	// Build a map of all sections for quick lookup
	const allSections = new Map<string, CtdSection>()
	structure.modules.forEach((module) => {
		module.sections.forEach((section) => {
			allSections.set(section.id, section)
		})
	})

	// Find top-level sections (sections that are not children of any other section)
	const topLevelSections = new Set<string>()
	structure.modules.forEach((module) => {
		module.sections.forEach((section) => {
			topLevelSections.add(section.id)
		})
	})

	// Remove sections that are children of other sections
	structure.modules.forEach((module) => {
		module.sections.forEach((section) => {
			if (section.children) {
				section.children.forEach((childId) => {
					topLevelSections.delete(childId)
				})
			}
		})
	})

	return (
		<div className="flex flex-col h-full">
			{structure.modules.map((module) => {
				const moduleTopLevelSections = module.sections.filter((section) => topLevelSections.has(section.id))

				return (
					<div className="mb-4" key={module.moduleNumber}>
						<div className="mb-2 p-2 bg-(--vscode-editor-background) border border-(--vscode-panel-border) rounded">
							<h3 className="font-semibold text-base">
								Module {module.moduleNumber}: {module.title}
							</h3>
							<p className="text-sm text-(--vscode-descriptionForeground) mt-1">{module.description}</p>
						</div>
						<div className="space-y-0">
							{moduleTopLevelSections.map((section) => (
								<SectionNode
									allSections={allSections}
									assessingOutputSections={assessingOutputSections}
									assessingSections={assessingSections}
									generatingSections={generatingSections}
									isAssessingSection53={isAssessingSection53}
									isGeneratingSection25={isGeneratingSection25}
									isGeneratingSection27={isGeneratingSection27}
									isGeneratingSection53={isGeneratingSection53}
									key={section.id}
									level={0}
									onAssess={onAssess}
									onAssessOutput={onAssessOutput}
									onAssessSection53={onAssessSection53}
									onGenerate={onGenerate}
									onGenerateSection25={onGenerateSection25}
									onGenerateSection27={onGenerateSection27}
									onGenerateSection53={onGenerateSection53}
									onSectionSelect={onSectionSelect}
									section={section}
									section53Assessed={section53Assessed}
									section53PaperCount={section53PaperCount}
								/>
							))}
						</div>
					</div>
				)
			})}
		</div>
	)
}
