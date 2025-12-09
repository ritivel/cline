import * as vscode from "vscode"

const contextHighlightDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: "rgba(255, 255, 0, 0.2)", // Yellowish highlight, distinct from selection
	isWholeLine: false,
	border: "1px solid rgba(255, 255, 0, 0.5)",
	overviewRulerColor: "rgba(255, 255, 0, 0.8)",
	overviewRulerLane: vscode.OverviewRulerLane.Right,
})

export class ContextDecorationController {
	private activeDecorations: Map<string, vscode.Range[]> = new Map()

	constructor() {
		// Listen for editor changes to re-apply decorations if needed
		vscode.window.onDidChangeVisibleTextEditors((editors) => {
			for (const editor of editors) {
				const ranges = this.activeDecorations.get(editor.document.uri.fsPath)
				if (ranges) {
					editor.setDecorations(contextHighlightDecorationType, ranges)
				}
			}
		})
	}

	public addHighlight(editor: vscode.TextEditor, range: vscode.Range) {
		const fsPath = editor.document.uri.fsPath
		const ranges = this.activeDecorations.get(fsPath) || []

		// Add new range
		ranges.push(range)
		this.activeDecorations.set(fsPath, ranges)

		editor.setDecorations(contextHighlightDecorationType, ranges)
	}

	public clearHighlights() {
		// Clear for all active editors
		for (const editor of vscode.window.visibleTextEditors) {
			const ranges = this.activeDecorations.get(editor.document.uri.fsPath)
			if (ranges) {
				editor.setDecorations(contextHighlightDecorationType, [])
			}
		}
		this.activeDecorations.clear()
	}
}

export const contextDecorationController = new ContextDecorationController()
