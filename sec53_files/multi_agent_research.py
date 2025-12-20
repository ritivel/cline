"""Multi-Agent Research System for ICH Module 5 Sections

This system uses a planning agent to parse regulation files, creates worker agents
for each subsection, and a compiler agent to generate the final JSON output.
"""

import os
import json
import re
import datetime
import asyncio
import time
from typing import List, Dict, Any, TypedDict, Annotated
from pathlib import Path
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain.chat_models import init_chat_model
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from research_paper_search import ResearchPaperSearcher, create_searcher, get_default_backend

# Try to import OpenAI rate limit error
try:
    from openai import RateLimitError
except ImportError:
    # Fallback if openai is not directly importable
    RateLimitError = None


# Initialize the research paper searcher
_searcher = None
_searcher_backend = None


def get_searcher(backend: str = None) -> ResearchPaperSearcher:
    """Get or create the ResearchPaperSearcher instance.

    Args:
        backend: Backend type ("parallel" or "pubmed"). If None, uses environment variable or auto-detects.

    Returns:
        ResearchPaperSearcher instance
    """
    global _searcher, _searcher_backend

    # Use provided backend or default
    if backend is None:
        backend = get_default_backend()

    # Recreate searcher if backend changed
    if _searcher is None or _searcher_backend != backend:
        _searcher = ResearchPaperSearcher(backend=backend)
        _searcher_backend = backend

    return _searcher


def create_search_tool(backend: str = None):
    """Create a search_research_papers tool for PubMed.

    Args:
        backend: Ignored (always uses PubMed)

    Returns:
        Tool function for searching research papers
    """
    @tool
    def search_research_papers(query: str, match_limit: int = 5) -> str:
        """Search for research papers using PubMed/NCBI database.

        This tool uses PubMed/NCBI E-utilities API to search for peer-reviewed research papers.
        PubMed contains biomedical literature from MEDLINE, life science journals, and online books.

        IMPORTANT FOR QUERY CONSTRUCTION:
        - Use PubMed search syntax: combine terms with AND, OR, NOT
        - Use square brackets for MeSH terms: [MeSH Terms]
        - Use quotes for exact phrases: "exact phrase"
        - Use field tags: [Title], [Abstract], [Title/Abstract]
        - Combine drug name with specific terms: "Levofloxacin"[Title/Abstract] AND "bioavailability"[Title/Abstract]
        - Be specific: include study type, methodology, or regulatory context when relevant

        Args:
            query: PubMed search query using PubMed syntax (e.g., "Levofloxacin"[Title/Abstract] AND "bioequivalence"[Title/Abstract])
            match_limit: Maximum number of papers to return (default: 5).

        Returns:
            A JSON string containing a list of research papers with their titles, URLs, PMIDs, abstracts, authors, journals, and years.
        """
        try:
            searcher = get_searcher(backend=backend)
            papers = searcher.search_papers(query, match_limit=match_limit)

            # Format results as JSON string for the agent
            result = {
                "query": query,
                "count": len(papers),
                "papers": papers
            }
            return json.dumps(result, indent=2)
        except Exception as e:
            return f"Error searching for papers: {str(e)}"

    return search_research_papers


def parse_regulation_file(file_path: str) -> Dict[str, Dict[str, str]]:
    """Parse a regulation file to extract section structure.

    Returns a dictionary mapping subsection IDs to their descriptions.
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    sections = {}
    current_section_id = None
    current_section_title = None
    current_description = []

    lines = content.split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Check for section header (e.g., "5.3.1.1 Bioavailability (BA) Study Reports")
        section_match = re.match(r'^(\d+\.\d+\.\d+(?:\.\d+)?)\s+(.+)$', line)
        if section_match:
            # Save previous section if exists
            if current_section_id:
                sections[current_section_id] = {
                    "title": current_section_title,
                    "description": "\n".join(current_description).strip()
                }

            # Start new section
            current_section_id = section_match.group(1)
            current_section_title = section_match.group(2)
            current_description = []
        else:
            # Add to current section description
            if current_section_id:
                current_description.append(line)

    # Save last section
    if current_section_id:
        sections[current_section_id] = {
            "title": current_section_title,
            "description": "\n".join(current_description).strip()
        }

    return sections


def extract_base_drug_name(drug_name: str) -> str:
    """Extract base drug name by removing dosage, USP, and other suffixes.

    Examples:
    - "Levofloxacin USP 250mg" -> "Levofloxacin"
    - "Amoxicillin 500mg" -> "Amoxicillin"
    - "Levofloxacin" -> "Levofloxacin"
    """
    # Remove common patterns: USP, dosage (mg, g, etc.), strength
    import re
    # Remove USP, BP, EP, JP, etc.
    base = re.sub(r'\s+(USP|BP|EP|JP|NF)\s*', ' ', drug_name, flags=re.IGNORECASE)
    # Remove dosage/strength (e.g., "250mg", "500 mg", "10g")
    base = re.sub(r'\s+\d+\s*(mg|g|mcg|µg|ml|mL)\s*', ' ', base, flags=re.IGNORECASE)
    # Remove any remaining numbers at the end
    base = re.sub(r'\s+\d+\s*$', '', base)
    # Clean up multiple spaces
    base = re.sub(r'\s+', ' ', base).strip()
    return base if base else drug_name


def sanitize_filename(name: str) -> str:
    """Sanitize a string for use in filenames.

    Replaces spaces and special characters with underscores.
    """
    import re
    # Replace spaces and special characters with underscores
    sanitized = re.sub(r'[^\w\-_\.]', '_', name)
    # Replace multiple underscores with single underscore
    sanitized = re.sub(r'_+', '_', sanitized)
    return sanitized.strip('_')


def load_drug_context(drug_name: str, base_path: str = ".") -> str:
    """Load drug-specific context from TXT files.

    Uses base drug name (without dosage/USP) for file lookup, but accepts
    full drug name with dosage information.
    """
    base_path = Path(base_path)
    context_parts = []

    # Extract base drug name for file lookup
    base_drug_name = extract_base_drug_name(drug_name)

    # Try to load TXT regulations using base name
    possible_txt = [
        f"{base_drug_name}_regulations.txt",
        f"{base_drug_name}Regulations.txt",
        f"{base_drug_name.lower()}_regulations.txt",
        # Also try with full name in case user created file with full name
        f"{drug_name}_regulations.txt",
        f"{drug_name}Regulations.txt",
        f"{drug_name.lower()}_regulations.txt"
    ]
    for filename in possible_txt:
        filepath = base_path / filename
        if filepath.exists():
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    context_parts.append(f"=== Drug Regulations (TXT) ===\n{f.read()}")
            except Exception as e:
                print(f"Warning: Could not read {filepath}: {e}")
            break

    return "\n\n".join(context_parts) if context_parts else ""


# State schema for the multi-agent system
class ResearchState(TypedDict):
    """State schema for the multi-agent research system."""
    messages: Annotated[list, add_messages]
    regulation_file: str
    drug_name: str
    sections: Dict[str, Dict[str, str]]  # section_id -> {title, description}
    section_results: Dict[str, List[Dict]]  # section_id -> list of papers
    final_json: Dict[str, Any]
    current_section: str


def create_planning_agent(model: str = "openai:gpt-4o", temperature: float = 0.3):
    """Create the planning agent that parses regulation files."""
    llm = init_chat_model(model, temperature=temperature)

    @tool
    def parse_regulation(regulation_file_path: str) -> str:
        """Parse a regulation file to extract section structure.

        Args:
            regulation_file_path: Path to the regulation file.

        Returns:
            JSON string with section structure.
        """
        sections = parse_regulation_file(regulation_file_path)
        return json.dumps(sections, indent=2)

    agent = create_agent(
        model=llm,
        tools=[parse_regulation],
        system_prompt="""You are a planning agent for ICH Module 5 research paper organization.

