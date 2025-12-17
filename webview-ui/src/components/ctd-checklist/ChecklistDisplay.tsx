import { StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { CheckCircle2, Circle, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { UiServiceClient } from "@/services/grpc-client"

interface ChecklistFeature {
	text: string
	checked: boolean
}

interface ParsedChecklist {
	sectionId: string
	features: ChecklistFeature[]
	outputFeatures?: ChecklistFeature[]
}

interface ChecklistDisplayProps {
	sectionId: string | null
	product: RegulatoryProductConfig | null
	onRefresh?: () => void
}

export const ChecklistDisplay = ({ sectionId, product, onRefresh }: ChecklistDisplayProps) => {
	const [checklist, setChecklist] = useState<ParsedChecklist | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (sectionId && product) {
			loadChecklist(sectionId, product)
		} else {
			setChecklist(null)
			setError(null)
		}
	}, [sectionId, product])

	const loadChecklist = async (sectionId: string, product: RegulatoryProductConfig) => {
		setLoading(true)
		setError(null)
		try {
			const response = await UiServiceClient.readChecklistFile(
				StringRequest.create({
					value: JSON.stringify({
						sectionId,
						product,
					}),
				}),
			)

			if (response.value) {
				const parsed = JSON.parse(response.value) as ParsedChecklist | null
				setChecklist(parsed)
				// If no checklist exists, don't set an error - just show the message in the UI
				if (!parsed) {
					setError(null) // Clear any previous errors
				}
			}
		} catch (err: any) {
			console.error("Failed to load checklist:", err)
			setError(err?.message || "Failed to load checklist")
			setChecklist(null)
		} finally {
			setLoading(false)
		}
	}

	const handleRefresh = () => {
		if (sectionId && product) {
			loadChecklist(sectionId, product)
			if (onRefresh) {
				onRefresh()
			}
		}
	}

	if (!sectionId) {
		return <div className="p-4 text-base text-(--vscode-descriptionForeground)">Select a section to view its checklist</div>
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center p-8">
				<Loader2 className="w-6 h-6 animate-spin text-(--vscode-icon-foreground)" />
				<span className="ml-2 text-base text-(--vscode-descriptionForeground)">Loading checklist...</span>
			</div>
		)
	}

	if (error) {
		return (
			<div className="p-4">
				<div className="p-3 bg-(--vscode-inputValidation-errorBackground) border border-(--vscode-inputValidation-errorBorder) rounded">
					<p className="text-base text-(--vscode-inputValidation-errorForeground)">{error}</p>
				</div>
			</div>
		)
	}

	// If no checklist exists, show message to assess
	if (!checklist) {
		return (
			<div className="p-4">
				<div className="p-3 bg-(--vscode-inputValidation-errorBackground) border border-(--vscode-inputValidation-errorBorder) rounded">
					<p className="text-base text-(--vscode-inputValidation-errorForeground)">
						No checklist found for this section. Click 'Assess' to create one.
					</p>
				</div>
			</div>
		)
	}

	const renderFeatureList = (features: ChecklistFeature[], title: string) => {
		if (features.length === 0) {
			return null
		}

		return (
			<div className="mb-6">
				<h4 className="font-semibold text-base mb-3 text-(--vscode-foreground)">{title}</h4>
				<div className="space-y-2">
					{features.map((feature, index) => (
						<div className="flex items-start gap-3 p-2 rounded hover:bg-(--vscode-list-hoverBackground)" key={index}>
							{feature.checked ? (
								<CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
							) : (
								<Circle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
							)}
							<span
								className={`text-base flex-1 ${
									feature.checked
										? "text-(--vscode-descriptionForeground) line-through"
										: "text-(--vscode-foreground)"
								}`}>
								{feature.text}
							</span>
						</div>
					))}
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			<div className="p-4 border-b border-(--vscode-panel-border)">
				<div className="flex items-center justify-between">
					<h3 className="font-semibold text-base">Checklist for Section {checklist.sectionId}</h3>
					<button className="text-sm text-(--vscode-textLink-foreground) hover:underline" onClick={handleRefresh}>
						Refresh
					</button>
				</div>
			</div>
			<div className="flex-1 overflow-auto p-4">
				{checklist.features.length === 0 && (!checklist.outputFeatures || checklist.outputFeatures.length === 0) ? (
					<div className="text-base text-(--vscode-descriptionForeground)">No checklist items found</div>
				) : (
					<>
						{renderFeatureList(checklist.features, "Input Features")}
						{checklist.outputFeatures && checklist.outputFeatures.length > 0 && (
							<div className="border-t border-(--vscode-panel-border) pt-4 mt-4">
								{renderFeatureList(checklist.outputFeatures, "Output Features")}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}
