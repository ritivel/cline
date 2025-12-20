"""Research Paper Search - PubMed/NCBI E-utilities API

Supports PubMed/NCBI E-utilities API for searching research papers.
"""

import os
import time
import sys
import requests
from typing import List, Dict, Optional
from abc import ABC, abstractmethod
import xml.etree.ElementTree as ET
import threading


class BaseSearcher(ABC):
    """Base class for research paper search backends."""

    @abstractmethod
    def search_papers(self, query: str, match_limit: int = 10, **kwargs) -> List[Dict]:
        """Search for research papers.

        Args:
            query: Search query string
            match_limit: Maximum number of papers to return
            **kwargs: Additional backend-specific parameters

        Returns:
            List of paper dictionaries with keys: title, url, pmid, abstract, authors, journal, year
        """
        pass


class PubMedSearcher(BaseSearcher):
    """Research paper search using PubMed/NCBI E-utilities API."""

    # Class-level shared rate limiting (thread-safe)
    _rate_limit_lock = threading.Lock()
    _last_request_time = 0
    _min_request_interval = 0.35  # ~3 requests per second (conservative)
    _max_concurrent_requests = 2  # Limit concurrent requests to avoid overwhelming API
    _request_semaphore = threading.Semaphore(_max_concurrent_requests)

    def __init__(self, api_key: str = None):
        # PubMed API doesn't require a key, but email is recommended for rate limiting
        self.email = os.getenv("PUBMED_EMAIL", "research@example.com")
        self.base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    @classmethod
    def _rate_limit(cls):
        """Enforce rate limiting for PubMed API (thread-safe, shared across all instances)."""
        with cls._rate_limit_lock:
            current_time = time.time()
            time_since_last = current_time - cls._last_request_time
            if time_since_last < cls._min_request_interval:
                sleep_time = cls._min_request_interval - time_since_last
                time.sleep(sleep_time)
            cls._last_request_time = time.time()

    def _make_request_with_retry(self, url: str, params: dict, max_retries: int = 3,
                                 initial_delay: float = 1.0) -> requests.Response:
        """Make a request with retry logic for rate limiting errors."""
        for attempt in range(max_retries):
            try:
                # Acquire semaphore to limit concurrent requests (class-level, shared across instances)
                with PubMedSearcher._request_semaphore:
                    # Apply rate limiting
                    self._rate_limit()

                    response = requests.get(url, params=params, timeout=30)

                    # If we get a 429, wait and retry
                    if response.status_code == 429:
                        if attempt < max_retries - 1:
                            # Exponential backoff: 1s, 2s, 4s
                            delay = initial_delay * (2 ** attempt)
                            print(f"[PubMed] Rate limited (429), waiting {delay:.1f}s before retry {attempt + 1}/{max_retries}...")
                            time.sleep(delay)
                            continue
                        else:
                            response.raise_for_status()

                    response.raise_for_status()
                    return response

            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    delay = initial_delay * (2 ** attempt)
                    print(f"[PubMed] Request error, retrying in {delay:.1f}s... ({attempt + 1}/{max_retries})")
                    time.sleep(delay)
                else:
                    raise
        raise requests.exceptions.RequestException("Max retries exceeded")

    def search_papers(self, query: str, match_limit: int = 10, **kwargs) -> List[Dict]:
        """Search for research papers using PubMed API."""
        # Step 1: Search PubMed and get PMIDs
        search_url = f"{self.base_url}/esearch.fcgi"
        search_params = {
            "db": "pubmed",
            "term": query,
            "retmax": min(match_limit, 100),  # PubMed allows up to 100
            "retmode": "json",
            "email": self.email,
            "sort": "relevance"  # Sort by relevance
        }

        try:
            print(f"[PubMed] Searching for: {query}")
            response = self._make_request_with_retry(search_url, search_params)
            search_data = response.json()
            pmids = search_data.get("esearchresult", {}).get("idlist", [])

            if not pmids:
                print("[PubMed] No papers found")
                return []

            print(f"[PubMed] Found {len(pmids)} papers, fetching details...")

            # Step 2: Fetch detailed information for each paper
            fetch_url = f"{self.base_url}/efetch.fcgi"
            fetch_params = {
                "db": "pubmed",
                "id": ",".join(pmids),
                "retmode": "xml",
                "email": self.email
            }

            response = self._make_request_with_retry(fetch_url, fetch_params)

            # Parse XML response
            root = ET.fromstring(response.content)

            papers = []
            for article in root.findall(".//PubmedArticle"):
                # Extract title
                title_elem = article.find(".//ArticleTitle")
                title = title_elem.text if title_elem is not None else "Untitled"

                # Extract abstract
                abstract_parts = []
                for abstract_text in article.findall(".//AbstractText"):
                    if abstract_text.text:
                        # Handle structured abstracts (Label attribute)
                        label = abstract_text.get("Label", "")
                        if label:
                            abstract_parts.append(f"{label}: {abstract_text.text}")
                        else:
                            abstract_parts.append(abstract_text.text)
                abstract = " ".join(abstract_parts)

                # Extract PMID for URL
                pmid_elem = article.find(".//PMID")
                pmid = pmid_elem.text if pmid_elem is not None else ""
                url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}" if pmid else ""

                # Extract authors (first few)
                authors = []
                for author in article.findall(".//Author")[:3]:
                    last_name = author.find("LastName")
                    first_name = author.find("ForeName")
                    if last_name is not None and first_name is not None:
                        authors.append(f"{first_name.text} {last_name.text}")
                    elif last_name is not None:
                        authors.append(last_name.text)

                # Extract journal and year
                journal_elem = article.find(".//Journal/Title")
                journal = journal_elem.text if journal_elem is not None else ""

                year_elem = article.find(".//PubDate/Year")
                year = year_elem.text if year_elem is not None else ""

                papers.append({
                    "title": title,
                    "url": url,
                    "pmid": pmid,
                    "abstract": abstract,
                    "authors": authors,
                    "journal": journal,
                    "year": year
                })

            print(f"[PubMed] Successfully retrieved {len(papers)} papers")
            return papers

        except requests.exceptions.RequestException as e:
            print(f"[PubMed] Error connecting to API: {e}")
            return []
        except ET.ParseError as e:
            print(f"[PubMed] Error parsing XML response: {e}")
            return []
        except Exception as e:
            print(f"[PubMed] Error searching: {e}")
            import traceback
            traceback.print_exc()
            return []


