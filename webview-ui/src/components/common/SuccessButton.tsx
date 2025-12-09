import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface SuccessButtonTWProps extends React.ComponentProps<typeof VSCodeButton> {}

const SuccessButtonTW: React.FC<SuccessButtonTWProps> = (props) => {
	return (
		<VSCodeButton
			{...props}
			className={`
				bg-[#7BB898]!
				border-[#7BB898]!
				text-white!
				hover:bg-[#8BC4A8]!
				hover:border-[#8BC4A8]!
				active:bg-[#6AAA88]!
				active:border-[#6AAA88]!
				${props.className || ""}
			`
				.replace(/\s+/g, " ")
				.trim()}
		/>
	)
}

export default SuccessButtonTW
