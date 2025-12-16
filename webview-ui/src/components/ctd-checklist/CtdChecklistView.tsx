import { StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"
import { ChecklistDisplay } from "./ChecklistDisplay"
import { CtdFolderTree } from "./CtdFolderTree"

type CtdChecklistViewProps = {
	onDone: () => void
}

const CtdChecklistView = ({ onDone }: CtdChecklistViewProps) => {
	const { currentRegulatoryProduct } = useExtensionState()
	const [error, setError] = useState<string | null>(null)
	const [ctdStructure, setCtdStructure] = useState<any>(null)
	const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
	const [assessingSections, setAssessingSections] = useState<Set<string>>(new Set())
	const [assessingOutputSections, setAssessingOutputSections] = useState<Set<string>>(new Set())
	const [generatingSections, setGeneratingSections] = useState<Set<string>>(new Set())

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

	const handleAssess = useCallback(
		async (sectionId: string) => {
			if (!currentRegulatoryProduct) return

			setAssessingSections((prev) => new Set(prev).add(sectionId))
			setError(null)

			try {
				const response = await UiServiceClient.executeSlashCommand(
					StringRequest.create({
						value: JSON.stringify({
							command: `/update-checklist ${sectionId}`,
						}),
					}),
				)

				if (response.value) {
					const result = JSON.parse(response.value) as { success: boolean; message: string }
					if (result.success) {
						// Automatically select the section to show the checklist
						setSelectedSectionId(sectionId)
						// Refresh checklist display after a short delay to allow file to be written
						setTimeout(() => {
							// Trigger refresh by updating selected section
							setSelectedSectionId(null)
							setTimeout(() => setSelectedSectionId(sectionId), 100)
						}, 2000)
					} else {
						setError(result.message || "Failed to assess section")
					}
				}
			} catch (error: any) {
				console.error("Failed to assess section:", error)
				setError(error?.message || "Failed to assess section")
			} finally {
				setAssessingSections((prev) => {
					const next = new Set(prev)
					next.delete(sectionId)
					return next
				})
			}
		},
		[currentRegulatoryProduct],
	)

	const handleGenerate = useCallback(
		async (sectionId: string) => {
			if (!currentRegulatoryProduct) return

			setGeneratingSections((prev) => new Set(prev).add(sectionId))
			setError(null)

			try {
				const response = await UiServiceClient.executeSlashCommand(
					StringRequest.create({
						value: JSON.stringify({
							command: `/generate-section ${sectionId}`,
						}),
					}),
				)

				if (response.value) {
					const result = JSON.parse(response.value) as { success: boolean; message: string }
					if (!result.success) {
						setError(result.message || "Failed to generate section")
					}
				}
			} catch (error: any) {
				console.error("Failed to generate section:", error)
				setError(error?.message || "Failed to generate section")
			} finally {
				setGeneratingSections((prev) => {
					const next = new Set(prev)
					next.delete(sectionId)
					return next
				})
			}
		},
		[currentRegulatoryProduct],
	)

	const handleAssessOutput = useCallback(
		async (sectionId: string) => {
			if (!currentRegulatoryProduct) return

			setAssessingOutputSections((prev) => new Set(prev).add(sectionId))
			setError(null)

			try {
				const response = await UiServiceClient.executeSlashCommand(
					StringRequest.create({
						value: JSON.stringify({
							command: `/update-output-checklist ${sectionId}`,
						}),
					}),
				)

				if (response.value) {
					const result = JSON.parse(response.value) as { success: boolean; message: string }
					if (result.success) {
						// Automatically select the section to show the checklist
						setSelectedSectionId(sectionId)
						// Refresh checklist display after a short delay to allow file to be written
						setTimeout(() => {
							// Trigger refresh by updating selected section
							setSelectedSectionId(null)
							setTimeout(() => setSelectedSectionId(sectionId), 100)
						}, 2000)
					} else {
						setError(result.message || "Failed to assess output")
					}
				}
			} catch (error: any) {
				console.error("Failed to assess output:", error)
				setError(error?.message || "Failed to assess output")
			} finally {
				setAssessingOutputSections((prev) => {
					const next = new Set(prev)
					next.delete(sectionId)
					return next
				})
			}
		},
		[currentRegulatoryProduct],
	)

	const handleSectionSelect = useCallback((sectionId: string) => {
		setSelectedSectionId(sectionId)
	}, [])

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

			<div className="flex-1 overflow-hidden flex">
				{error && (
					<div className="absolute top-16 left-4 right-4 z-10 p-3 bg-(--vscode-inputValidation-errorBackground) border border-(--vscode-inputValidation-errorBorder) rounded">
						<p className="text-sm text-(--vscode-inputValidation-errorForeground)">❌ {error}</p>
					</div>
				)}

				{/* CTD Structure Tree */}
				<div className="flex-1 overflow-auto p-4 border-r border-(--vscode-panel-border)">
					<CtdFolderTree
						assessingOutputSections={assessingOutputSections}
						assessingSections={assessingSections}
						generatingSections={generatingSections}
						onAssess={handleAssess}
						onAssessOutput={handleAssessOutput}
						onGenerate={handleGenerate}
						onSectionSelect={handleSectionSelect}
						structure={ctdStructure}
					/>
				</div>

				{/* Checklist Display */}
				<div className="flex-1 overflow-hidden">
					<ChecklistDisplay
						onRefresh={() => {
							if (selectedSectionId) {
								setSelectedSectionId(null)
								setTimeout(() => setSelectedSectionId(selectedSectionId), 100)
							}
						}}
						product={currentRegulatoryProduct}
						sectionId={selectedSectionId}
					/>
				</div>
			</div>
		</div>
	)
}

export default CtdChecklistView
