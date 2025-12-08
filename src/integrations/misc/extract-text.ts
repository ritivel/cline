import ExcelJS from "exceljs"
import fs from "fs/promises"
import * as iconv from "iconv-lite"
import { isBinaryFile } from "isbinaryfile"
import * as chardet from "jschardet"
import mammoth from "mammoth"
import * as path from "path"
// @ts-ignore-next-line
import pdf from "pdf-parse/lib/pdf-parse"

export async function detectEncoding(fileBuffer: Buffer, fileExtension?: string): Promise<string> {
	const detected = chardet.detect(fileBuffer)
	if (typeof detected === "string") {
		return detected
	} else if (detected && (detected as any).encoding) {
		return (detected as any).encoding
	} else {
		if (fileExtension) {
			const isBinary = await isBinaryFile(fileBuffer).catch(() => false)
			if (isBinary) {
				throw new Error(`Cannot read text for file type: ${fileExtension}`)
			}
		}
		return "utf8"
	}
}

export async function extractTextFromFile(filePath: string): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (_error) {
		throw new Error(`File not found: ${filePath}`)
	}

	return callTextExtractionFunctions(filePath)
}

/**
 * Expects the fs.access call to have already been performed prior to calling
 */
export async function callTextExtractionFunctions(filePath: string): Promise<string> {
	const fileExtension = path.extname(filePath).toLowerCase()

	switch (fileExtension) {
		case ".pdf":
			return extractTextFromPDF(filePath)
		case ".docx":
			return extractTextFromDOCX(filePath)
		case ".ipynb":
			return extractTextFromIPYNB(filePath)
		case ".xlsx":
			return extractTextFromExcel(filePath)
		default:
			const fileBuffer = await fs.readFile(filePath)
			if (fileBuffer.byteLength > 20 * 1000 * 1024) {
				// 20MB limit (20 * 1000 * 1024 bytes, decimal MB)
				throw new Error(`File is too large to read into context.`)
			}
			const encoding = await detectEncoding(fileBuffer, fileExtension)
			return iconv.decode(fileBuffer, encoding)
	}
}

async function extractTextFromPDF(filePath: string): Promise<string> {
	const dataBuffer = await fs.readFile(filePath)
	const data = await pdf(dataBuffer)
	return data.text
}

async function extractTextFromDOCX(filePath: string): Promise<string> {
	const result = await mammoth.extractRawText({ path: filePath })
	return result.value
}

async function extractTextFromIPYNB(filePath: string): Promise<string> {
	const fileBuffer = await fs.readFile(filePath)
	const encoding = await detectEncoding(fileBuffer)
	const data = iconv.decode(fileBuffer, encoding)
	const notebook = JSON.parse(data)
	let extractedText = ""

	for (const cell of notebook.cells) {
		if ((cell.cell_type === "markdown" || cell.cell_type === "code") && cell.source) {
			extractedText += cell.source.join("\n") + "\n"
		}
	}

	return extractedText
}

/**
 * Format the data inside Excel cells
 */
function formatCellValue(cell: ExcelJS.Cell): string {
	const value = cell.value
	if (value === null || value === undefined) {
		return ""
	}

	// Handle error values (#DIV/0!, #N/A, etc.)
	if (typeof value === "object" && "error" in value) {
		return `[Error: ${value.error}]`
	}

	// Handle dates - ExcelJS can parse them as Date objects
	if (value instanceof Date) {
		return value.toISOString().split("T")[0] // Just the date part
	}

	// Handle rich text
	if (typeof value === "object" && "richText" in value) {
		return value.richText.map((rt) => rt.text).join("")
	}

	// Handle hyperlinks
	if (typeof value === "object" && "text" in value && "hyperlink" in value) {
		return `${value.text} (${value.hyperlink})`
	}

	// Handle formulas - get the calculated result
	if (typeof value === "object" && "formula" in value) {
		if ("result" in value && value.result !== undefined && value.result !== null) {
			return value.result.toString()
		} else {
			return `[Formula: ${value.formula}]`
		}
	}

	return value.toString()
}

/**
 * Extract and format text from xlsx files
 */
