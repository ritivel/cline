import * as diff from "diff"
import * as vscode from "vscode"

/**
 * Decoration types for pending file changes
 * Note: Text editor decorations are VS Code-specific and don't have a HostProvider abstraction
 */
// biome-ignore lint: Text editor decorations are VS Code-specific API with no abstraction
const addedLineDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: "rgba(35, 134, 54, 0.3)", // Green background for additions
	isWholeLine: true,
	gutterIconPath: vscode.Uri.parse(
		"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTggM0w4IDEzTTMgOEwxMyA4IiBzdHJva2U9IiMyOGE3NDUiIHN0cm9rZS13aWR0aD0iMiIvPgo8L3N2Zz4K",
	),
	gutterIconSize: "contain",
	overviewRulerColor: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
})

// biome-ignore lint: Text editor decorations are VS Code-specific API with no abstraction
const deletedLineDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: "rgba(215, 58, 73, 0.3)", // Red background for deletions
	isWholeLine: true,
	textDecoration: "line-through",
	opacity: "0.7",
	overviewRulerColor: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
})

// biome-ignore lint: Text editor decorations are VS Code-specific API with no abstraction
const modifiedLineDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: "rgba(227, 179, 65, 0.3)", // Yellow/orange background for modifications
	isWholeLine: true,
	overviewRulerColor: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
})

/**
 * Compute diff using the diff library to find added, deleted, and modified lines
 * Returns line numbers in the modified file
 */
function computeDiff(
	original: string,
	newContent: string,
): {
	added: number[]
	deleted: number[]
	modified: number[]
} {
	const added: number[] = []
	const deleted: number[] = []
	const modifiedLines: number[] = []

	// Use the diff library for accurate diff computation
	const changes = diff.diffLines(original, newContent)

	let currentLineInModified = 0

	for (const change of changes) {
		if (change.added) {
			// These are new lines added
			const lineCount = change.value.split("\n").length - (change.value.endsWith("\n") ? 1 : 0)
			for (let i = 0; i < lineCount; i++) {
				added.push(currentLineInModified + i)
			}
			currentLineInModified += lineCount
		} else if (change.removed) {
			// These lines were removed - mark the position where they would be in modified
			// Since they're deleted, we don't increment currentLineInModified
			// But we mark the current position for visual indication
			const lineCount = change.value.split("\n").length - (change.value.endsWith("\n") ? 1 : 0)
			for (let i = 0; i < lineCount; i++) {
				deleted.push(currentLineInModified + i)
			}
		} else {
			// Unchanged lines - check if next change is a modification
			const lineCount = change.value.split("\n").length - (change.value.endsWith("\n") ? 1 : 0)
			currentLineInModified += lineCount
		}
	}

	// For modifications, we need to detect when a removal is followed by an addition at the same position
	// This indicates a modification rather than separate add/delete
	let i = 0
	while (i < changes.length) {
		if (changes[i].removed && i + 1 < changes.length && changes[i + 1].added) {
			// This is a modification - remove from added/deleted and add to modified
			const removedCount = changes[i].value.split("\n").length - (changes[i].value.endsWith("\n") ? 1 : 0)
			const addedCount = changes[i + 1].value.split("\n").length - (changes[i + 1].value.endsWith("\n") ? 1 : 0)

			// Calculate the line number where this modification occurs
			let lineNum = 0
			for (let j = 0; j < i; j++) {
				if (!changes[j].removed) {
					lineNum += changes[j].value.split("\n").length - (changes[j].value.endsWith("\n") ? 1 : 0)
				}
			}

			// Remove from added/deleted arrays
			for (let k = 0; k < addedCount; k++) {
				const idx = added.indexOf(lineNum + k)
				if (idx !== -1) added.splice(idx, 1)
			}
			for (let k = 0; k < removedCount; k++) {
				const idx = deleted.indexOf(lineNum + k)
				if (idx !== -1) deleted.splice(idx, 1)
			}

			// Add to modified
			for (let k = 0; k < Math.max(removedCount, addedCount); k++) {
				if (!modifiedLines.includes(lineNum + k)) {
					modifiedLines.push(lineNum + k)
				}
			}

			i += 2 // Skip both removal and addition
		} else {
			i++
		}
	}

	return { added, deleted, modified: modifiedLines }
}

/**
 * Apply visual decorations to show pending file changes
 */
export function applyPendingFileDecorations(editor: vscode.TextEditor, originalContent: string, newContent: string): void {
	if (!editor || editor.document.isClosed) {
		return
	}

	const diff = computeDiff(originalContent, newContent)

	const addedRanges: vscode.Range[] = diff.added.map((lineNum) => {
		const line = editor.document.lineAt(Math.min(lineNum, editor.document.lineCount - 1))
		return new vscode.Range(line.lineNumber, 0, line.lineNumber, line.text.length)
	})

	const deletedRanges: vscode.Range[] = diff.deleted.map((lineNum) => {
		if (lineNum >= editor.document.lineCount) {
			return new vscode.Range(editor.document.lineCount - 1, 0, editor.document.lineCount - 1, 0)
		}
		const line = editor.document.lineAt(lineNum)
		return new vscode.Range(line.lineNumber, 0, line.lineNumber, line.text.length)
	})

	const modifiedRanges: vscode.Range[] = diff.modified.map((lineNum) => {
		if (lineNum >= editor.document.lineCount) {
			return new vscode.Range(editor.document.lineCount - 1, 0, editor.document.lineCount - 1, 0)
		}
		const line = editor.document.lineAt(lineNum)
		return new vscode.Range(line.lineNumber, 0, line.lineNumber, line.text.length)
	})

	editor.setDecorations(addedLineDecorationType, addedRanges)
	editor.setDecorations(deletedLineDecorationType, deletedRanges)
	editor.setDecorations(modifiedLineDecorationType, modifiedRanges)

	console.log(
		`[PendingFileDecorations] Applied decorations: ${addedRanges.length} added, ${deletedRanges.length} deleted, ${modifiedRanges.length} modified`,
	)
}

/**
 * Clear all pending file decorations
 */
export function clearPendingFileDecorations(editor: vscode.TextEditor): void {
	if (!editor || editor.document.isClosed) {
		return
	}

	editor.setDecorations(addedLineDecorationType, [])
	editor.setDecorations(deletedLineDecorationType, [])
	editor.setDecorations(modifiedLineDecorationType, [])

	console.log("[PendingFileDecorations] Cleared all decorations")
}

/**
 * Notify markdown editor extension to apply decorations
 * This sends decoration data to the markdown editor webview if it's open
 * @deprecated Markdown editor extension has been removed - this is now a no-op
 */
export async function notifyMarkdownEditorDecorations(
	absolutePath: string,
	originalContent: string,
	newContent: string,
): Promise<void> {
	// Markdown editor extension has been removed - this function is kept for API compatibility
}

/**
 * Notify markdown editor extension to clear decorations
 * @deprecated Markdown editor extension has been removed - this is now a no-op
 */
export async function notifyMarkdownEditorClearDecorations(absolutePath: string): Promise<void> {
	// Markdown editor extension has been removed - this function is kept for API compatibility
}
