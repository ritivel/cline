/**
 * PubMed/NCBI E-utilities API client for searching research papers
 * Ported from research_paper_search.py
 */

import type { Paper, PubMedSearchResult } from "./types"

const PUBMED_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
const DEFAULT_EMAIL = "pavan@ritivel.com"
const MIN_REQUEST_INTERVAL_MS = 350 // ~3 requests per second
const MAX_RETRIES = 3

// Rate limiting state
let lastRequestTime = 0

/**
 * Enforce rate limiting for PubMed API
 */
async function rateLimit(): Promise<void> {
	const now = Date.now()
	const timeSinceLast = now - lastRequestTime
	if (timeSinceLast < MIN_REQUEST_INTERVAL_MS) {
		await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLast))
	}
	lastRequestTime = Date.now()
}

/**
 * Make a request with retry logic for rate limiting errors
 */
async function makeRequestWithRetry(
	url: string,
	params: Record<string, string>,
	maxRetries: number = MAX_RETRIES,
): Promise<Response> {
	const searchParams = new URLSearchParams(params)
	const fullUrl = `${url}?${searchParams.toString()}`

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		await rateLimit()

		try {
			const response = await fetch(fullUrl, {
				method: "GET",
				headers: {
					Accept: "application/json,application/xml",
				},
			})

			if (response.status === 429) {
				if (attempt < maxRetries - 1) {
					const delay = 2 ** attempt * 1000 // Exponential backoff
					console.log(`[PubMed] Rate limited (429), waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}...`)
					await new Promise((resolve) => setTimeout(resolve, delay))
					continue
				}
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			return response
		} catch (error) {
			if (attempt < maxRetries - 1) {
				const delay = 2 ** attempt * 1000
				console.log(`[PubMed] Request error, retrying in ${delay}ms... (${attempt + 1}/${maxRetries})`)
				await new Promise((resolve) => setTimeout(resolve, delay))
			} else {
				throw error
			}
		}
	}

	throw new Error("Max retries exceeded")
}

/**
 * Parse XML response from PubMed to extract paper details
 */
function parseXmlResponse(xmlText: string): Paper[] {
	const papers: Paper[] = []

	// Simple XML parsing using regex (since we're in a Node.js environment without DOM)
	const articleMatches = xmlText.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || []

	for (const articleXml of articleMatches) {
		// Extract PMID
		const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/)
		const pmid = pmidMatch?.[1] || ""

		// Extract title
		const titleMatch = articleXml.match(/<ArticleTitle>([^<]*)<\/ArticleTitle>/)
		const title = titleMatch?.[1] || "Untitled"

		// Extract abstract - handle multiple AbstractText elements
		const abstractParts: string[] = []
		const abstractMatches = articleXml.matchAll(/<AbstractText[^>]*(?:Label="([^"]*)")?[^>]*>([^<]*)<\/AbstractText>/g)
		for (const match of abstractMatches) {
			const label = match[1]
			const text = match[2]
			if (label) {
				abstractParts.push(`${label}: ${text}`)
			} else {
				abstractParts.push(text)
			}
		}
		const abstract = abstractParts.join(" ")

		// Extract authors (first 3)
		const authors: string[] = []
		const authorMatches = articleXml.matchAll(
			/<Author[^>]*>[\s\S]*?(?:<ForeName>([^<]*)<\/ForeName>)?[\s\S]*?(?:<LastName>([^<]*)<\/LastName>)?[\s\S]*?<\/Author>/g,
		)
		let authorCount = 0
		for (const match of authorMatches) {
			if (authorCount >= 3) break
			const firstName = match[1] || ""
			const lastName = match[2] || ""
			if (lastName) {
				authors.push(firstName ? `${firstName} ${lastName}` : lastName)
				authorCount++
			}
		}

		// Extract journal
		const journalMatch = articleXml.match(/<Journal>[\s\S]*?<Title>([^<]*)<\/Title>/)
		const journal = journalMatch?.[1] || ""

		// Extract year
		const yearMatch = articleXml.match(/<PubDate>[\s\S]*?<Year>(\d+)<\/Year>/)
		const year = yearMatch?.[1] || ""

		papers.push({
			title: decodeHtmlEntities(title),
			url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}` : "",
			pmid,
			abstract: decodeHtmlEntities(abstract),
			authors,
			journal: decodeHtmlEntities(journal),
			year,
		})
	}

	return papers
}

/**
 * Decode HTML entities in text
 */
function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
}

/**
 * Search for research papers using PubMed API
 */
export async function searchPubMed(query: string, matchLimit: number = 10): Promise<PubMedSearchResult> {
	console.log(`[PubMed] Searching for: ${query}`)

	try {
		// Step 1: Search PubMed and get PMIDs
		const searchParams: Record<string, string> = {
			db: "pubmed",
			term: query,
			retmax: Math.min(matchLimit, 100).toString(),
			retmode: "json",
			email: DEFAULT_EMAIL,
			sort: "relevance",
		}

		const searchResponse = await makeRequestWithRetry(`${PUBMED_BASE_URL}/esearch.fcgi`, searchParams)
		const searchData = await searchResponse.json()
		const pmids: string[] = searchData?.esearchresult?.idlist || []

		if (pmids.length === 0) {
			console.log("[PubMed] No papers found")
			return { query, count: 0, papers: [] }
		}

		console.log(`[PubMed] Found ${pmids.length} papers, fetching details...`)

		// Step 2: Fetch detailed information for each paper
		const fetchParams: Record<string, string> = {
			db: "pubmed",
			id: pmids.join(","),
			retmode: "xml",
			email: DEFAULT_EMAIL,
		}

		const fetchResponse = await makeRequestWithRetry(`${PUBMED_BASE_URL}/efetch.fcgi`, fetchParams)
		const xmlText = await fetchResponse.text()

		// Parse XML response
		const papers = parseXmlResponse(xmlText)

		console.log(`[PubMed] Successfully retrieved ${papers.length} papers`)

		return {
			query,
			count: papers.length,
			papers,
		}
	} catch (error) {
		console.error(`[PubMed] Error searching: ${error}`)
		return { query, count: 0, papers: [] }
	}
}

/**
 * PubMed searcher class for compatibility with Python version
 */
export class PubMedSearcher {
	async searchPapers(query: string, matchLimit: number = 10): Promise<Paper[]> {
		const result = await searchPubMed(query, matchLimit)
		return result.papers
	}
}
