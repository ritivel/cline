import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface DangerButtonProps extends React.ComponentProps<typeof VSCodeButton> {}

const DangerButton: React.FC<DangerButtonProps> = (props) => {
	return (
		<VSCodeButton
			{...props}
			className={`
				bg-[#D98B8B]!
				border-[#D98B8B]!
				text-white!
				hover:bg-[#E8A8A8]!
				hover:border-[#E8A8A8]!
				active:bg-[#C87878]!
				active:border-[#C87878]!
				${props.className || ""}
			`}
		/>
	)
}

export default DangerButton