Your role is to:
1. Parse the regulation file to identify all subsections
2. Extract section IDs, titles, and descriptions
3. Return a structured JSON with all sections found

The regulation file contains ICH Module 5 section structure. Parse it carefully
to identify all subsections (e.g., 5.3.1.1, 5.3.1.2, etc.) and their descriptions.""",
    )

    return agent


def create_worker_agent(section_id: str, section_title: str, section_description: str,
                       drug_name: str, drug_context: str,
                       model: str = "openai:gpt-4o", temperature: float = 0.3,
                       search_backend: str = None):
    """Create a worker agent for a specific subsection.

    Args:
        section_id: Section identifier
        section_title: Section title
        section_description: Section description
        drug_name: Drug name
        drug_context: Drug-specific context
        model: LLM model to use
        temperature: Temperature for LLM
        search_backend: Ignored (always uses PubMed)
    """
    llm = init_chat_model(model, temperature=temperature)

    # Extract base drug name for search queries
    base_drug_name = extract_base_drug_name(drug_name)

    # Create search tool
    search_tool = create_search_tool(backend=search_backend)

    system_prompt = f"""You are a specialized research assistant for ICH Module 5, Section {section_id}: {section_title}

DRUG: {drug_name} (base name: {base_drug_name})

SECTION DESCRIPTION:
{section_description}

{drug_context}

YOUR PRIMARY TASK:
Search PubMed database for research papers that are HIGHLY RELEVANT to Section {section_id} for {drug_name} ANDA submission.

CRITICAL REQUIREMENTS FOR RELEVANCE:
- Papers MUST be directly related to {base_drug_name} (not just similar drugs or drug classes)
- Papers MUST specifically address the section requirements ({section_title})
- Papers MUST be relevant to ANDA submission context (generic drug development, bioequivalence, regulatory submissions)
- EXCLUDE papers that are:
  * About other drugs (even if similar)
  * General methodology papers not specific to {base_drug_name}
  * Case reports or clinical use papers not related to biopharmaceutics/regulatory requirements
  * Papers from other sections (be strict about section boundaries)

PUBMED SEARCH QUERY GUIDELINES:
1. Use PubMed search syntax with field tags for precision:
   - "{base_drug_name}"[Title/Abstract] AND "specific_term"[Title/Abstract]
   - Use [Title/Abstract] to search both title and abstract
   - Use [MeSH Terms] for medical subject headings when appropriate
   - Combine multiple relevant terms with AND

2. Generate 4-8 highly focused queries that target:
   - {base_drug_name} + section-specific terms (e.g., "bioavailability", "bioequivalence", "dissolution")
   - {base_drug_name} + regulatory terms (e.g., "ANDA", "generic", "pharmaceutical equivalence")
   - {base_drug_name} + methodology terms specific to this section
   - Be specific: avoid overly broad queries that return irrelevant papers

3. Example query format:
   "Levofloxacin"[Title/Abstract] AND "bioequivalence"[Title/Abstract] AND ("generic"[Title/Abstract] OR "ANDA"[Title/Abstract])

VALIDATION CRITERIA (STRICT):
For each paper found, verify:
1. Direct relevance: Paper must be about {base_drug_name} specifically (not just mentioned in passing)
2. Section match: Paper must address {section_title} requirements
3. Regulatory context: Paper should relate to generic drug development, ANDA submission, or regulatory requirements
4. Quality: Prefer peer-reviewed research papers over reviews or case reports (unless specifically relevant)
5. Exclude if: Paper is about clinical use, case studies, or other drugs

OUTPUT FORMAT:
Return a JSON array of ONLY highly relevant, validated papers:
[
  {{
    "title": "Exact paper title from PubMed",
    "url": "PubMed URL",
    "description": "Brief description (authors, journal, year, key findings)",
    "relevance_reason": "Specific explanation of why this paper is relevant to Section {section_id} and {base_drug_name} ANDA submission"
  }}
]

