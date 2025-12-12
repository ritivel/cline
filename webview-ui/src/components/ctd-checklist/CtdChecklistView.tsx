import { StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { CheckCircle2, Circle, FileText, Loader2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { type CtdAssessment, type CtdSectionStatus, useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

type CtdChecklistViewProps = {
	onDone: () => void
}

const CtdChecklistView = ({ onDone }: CtdChecklistViewProps) => {
	const { currentRegulatoryProduct, ctdAssessment, setCtdAssessment } = useExtensionState()
	const [isAssessing, setIsAssessing] = useState(false)
	const [isGenerating, setIsGenerating] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [ctdStructure, setCtdStructure] = useState<any>(null)

	useEffect(() => {
		if (currentRegulatoryProduct) {
			loadCtdStructure(currentRegulatoryProduct)
		}
	}, [currentRegulatoryProduct])

	const loadCtdStructure = async (product: RegulatoryProductConfig) => {
		try {
			const response = await UiServiceClient.getCtdStructure(
				StringRequest.create({ value: JSON.stringify({ marketName: product.marketName }) }),
			)
			if (response.value) {
				setCtdStructure(JSON.parse(response.value))
			}
		} catch (error) {
			console.error("Failed to load CTD structure:", error)
			setError("Failed to load CTD structure")
		}
	}

	const handleAssess = useCallback(async () => {
		if (!currentRegulatoryProduct) return

		setIsAssessing(true)
		setError(null)

		try {
			const response = await UiServiceClient.assessCtdDocuments(
				StringRequest.create({ value: JSON.stringify(currentRegulatoryProduct) }),
			)

			if (response.value) {
				const assessment: CtdAssessment = JSON.parse(response.value)
				setCtdAssessment(assessment)
			}
		} catch (error: any) {
			console.error("Failed to assess documents:", error)
			setError(error?.message || "Failed to assess documents")
		} finally {
			setIsAssessing(false)
		}
	}, [currentRegulatoryProduct, setCtdAssessment])

	const handleGenerate = useCallback(async () => {
		if (!currentRegulatoryProduct || !ctdAssessment) return

		setIsGenerating(true)
		setError(null)

		try {
			await UiServiceClient.generateCtdDossier(
				StringRequest.create({
					value: JSON.stringify({
						product: currentRegulatoryProduct,
						assessment: ctdAssessment,
					}),
				}),
			)

			onDone()
		} catch (error: any) {
			console.error("Failed to generate dossier:", error)
			setError(error?.message || "Failed to generate dossier")
		} finally {
			setIsGenerating(false)
		}
	}, [currentRegulatoryProduct, ctdAssessment, onDone])

	const renderSection = (section: CtdSectionStatus, level: number = 0) => {
		const indent = level * 24
		return (
			<div className="mb-2" key={section.sectionId} style={{ paddingLeft: `${indent}px` }}>
				<div className="flex items-center gap-2">
					{section.isComplete ? (
						<CheckCircle2 className="w-4 h-4 text-green-500" />
					) : (
						<Circle className="w-4 h-4 text-gray-400" />
					)}
					<span className="font-medium">{section.sectionId}</span>
					<span className="text-sm text-(--vscode-descriptionForeground)">{section.sectionTitle}</span>
				</div>
				{ctdAssessment && (
					<div className="ml-6 mt-1 text-xs text-(--vscode-descriptionForeground)">
						{section.presentDocuments.length > 0 && (
							<div className="text-green-500">✓ {section.presentDocuments.length} document(s) present</div>
						)}
						{section.missingDocuments.length > 0 && (
							<div className="text-orange-500">⚠ {section.missingDocuments.length} document(s) missing</div>
						)}
					</div>
				)}
			</div>
		)
	}

	if (!currentRegulatoryProduct) {
		return (
			<div className="flex flex-col items-center justify-center h-full">
				<p className="text-lg">No product selected</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex justify-between items-center p-4 border-b border-(--vscode-panel-border)">
				<div>
					<h2 className="text-lg font-semibold">CTD Checklist</h2>
					<p className="text-sm text-(--vscode-descriptionForeground)">
						{currentRegulatoryProduct.drugName} - {currentRegulatoryProduct.marketName}
					</p>
				</div>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div className="flex-1 overflow-auto p-4">
				{error && (
					<div className="p-3 mb-4 bg-(--vscode-inputValidation-errorBackground) border border-(--vscode-inputValidation-errorBorder) rounded">
						<p className="text-sm text-(--vscode-inputValidation-errorForeground)">❌ {error}</p>
					</div>
				)}

				{/* CTD Structure Display */}
				<div className="mb-4">
					<h3 className="text-md font-semibold mb-2">CTD Structure</h3>
					{ctdStructure ? (
						<div className="space-y-1">{ctdAssessment?.sections.map((section) => renderSection(section))}</div>
					) : ctdAssessment ? (
						<div className="space-y-1">{ctdAssessment.sections.map((section) => renderSection(section))}</div>
					) : (
						<p className="text-sm text-(--vscode-descriptionForeground)">
							Click 'Assess Documents' to view CTD structure
						</p>
					)}
				</div>

				{/* Action Buttons */}
				<div className="flex gap-2 mt-4">
					<VSCodeButton disabled={isAssessing || isGenerating} onClick={handleAssess}>
						{isAssessing ? (
							<>
								<Loader2 className="w-4 h-4 mr-2 animate-spin" />
								Assessing...
							</>
						) : (
							<>
								<FileText className="w-4 h-4 mr-2" />
								Assess Documents
							</>
						)}
					</VSCodeButton>

					{ctdAssessment && (
						<VSCodeButton disabled={isGenerating || isAssessing} onClick={handleGenerate}>
							{isGenerating ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									Generating...
								</>
							) : (
								"Generate Dossier"
							)}
						</VSCodeButton>
					)}
				</div>
			</div>
		</div>
	)
}

export default CtdChecklistView
