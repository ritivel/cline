import { StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { UiServiceClient } from "@/services/grpc-client"

interface Section53Paper {
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

interface Section53Section {
	title: string
	description: string
	papers: Section53Paper[]
}

interface Section53Result {
	drugName: string
	regulationSection: string
	sections: Record<string, Section53Section>
	summary: {
		totalUniquePapers: number
		totalMentions: number
		papersBySection: Record<string, number>
		sectionsProcessed: string[]
		deduplicationStats?: {
			duplicatesFound: number
			papersRemoved: number
		}
	}
	combinedAt: string
}

type CachedPapersResponse = { success: true; result: Section53Result } | { success: false; error: string }

type AssessPapersResponse = { success: true; result: Section53Result } | { success: false; error: string }

function formatReferenceDetails(paper: Section53Paper): string {
	const parts: string[] = []

	const journal = paper.journal?.trim()
	const year = paper.year?.trim()
	if (journal) {
		parts.push(year ? `${journal}, ${year}` : journal)
	} else if (year) {
		parts.push(year)
	}

	if (paper.authors && paper.authors.length > 0) {
		const authors = paper.authors.join(", ")
		parts.push(authors)
	}

	return parts.join(" • ")
}

export const Section52ClinicalStudies = ({ product }: { product: RegulatoryProductConfig }) => {
	const [loading, setLoading] = useState(true)
	const [assessing, setAssessing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [result, setResult] = useState<Section53Result | null>(null)

	const loadCached = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await UiServiceClient.getSection53Papers(
				StringRequest.create({
					value: JSON.stringify({
						drugName: product.drugName,
						productPath: product.submissionsPath,
					}),
				}),
			)

			const parsed = JSON.parse(response.value || "{}") as CachedPapersResponse
			if (parsed.success) {
				setResult(parsed.result)
				setError(null)
			} else {
				setResult(null)
				setError(parsed.error || "No cached papers found. Please assess Section 5.3 papers first.")
			}
		} catch (e: any) {
			setResult(null)
			setError(e?.message || "Failed to load cached Section 5.3 papers.")
		} finally {
			setLoading(false)
		}
	}, [product.drugName, product.submissionsPath])

	useEffect(() => {
		loadCached()
	}, [loadCached])

	const handleAssess = useCallback(async () => {
		setAssessing(true)
		setError(null)
		try {
			const response = await UiServiceClient.assessSection53Papers(
				StringRequest.create({
					value: JSON.stringify({
						drugName: product.drugName,
						productPath: product.submissionsPath,
					}),
				}),
			)

			const parsed = JSON.parse(response.value || "{}") as AssessPapersResponse
			if (parsed.success) {
				setResult(parsed.result)
			} else {
				setError(parsed.error || "Failed to assess Section 5.3 papers.")
			}
		} catch (e: any) {
			setError(e?.message || "Failed to assess Section 5.3 papers.")
		} finally {
			setAssessing(false)
		}
	}, [product.drugName, product.submissionsPath])

	const papers = useMemo(() => {
		if (!result) return []
		const flattened: Section53Paper[] = []
		const seen = new Set<string>()
		for (const section of Object.values(result.sections || {})) {
			for (const paper of section.papers || []) {
				const key = paper.pmid || paper.url || paper.title
				if (!key || seen.has(key)) continue
				seen.add(key)
				flattened.push(paper)
			}
		}
		return flattened
	}, [result])

	if (loading) {
		return (
			<div className="flex items-center justify-center p-8">
				<Loader2 className="w-6 h-6 animate-spin text-(--vscode-icon-foreground)" />
				<span className="ml-2 text-base text-(--vscode-descriptionForeground)">
					Loading Section 5.2 clinical studies…
				</span>
			</div>
		)
	}

	if (!result) {
		return (
			<div className="p-4">
				<div className="p-3 border border-(--vscode-panel-border) rounded bg-(--vscode-editor-background)">
					<p className="text-base text-(--vscode-foreground) font-medium">
						Section 5.2 requires Section 5.3 papers to be assessed first.
					</p>
					<p className="text-sm text-(--vscode-descriptionForeground) mt-1">
						{error ||
							"Click the “Assess Papers” button under Section 5.3, or use the button below to run the assessment now."}
					</p>
					<div className="flex items-center gap-2 mt-3">
						<VSCodeButton disabled={assessing} onClick={handleAssess}>
							{assessing ? "Assessing 5.3 Papers..." : "Assess 5.3 Papers"}
						</VSCodeButton>
						<VSCodeButton appearance="secondary" disabled={assessing} onClick={loadCached}>
							<RefreshCw className="w-4 h-4 mr-2" />
							Check again
						</VSCodeButton>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			<div className="p-4 border-b border-(--vscode-panel-border)">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h3 className="font-semibold text-base">5.2 Tabular Listing of all Clinical Studies</h3>
						<div className="text-sm text-(--vscode-descriptionForeground) mt-1">
							Showing {papers.length} studies from cached Section 5.3 paper assessment for {result.drugName}. Last
							updated: {new Date(result.combinedAt).toLocaleString()}.
						</div>
					</div>
					<div className="flex gap-2">
						<VSCodeButton appearance="secondary" disabled={assessing} onClick={loadCached}>
							<RefreshCw className="w-4 h-4 mr-2" />
							Refresh
						</VSCodeButton>
					</div>
				</div>
			</div>

			<div className="flex-1 overflow-auto p-4">
				<div className="border border-(--vscode-panel-border) rounded overflow-hidden">
					<table className="w-full text-sm">
						<thead className="bg-(--vscode-sideBar-background)">
							<tr className="text-left">
								<th className="p-2 border-b border-(--vscode-panel-border)" style={{ width: "80px" }}>
									Sr No.
								</th>
								<th className="p-2 border-b border-(--vscode-panel-border)">Study / Design</th>
								<th className="p-2 border-b border-(--vscode-panel-border)" style={{ width: "40%" }}>
									Reference Details
								</th>
							</tr>
						</thead>
						<tbody>
							{papers.map((paper, idx) => (
								<tr
									className={
										idx % 2 === 0 ? "bg-(--vscode-editor-background)" : "bg-(--vscode-editor-background)/60"
									}
									key={paper.pmid || paper.url || `${idx}`}>
									<td className="p-2 align-top border-b border-(--vscode-panel-border)">{idx + 1}</td>
									<td className="p-2 align-top border-b border-(--vscode-panel-border)">
										<div className="font-medium text-(--vscode-foreground)">{paper.title}</div>
										{paper.relevanceReason && (
											<div className="text-xs text-(--vscode-descriptionForeground) mt-1 italic">
												Relevance: {paper.relevanceReason}
											</div>
										)}
										{paper.alsoRelevantTo && paper.alsoRelevantTo.length > 0 && (
											<div className="text-xs text-(--vscode-descriptionForeground) mt-1">
												Also relevant to: {paper.alsoRelevantTo.join(", ")}
											</div>
										)}
									</td>
									<td className="p-2 align-top border-b border-(--vscode-panel-border)">
										<div className="text-(--vscode-foreground)">{formatReferenceDetails(paper) || "—"}</div>
										<div className="flex items-center gap-2 mt-1">
											{paper.pmid && (
												<span className="text-xs text-(--vscode-descriptionForeground)">
													PMID: {paper.pmid}
												</span>
											)}
											{paper.url && (
												<a
													className="text-(--vscode-textLink-foreground) hover:text-(--vscode-textLink-activeForeground) inline-flex items-center gap-1"
													href={paper.url}
													rel="noopener noreferrer"
													target="_blank">
													Open <ExternalLink className="w-3 h-3" />
												</a>
											)}
										</div>
									</td>
								</tr>
							))}
							{papers.length === 0 && (
								<tr>
									<td className="p-3 text-(--vscode-descriptionForeground)" colSpan={3}>
										No papers found in the cached Section 5.3 assessment.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	)
}

export default Section52ClinicalStudies
