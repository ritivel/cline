import * as vscode from "vscode"
import { ShowTextDocumentRequest, TextEditorInfo } from "@/shared/proto/host/window"
import { arePathsEqual } from "@/utils/path"

export async function showTextDocument(request: ShowTextDocumentRequest): Promise<TextEditorInfo> {
	// Convert file path to URI
	const uri = vscode.Uri.file(request.path)

	// Check if the document is already open in a tab group that's not in the active editor's column.
	//  If it is, then close it (if not dirty) so that we don't duplicate tabs
	try {
		for (const group of vscode.window.tabGroups.all) {
			const existingTab = group.tabs.find(
				(tab) => tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, uri.fsPath),
			)
			if (existingTab) {
				const activeColumn = vscode.window.activeTextEditor?.viewColumn
				const tabColumn = vscode.window.tabGroups.all.find((group) => group.tabs.includes(existingTab))?.viewColumn
				if (activeColumn && activeColumn !== tabColumn && !existingTab.isDirty) {
					await vscode.window.tabGroups.close(existingTab)
				}
				break
			}
		}
	} catch {} // not essential, sometimes tab operations fail

	// For .tex files, only open with overleaf-visual editor
	if (request.path.endsWith(".tex")) {
		try {
			await vscode.commands.executeCommand("vscode.openWith", uri, "overleafVisual.editor", {
				preserveFocus: request.options?.preserveFocus ?? false,
				preview: request.options?.preview ?? false,
			})
			// Wait a bit for the editor to open, then get the editor info
			await new Promise((resolve) => setTimeout(resolve, 100))
			const activeEditor = vscode.window.activeTextEditor
			if (activeEditor && activeEditor.document.uri.fsPath === uri.fsPath) {
				return TextEditorInfo.create({
					documentPath: activeEditor.document.uri.fsPath,
					viewColumn: activeEditor.viewColumn,
					isActive: true,
				})
			}
			// If we can't get editor info, return a basic response
			return TextEditorInfo.create({
				documentPath: uri.fsPath,
				isActive: false,
			})
		} catch (error) {
			// If overleaf-visual is not available, don't open the file
			console.log(`Could not open .tex file with overleaf-visual: ${error}`)
			// Return a response indicating the file wasn't opened
			return TextEditorInfo.create({
				documentPath: uri.fsPath,
				isActive: false,
			})
		}
	}

	// For non-.tex files, use regular text editor
	const options: vscode.TextDocumentShowOptions = {}

	if (request.options?.preview !== undefined) {
		options.preview = request.options.preview
	}
	if (request.options?.preserveFocus !== undefined) {
		options.preserveFocus = request.options.preserveFocus
	}
	if (request.options?.viewColumn !== undefined) {
		options.viewColumn = request.options.viewColumn
	}

	const editor = await vscode.window.showTextDocument(uri, options)

	return TextEditorInfo.create({
		documentPath: editor.document.uri.fsPath,
		viewColumn: editor.viewColumn,
		isActive: vscode.window.activeTextEditor === editor,
	})
}
