import { StringRequest } from "@shared/proto/cline/common"
import type { RegulatoryProductConfig } from "@shared/storage/state-keys"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { CheckSquare, FileText, List, Pencil, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { ChecklistDisplay } from "./ChecklistDisplay"
import { CtdFolderTree } from "./CtdFolderTree"
import { Section53PaperSelection } from "./Section53PaperSelection"

// Types for Section 5.3 papers result
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
	}
	combinedAt: string
}

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
	const [viewMode, setViewMode] = useState<"sections" | "checklist" | "section53Papers">("sections")

	// Section 5.3 specific state
	const [isAssessingSection53, setIsAssessingSection53] = useState(false)
	const [section53Result, setSection53Result] = useState<Section53Result | null>(null)
	const [isGeneratingSection53, setIsGeneratingSection53] = useState(false)

	// Section 2.5 specific state
	const [isGeneratingSection25, setIsGeneratingSection25] = useState(false)

	// Section 2.7 specific state
	const [isGeneratingSection27, setIsGeneratingSection27] = useState(false)

	// Edit product state
	const [isEditingProduct, setIsEditingProduct] = useState(false)
	const [editDrugName, setEditDrugName] = useState("")
	const [editMarketName, setEditMarketName] = useState("")
	const [isSavingProduct, setIsSavingProduct] = useState(false)

	useEffect(() => {
		if (currentRegulatoryProduct) {
			loadCtdStructure(currentRegulatoryProduct)
			loadCachedSection53Papers(currentRegulatoryProduct)
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

	const loadCachedSection53Papers = async (product: RegulatoryProductConfig) => {
		try {
			const response = await UiServiceClient.getSection53Papers(
				StringRequest.create({
					value: JSON.stringify({
						drugName: product.drugName,
						productPath: product.submissionsPath,
					}),
				}),
			)
			if (response.value) {
				const parsed = JSON.parse(response.value) as { success: boolean; result?: Section53Result }
				if (parsed.success && parsed.result) {
					setSection53Result(parsed.result)
				}
			}
		} catch (e) {
			// Silent: cached papers are optional
			console.log("No cached Section 5.3 papers found:", e)
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

	// Handler for Section 5.3 paper assessment
	const handleAssessSection53 = useCallback(async () => {
		if (!currentRegulatoryProduct) return

		setIsAssessingSection53(true)
		setError(null)

		try {
			const response = await UiServiceClient.assessSection53Papers(
				StringRequest.create({
					value: JSON.stringify({
						drugName: currentRegulatoryProduct.drugName,
						productPath: currentRegulatoryProduct.submissionsPath,
					}),
				}),
			)

			if (response.value) {
				const result = JSON.parse(response.value) as {
					success: boolean
					result?: Section53Result
					error?: string
				}
				if (result.success && result.result) {
					setSection53Result(result.result)
					setViewMode("section53Papers")
				} else {
					setError(result.error || "Failed to assess Section 5.3 papers")
				}
			}
		} catch (error: any) {
			console.error("Failed to assess Section 5.3 papers:", error)
			setError(error?.message || "Failed to assess Section 5.3 papers")
		} finally {
			setIsAssessingSection53(false)
		}
	}, [currentRegulatoryProduct])

	// Handler for generating Section 5.3 with selected papers (from paper selection view)
	const handleGenerateSection53 = useCallback(
		async (selectedPapers: Array<{ sectionId: string; pmid: string }>) => {
			if (!currentRegulatoryProduct) return

			setIsGeneratingSection53(true)
			setError(null)

			try {
				// Call the generate RPC with the section53Result and selected papers
				const response = await UiServiceClient.generateSection53(
					StringRequest.create({
						value: JSON.stringify({
							drugName: currentRegulatoryProduct.drugName,
							productPath: currentRegulatoryProduct.submissionsPath,
							result: section53Result,
							selectedPapers,
						}),
					}),
				)

				if (response.value) {
					const result = JSON.parse(response.value) as { success: boolean; error?: string; texPath?: string }
					if (result.success) {
						setViewMode("sections")
						setError(null)
					} else {
						setError(result.error || "Failed to generate Section 5.3")
					}
				}
			} catch (error: any) {
				console.error("Failed to generate Section 5.3:", error)
				setError(error?.message || "Failed to generate Section 5.3")
			} finally {
				setIsGeneratingSection53(false)
			}
		},
		[currentRegulatoryProduct, section53Result],
	)

	// Handler for generating Section 5.3 from the tree button
	// If papers are not assessed, assess first then show paper selection
	// If papers are assessed, go directly to paper selection for generation
	const handleGenerateSection53FromTree = useCallback(async () => {
		if (!currentRegulatoryProduct) return

		// If papers are already assessed, go to paper selection view
		if (section53Result && section53Result.summary.totalUniquePapers > 0) {
			setViewMode("section53Papers")
			return
		}

		// Papers not assessed yet - assess first
		setIsAssessingSection53(true)
		setError(null)

		try {
			const response = await UiServiceClient.assessSection53Papers(
				StringRequest.create({
					value: JSON.stringify({
						drugName: currentRegulatoryProduct.drugName,
						productPath: currentRegulatoryProduct.submissionsPath,
					}),
				}),
			)

			if (response.value) {
				const result = JSON.parse(response.value) as {
					success: boolean
					result?: Section53Result
					error?: string
				}
				if (result.success && result.result) {
					setSection53Result(result.result)
					// After assessing, show the paper selection view
					setViewMode("section53Papers")
				} else {
					setError(result.error || "Failed to assess Section 5.3 papers")
				}
			}
		} catch (error: any) {
			console.error("Failed to assess Section 5.3 papers:", error)
			setError(error?.message || "Failed to assess Section 5.3 papers")
		} finally {
			setIsAssessingSection53(false)
		}
	}, [currentRegulatoryProduct, section53Result])

	// Handler to go back from Section 5.3 paper selection
	const handleBackFromSection53 = useCallback(() => {
		setViewMode("sections")
	}, [])

	// Handler for generating Section 2.5 (Clinical Overview)
	// Requires Section 5.3 to be assessed first
	const handleGenerateSection25 = useCallback(async () => {
		if (!currentRegulatoryProduct) return

		// Check if Section 5.3 has been assessed
		if (!section53Result || !section53Result.summary?.totalUniquePapers) {
			setError(
				"Section 5.3 has not been assessed yet. Please assess Section 5.3 first before generating Section 2.5 (Clinical Overview).",
			)
			return
		}

		setIsGeneratingSection25(true)
		setError(null)

		try {
			const response = await UiServiceClient.generateSection25(
				StringRequest.create({
					value: JSON.stringify({
						drugName: currentRegulatoryProduct.drugName,
						productPath: currentRegulatoryProduct.submissionsPath,
						companyName: currentRegulatoryProduct.companyName || "",
					}),
				}),
			)

			if (response.value) {
				const result = JSON.parse(response.value) as {
					success: boolean
					error?: string
					texPath?: string
					requiresSection53?: boolean
				}
				if (result.success) {
					setError(null)
				} else if (result.requiresSection53) {
					setError(
						"Section 5.3 has not been assessed yet. Please assess Section 5.3 first before generating Section 2.5 (Clinical Overview).",
					)
				} else {
					setError(result.error || "Failed to generate Section 2.5")
				}
			}
		} catch (error: any) {
			console.error("Failed to generate Section 2.5:", error)
			setError(error?.message || "Failed to generate Section 2.5")
		} finally {
			setIsGeneratingSection25(false)
		}
	}, [currentRegulatoryProduct, section53Result])

	// Handler for generating Section 2.7 (Clinical Summary)
	// Requires Section 5.3 to be assessed first
	const handleGenerateSection27 = useCallback(async () => {
		if (!currentRegulatoryProduct) return

		// Check if Section 5.3 has been assessed
		if (!section53Result || !section53Result.summary?.totalUniquePapers) {
			setError(
				"Section 5.3 has not been assessed yet. Please assess Section 5.3 first before generating Section 2.7 (Clinical Summary).",
			)
			return
		}

		setIsGeneratingSection27(true)
		setError(null)

		try {
			const response = await UiServiceClient.generateSection27(
				StringRequest.create({
					value: JSON.stringify({
						drugName: currentRegulatoryProduct.drugName,
						productPath: currentRegulatoryProduct.submissionsPath,
						companyName: currentRegulatoryProduct.companyName || "",
					}),
				}),
			)

			if (response.value) {
				const result = JSON.parse(response.value) as {
					success: boolean
					error?: string
					texPath?: string
					requiresSection53?: boolean
				}
				if (result.success) {
					setError(null)
				} else if (result.requiresSection53) {
					setError(
						"Section 5.3 has not been assessed yet. Please assess Section 5.3 first before generating Section 2.7 (Clinical Summary).",
					)
				} else {
					setError(result.error || "Failed to generate Section 2.7")
				}
			}
		} catch (error: any) {
			console.error("Failed to generate Section 2.7:", error)
			setError(error?.message || "Failed to generate Section 2.7")
		} finally {
			setIsGeneratingSection27(false)
		}
	}, [currentRegulatoryProduct, section53Result])

	// Product edit handlers
	const handleEditClick = useCallback(() => {
		if (!currentRegulatoryProduct) return
		setEditDrugName(currentRegulatoryProduct.drugName)
		setEditMarketName(currentRegulatoryProduct.marketName)
		setIsEditingProduct(true)
		setError(null)
	}, [currentRegulatoryProduct])

	const handleCancelEdit = useCallback(() => {
		setIsEditingProduct(false)
		setEditDrugName("")
		setEditMarketName("")
	}, [])

	const handleSaveEdit = useCallback(async () => {
		if (!currentRegulatoryProduct) return

		if (!editDrugName.trim() || !editMarketName.trim()) {
			setError("Drug name and market name are required.")
			return
		}

		setIsSavingProduct(true)
		setError(null)

		try {
			const updateRequest = {
				originalProduct: currentRegulatoryProduct,
				updatedProduct: {
					...currentRegulatoryProduct,
					drugName: editDrugName.trim(),
					marketName: editMarketName.trim(),
				},
			}

			await UiServiceClient.updateRegulatoryProduct(StringRequest.create({ value: JSON.stringify(updateRequest) }))

			// The state will be updated via postStateToWebview from the backend
			handleCancelEdit()
		} catch (error: any) {
			console.error("Failed to update product:", error)
			setError(error?.message || "Failed to update product. Please try again.")
		} finally {
			setIsSavingProduct(false)
		}
	}, [currentRegulatoryProduct, editDrugName, editMarketName, handleCancelEdit])

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

			// Special handling for section 2.5: trigger generation
			if (sectionId === "2.5") {
				await handleGenerateSection25()
				return // Exit early, generation will handle the rest
			}

			// Special handling for section 2.7: trigger generation
			if (sectionId === "2.7") {
				await handleGenerateSection27()
				return // Exit early, generation will handle the rest
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
					<div className="flex items-center gap-2">
						<p className="text-base text-(--vscode-descriptionForeground)">
							{currentRegulatoryProduct.drugName} - {currentRegulatoryProduct.marketName}
						</p>
						<button
							className="p-1 rounded hover:bg-(--vscode-toolbar-hoverBackground) text-(--vscode-descriptionForeground) hover:text-(--vscode-foreground)"
							onClick={handleEditClick}
							title="Edit product">
							<Pencil className="w-4 h-4" />
						</button>
					</div>
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
						{section53Result && (
							<button
								aria-label="View Section 5.3 Papers"
								className={`px-3 py-1.5 text-base flex items-center gap-2 transition-colors ${
									viewMode === "section53Papers"
										? "bg-(--vscode-button-background) text-(--vscode-button-foreground)"
										: "bg-(--vscode-panel-background) text-(--vscode-foreground) hover:bg-(--vscode-list-hoverBackground)"
								}`}
								onClick={() => setViewMode("section53Papers")}
								title="View Section 5.3 Papers">
								<FileText className="w-5 h-5" />
								5.3 Papers
							</button>
						)}
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
							isAssessingSection53={isAssessingSection53}
							isGeneratingSection25={isGeneratingSection25}
							isGeneratingSection27={isGeneratingSection27}
							isGeneratingSection53={isGeneratingSection53}
							onAssess={handleAssess}
							onAssessOutput={handleAssessOutput}
							onAssessSection53={handleAssessSection53}
							onGenerate={handleGenerate}
							onGenerateSection25={handleGenerateSection25}
							onGenerateSection27={handleGenerateSection27}
							onGenerateSection53={handleGenerateSection53FromTree}
							onSectionSelect={handleSectionSelect}
							section53Assessed={!!section53Result && (section53Result.summary?.totalUniquePapers ?? 0) > 0}
							section53PaperCount={section53Result?.summary?.totalUniquePapers}
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

				{/* Section 5.3 Paper Selection */}
				{viewMode === "section53Papers" && section53Result && (
					<div className="h-full overflow-hidden">
						<Section53PaperSelection
							isGenerating={isGeneratingSection53}
							onBack={handleBackFromSection53}
							onGenerate={handleGenerateSection53}
							result={section53Result}
						/>
					</div>
				)}
			</div>

			{/* Edit Product Modal */}
			{isEditingProduct && currentRegulatoryProduct && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
					<div className="bg-(--vscode-editor-background) border border-(--vscode-panel-border) rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
						<div className="flex justify-between items-center mb-4">
							<h3 className="text-lg font-semibold">Edit Product</h3>
							<button
								className="p-1 rounded hover:bg-(--vscode-toolbar-hoverBackground)"
								onClick={handleCancelEdit}>
								<X className="w-5 h-5" />
							</button>
						</div>

						<div className="space-y-4">
							<div>
								<label className="block text-sm font-medium mb-1">Drug Name</label>
								<VSCodeTextField
									className="w-full"
									onInput={(e: any) => setEditDrugName(e.target.value)}
									placeholder="e.g., Levofloxacin USP 500mg"
									value={editDrugName}
								/>
							</div>

							<div>
								<label className="block text-sm font-medium mb-1">Market Name</label>
								<VSCodeTextField
									className="w-full"
									onInput={(e: any) => setEditMarketName(e.target.value)}
									placeholder="e.g., US FDA"
									value={editMarketName}
								/>
							</div>

							<div className="text-xs text-(--vscode-descriptionForeground)">
								<p>Workspace: {currentRegulatoryProduct.workspacePath}</p>
								<p className="mt-1">Submissions: {currentRegulatoryProduct.submissionsPath}</p>
							</div>

							<div className="flex gap-2 justify-end pt-2">
								<VSCodeButton appearance="secondary" disabled={isSavingProduct} onClick={handleCancelEdit}>
									Cancel
								</VSCodeButton>
								<VSCodeButton disabled={isSavingProduct} onClick={handleSaveEdit}>
									{isSavingProduct ? "Saving..." : "Save Changes"}
								</VSCodeButton>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default CtdChecklistView
