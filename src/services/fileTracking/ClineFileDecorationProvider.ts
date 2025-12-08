import * as vscode from "vscode"
import { ClineFileTracker } from "./ClineFileTracker"

/**
 * File decoration provider that shows "ai" badge on files/folders created by Cline
 */
export class ClineFileDecorationProvider implements vscode.FileDecorationProvider {
	private readonly tracker = ClineFileTracker.getInstance()

	readonly onDidChangeFileDecorations = this.tracker.onDidChangeFileDecorations

	provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
		if (token.isCancellationRequested) {
			return undefined
		}

		// Check if this file/folder was created by Cline
		if (this.tracker.isTracked(uri)) {
			return new vscode.FileDecoration(
				"ai", // Badge text
				"Created by ritivel", // Tooltip
				new vscode.ThemeColor("gitDecoration.addedResourceForeground"), // Color
			)
		}

		return undefined
	}
}
