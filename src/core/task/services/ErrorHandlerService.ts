/**
 * Error types that can be handled
 */
export enum ErrorType {
	RateLimit = "RATE_LIMIT",
	ContextWindowExceeded = "CONTEXT_WINDOW_EXCEEDED",
	ApiError = "API_ERROR",
	NetworkError = "NETWORK_ERROR",
	Timeout = "TIMEOUT",
	Unknown = "UNKNOWN",
}

/**
 * Classification result for an error
 */
export interface ErrorClassification {
	type: ErrorType
	isRetryable: boolean
	suggestedDelay: number
	message: string
	originalError: unknown
}

/**
 * Retry configuration
 */
export interface RetryConfig {
	maxRetries: number
	baseDelay: number
	maxDelay: number
	backoffMultiplier: number
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
	success: boolean
	result?: T
	error?: ErrorClassification
	attempts: number
}

/**
 * Service for handling errors in the section generation pipeline
 * Provides retry logic, error classification, and recovery strategies
 */
export class ErrorHandlerService {
	private defaultConfig: RetryConfig = {
		maxRetries: 5,
		baseDelay: 2000,
		maxDelay: 60000,
		backoffMultiplier: 2,
	}

	constructor(config?: Partial<RetryConfig>) {
		if (config) {
			this.defaultConfig = { ...this.defaultConfig, ...config }
		}
	}

	/**
	 * Classifies an error to determine handling strategy
	 */
	classifyError(error: unknown): ErrorClassification {
		const errorString = this.getErrorString(error)
		const lowerError = errorString.toLowerCase()

		// Rate limit errors (429)
		if (
			lowerError.includes("429") ||
			lowerError.includes("rate limit") ||
			lowerError.includes("too many requests") ||
			lowerError.includes("tpm") ||
			lowerError.includes("tokens per min")
		) {
			const suggestedDelay = this.parseRetryAfter(errorString)
			return {
				type: ErrorType.RateLimit,
				isRetryable: true,
				suggestedDelay: suggestedDelay || this.defaultConfig.baseDelay,
				message: "Rate limit exceeded. Will retry after delay.",
				originalError: error,
			}
		}

		// Context window exceeded
		if (
			lowerError.includes("context") ||
			lowerError.includes("token limit") ||
			lowerError.includes("maximum context") ||
			lowerError.includes("context length") ||
			lowerError.includes("too long")
		) {
			return {
				type: ErrorType.ContextWindowExceeded,
				isRetryable: true,
				suggestedDelay: 0, // No delay needed, just reduce context
				message: "Context window exceeded. Will reduce context and retry.",
				originalError: error,
			}
		}

		// Network errors
		if (
			lowerError.includes("network") ||
			lowerError.includes("econnrefused") ||
			lowerError.includes("enotfound") ||
			lowerError.includes("etimedout") ||
			lowerError.includes("socket")
		) {
			return {
				type: ErrorType.NetworkError,
				isRetryable: true,
				suggestedDelay: this.defaultConfig.baseDelay,
				message: "Network error. Will retry.",
				originalError: error,
			}
		}

		// Timeout errors
		if (lowerError.includes("timeout") || lowerError.includes("timed out")) {
			return {
				type: ErrorType.Timeout,
				isRetryable: true,
				suggestedDelay: this.defaultConfig.baseDelay,
				message: "Request timed out. Will retry.",
				originalError: error,
			}
		}

		// API errors (5xx)
		if (
			lowerError.includes("500") ||
			lowerError.includes("502") ||
			lowerError.includes("503") ||
			lowerError.includes("504") ||
			lowerError.includes("internal server") ||
			lowerError.includes("service unavailable")
		) {
			return {
				type: ErrorType.ApiError,
				isRetryable: true,
				suggestedDelay: this.defaultConfig.baseDelay * 2,
				message: "API server error. Will retry.",
				originalError: error,
			}
		}

		// Unknown error - not retryable by default
		return {
			type: ErrorType.Unknown,
			isRetryable: false,
			suggestedDelay: 0,
			message: `Unknown error: ${errorString.substring(0, 200)}`,
			originalError: error,
		}
	}

