import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"

interface NotificationOptions {
	title?: string
	subtitle?: string
	message: string
	type?: "info" | "warning" | "error"
}

export async function showSystemNotification(options: NotificationOptions): Promise<void> {
	try {
		const { title = "Ritivel", subtitle, message, type = "info" } = options

		if (!message) {
			throw new Error("Message is required")
		}

		// Construct the full notification message
		const fullMessage = subtitle ? `${subtitle}: ${message}` : message
		const prefixedMessage = `[${title}] ${fullMessage}`

		// Map notification type to ShowMessageType
		let messageType: ShowMessageType
		switch (type) {
			case "error":
				messageType = ShowMessageType.ERROR
				break
			case "warning":
				messageType = ShowMessageType.WARNING
				break
			case "info":
			default:
				messageType = ShowMessageType.INFORMATION
				break
		}

		// Use HostProvider's window abstraction for notifications
		HostProvider.window.showMessage({
			type: messageType,
			message: prefixedMessage,
		})
	} catch (error) {
		console.error("Could not show VS Code notification", error)
	}
}
