import { StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { CheckSquare, List } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
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
	const [viewMode, setViewMode] = useState<"sections" | "checklist">("sections")

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

	/**
	 * Gets the .tex file path for a section
	 * Path structure: module-{moduleNum}/section-{sectionId}/content.tex
	 * e.g., "2.1" -> module-2/section-2.1/content.tex
	 */
	const getSectionTexPath = useCallback((sectionId: string, product: RegulatoryProductConfig): string | null => {
		if (!product?.submissionsPath) {
			return null
		}

		const moduleNum = sectionId.charAt(0)
		const dossierPath = `${product.submissionsPath}/dossier`
		const sectionFolderPath = `${dossierPath}/module-${moduleNum}/section-${sectionId}`
		const texPath = `${sectionFolderPath}/content.tex`

		return texPath
	}, [])

	const handleSectionSelect = useCallback(
		async (sectionId: string) => {
			setSelectedSectionId(sectionId)
			// Automatically switch to checklist view when a section is selected
			setViewMode("checklist")

			// Special handling for section 2.5: always regenerate
			if (sectionId === "2.5") {
				await handleGenerate(sectionId)
				return // Exit early, regeneration will handle the rest
			}

			// Normal flow for other sections: Try to open the .tex file if it exists
			if (currentRegulatoryProduct) {
				const texPath = getSectionTexPath(sectionId, currentRegulatoryProduct)
				if (texPath) {
					try {
						// Check if file exists before trying to open it
						const existsResponse = await FileServiceClient.ifFileExistsRelativePath(
							StringRequest.create({ value: texPath }),
						)
						if (existsResponse.value) {
							await FileServiceClient.openFile(StringRequest.create({ value: texPath }))
						}
					} catch (error) {
						// Silently fail if file doesn't exist or can't be opened
						// This is expected behavior - not all sections have .tex files yet
						console.log(`Could not open .tex file for section ${sectionId}:`, error)
					}
				}
			}
		},
		[currentRegulatoryProduct, getSectionTexPath, handleGenerate],
	)

	if (!currentRegulatoryProduct) {
		return (
			<div className="flex flex-col items-center justify-center h-full">
				<p className="text-xl">No product selected</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex justify-between items-center p-4 border-b border-(--vscode-panel-border)">
				<div>
					<h2 className="text-xl font-semibold">CTD Checklist</h2>
					<p className="text-base text-(--vscode-descriptionForeground)">
						{currentRegulatoryProduct.drugName} - {currentRegulatoryProduct.marketName}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<div className="flex gap-1 border border-(--vscode-panel-border) rounded">
						<button
							aria-label="View sections"
							className={`px-3 py-1.5 text-base flex items-center gap-2 transition-colors ${
								viewMode === "sections"
									? "bg-(--vscode-button-background) text-(--vscode-button-foreground)"
									: "bg-(--vscode-panel-background) text-(--vscode-foreground) hover:bg-(--vscode-list-hoverBackground)"
							}`}
							onClick={() => setViewMode("sections")}
							title="View sections">
							<List className="w-5 h-5" />
							Sections
						</button>
						<button
							aria-label="View checklist"
							className={`px-3 py-1.5 text-base flex items-center gap-2 transition-colors ${
								viewMode === "checklist"
									? "bg-(--vscode-button-background) text-(--vscode-button-foreground)"
									: "bg-(--vscode-panel-background) text-(--vscode-foreground) hover:bg-(--vscode-list-hoverBackground)"
							}`}
							onClick={() => setViewMode("checklist")}
							title="View checklist">
							<CheckSquare className="w-5 h-5" />
							Checklist
						</button>
					</div>
					<VSCodeButton onClick={onDone}>Done</VSCodeButton>
				</div>
			</div>

			<div className="flex-1 overflow-hidden relative">
				{error && (
					<div className="absolute top-0 left-4 right-4 z-10 p-3 bg-(--vscode-inputValidation-errorBackground) border border-(--vscode-inputValidation-errorBorder) rounded">
						<p className="text-base text-(--vscode-inputValidation-errorForeground)">❌ {error}</p>
					</div>
				)}

				{/* CTD Structure Tree */}
				{viewMode === "sections" && (
					<div className="h-full overflow-auto p-4">
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
				)}

				{/* Checklist Display */}
				{viewMode === "checklist" && (
					<div className="h-full overflow-hidden">
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
				)}
			</div>
		</div>
	)
}

export default CtdChecklistView