IMPORTANT:
- Quality over quantity: Only include papers that clearly meet ALL relevance criteria
- Be strict: It's better to return fewer highly relevant papers than many marginally relevant ones
- Each paper must have a clear, specific relevance_reason explaining its fit for this section
- If no highly relevant papers are found after multiple searches, return an empty array rather than including marginal papers"""

    agent = create_agent(
        model=llm,
        tools=[search_tool],
        system_prompt=system_prompt,
    )

    return agent


def create_deduplication_agent(model: str = "openai:gpt-4o", temperature: float = 0.3):
    """Create the deduplication agent that identifies duplicate papers by index."""
    llm = init_chat_model(model, temperature=temperature)

    agent = create_agent(
        model=llm,
        tools=[],  # No tools needed - just return indices
        system_prompt="""You are a deduplication agent for ICH Module 5 research papers.

Your role is to:
1. Analyze paper titles and URLs across different sections
2. Identify duplicate papers (same paper appearing in multiple sections)
   - Compare papers by URL (primary method - exact match)
   - Compare papers by title similarity (secondary method - very similar titles)
3. For each duplicate group:
   - Identify the PRIMARY section (most relevant section for that paper)
   - List all other sections where duplicates appear
4. Return ONLY a JSON object with indices to remove:
{
  "removals": {
    "section_id": [index1, index2, ...],  // indices to remove from this section
    ...
  },
  "also_relevant": {
    "section_id": {
      "index": [other_section_id1, other_section_id2, ...]  // paper at this index is also relevant to these sections
    },
    ...
  }
}

IMPORTANT:
- Only return indices to remove, NOT the full structure
- Indices are 0-based (first paper is index 0)
- Be thorough in identifying duplicates by URL first, then title similarity
- Keep papers in their PRIMARY (most relevant) section
- Remove duplicates from other sections""",
    )

    return agent


def planning_node(state: ResearchState) -> ResearchState:
    """Planning node: Parse regulation file and identify subsections."""
    start_time = datetime.datetime.now()

    print(f"\n{'='*80}")
    print("📋 PLANNING PHASE: Parsing regulation file...")
    print(f"{'='*80}")
    print(f"⏰ Started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    regulation_file = state["regulation_file"]
    drug_name = state["drug_name"]

    # Parse the regulation file
    sections = parse_regulation_file(regulation_file)

    print(f"✅ Found {len(sections)} subsections to process:\n")
    for idx, (section_id, section_info) in enumerate(sections.items(), 1):
        print(f"  [{idx}/{len(sections)}] {section_id}: {section_info['title']}")

    print(f"\n{'='*80}")
    print(f"✅ Planning complete. Proceeding to worker phase...")
    print(f"{'='*80}\n")

    return {
        "sections": sections,
        "messages": state["messages"] + [{
            "role": "assistant",
            "content": f"Planning complete. Found {len(sections)} subsections to process."
        }]
    }


def deduplication_node(state: ResearchState, model: str = "openai:gpt-4o", temperature: float = 0.3) -> ResearchState:
    """Deduplication node: Use LLM to identify duplicates by index, then apply removals to original JSON."""
    dedup_start = datetime.datetime.now()

    print(f"\n{'='*80}")
    print("🔄 DEDUPLICATION & COMPILATION PHASE")
    print(f"{'='*80}")
    print(f"⏰ Started at: {dedup_start.strftime('%Y-%m-%d %H:%M:%S')}\n")

    sections = state["sections"]
    section_results = state.get("section_results", {})
    drug_name = state["drug_name"]
    regulation_file = state["regulation_file"]

    # Prepare lightweight data with only titles and URLs for deduplication
    lightweight_data = {
        "sections": {}
    }

    # Store original full data for later use
    original_sections_data = {}
    total_mentions = 0
    papers_by_section = {}

    for section_id, section_info in sections.items():
        papers = section_results.get(section_id, [])
        papers_by_section[section_id] = len(papers)
        total_mentions += len(papers)

        # Store original full data
        original_sections_data[section_id] = {
            "title": section_info["title"],
            "description": section_info["description"],
            "papers": papers
        }

        # Create lightweight version with only index, title, and URL
        lightweight_data["sections"][section_id] = {
            "title": section_info["title"],
            "papers": [
                {
                    "index": idx,
                    "title": paper.get("title", ""),
                    "url": paper.get("url", ""),
                    "pmid": paper.get("pmid", "")
                }
                for idx, paper in enumerate(papers)
            ]
        }

    # Create deduplication agent
    dedup_agent = create_deduplication_agent(model=model, temperature=temperature)

    # Prepare prompt for deduplication (only titles and URLs)
    lightweight_json = json.dumps(lightweight_data, indent=2)
    prompt = f"""Analyze the following research papers and identify duplicates across sections.

PAPERS BY SECTION (with indices):
{lightweight_json}

TASK:
1. Identify duplicate papers by comparing URLs (exact match) and titles (very similar)
2. For each duplicate group, determine the PRIMARY section (most relevant)
3. Return a JSON object with:
   - "removals": {{"section_id": [index1, index2, ...]}} - indices to remove from each section
   - "also_relevant": {{"section_id": {{"index": [other_section_ids]}}}} - papers that are also relevant to other sections

