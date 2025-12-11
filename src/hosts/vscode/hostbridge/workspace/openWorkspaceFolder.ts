import * as vscode from "vscode"

import { OpenWorkspaceFolderRequest, OpenWorkspaceFolderResponse } from "@/shared/proto/index.host"

export async function openWorkspaceFolder(request: OpenWorkspaceFolderRequest): Promise<OpenWorkspaceFolderResponse> {
	const workspaceUri = vscode.Uri.file(request.path || "")
	await vscode.commands.executeCommand("vscode.openFolder", workspaceUri, false)
	return {}
}
