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
	assessingSections?: Set<string>
	assessingOutputSections?: Set<string>
	generatingSections?: Set<string>
}

interface SectionNodeProps {
	section: CtdSection
	allSections: Map<string, CtdSection>
	level: number
	onSectionSelect?: (sectionId: string) => void
	onAssess?: (sectionId: string) => void
	onAssessOutput?: (sectionId: string) => void
	onGenerate?: (sectionId: string) => void
	assessingSections?: Set<string>
	assessingOutputSections?: Set<string>
	generatingSections?: Set<string>
}

const SectionNode = ({
	section,
	allSections,
	level,
	onSectionSelect,
	onAssess,
	onAssessOutput,
	onGenerate,
	assessingSections,
	assessingOutputSections,
	generatingSections,
}: SectionNodeProps) => {
	const [isExpanded, setIsExpanded] = useState(level < 2) // Auto-expand first 2 levels
	const isLeaf = !section.children || section.children.length === 0
	const hasChildren = section.children && section.children.length > 0
	// Sections that should show buttons even if they're not leaf nodes
	const intermediateSectionsWithButtons = ["2.3", "2.5"]
	const showButtons = isLeaf || intermediateSectionsWithButtons.includes(section.id)
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
				{showButtons && (
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
								key={childId}
								level={level + 1}
								onAssess={onAssess}
								onAssessOutput={onAssessOutput}
								onGenerate={onGenerate}
								onSectionSelect={onSectionSelect}
								section={childSection}
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
	assessingSections,
	assessingOutputSections,
	generatingSections,
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
									key={section.id}
									level={0}
									onAssess={onAssess}
									onAssessOutput={onAssessOutput}
									onGenerate={onGenerate}
									onSectionSelect={onSectionSelect}
									section={section}
								/>
							))}
						</div>
					</div>
				)
			})}
		</div>
	)
}
