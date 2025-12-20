import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { ChevronDown, ChevronRight, ExternalLink, FileText, Loader2 } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

interface Paper {
	title: string
	url: string
	pmid: string
	abstract: string
	authors: string[]
	journal: string
	year: string
	alsoRelevantTo?: string[]
	relevanceReason?: string
}

interface Section {
	title: string
	description: string
	papers: Paper[]
}

interface CombinedPapersResult {
	drugName: string
	regulationSection: string
	sections: Record<string, Section>
	summary: {
		totalUniquePapers: number
		totalMentions: number
		papersBySection: Record<string, number>
		sectionsProcessed: string[]
	}
	combinedAt: string
}

interface Section53PaperSelectionProps {
	result: CombinedPapersResult
	onGenerate: (selectedPapers: Array<{ sectionId: string; pmid: string }>) => void
	onBack: () => void
	isGenerating?: boolean
}

interface PaperItemProps {
	paper: Paper
	sectionId: string
	isSelected: boolean
	onToggle: (sectionId: string, pmid: string) => void
}

const PaperItem = ({ paper, sectionId, isSelected, onToggle }: PaperItemProps) => {
	const [isExpanded, setIsExpanded] = useState(false)

	return (
		<div
			className={`border rounded-md p-3 mb-2 ${isSelected ? "border-(--vscode-focusBorder) bg-(--vscode-list-activeSelectionBackground)/20" : "border-(--vscode-panel-border)"}`}>
			<div className="flex items-start gap-3">
				<VSCodeCheckbox checked={isSelected} onChange={() => onToggle(sectionId, paper.pmid)} />
				<div className="flex-1 min-w-0">
					<div className="flex items-start justify-between gap-2">
						<h4
							className="text-sm font-medium text-(--vscode-foreground) cursor-pointer hover:underline"
							onClick={() => setIsExpanded(!isExpanded)}>
							{paper.title}
						</h4>
						{paper.url && (
							<a
								className="text-(--vscode-textLink-foreground) hover:text-(--vscode-textLink-activeForeground) flex-shrink-0"
								href={paper.url}
								rel="noopener noreferrer"
								target="_blank"
								title="Open in PubMed">
								<ExternalLink className="w-4 h-4" />
							</a>
						)}
					</div>

					<div className="text-xs text-(--vscode-descriptionForeground) mt-1">
						{paper.authors.length > 0 && <span>{paper.authors.join(", ")}</span>}
						{paper.journal && (
							<span>
								{paper.authors.length > 0 ? " • " : ""}
								{paper.journal}
							</span>
						)}
						{paper.year && <span> ({paper.year})</span>}
						{paper.pmid && <span className="ml-2 text-(--vscode-badge-foreground)">PMID: {paper.pmid}</span>}
					</div>

					{paper.relevanceReason && (
						<div className="text-xs text-(--vscode-charts-green) mt-1 italic">✓ {paper.relevanceReason}</div>
					)}

					{paper.alsoRelevantTo && paper.alsoRelevantTo.length > 0 && (
						<div className="text-xs text-(--vscode-descriptionForeground) mt-1">
							Also relevant to: {paper.alsoRelevantTo.join(", ")}
						</div>
					)}

					{isExpanded && paper.abstract && (
						<div className="mt-2 text-xs text-(--vscode-foreground) p-2 bg-(--vscode-editor-background) rounded border border-(--vscode-panel-border)">
							<strong>Abstract:</strong> {paper.abstract}
						</div>
					)}

					<button
						className="text-xs text-(--vscode-textLink-foreground) hover:underline mt-1"
						onClick={() => setIsExpanded(!isExpanded)}>
						{isExpanded ? "Hide abstract" : "Show abstract"}
					</button>
				</div>
			</div>
		</div>
	)
}

interface SectionGroupProps {
	sectionId: string
	section: Section
	selectedPapers: Set<string>
	onTogglePaper: (sectionId: string, pmid: string) => void
	onSelectAll: (sectionId: string) => void
	onDeselectAll: (sectionId: string) => void
}

