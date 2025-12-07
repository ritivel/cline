import { SVGProps } from "react"
import type { Environment } from "../../../src/config"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * ClineLogoVariable component renders the Ritivel logo with automatic theme adaptation
 * and environment-based color indicators.
 *
 * This component uses VS Code theme variables for the fill color, with environment-specific colors:
 * - Local: yellow/orange (development/experimental)
 * - Staging: blue (stable testing)
 * - Production: gray/white (default icon color)
 *
 * @param {SVGProps<SVGSVGElement> & { environment?: Environment }} props - Standard SVG props plus optional environment
 * @returns {JSX.Element} SVG Ritivel logo that adapts to VS Code themes and environment
 */
const ClineLogoVariable = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props

	// Determine fill color based on environment
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg fill="none" height="60" viewBox="0 0 300 60" width="300" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<text
				dominantBaseline="middle"
				fill={fillColor}
				fontFamily="sans-serif"
				fontSize="48"
				fontWeight="bold"
				textAnchor="middle"
				x="50%"
				y="50%">
				ritivel
			</text>
		</svg>
	)
}
export default ClineLogoVariable
