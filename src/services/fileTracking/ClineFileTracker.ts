import * as path from "path"
import * as vscode from "vscode"
import { EventEmitter } from "vscode"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Service to track files and folders created by Cline
 * Used for applying "ai" decorations
 */
export class ClineFileTracker {
	private static instance: ClineFileTracker
	private trackedPaths = new Set<string>()
	private readonly _onDidChangeFileDecorations = new EventEmitter<vscode.Uri | vscode.Uri[] | undefined>()
	readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event

	private constructor() {}

	static getInstance(): ClineFileTracker {
		if (!ClineFileTracker.instance) {
			ClineFileTracker.instance = new ClineFileTracker()
		}
		return ClineFileTracker.instance
	}

	/**
	 * Track a file or folder as created by Cline
	 */
	trackFile(uri: vscode.Uri | string): void {
		const uriString = typeof uri === "string" ? vscode.Uri.file(uri).toString() : uri.toString()
		this.trackedPaths.add(uriString)

		// Also track parent directories so decorations propagate (fire and forget)
		const fileUri = typeof uri === "string" ? vscode.Uri.file(uri) : uri
		this.trackParentDirectories(fileUri).catch(() => {
			// Ignore errors in parent directory tracking
		})

		// Notify that decorations changed
		this._onDidChangeFileDecorations.fire(fileUri)
	}

	/**
	 * Track multiple files/folders
	 */
	trackFiles(uris: (vscode.Uri | string)[]): void {
		const fileUris: vscode.Uri[] = []
		for (const uri of uris) {
			const fileUri = typeof uri === "string" ? vscode.Uri.file(uri) : uri
			const uriString = fileUri.toString()
			this.trackedPaths.add(uriString)
			fileUris.push(fileUri)
		}

		// Track parent directories for all files (fire and forget)
		for (const fileUri of fileUris) {
			this.trackParentDirectories(fileUri).catch(() => {
				// Ignore errors in parent directory tracking
			})
		}

		// Notify that decorations changed
		this._onDidChangeFileDecorations.fire(fileUris)
	}

	/**
	 * Track parent directories so decorations can propagate
	 */
	private async trackParentDirectories(uri: vscode.Uri): Promise<void> {
		let currentPath = path.dirname(uri.fsPath)
		const trackedUris: vscode.Uri[] = []

		try {
			const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
			if (!workspacePaths.paths || workspacePaths.paths.length === 0) {
				return
			}

			const workspaceRoot = workspacePaths.paths[0]

			// Track all parent directories up to workspace root
			while (currentPath !== workspaceRoot && currentPath !== path.dirname(currentPath)) {
				const dirUri = vscode.Uri.file(currentPath)
				if (!this.trackedPaths.has(dirUri.toString())) {
					this.trackedPaths.add(dirUri.toString())
					trackedUris.push(dirUri)
				}
				currentPath = path.dirname(currentPath)
			}

			// Notify about parent directory decorations if any were added
			if (trackedUris.length > 0) {
				this._onDidChangeFileDecorations.fire(trackedUris.length === 1 ? trackedUris[0] : trackedUris)
			}
		} catch {
			// If workspace paths can't be retrieved, skip parent tracking
			return
		}
	}

	/**
	 * Check if a file/folder is tracked (created by Cline)
	 */
	isTracked(uri: vscode.Uri): boolean {
		return this.trackedPaths.has(uri.toString())
	}

	/**
	 * Remove tracking for a file/folder
	 */
	untrackFile(uri: vscode.Uri | string): void {
		const uriString = typeof uri === "string" ? vscode.Uri.file(uri).toString() : uri.toString()
		this.trackedPaths.delete(uriString)
		const fileUri = typeof uri === "string" ? vscode.Uri.file(uri) : uri
		this._onDidChangeFileDecorations.fire(fileUri)
	}

	/**
	 * Clear all tracked files
	 */
	clear(): void {
		this.trackedPaths.clear()
		this._onDidChangeFileDecorations.fire(undefined)
	}
}