# Backend type constant
BACKEND_PUBMED = "pubmed"

# Default backend selection
def get_default_backend() -> str:
    """Get the default search backend (always PubMed)."""
    return BACKEND_PUBMED


def create_searcher(backend: Optional[str] = None, **kwargs) -> BaseSearcher:
    """Factory function to create a PubMed search backend instance.

    Args:
        backend: Backend type (ignored, always uses PubMed)
        **kwargs: Additional arguments passed to the searcher constructor

    Returns:
        PubMedSearcher instance
    """
    return PubMedSearcher(**kwargs)


# For backward compatibility
class ResearchPaperSearcher:
    """Backward-compatible wrapper that uses PubMed searcher."""

    def __init__(self, api_key: str = None, backend: Optional[str] = None):
        """Initialize searcher (always uses PubMed).

        Args:
            api_key: Ignored (PubMed doesn't require API key)
            backend: Ignored (always uses PubMed)
        """
        self._searcher = create_searcher(backend=backend)
        self.backend = BACKEND_PUBMED

    def search_papers(self, query: str, match_limit: int = 10, **kwargs) -> List[Dict]:
        """Search for papers using PubMed."""
        return self._searcher.search_papers(query, match_limit=match_limit, **kwargs)


def main():
    """Test function for command-line usage."""
    if len(sys.argv) < 2:
        print("Usage: python research_paper_search.py '<query>' [limit]")
        print("\nUses PubMed/NCBI API (free, no key required)")
        print("\nExamples:")
        print("  python research_paper_search.py 'Levofloxacin bioavailability'")
        print("  python research_paper_search.py 'Levofloxacin bioavailability' 10")
        sys.exit(1)

    query = sys.argv[1]
    limit = 10

    # Parse arguments
    if len(sys.argv) > 2 and sys.argv[2].isdigit():
        limit = int(sys.argv[2])

    try:
        searcher = create_searcher()
        print(f"Using backend: {searcher.__class__.__name__}\n")
        papers = searcher.search_papers(query, match_limit=limit)

        print(f"\n{'='*80}")
        print(f"Found {len(papers)} papers:")
        print(f"{'='*80}\n")

        for i, p in enumerate(papers, 1):
            print(f"{i}. {p['title']}")
            print(f"   URL: {p['url']}")
            if p.get('pmid'):
                print(f"   PMID: {p['pmid']}")
            if p.get('authors'):
                print(f"   Authors: {', '.join(p['authors'])}")
            if p.get('journal'):
                print(f"   Journal: {p['journal']}")
            if p.get('year'):
                print(f"   Year: {p['year']}")
            if p.get('abstract'):
                abstract_preview = p['abstract'][:200] + "..." if len(p['abstract']) > 200 else p['abstract']
                print(f"   Abstract: {abstract_preview}")
            print()
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