	/**
	 * Executes a function with retry logic
	 */
	async executeWithRetry<T>(
		fn: () => Promise<T>,
		config?: Partial<RetryConfig>,
		onRetry?: (attempt: number, error: ErrorClassification) => void,
	): Promise<RetryResult<T>> {
		const retryConfig = { ...this.defaultConfig, ...config }
		let lastError: ErrorClassification | undefined

		for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
			try {
				const result = await fn()
				return {
					success: true,
					result,
					attempts: attempt,
				}
			} catch (error) {
				lastError = this.classifyError(error)

				console.log(
					`[ErrorHandlerService] Attempt ${attempt}/${retryConfig.maxRetries} failed: ${lastError.type} - ${lastError.message}`,
				)

				// If not retryable or last attempt, stop
				if (!lastError.isRetryable || attempt === retryConfig.maxRetries) {
					break
				}

				// Notify about retry
				if (onRetry) {
					onRetry(attempt, lastError)
				}

				// Calculate delay with exponential backoff
				const delay = Math.min(
					lastError.suggestedDelay || retryConfig.baseDelay * retryConfig.backoffMultiplier ** (attempt - 1),
					retryConfig.maxDelay,
				)

				console.log(`[ErrorHandlerService] Waiting ${delay}ms before retry...`)
				await this.sleep(delay)
			}
		}

		return {
			success: false,
			error: lastError,
			attempts: retryConfig.maxRetries,
		}
	}

	/**
	 * Executes a function with context reduction on failure
	 * Useful for handling context window exceeded errors
	 */
	async executeWithContextReduction<T>(
		fn: (reductionFactor: number) => Promise<T>,
		maxReductions: number = 3,
		reductionStep: number = 0.25,
	): Promise<RetryResult<T>> {
		let reductionFactor = 1.0
		let lastError: ErrorClassification | undefined

		for (let attempt = 0; attempt <= maxReductions; attempt++) {
			try {
				const result = await fn(reductionFactor)
				return {
					success: true,
					result,
					attempts: attempt + 1,
				}
			} catch (error) {
				lastError = this.classifyError(error)

				console.log(`[ErrorHandlerService] Context attempt ${attempt + 1}/${maxReductions + 1} failed: ${lastError.type}`)

				// Only reduce context for context window errors
				if (lastError.type !== ErrorType.ContextWindowExceeded) {
					// For other errors, use standard retry
					return this.executeWithRetry(() => fn(reductionFactor))
				}

				// Reduce context for next attempt
				reductionFactor -= reductionStep

				if (reductionFactor <= 0) {
					break
				}

				console.log(`[ErrorHandlerService] Reducing context to ${Math.round(reductionFactor * 100)}% for next attempt`)
			}
		}

		return {
			success: false,
			error: lastError,
			attempts: maxReductions + 1,
		}
	}

	/**
	 * Parses retry-after value from error message
	 */
	private parseRetryAfter(errorMessage: string): number | null {
		// Match patterns like "try again in 4.806s" or "retry after 5 seconds"
		const patterns = [/try again in ([\d.]+)s/i, /retry after ([\d.]+)\s*(?:seconds?)?/i, /wait ([\d.]+)\s*(?:seconds?)?/i]

		for (const pattern of patterns) {
			const match = errorMessage.match(pattern)
			if (match) {
				return Math.ceil(parseFloat(match[1]) * 1000)
			}
		}

		return null
	}

	/**
	 * Converts error to string
	 */
	private getErrorString(error: unknown): string {
		if (error instanceof Error) {
			return error.message
		}
		if (typeof error === "string") {
			return error
		}
		return String(error)
	}

	/**
	 * Sleep for a given duration
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * Creates a wrapper function that automatically retries on failure
	 */
	wrapWithRetry<TArgs extends unknown[], TResult>(
		fn: (...args: TArgs) => Promise<TResult>,
		config?: Partial<RetryConfig>,
	): (...args: TArgs) => Promise<TResult> {
		return async (...args: TArgs) => {
			const result = await this.executeWithRetry(() => fn(...args), config)
			if (result.success && result.result !== undefined) {
				return result.result
			}
			throw result.error?.originalError || new Error("Operation failed after retries")
		}
	}

	/**
	 * Checks if an error is of a specific type
	 */
	isErrorType(error: unknown, type: ErrorType): boolean {
		const classification = this.classifyError(error)
		return classification.type === type
	}

	/**
	 * Gets retry delay for an error
	 */
	getRetryDelay(error: unknown, attempt: number): number {
		const classification = this.classifyError(error)

		if (classification.suggestedDelay) {
			return classification.suggestedDelay
		}

		return Math.min(
			this.defaultConfig.baseDelay * this.defaultConfig.backoffMultiplier ** attempt,
			this.defaultConfig.maxDelay,
		)
	}
}