Return ONLY the JSON object with removals and also_relevant mappings. Indices are 0-based."""

    # Run the deduplication agent
    inputs = {"messages": [{"role": "user", "content": prompt}]}

    try:
        print("🤖 Running deduplication agent...")
        print("   Analyzing paper titles and URLs for duplicates (lightweight mode)...\n")
        result = dedup_agent.invoke(inputs)

        # Extract the removals JSON from the agent's response
        removals_data = None
        if result and "messages" in result:
            for message in reversed(result["messages"]):
                if hasattr(message, 'content') and message.content:
                    content = str(message.content)
                    # Look for JSON in the response
                    try:
                        # Try to find JSON object with removals
                        json_match = re.search(r'\{[^{}]*"removals"[^{}]*\}', content, re.DOTALL)
                        if json_match:
                            removals_data = json.loads(json_match.group(0))
                            break
                        # Try broader match
                        json_match = re.search(r'(\{.*"removals".*\})', content, re.DOTALL)
                        if json_match:
                            removals_data = json.loads(json_match.group(1))
                            break
                    except (json.JSONDecodeError, ValueError):
                        pass

        # Apply removals to original data
        final_sections = {}
        removals = removals_data.get("removals", {}) if removals_data else {}
        also_relevant = removals_data.get("also_relevant", {}) if removals_data else {}

        papers_removed = 0
        duplicates_found = 0

        for section_id, section_data in original_sections_data.items():
            papers = section_data["papers"].copy()
            indices_to_remove = set(removals.get(section_id, []))

            # Remove papers at specified indices (in reverse order to maintain indices)
            for idx in sorted(indices_to_remove, reverse=True):
                if 0 <= idx < len(papers):
                    papers.pop(idx)
                    papers_removed += 1
                    duplicates_found += 1

            # Add also_relevant_to fields
            section_also_relevant = also_relevant.get(section_id, {})
            for paper_idx, other_sections in section_also_relevant.items():
                paper_idx_int = int(paper_idx)
                if 0 <= paper_idx_int < len(papers):
                    if "also_relevant_to" not in papers[paper_idx_int]:
                        papers[paper_idx_int]["also_relevant_to"] = []
                    papers[paper_idx_int]["also_relevant_to"].extend(other_sections)

            final_sections[section_id] = {
                "title": section_data["title"],
                "description": section_data["description"],
                "papers": papers
            }

        # Build final JSON structure
        total_unique_papers = sum(len(s["papers"]) for s in final_sections.values())

        final_json = {
            "drug_name": drug_name,
            "regulation_section": Path(regulation_file).stem,
            "sections": final_sections,
            "summary": {
                "total_unique_papers": total_unique_papers,
                "total_mentions": total_mentions,
                "papers_by_section": {sid: len(s["papers"]) for sid, s in final_sections.items()},
                "deduplication_stats": {
                    "duplicates_found": duplicates_found,
                    "papers_removed": papers_removed
                }
            }
        }

        # Save final JSON in module5Results folder
        output_dir = Path("module5Results")
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / f"{sanitize_filename(drug_name)}_{Path(regulation_file).stem}_papers.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(final_json, f, indent=2, ensure_ascii=False)

        dedup_end = datetime.datetime.now()
        duration = (dedup_end - dedup_start).total_seconds()

        print(f"\n{'='*80}")
        print(f"✅ DEDUPLICATION COMPLETE")
        print(f"{'='*80}")
        print(f"   Unique papers: {total_unique_papers}")
        print(f"   Total mentions (before dedup): {total_mentions}")
        print(f"   Duplicates found: {duplicates_found}")
        print(f"   Papers removed: {papers_removed}")
        print(f"   Duration: {duration:.1f}s")
        print(f"   Output file: {output_file}")
        print(f"{'='*80}\n")

        return {
            "final_json": final_json,
            "messages": state["messages"] + [{
                "role": "assistant",
                "content": f"Deduplication complete. Processed {total_mentions} paper mentions across {len(sections)} sections. Removed {papers_removed} duplicates."
            }]
        }
    except Exception as e:
        print(f"Error in deduplication: {e}")
        import traceback
        traceback.print_exc()

        # Fallback: create JSON without deduplication
        final_json = {
            "drug_name": drug_name,
            "regulation_section": Path(regulation_file).stem,
            "sections": original_sections_data,
            "summary": {
                "total_unique_papers": total_mentions,
                "total_mentions": total_mentions,
                "papers_by_section": papers_by_section,
                "deduplication_stats": {
                    "duplicates_found": 0,
                    "papers_removed": 0
                }
            }
        }

        # Save final JSON in module5Results folder
        output_dir = Path("module5Results")
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / f"{sanitize_filename(drug_name)}_{Path(regulation_file).stem}_papers.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(final_json, f, indent=2, ensure_ascii=False)

        return {
            "final_json": final_json,
            "messages": state["messages"] + [{
                "role": "assistant",
                "content": f"Error during deduplication: {str(e)}. Using original data without deduplication."
            }]
        }




def extract_papers_from_result(result: Any) -> List[Dict]:
    """Extract papers from agent result."""
    papers = []
    if result and "messages" in result:
        # First, collect papers from tool results (these are most reliable)
        tool_papers = []
        for message in result["messages"]:
            # Check for tool results
            if hasattr(message, 'type') and message.type == 'tool' and hasattr(message, 'content'):
                try:
                    tool_result = json.loads(str(message.content))
                    if isinstance(tool_result, dict):
                        if "papers" in tool_result:
                            tool_papers.extend(tool_result["papers"])
                        elif "query" in tool_result and "papers" in tool_result:
                            tool_papers.extend(tool_result["papers"])
                except (json.JSONDecodeError, AttributeError):
                    pass

        # Use tool papers as primary source (most reliable)
        papers = tool_papers

        # Also check assistant messages - they might aggregate/filter papers
        # We'll merge both sources, preferring assistant's final summary if it exists
        assistant_papers = []
        for message in result["messages"]:
                if hasattr(message, 'content') and message.content:
                    content = str(message.content)

                    # Try to parse as JSON directly
                    try:
                        parsed = json.loads(content)
                        if isinstance(parsed, dict):
                            if "papers" in parsed:
                                assistant_papers = parsed["papers"]
                            elif "query" in parsed and "papers" in parsed:
                                assistant_papers = parsed["papers"]
                        elif isinstance(parsed, list):
                            # Check if it's a list of paper objects
                            if parsed and isinstance(parsed[0], dict) and any(key in parsed[0] for key in ['title', 'url', 'description']):
                                assistant_papers = parsed
                    except json.JSONDecodeError:
                        # Try to extract JSON from text using multiple strategies
                        # Strategy 0: Extract from code blocks (```json ... ```)
                        try:
                            code_block_match = re.search(r'```(?:json)?\s*(\[.*?\]|\{.*?"papers".*?\})\s*```', content, re.DOTALL)
                            if code_block_match:
                                parsed = json.loads(code_block_match.group(1))
                                if isinstance(parsed, list):
                                    assistant_papers = parsed
                                elif isinstance(parsed, dict):
                                    if "papers" in parsed:
                                        assistant_papers = parsed["papers"]
                        except (json.JSONDecodeError, ValueError):
                            pass

                        # Strategy 1: Look for JSON arrays (more flexible pattern)
                        if not assistant_papers:
                            try:
                                # Match JSON array with objects containing "title" field
                                json_match = re.search(r'\[\s*(\{[^}]*"title"[^}]*\}(?:\s*,\s*\{[^}]*"title"[^}]*\})*)\s*\]', content, re.DOTALL)
                                if json_match:
                                    # Reconstruct full array
                                    array_str = "[" + json_match.group(1) + "]"
                                    parsed = json.loads(array_str)
                                    if isinstance(parsed, list):
                                        assistant_papers = parsed
                            except (json.JSONDecodeError, ValueError):
                                pass

                        # Strategy 2: Look for JSON objects with papers array
                        if not assistant_papers:
                            try:
                                json_match = re.search(r'\{\s*"papers"\s*:\s*\[.*?\]\s*\}', content, re.DOTALL)
                                if json_match:
                                    parsed = json.loads(json_match.group(0))
                                    if isinstance(parsed, dict) and "papers" in parsed:
                                        assistant_papers = parsed["papers"]
                            except (json.JSONDecodeError, ValueError):
                                pass

                        # Strategy 3: Look for any JSON array structure (most permissive)
                        if not assistant_papers:
                            try:
                                # Find JSON array that might span multiple lines
                                json_match = re.search(r'\[\s*(?:\{[^}]*\}(?:\s*,\s*\{[^}]*\})*)\s*\]', content, re.DOTALL)
                                if json_match:
                                    parsed = json.loads(json_match.group(0))
                                    if isinstance(parsed, list) and len(parsed) > 0:
                                        # Verify it looks like papers (has title, url, or description)
                                        if all(isinstance(p, dict) and any(k in p for k in ['title', 'url', 'description']) for p in parsed):
                                            assistant_papers = parsed
                            except (json.JSONDecodeError, ValueError):
                                pass

                    if assistant_papers:
                        break

        # Merge tool papers and assistant papers, preferring assistant's aggregated version
        # BUT: Check if assistant_papers contains placeholder values - if so, use tool_papers instead
        def has_placeholder_values(papers_list):
            """Check if papers list contains placeholder values like '...'."""
            if not papers_list:
                return False
            for paper in papers_list:
                if isinstance(paper, dict):
                    # Check if any field is just "..." or similar placeholder
                    for key, value in paper.items():
                        if isinstance(value, str) and value.strip() in ["...", ".", "-", ""]:
                            return True
            return False

        def has_real_data(papers_list):
            """Check if papers list has real data (not just placeholders)."""
            if not papers_list:
                return False
            for paper in papers_list:
                if isinstance(paper, dict):
                    # Check if we have at least one real field
                    for key, value in paper.items():
                        if isinstance(value, str) and value.strip() not in ["...", ".", "-", ""] and len(value.strip()) > 3:
                            return True
            return False

        def is_valid_paper(paper: dict) -> bool:
            """Check if a paper has real data (not just placeholders)."""
            if not isinstance(paper, dict):
                return False

            # Check if title is valid (required field)
            title = paper.get('title', '').strip()
            if not title or title in ["...", ".", "-", ""]:
                return False

            # Check if URL is valid (required field)
            url = paper.get('url', '').strip()
            if not url or url in ["...", ".", "-", ""] or not url.startswith('http'):
                return False

            # Paper is valid if it has a real title and URL
            return True

        def filter_valid_papers(papers_list: List[Dict]) -> List[Dict]:
            """Filter out papers with placeholder values."""
            if not papers_list:
                return []
            return [p for p in papers_list if is_valid_paper(p)]

        if assistant_papers and not has_placeholder_values(assistant_papers):
            # If assistant provided an aggregated list without placeholders, prefer it
            papers = assistant_papers
        elif tool_papers and has_real_data(tool_papers):
            # Use raw tool results (these are the actual papers from the search)
            papers = tool_papers
            # Debug: Log that we're using tool papers (likely because assistant had placeholders)
            if assistant_papers and has_placeholder_values(assistant_papers):
                print(f"   🔧 Using tool_papers ({len(tool_papers)} papers) - assistant_papers contained placeholders")
        elif assistant_papers:
            # Try to filter out placeholders from assistant papers
            filtered_assistant = filter_valid_papers(assistant_papers)
            if filtered_assistant:
                papers = filtered_assistant
                print(f"   🔧 Filtered assistant_papers: {len(assistant_papers)} -> {len(filtered_assistant)} valid papers")
            else:
                # No valid papers found, use empty list
                papers = []
                print(f"   ⚠️  No valid papers found - assistant_papers contained only placeholders")
        else:
            # Last resort: use tool_papers even if they might have issues
            papers = tool_papers

        # Filter out any remaining placeholder papers
        papers = filter_valid_papers(papers)

        # Deduplicate papers by URL
        if papers:
            seen_urls = set()
            unique_papers = []
            for paper in papers:
                url = paper.get('url', '')
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    unique_papers.append(paper)
                elif not url:  # Only include papers without URLs if they have valid titles
                    title = paper.get('title', '').strip()
                    if title and title not in ["...", ".", "-", ""]:
                        unique_papers.append(paper)
            papers = unique_papers

    return papers if papers else []


def save_section_results(drug_name: str, regulation_file: str, section_id: str,
                        section_title: str, papers: List[Dict], base_path: str = "."):
    """Save individual section results to a JSON file."""
    try:
        # Final validation: filter out any placeholder papers before saving
        def is_valid_paper(paper: dict) -> bool:
            """Check if a paper has real data (not just placeholders)."""
            if not isinstance(paper, dict):
                return False
            title = paper.get('title', '').strip()
            url = paper.get('url', '').strip()
            if not title or title in ["...", ".", "-", ""]:
                return False
            if not url or url in ["...", ".", "-", ""] or not url.startswith('http'):
                return False
            return True

        valid_papers = [p for p in papers if is_valid_paper(p)]

        if len(valid_papers) < len(papers):
            print(f"   ⚠️  Filtered out {len(papers) - len(valid_papers)} placeholder papers before saving")

        output_dir = Path(base_path) / "module5Results" / "section_results"
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{sanitize_filename(drug_name)}_{Path(regulation_file).stem}_{section_id.replace('.', '_')}_papers.json"
        filepath = output_dir / filename

        section_data = {
            "drug_name": drug_name,
            "regulation_section": Path(regulation_file).stem,
            "section_id": section_id,
            "section_title": section_title,
            "papers": valid_papers,
            "paper_count": len(valid_papers),
            "saved_at": datetime.datetime.now().isoformat()
        }

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(section_data, f, indent=2, ensure_ascii=False)

        print(f"   💾 Results saved to: {filepath}")
        return str(filepath)
    except Exception as e:
        print(f"   ⚠️  Warning: Could not save section results: {e}")
        return None


def create_simple_research_graph(model: str = "openai:gpt-4o", temperature: float = 0.3,
                                 search_backend: str = None):
    """Create a graph with parallel worker execution.

    Args:
        model: LLM model to use
        temperature: Temperature for LLM
        search_backend: Ignored (always uses PubMed)
    """
    graph = StateGraph(ResearchState)

    # Add nodes
    graph.add_node("planning", planning_node)

    # Create deduplication node with model parameters
    def dedup_node(state: ResearchState) -> ResearchState:
        return deduplication_node(state, model=model, temperature=temperature)

    graph.add_node("deduplication", dedup_node)

    # Set entry point
    graph.set_entry_point("planning")

    # Process workers in parallel, then deduplicate
    def process_workers_parallel(state: ResearchState) -> ResearchState:
        """Process all workers in parallel using asyncio."""
        sections = state.get("sections", {})
        section_results = state.get("section_results", {})
        drug_name = state["drug_name"]
        regulation_file = state["regulation_file"]
        drug_context = load_drug_context(drug_name)

        total_sections = len(sections)
        section_list = list(sections.items())

        print(f"\n{'='*80}")
        print(f"🔍 WORKER PHASE: Processing {total_sections} sections in PARALLEL...")
        print(f"🔎 Search Backend: PubMed/NCBI")
        print(f"{'='*80}\n")

        async def process_section(section_id: str, section_info: dict, section_idx: int) -> tuple[str, List[Dict]]:
            """Process a single section asynchronously with retry logic for rate limits."""
            try:
                section_start = datetime.datetime.now()

                print(f"\n{'─'*80}")
                print(f"📄 [{section_idx}/{total_sections}] Processing Section {section_id} (PARALLEL)")
                print(f"   Title: {section_info['title']}")
                print(f"   Started: {section_start.strftime('%H:%M:%S')}")
                print(f"{'─'*80}\n")

                worker = create_worker_agent(
                    section_id,
                    section_info["title"],
                    section_info["description"],
                    drug_name,
                    drug_context,
                    model=model,
                    temperature=temperature,
                    search_backend=search_backend
                )

                # Extract base drug name for the query
                base_drug_name = extract_base_drug_name(drug_name)

                query = f"""Search PubMed for research papers HIGHLY RELEVANT to Section {section_id}: {section_info['title']} for {drug_name} ANDA submission.