async function extractTextFromExcel(filePath: string): Promise<string> {
	const workbook = new ExcelJS.Workbook()
	let excelText = ""

	try {
		await workbook.xlsx.readFile(filePath)

		workbook.eachSheet((worksheet, _sheetId) => {
			// Skip hidden sheets
			if (worksheet.state === "hidden" || worksheet.state === "veryHidden") {
				return
			}

			excelText += `--- Sheet: ${worksheet.name} ---\n`

			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				// Optional: limit processing for very large sheets
				if (rowNumber > 50000) {
					excelText += `[... truncated at row ${rowNumber} ...]\n`
					return false
				}

				const rowTexts: string[] = []
				let hasContent = false

				row.eachCell({ includeEmpty: true }, (cell, _colNumber) => {
					const cellText = formatCellValue(cell)
					if (cellText.trim()) {
						hasContent = true
					}
					rowTexts.push(cellText)
				})

				// Only add rows with actual content
				if (hasContent) {
					excelText += rowTexts.join("\t") + "\n"
				}

				return true
			})

			excelText += "\n" // Blank line between sheets
		})

		return excelText.trim()
	} catch (error: any) {
		console.error(`Error extracting text from Excel ${filePath}:`, error)
		throw new Error(`Failed to extract text from Excel: ${error.message}`)
	}
}

/**
 * Parse a file entry that may contain line range and embedded text
 * Format: "filepath:startLine-endLine|text" or "filepath"
 * Returns: { filePath, lineRange, embeddedText }
 */
function parseFileEntry(fileEntry: string): {
	filePath: string
	lineRange: string | null
	startLine: number | null
	endLine: number | null
	embeddedText: string | null
} {
	// Check for embedded text format: filepath:startLine-endLine|text
	if (fileEntry.includes("|") && fileEntry.includes(":")) {
		const pipeIndex = fileEntry.indexOf("|")
		const pathWithRange = fileEntry.substring(0, pipeIndex)
		const embeddedText = fileEntry.substring(pipeIndex + 1)

		// Find the last colon that separates path from line range
		const lastColonIndex = pathWithRange.lastIndexOf(":")
		if (lastColonIndex !== -1) {
			const potentialRange = pathWithRange.substring(lastColonIndex + 1)
			// Verify it looks like a line range (e.g., "5-10" or "5")
			if (/^\d+(-\d+)?$/.test(potentialRange)) {
				const [startStr, endStr] = potentialRange.split("-")
				const startLine = Number(startStr)
				const endLine = endStr ? Number(endStr) : startLine
				return {
					filePath: pathWithRange.substring(0, lastColonIndex),
					lineRange: potentialRange,
					startLine,
					endLine,
					embeddedText,
				}
			}
		}
	}

	return {
		filePath: fileEntry,
		lineRange: null,
		startLine: null,
		endLine: null,
		embeddedText: null,
	}
}

/**
 * Helper function used to load file(s) and format them into a string
 * Supports embedded text format for files with line ranges from markdown editor
 */
export async function processFilesIntoText(files: string[]): Promise<string> {
	const fileContentsPromises = files.map(async (fileEntry) => {
		try {
			const { filePath, lineRange, embeddedText, startLine, endLine } = parseFileEntry(fileEntry)

			// If embedded text is provided (from markdown editor with line range), use it directly
			if (embeddedText !== null) {
				const lineInfo = lineRange ? ` (lines ${lineRange})` : ""
				const rangeAttrs =
					startLine !== null && endLine !== null ? ` start_line="${startLine}" end_line="${endLine}"` : ""
				const guard =
					startLine !== null && endLine !== null
						? `# Edit only lines ${startLine}-${endLine} in this file. Keep all other lines unchanged.\n`
						: ""
				return `<file_content path="${filePath.toPosix()}"${rangeAttrs}${lineInfo}>\n${guard}${embeddedText}\n</file_content>`
			}

			// Otherwise, read the file from disk
			const content = await extractTextFromFile(filePath)
			return `<file_content path="${filePath.toPosix()}">\n${content}\n</file_content>`
		} catch (error) {
			const { filePath } = parseFileEntry(fileEntry)
			console.error(`Error processing file ${filePath}:`, error)
			return `<file_content path="${filePath.toPosix()}">\nError fetching content: ${error.message}\n</file_content>`
		}
	})

	const fileContents = await Promise.all(fileContentsPromises)

	const validFileContents = fileContents.filter((content) => content !== null).join("\n\n")

	if (validFileContents) {
		return `Files attached by the user:\n\n${validFileContents}`
	}

	// returns empty string if no files were loaded properly
	return ""
}