const SectionGroup = ({ sectionId, section, selectedPapers, onTogglePaper, onSelectAll, onDeselectAll }: SectionGroupProps) => {
	const [isExpanded, setIsExpanded] = useState(true)

	const sectionSelectedCount = section.papers.filter((p) => selectedPapers.has(`${sectionId}:${p.pmid}`)).length
	const allSelected = sectionSelectedCount === section.papers.length && section.papers.length > 0

	return (
		<div className="mb-4">
			<div
				className="flex items-center gap-2 p-2 bg-(--vscode-sideBar-background) rounded cursor-pointer hover:bg-(--vscode-list-hoverBackground)"
				onClick={() => setIsExpanded(!isExpanded)}>
				{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
				<FileText className="w-4 h-4 text-(--vscode-icon-foreground)" />
				<span className="font-medium text-sm text-(--vscode-foreground)">
					{sectionId}: {section.title}
				</span>
				<span className="text-xs text-(--vscode-badge-foreground) bg-(--vscode-badge-background) px-2 py-0.5 rounded-full">
					{sectionSelectedCount}/{section.papers.length}
				</span>
			</div>

			{isExpanded && (
				<div className="ml-6 mt-2">
					{section.papers.length > 0 ? (
						<>
							<div className="flex gap-2 mb-2">
								<button
									className="text-xs text-(--vscode-textLink-foreground) hover:underline"
									disabled={allSelected}
									onClick={(e) => {
										e.stopPropagation()
										onSelectAll(sectionId)
									}}>
									Select All
								</button>
								<span className="text-(--vscode-descriptionForeground)">|</span>
								<button
									className="text-xs text-(--vscode-textLink-foreground) hover:underline"
									disabled={sectionSelectedCount === 0}
									onClick={(e) => {
										e.stopPropagation()
										onDeselectAll(sectionId)
									}}>
									Deselect All
								</button>
							</div>
							{section.papers.map((paper) => (
								<PaperItem
									isSelected={selectedPapers.has(`${sectionId}:${paper.pmid}`)}
									key={paper.pmid}
									onToggle={onTogglePaper}
									paper={paper}
									sectionId={sectionId}
								/>
							))}
						</>
					) : (
						<div className="text-sm text-(--vscode-descriptionForeground) italic p-2">
							No relevant papers found for this section
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export const Section53PaperSelection = ({ result, onGenerate, onBack, isGenerating }: Section53PaperSelectionProps) => {
	// Track selected papers as Set of "sectionId:pmid"
	const [selectedPapers, setSelectedPapers] = useState<Set<string>>(() => {
		// Initially select all papers
		const allPapers = new Set<string>()
		for (const [sectionId, section] of Object.entries(result.sections)) {
			for (const paper of section.papers) {
				allPapers.add(`${sectionId}:${paper.pmid}`)
			}
		}
		return allPapers
	})

	const handleTogglePaper = useCallback((sectionId: string, pmid: string) => {
		const key = `${sectionId}:${pmid}`
		setSelectedPapers((prev) => {
			const next = new Set(prev)
			if (next.has(key)) {
				next.delete(key)
			} else {
				next.add(key)
			}
			return next
		})
	}, [])

	const handleSelectAll = useCallback(
		(sectionId: string) => {
			setSelectedPapers((prev) => {
				const next = new Set(prev)
				const section = result.sections[sectionId]
				if (section) {
					for (const paper of section.papers) {
						next.add(`${sectionId}:${paper.pmid}`)
					}
				}
				return next
			})
		},
		[result.sections],
	)

	const handleDeselectAll = useCallback((sectionId: string) => {
		setSelectedPapers((prev) => {
			const next = new Set(prev)
			for (const key of prev) {
				if (key.startsWith(`${sectionId}:`)) {
					next.delete(key)
				}
			}
			return next
		})
	}, [])

	const handleSelectAllSections = useCallback(() => {
		const allPapers = new Set<string>()
		for (const [sectionId, section] of Object.entries(result.sections)) {
			for (const paper of section.papers) {
				allPapers.add(`${sectionId}:${paper.pmid}`)
			}
		}
		setSelectedPapers(allPapers)
	}, [result.sections])

	const handleDeselectAllSections = useCallback(() => {
		setSelectedPapers(new Set())
	}, [])

	const handleGenerate = useCallback(() => {
		const selected = Array.from(selectedPapers).map((key) => {
			const [sectionId, pmid] = key.split(":")
			return { sectionId, pmid }
		})
		onGenerate(selected)
	}, [selectedPapers, onGenerate])

	const sortedSections = useMemo(() => {
		return Object.entries(result.sections).sort(([a], [b]) => a.localeCompare(b))
	}, [result.sections])

	const totalPapers = result.summary.totalUniquePapers
	const selectedCount = selectedPapers.size

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="p-4 border-b border-(--vscode-panel-border)">
				<div className="flex items-center justify-between mb-2">
					<h2 className="text-lg font-semibold text-(--vscode-foreground)">Section 5.3 Papers for {result.drugName}</h2>
					<VSCodeButton appearance="secondary" onClick={onBack}>
						Back
					</VSCodeButton>
				</div>
				<div className="text-sm text-(--vscode-descriptionForeground)">
					Found {totalPapers} unique papers across {result.summary.sectionsProcessed.length} subsections.
					<span className="ml-2 font-medium text-(--vscode-foreground)">{selectedCount} selected for generation.</span>
				</div>
				<div className="flex gap-2 mt-2">
					<button
						className="text-xs text-(--vscode-textLink-foreground) hover:underline"
						onClick={handleSelectAllSections}>
						Select All Papers
					</button>
					<span className="text-(--vscode-descriptionForeground)">|</span>
					<button
						className="text-xs text-(--vscode-textLink-foreground) hover:underline"
						onClick={handleDeselectAllSections}>
						Deselect All
					</button>
				</div>
			</div>

			{/* Paper List */}
			<div className="flex-1 overflow-auto p-4">
				{sortedSections.map(([sectionId, section]) => (
					<SectionGroup
						key={sectionId}
						onDeselectAll={handleDeselectAll}
						onSelectAll={handleSelectAll}
						onTogglePaper={handleTogglePaper}
						section={section}
						sectionId={sectionId}
						selectedPapers={selectedPapers}
					/>
				))}
			</div>

			{/* Footer */}
			<div className="p-4 border-t border-(--vscode-panel-border) flex justify-between items-center">
				<div className="text-sm text-(--vscode-descriptionForeground)">
					Last updated: {new Date(result.combinedAt).toLocaleString()}
				</div>
				<VSCodeButton disabled={selectedCount === 0 || isGenerating} onClick={handleGenerate}>
					{isGenerating ? (
						<>
							<Loader2 className="w-4 h-4 mr-2 animate-spin" />
							Generating...
						</>
					) : (
						`Generate with ${selectedCount} Papers`
					)}
				</VSCodeButton>
			</div>
		</div>
	)
}

export default Section53PaperSelection