CRITICAL REQUIREMENTS:
1. Use PubMed search syntax with field tags: "{base_drug_name}"[Title/Abstract] AND "specific_term"[Title/Abstract]
2. Generate 4-8 focused queries targeting {base_drug_name} + section-specific terms
3. Be STRICT on relevance: Only include papers that are:
   - Directly about {base_drug_name} (not just mentioned in passing)
   - Specifically address {section_info['title']} requirements
   - Relevant to ANDA submission/generic drug development context
4. EXCLUDE papers about other drugs, general methodology, or clinical use not related to biopharmaceutics
5. Quality over quantity: Return only highly relevant papers

Return your final answer as a JSON array of validated papers: [{{\"title\": \"...\", \"url\": \"...\", \"description\": \"...\", \"relevance_reason\": \"...\"}}]"""
                inputs = {"messages": [{"role": "user", "content": query}]}

                # Retry logic with exponential backoff for rate limits
                max_retries = 5
                base_delay = 2.0  # Start with 2 seconds
                result = None

                for attempt in range(max_retries):
                    try:
                        if attempt > 0:
                            print(f"🤖 [{section_id}] Retrying... (Attempt {attempt + 1}/{max_retries})\n")
                        else:
                            print(f"🤖 [{section_id}] Agent generating search queries and searching for papers...\n")
                        result = await worker.ainvoke(inputs)
                        break  # Success, exit retry loop

                    except Exception as e:
                        # Check if it's a rate limit error
                        is_rate_limit = False
                        wait_time = None

                        # Check exception and its chain for rate limit errors
                        current_exception = e
                        while current_exception:
                            # Check for OpenAI RateLimitError
                            if RateLimitError and isinstance(current_exception, RateLimitError):
                                is_rate_limit = True
                                break
                            # Check exception type name
                            exception_type = type(current_exception).__name__
                            if "RateLimit" in exception_type or "rate_limit" in exception_type.lower():
                                is_rate_limit = True
                                break
                            # Check error message
                            error_str = str(current_exception).lower()
                            if "rate limit" in error_str or "429" in error_str or "rate_limit" in error_str:
                                is_rate_limit = True
                                # Try to extract wait time from error message
                                wait_match = re.search(r'(\d+\.?\d*)\s*seconds?', str(current_exception), re.IGNORECASE)
                                if wait_match:
                                    wait_time = float(wait_match.group(1)) + 1  # Add 1 second buffer
                                break
                            # Check __cause__ and __context__ for nested exceptions
                            current_exception = getattr(current_exception, '__cause__', None) or getattr(current_exception, '__context__', None)
                            if not current_exception:
                                break

                        if is_rate_limit and attempt < max_retries - 1:
                            # Calculate exponential backoff delay
                            if wait_time:
                                delay = wait_time
                            else:
                                delay = base_delay * (2 ** attempt)  # Exponential backoff: 2s, 4s, 8s, 16s, 32s

                            print(f"⏳ [{section_id}] Rate limit hit. Waiting {delay:.1f}s before retry {attempt + 2}/{max_retries}...")
                            await asyncio.sleep(delay)
                            continue
                        else:
                            # Not a rate limit error, or max retries reached
                            raise

                # Check if we got a result
                if result is None:
                    raise Exception(f"Failed to get result after {max_retries} attempts")

                # Debug: Print what the agent returned
                if result and "messages" in result:
                    print(f"🔍 [{section_id}] DEBUG: Agent returned {len(result['messages'])} messages")
                    tool_result_count = 0
                    for msg in result["messages"]:
                        # Count tool messages that might contain papers
                        if hasattr(msg, 'type') and msg.type == 'tool':
                            tool_result_count += 1
                            if hasattr(msg, 'content'):
                                try:
                                    tool_content = json.loads(str(msg.content))
                                    if isinstance(tool_content, dict) and "papers" in tool_content:
                                        paper_count = len(tool_content["papers"])
                                        if paper_count > 0:
                                            print(f"   🔍 Tool result contains {paper_count} papers")
                                except:
                                    pass

                    # Show last 3 messages preview
                    for idx, msg in enumerate(result["messages"][-3:], 1):
                        if hasattr(msg, 'content') and msg.content:
                            content_preview = str(msg.content)[:200] + "..." if len(str(msg.content)) > 200 else str(msg.content)
                            msg_type = getattr(msg, 'type', 'unknown')
                            print(f"   Message {idx} ({msg_type}) preview: {content_preview}")

                    if tool_result_count > 0:
                        print(f"   📊 Found {tool_result_count} tool result messages")

                papers = extract_papers_from_result(result)

                # Debug: Log what was extracted
                if papers:
                    print(f"   📄 Extracted {len(papers)} papers from agent result")
                    if papers and isinstance(papers[0], dict):
                        sample_title = papers[0].get('title', 'N/A')[:50]
                        print(f"   📝 Sample paper title: {sample_title}...")
                else:
                    print(f"   ⚠️  No valid papers extracted from agent result")

                # Additional extraction: Look for papers in tool calls/results
                if len(papers) == 0 and result and "messages" in result:
                    # Check if search tool was called and returned papers
                    for message in reversed(result["messages"]):
                        if hasattr(message, 'tool_calls') and message.tool_calls:
                            for tool_call in message.tool_calls:
                                if tool_call.get('name') == 'search_research_papers':
                                    # Try to find tool result in subsequent messages
                                    pass
                        # Also check if content mentions papers but wasn't parsed
                        if hasattr(message, 'content') and message.content:
                            content = str(message.content)
                            # Look for JSON arrays or objects more aggressively
                            if 'paper' in content.lower() or 'research' in content.lower():
                                # Try multiple JSON extraction patterns
                                patterns = [
                                    r'\[\s*\{[^}]+\}\s*(?:,\s*\{[^}]+\}\s*)*\]',  # Array of objects
                                    r'\{\s*"papers"\s*:\s*\[.*?\]\s*\}',  # Object with papers array
                                ]
                                for pattern in patterns:
                                    matches = re.findall(pattern, content, re.DOTALL)
                                    for match in matches:
                                        try:
                                            parsed = json.loads(match)
                                            if isinstance(parsed, list) and len(parsed) > 0:
                                                papers = parsed
                                                print(f"🔍 [{section_id}] Found {len(papers)} papers via pattern matching")
                                                break
                                            elif isinstance(parsed, dict) and "papers" in parsed:
                                                papers = parsed["papers"]
                                                print(f"🔍 [{section_id}] Found {len(papers)} papers via pattern matching")
                                                break
                                        except json.JSONDecodeError:
                                            continue
                                    if papers:
                                        break
                        if papers:
                            break

                # Save individual section results
                save_section_results(
                    drug_name,
                    regulation_file,
                    section_id,
                    section_info["title"],
                    papers
                )

                section_end = datetime.datetime.now()
                duration = (section_end - section_start).total_seconds()

                print(f"\n{'─'*80}")
                print(f"✅ Section {section_id} COMPLETE")
                print(f"   Papers found: {len(papers)}")
                print(f"   Duration: {duration:.1f}s")
                if len(papers) == 0:
                    print(f"   ⚠️  No papers found - check search queries or API responses")
                print(f"{'─'*80}\n")

                return (section_id, papers)

            except Exception as e:
                import traceback
                print(f"\n{'─'*80}")
                print(f"❌ ERROR in Section {section_id}: {e}")
                print(f"   Traceback: {traceback.format_exc()}")
                print(f"{'─'*80}\n")
                return (section_id, [])

        # Run all sections with controlled concurrency to avoid rate limits
        async def run_all_sections():
            # Limit concurrent requests to avoid hitting rate limits
            # For OpenAI GPT-4o: TPM limit is 30,000, so we limit to 2-3 concurrent requests
            max_concurrent = 2  # Process 2 sections at a time to avoid rate limits
            semaphore = asyncio.Semaphore(max_concurrent)

            async def process_with_semaphore(section_id: str, section_info: dict, section_idx: int):
                async with semaphore:
                    # Add a small delay between starting concurrent requests to spread out token usage
                    await asyncio.sleep(0.5 * (section_idx - 1) % max_concurrent)
                    return await process_section(section_id, section_info, section_idx)

            tasks = [
                process_with_semaphore(section_id, section_info, idx + 1)
                for idx, (section_id, section_info) in enumerate(section_list)
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Handle any exceptions that weren't caught
            processed_results = []
            for idx, result in enumerate(results):
                if isinstance(result, Exception):
                    section_id = section_list[idx][0]
                    print(f"⚠️  [{section_id}] Failed after all retries: {result}")
                    processed_results.append((section_id, []))
                else:
                    processed_results.append(result)

            return processed_results

        # Execute async function - asyncio.run() is safe here since LangGraph nodes are sync
        results = asyncio.run(run_all_sections())

        # Update section_results with all results
        for section_id, papers in results:
            section_results[section_id] = papers

        print(f"\n{'='*80}")
        print(f"✅ WORKER PHASE COMPLETE: Processed {total_sections} sections in parallel")
        print(f"{'='*80}\n")

        return {"section_results": section_results}

    graph.add_node("workers", process_workers_parallel)

    # Connect: planning -> workers -> deduplication -> END
    graph.add_edge("planning", "workers")
    graph.add_edge("workers", "deduplication")
    graph.add_edge("deduplication", END)

    return graph.compile()


def main():
    """Main function to run the multi-agent research system."""
    import sys

    if len(sys.argv) < 3:
        print("Usage: python multi_agent_research.py <regulation_file> <drug_name> [model]")
        print("\nArguments:")
        print("  regulation_file: Path to regulation file (e.g., Module5Regulation/5.3.1.txt)")
        print("  drug_name: Name of the drug (e.g., Levofloxacin)")
        print("  model: (optional) LLM model (e.g., 'openai:gpt-4o' or 'anthropic:claude-sonnet-4-5-20250929')")
        print("\nExamples:")
        print("  python multi_agent_research.py Module5Regulation/5.3.1.txt Levofloxacin")
        print("  python multi_agent_research.py Module5Regulation/5.3.1.txt Levofloxacin 'openai:gpt-4o'")
        print("\nEnvironment Variables:")
        print("  PUBMED_EMAIL: Optional email for PubMed (recommended for rate limiting)")
        sys.exit(1)

    regulation_file = sys.argv[1]
    drug_name = sys.argv[2]

    # Parse model argument
    model = "openai:gpt-4o"

    for arg in sys.argv[3:]:
        if arg.startswith(('openai:', 'anthropic:', 'gpt-', 'claude-')):
            model = arg

    if not os.path.exists(regulation_file):
        print(f"Error: Regulation file not found: {regulation_file}")
        sys.exit(1)

    print(f"Regulation File: {regulation_file}")
    print(f"Drug: {drug_name}")
    print(f"Model: {model}")
    print(f"Search Backend: PubMed/NCBI")
    print(f"\nTask: Finding research papers for all subsections in {Path(regulation_file).stem} for {drug_name} ANDA submission\n")

    # Create the graph
    graph = create_simple_research_graph(model=model)

    # Initial state - no query needed, agents will generate their own
    initial_state = {
        "messages": [{"role": "user", "content": f"Find all relevant research papers for {drug_name} ANDA submission based on the regulation file structure."}],
        "regulation_file": regulation_file,
        "drug_name": drug_name,
        "sections": {},
        "section_results": {},
        "final_json": {},
        "current_section": ""
    }

    # Run the graph
    print("="*80)
    print("🚀 STARTING MULTI-AGENT RESEARCH SYSTEM")
    print("="*80)
    print(f"📁 Regulation File: {regulation_file}")
    print(f"💊 Drug: {drug_name}")
    print(f"🤖 Model: {model}")
    print(f"🔎 Search Backend: PubMed/NCBI")
    print(f"📋 Task: Finding research papers for all subsections")
    print("="*80)
    print("\n")

    result = graph.invoke(initial_state)

    print("\n" + "="*80)
    print("FINAL RESULTS")
    print("="*80)
    if "final_json" in result:
        output_file = Path("module5Results") / f"{sanitize_filename(drug_name)}_{Path(regulation_file).stem}_papers.json"
        print(f"\n✓ Results saved to: {output_file}")
        print(f"\nSummary:")
        summary = result["final_json"].get("summary", {})
        if "total_unique_papers" in summary:
            print(f"  Unique papers: {summary.get('total_unique_papers', 0)}")
            print(f"  Total mentions (before dedup): {summary.get('total_mentions', 0)}")
            if "deduplication_stats" in summary:
                dedup_stats = summary["deduplication_stats"]
                print(f"  Duplicates found: {dedup_stats.get('duplicates_found', 0)}")
                print(f"  Papers removed: {dedup_stats.get('papers_removed', 0)}")
        else:
            # Fallback for old format
            print(f"  Total papers: {summary.get('total_papers', summary.get('total_mentions_before_dedup', 0))}")
        print(f"  Sections processed: {len(result['final_json'].get('sections', {}))}")


if __name__ == "__main__":
    main()

