"""Multi-Agent System for Writing ICH Module 5 Section 2.5 LaTeX Documents

This system uses agents to write LaTeX sections for each subsection of 2.5,
cross-referencing papers from the combined papers JSON file.

Features:
- Multi-step writing process (outline → draft → refinement → validation)
- Quality validation with LaTeX syntax checking
- Self-review and critique loop for continuous improvement
- Enhanced regulatory writing standards with ICH guidelines
- Rate limit handling with exponential backoff retries
- Context length management (truncates/summarizes long content)
- Sequential processing by dependencies
- Cross-referencing between sections and papers
- Semantic chunking for better paper context management
"""

import os
import json
import re
import datetime
import asyncio
import time
from typing import List, Dict, Any, TypedDict, Annotated, Optional, Tuple
from pathlib import Path
from dataclasses import dataclass
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

# Try to import OpenAI rate limit error
try:
    from openai import RateLimitError
except ImportError:
    RateLimitError = None


# Quality metrics thresholds
QUALITY_THRESHOLDS = {
    "min_length": 500,  # Minimum characters for a valid section
    "max_length": 50000,  # Maximum to prevent context issues
    "min_citations": 1,  # Minimum citations expected
    "min_sections": 1,  # Minimum LaTeX section commands
    "required_elements": ["\\section", "\\label"],  # Required LaTeX elements
}

# Regulatory writing standards
REGULATORY_WRITING_GUIDELINES = """
REGULATORY WRITING STANDARDS (ICH M4E Compliance):

1. LANGUAGE AND TONE:
   - Use precise, unambiguous scientific language
   - Maintain objective, third-person perspective
   - Avoid promotional or biased language
   - Use active voice where appropriate for clarity
   - Define abbreviations on first use

2. STRUCTURE AND ORGANIZATION:
   - Follow a logical flow from general to specific
   - Use clear topic sentences for each paragraph
   - Ensure smooth transitions between sections
   - Include appropriate cross-references to other sections

3. DATA PRESENTATION:
   - Present data objectively with appropriate context
   - Include relevant statistics and confidence intervals
   - Discuss both positive and negative findings
   - Acknowledge limitations transparently

4. CITATION STANDARDS:
   - Cite primary sources for all scientific claims
   - Use consistent citation format (PMID-based)
   - Prioritize peer-reviewed publications
   - Include page numbers for direct quotes

5. REGULATORY COMPLIANCE:
   - Address all required elements per ICH guidelines
   - Use standardized terminology (MedDRA, WHO-DD)
   - Include required safety and efficacy summaries
   - Follow regional requirements as applicable
"""

# Example LaTeX output for few-shot learning
LATEX_EXAMPLE = r"""
\section{2.5.1 Product Development Rationale}
\label{sec:2_5_1}

\subsection{2.5.1.1 Pharmacological Class and Mechanism of Action}
\label{subsec:2_5_1_mechanism}

The investigational product [Drug Name] is a [pharmacological class] that exerts its therapeutic effect through [mechanism of action]. The compound demonstrates selective activity at [target], with an IC50 of [value] as demonstrated in the biopharmaceutic studies \modref{5.3.1.1}.

\subsection{2.5.1.2 Therapeutic Rationale}
\label{subsec:2_5_1_rationale}

The development of [Drug Name] for the treatment of [indication] is supported by:
\begin{itemize}
    \item Established understanding of disease pathophysiology
    \item Demonstrated pharmacological activity at relevant targets
    \item Favorable preclinical efficacy and safety profile
    \item Unmet medical need in the target patient population
\end{itemize}

As discussed in \secref{2.5.3}, the clinical pharmacology studies further support the proposed therapeutic approach. Complete study details are provided in the tabular listing \modref{5.2}.

\subsection{2.5.1.3 Scientific Rationale for Dosing}
\label{subsec:2_5_1_dosing}

The proposed dosing regimen is based on integrated pharmacokinetic-pharmacodynamic (PK-PD) modeling \modref{5.3.3.5}, which established target exposure levels for efficacy while maintaining an acceptable safety margin. Key considerations included:

\begin{enumerate}
    \item Target receptor occupancy of $\geq$80\% at trough concentrations
    \item Maintenance of plasma concentrations above the EC90 for $\geq$12 hours
    \item Safety margins based on preclinical toxicology findings \modref{5.3.5.3}
\end{enumerate}
"""


@dataclass
class QualityReport:
    """Quality assessment report for generated LaTeX content."""
    is_valid: bool
    score: float  # 0-100
    issues: List[str]
    suggestions: List[str]
    latex_errors: List[str]
    citation_count: int
    section_count: int
    word_count: int


# State schema for the section writing system
class SectionWritingState(TypedDict):
    """State schema for the section writing system."""
    messages: Annotated[list, add_messages]
    section_id: str  # e.g., "2.5.1", "2.5.2", etc.
    section_guidance: str  # Content from the .txt file
    papers_data: Dict[str, Any]  # Papers from JSON file
    output_tex: str  # Generated LaTeX content
    cross_references: List[Dict[str, str]]  # List of cross-referenced papers
    other_sections: Dict[str, str]  # Other 2.5 sections for cross-referencing {section_id: title}
    related_sections_tex: Dict[str, str]  # Already-written LaTeX content from related sections
    output_dir: str  # Output directory where .tex files are saved
    # New fields for enhanced pipeline
    outline: str  # Section outline before full writing
    draft_tex: str  # Initial draft before refinement
    quality_report: Dict[str, Any]  # Quality validation results
    revision_count: int  # Number of revision iterations
    writing_phase: str  # Current phase: outline, draft, refine, validate


def load_section_guidance(section_id: str, base_path: str = "section2.5") -> str:
    """Load guidance text for a specific section.

    Args:
        section_id: Section ID (e.g., "2.5.1", "2.5.2", "2.5.6.1")
        base_path: Base path to section2.5 folder

    Returns:
        Content of the guidance file
    """
    base_path = Path(base_path)
    filename = f"{section_id}.txt"
    filepath = base_path / filename

    if not filepath.exists():
        # For nested sections, try to find guidance in parent section
        # e.g., if 2.5.6.1.txt doesn't exist, look in 2.5.6.txt
        parts = section_id.split('.')
        if len(parts) > 3:
            parent_id = '.'.join(parts[:-1])
            parent_filename = f"{parent_id}.txt"
            parent_filepath = base_path / parent_filename
            if parent_filepath.exists():
                print(f"⚠️  Note: {filename} not found, using guidance from {parent_filename}")
                with open(parent_filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                    # Try to extract relevant subsection from parent
                    # Look for subsection matching the section_id
                    lines = content.split('\n')
                    in_subsection = False
                    subsection_lines = []
                    for line in lines:
                        if section_id in line and (line.startswith(section_id) or line.startswith(f"{section_id} ")):
                            in_subsection = True
                            subsection_lines.append(line)
                        elif in_subsection:
                            # Check if we've hit another section
                            if re.match(r'^\d+\.\d+', line.strip()):
                                break
                            subsection_lines.append(line)
                    if subsection_lines:
                        return '\n'.join(subsection_lines)
                    return content

        raise FileNotFoundError(f"Guidance file not found: {filepath}")

    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()


def load_preamble(base_path: str = "section2.5") -> str:
    """Load preamble from 2.5.txt.

    Args:
        base_path: Base path to section2.5 folder

    Returns:
        Content of 2.5.txt
    """
    base_path = Path(base_path)
    filepath = base_path / "2.5.txt"

    if not filepath.exists():
        raise FileNotFoundError(f"Preamble file not found: {filepath}")

    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()


def get_all_section_info(base_path: str = "section2.5") -> Dict[str, Dict[str, str]]:
    """Get information about all sections in 2.5.

    Args:
        base_path: Base path to section2.5 folder

    Returns:
        Dictionary mapping section_id to {title, description}
    """
    base_path = Path(base_path)
    sections_info = {}

    # Section titles mapping
    section_titles = {
        "2.5": "Clinical Overview",
        "2.5.1": "Product Development Rationale",
        "2.5.2": "Overview of Biopharmaceutics",
        "2.5.3": "Overview of Clinical Pharmacology",
        "2.5.4": "Overview of Efficacy",
        "2.5.5": "Overview of Safety",
        "2.5.6": "Benefits and Risks Conclusions",
        "2.5.6.1": "Therapeutic Context",
        "2.5.6.1.1": "Disease or Condition",
        "2.5.6.1.2": "Current Therapies",
        "2.5.6.2": "Benefits",
        "2.5.6.3": "Risks",
        "2.5.6.4": "Benefit-Risk Assessment",
        "2.5.7": "Literature References"
    }

    # Load all .txt files
    for txt_file in sorted(base_path.glob("*.txt")):
        section_id = txt_file.stem
        if section_id == "2.5":
            continue  # Skip preamble

        try:
            with open(txt_file, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = content.split('\n')
                title = section_titles.get(section_id, "")
                if not title and lines:
                    # Try to extract title from first line
                    first_line = lines[0].strip()
                    if section_id in first_line:
                        title = first_line.replace(section_id, "").strip()

                # Get first few lines as description
                description = '\n'.join(lines[:5]).strip()

                sections_info[section_id] = {
                    "title": title,
                    "description": description
                }
        except Exception as e:
            print(f"⚠️  Warning: Could not load info for {section_id}: {e}")

    return sections_info


def get_section_dependencies() -> Dict[str, List[str]]:
    """Get dependency graph for sections - which sections depend on which.

    Returns:
        Dictionary mapping section_id to list of sections it depends on
    """
    return {
        "2.5": [],  # Preamble - no dependencies
        "2.5.1": [],  # Product Development Rationale - standalone (write first)
        "2.5.2": ["2.5.1"],  # Biopharmaceutics depends on Product Development
        "2.5.3": ["2.5.2"],  # Clinical Pharmacology depends on Biopharmaceutics
        "2.5.4": ["2.5.3"],  # Efficacy depends on Clinical Pharmacology
        "2.5.5": ["2.5.3", "2.5.4"],  # Safety depends on Clinical Pharmacology and Efficacy
        "2.5.6": ["2.5.4", "2.5.5"],  # Benefits/Risks depends on Efficacy and Safety
        "2.5.6.1": ["2.5.1", "2.5.6"],  # Therapeutic Context depends on Product Development and parent
        "2.5.6.1.1": ["2.5.6.1"],  # Disease or Condition depends on parent
        "2.5.6.1.2": ["2.5.6.1"],  # Current Therapies depends on parent
        "2.5.6.2": ["2.5.4", "2.5.6"],  # Benefits depends on Efficacy and parent
        "2.5.6.3": ["2.5.5", "2.5.6"],  # Risks depends on Safety and parent
        "2.5.6.4": ["2.5.4", "2.5.5", "2.5.6.2", "2.5.6.3", "2.5.6"],  # Benefit-Risk depends on all
        "2.5.7": []  # References - can be written anytime (but usually last)
    }


def get_related_sections(section_id: str, all_sections: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, str]]:
    """Get sections that are related/should be cross-referenced.

    Args:
        section_id: Current section ID
        all_sections: All section information

    Returns:
        Dictionary of related sections
    """
    related = {}

    # Get dependencies (sections this section depends on)
    dependencies = get_section_dependencies()
    related_ids = dependencies.get(section_id, [])

    # Also include parent sections if this is a nested section
    parts = section_id.split('.')
    if len(parts) > 3:
        # e.g., 2.5.6.1 -> also reference 2.5.6
        parent_id = '.'.join(parts[:-1])
        if parent_id not in related_ids and parent_id in all_sections:
            related_ids.append(parent_id)

    # Get information for related sections
    for related_id in related_ids:
        if related_id in all_sections:
            related[related_id] = all_sections[related_id]

    return related


def topological_sort_sections(sections: List[str]) -> List[str]:
    """Sort sections in dependency order using topological sort.

    Sections with no dependencies come first, then sections that depend on them.

    Args:
        sections: List of section IDs to sort

    Returns:
        Sorted list of sections in dependency order
    """
    dependencies = get_section_dependencies()

    # Build dependency graph
    graph = {section: set(dependencies.get(section, [])) for section in sections}

    # Topological sort using Kahn's algorithm
    # Calculate in-degree for each section
    in_degree = {section: 0 for section in sections}
    for section in sections:
        for dep in graph[section]:
            if dep in in_degree:
                in_degree[section] += 1

    # Find sections with no dependencies
    queue = [section for section in sections if in_degree[section] == 0]
    result = []

    while queue:
        # Sort queue to ensure consistent ordering (alphabetical for sections at same level)
        queue.sort()
        section = queue.pop(0)
        result.append(section)

        # Reduce in-degree of sections that depend on this one
        for other_section in sections:
            if section in graph[other_section]:
                in_degree[other_section] -= 1
                if in_degree[other_section] == 0:
                    queue.append(other_section)

    # Check for circular dependencies
    if len(result) != len(sections):
        remaining = [s for s in sections if s not in result]
        print(f"⚠️  Warning: Possible circular dependencies or missing dependencies for: {remaining}")
        # Add remaining sections at the end
        result.extend(remaining)

    return result


def load_papers_json(json_path: str) -> Dict[str, Any]:
    """Load papers data from JSON file.

    Args:
        json_path: Path to the combined papers JSON file

    Returns:
        Papers data dictionary
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def find_relevant_papers(section_id: str, papers_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Find papers relevant to a specific section.

    Args:
        section_id: Section ID (e.g., "2.5.1", "2.5.2", "2.5.6.1")
        papers_data: Papers data from JSON

    Returns:
        List of relevant papers
    """
    relevant_papers = []
    sections = papers_data.get("sections", {})

    # Map section 2.5.x to corresponding 5.3.x sections
    # Base mappings for main sections
    base_section_mapping = {
        "2.5.1": ["5.3.1", "5.3.1.1", "5.3.1.2", "5.3.3", "5.3.3.1", "5.3.3.2"],
        "2.5.2": ["5.3.1", "5.3.1.1", "5.3.1.2", "5.3.1.3", "5.3.1.4"],
        "2.5.3": ["5.3.2", "5.3.2.1", "5.3.2.2", "5.3.2.3", "5.3.3", "5.3.3.1",
                  "5.3.3.2", "5.3.3.3", "5.3.3.4", "5.3.3.5", "5.3.4", "5.3.4.1", "5.3.4.2"],
        "2.5.4": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],
        "2.5.5": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
        "2.5.6": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],
        "2.5.7": []  # References section - all papers are relevant
    }

    # Handle nested sections (e.g., 2.5.6.1, 2.5.6.2)
    # For nested sections, inherit from parent and add specific mappings
    nested_section_mapping = {
        "2.5.6.1": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4"],  # Therapeutic Context
        "2.5.6.2": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3"],  # Benefits
        "2.5.6.3": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.6"],  # Risks
        "2.5.6.4": ["5.3.5", "5.3.5.1", "5.3.5.2", "5.3.5.3", "5.3.5.4", "5.3.6"],  # Benefit-Risk Assessment
    }

    # Determine mapped sections
    if section_id in nested_section_mapping:
        mapped_sections = nested_section_mapping[section_id]
    elif section_id in base_section_mapping:
        mapped_sections = base_section_mapping[section_id]
    else:
        # For unknown sections, try to infer from parent
        # e.g., 2.5.6.1.1 -> use 2.5.6.1 mapping
        parts = section_id.split('.')
        if len(parts) > 3:
            parent_id = '.'.join(parts[:-1])
            mapped_sections = nested_section_mapping.get(parent_id, base_section_mapping.get(parent_id, []))
        else:
            mapped_sections = []

    # Collect papers from mapped sections
    for mapped_section in mapped_sections:
        if mapped_section in sections:
            section_papers = sections[mapped_section].get("papers", [])
            for paper in section_papers:
                # Avoid duplicates by URL
                if not any(p.get("url") == paper.get("url") for p in relevant_papers):
                    relevant_papers.append(paper)

    # Also check for papers marked as "also_relevant_to" in parent sections
    # This helps with cross-referencing
    for section_key, section_data in sections.items():
        section_papers = section_data.get("papers", [])
        for paper in section_papers:
            also_relevant = paper.get("also_relevant_to", [])
            # Check if any mapped section is in also_relevant_to
            if any(mapped in also_relevant for mapped in mapped_sections):
                if not any(p.get("url") == paper.get("url") for p in relevant_papers):
                    relevant_papers.append(paper)

    # For 2.5.7, include all papers
    if section_id == "2.5.7":
        for section_key, section_data in sections.items():
            section_papers = section_data.get("papers", [])
            for paper in section_papers:
                if not any(p.get("url") == paper.get("url") for p in relevant_papers):
                    relevant_papers.append(paper)

    return relevant_papers


def create_section_writer_agent(section_id: str, section_guidance: str,
                                relevant_papers: List[Dict[str, Any]],
                                related_sections: Dict[str, Dict[str, str]] = None,
                                related_sections_tex: Dict[str, str] = None,
                                output_dir: str = "section2.5_tex",
                                model: str = "openai:gpt-4o",
                                temperature: float = 0.3,
                                writing_phase: str = "full"):
    """Create an agent for writing a specific section.

    Each section has its own dedicated agent that can reference:
    - Guidance from .txt files
    - Relevant papers from Module 5.3
    - Already-written LaTeX content from other 2.5 sections

    Args:
        section_id: Section ID (e.g., "2.5.1")
        section_guidance: Guidance text from .txt file
        relevant_papers: List of relevant papers
        related_sections: Dictionary of related 2.5 sections metadata
        related_sections_tex: Dictionary of already-written LaTeX content from related sections
        output_dir: Output directory where .tex files are saved
        model: LLM model to use
        temperature: Temperature for LLM
        writing_phase: Phase of writing - "outline", "draft", "refine", "review", or "full"
    """
    # Use lower temperature for refinement, higher for initial drafting
    if writing_phase == "outline":
        temperature = 0.4  # More creative for structure planning
    elif writing_phase == "draft":
        temperature = 0.3  # Balanced for content generation
    elif writing_phase == "refine":
        temperature = 0.2  # More focused for refinement
    elif writing_phase == "review":
        temperature = 0.1  # Very focused for critique

    llm = init_chat_model(model, temperature=temperature)

    # Use enhanced paper formatting with semantic grouping
    papers_context, citation_keys = format_papers_for_context(
        relevant_papers, max_papers=15, include_key_findings=True
    )

    # Format related sections for context
    sections_context = ""
    if related_sections:
        sections_context = "\n\nRELATED SECTIONS IN 2.5 FOR CROSS-REFERENCING:\n"
        sections_context += "=" * 60 + "\n"
        sections_context += "Cross-reference these sections using \\secref{2.5.X} command.\n"
        sections_context += "Always add \\label{sec:X_Y_Z} after your section commands.\n\n"

        for related_id, info in related_sections.items():
            title = info.get("title", related_id)
            description = info.get("description", "")[:150] + "..." if len(info.get("description", "")) > 150 else info.get("description", "")
            label_id = related_id.replace('.', '_')
            sections_context += f"\n[{related_id}] {title}\n"
            sections_context += f"    Cross-ref: \\secref{{{related_id}}}\n"

            # Include actual LaTeX content if available (truncated for context length)
            if related_sections_tex and related_id in related_sections_tex:
                tex_content = related_sections_tex[related_id]
                if tex_content:
                    max_tex_preview = 2000
                    if len(tex_content) > max_tex_preview:
                        preview = summarize_latex_content(tex_content, max_tex_preview)
                        sections_context += f"    Content preview ({len(tex_content)} chars total):\n"
                        # Indent the preview
                        for line in preview.split('\n')[:10]:
                            sections_context += f"      {line}\n"
                    else:
                        sections_context += f"    Content:\n"
                        for line in tex_content.split('\n')[:10]:
                            sections_context += f"      {line}\n"
            else:
                sections_context += f"    Status: Not yet written (use forward reference)\n"

        sections_context += "=" * 60 + "\n"

    # Build phase-specific prompts
    phase_instructions = ""
    if writing_phase == "outline":
        phase_instructions = """
CURRENT TASK: CREATE SECTION OUTLINE

Before writing the full content, create a detailed outline for Section {section_id}.

Your outline should include:
1. Main section heading and label
2. All subsections with brief descriptions (2-3 sentences each)
3. Key points to cover in each subsection
4. Planned citations for each subsection (list which papers support which points)
5. Cross-references to other sections that should be included

Format the outline as a structured list, NOT as LaTeX code.
Example:
---
SECTION: 2.5.1 Product Development Rationale
- 1.1 Pharmacological Class and Mechanism
  • Key points: mechanism of action, target receptors, selectivity
  • Citations: [1] Smith2020, [3] Jones2021
  • Cross-ref: Links to Section 2.5.3

- 1.2 Therapeutic Rationale
  • Key points: unmet medical need, disease burden, treatment goals
  • Citations: [2] Brown2019
  ...
---
"""
    elif writing_phase == "draft":
        phase_instructions = """
CURRENT TASK: WRITE INITIAL DRAFT

Based on the guidance and outline (if provided), write the initial draft of the LaTeX content.

Focus on:
1. Complete coverage of all required topics
2. Proper structure with sections and subsections
3. Including all necessary citations
4. Clear, scientific language

Don't worry about perfect polishing - this is the first draft that will be refined.
"""
    elif writing_phase == "refine":
        phase_instructions = """
CURRENT TASK: REFINE AND IMPROVE DRAFT

Review and improve the existing draft. Focus on:
1. Improving clarity and flow of the text
2. Ensuring all claims are properly cited
3. Adding missing cross-references to other sections
4. Fixing any LaTeX formatting issues
5. Enhancing regulatory compliance language
6. Adding transition sentences between sections
7. Ensuring consistent terminology throughout

Return the complete, refined LaTeX content.
"""
    elif writing_phase == "review":
        phase_instructions = """
CURRENT TASK: CRITICAL REVIEW AND SELF-ASSESSMENT

Critically review the content and provide:
1. A quality score (0-100)
2. List of issues found
3. Specific suggestions for improvement
4. Missing elements that should be added
5. LaTeX syntax issues

Format your response as:
---
QUALITY SCORE: [0-100]

ISSUES FOUND:
- Issue 1
- Issue 2
...

SUGGESTIONS:
- Suggestion 1
- Suggestion 2
...

MISSING ELEMENTS:
- Element 1
...

LATEX ISSUES:
- Issue 1
...
---

Then provide the improved LaTeX content incorporating these fixes.
"""
    else:  # full
        phase_instructions = """
CURRENT TASK: WRITE COMPLETE SECTION

Write a comprehensive, polished LaTeX section that is ready for regulatory submission.
"""

    # Build the complete system prompt with enhanced guidelines
    system_prompt = f"""You are an expert regulatory medical writer specializing in ICH Module 5 Section 2.5: Clinical Overview.

You are writing Section {section_id} as part of a multi-agent system where each agent is responsible for a specific section.

{REGULATORY_WRITING_GUIDELINES}

SECTION GUIDANCE FROM REGULATORY REQUIREMENTS:
{'='*60}
{section_guidance}
{'='*60}

{papers_context}

{sections_context}

{phase_instructions.format(section_id=section_id)}

LATEX FORMATTING REQUIREMENTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Section commands: Use the EXACT section number in the title: \\section{{{section_id} Title}}
  Example: \\section{{2.5.1 Product Development Rationale}}
• Labels: \\label{{sec:{section_id.replace('.', '_')}}} immediately after section commands
• Cross-references to OTHER 2.5 sections: \\secref{{2.5.X}} (e.g., \\secref{{2.5.3}})
• Bold: \\textbf{{text}}, Italic: \\textit{{text}}
• Lists: \\begin{{itemize}}...\\end{{itemize}} or \\begin{{enumerate}}...\\end{{enumerate}}
• Math: $x = y$ for inline, \\[x = y\\] for display
• Special characters: Escape %, $, &, #, _ as \\%, \\$, \\&, \\#, \\_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REFERENCING MODULE 5 CLINICAL STUDY DATA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT: Do NOT use \\cite{{PMID...}} for citations!

Instead, reference Module 5 sections directly using these formats:
• For clinical study reports: \\modref{{5.3.5.1}} or (see Section 5.3.5.1)
• For tabular listings: \\tableref{{X}} where X is the study/row number
• For specific studies: \\studyref{{Study-001}} or (see Section 5.2, Study XYZ-001)

Examples:
• "The pharmacokinetic parameters are detailed in \\modref{{5.3.1.1}}."
• "Clinical efficacy was demonstrated in pivotal trials \\modref{{5.3.5.1}}."
• "Adverse event data are summarized in \\modref{{5.3.5.3}}."
• "As shown in the tabular listing \\tableref{{3}}, the study demonstrated..."

Section 5.2 contains the Tabular Listing of All Clinical Studies.
Section 5.3 contains the Clinical Study Reports organized as:
  5.3.1 - Reports of Biopharmaceutic Studies
  5.3.2 - Reports of Studies Pertinent to Pharmacokinetics
  5.3.3 - Reports of Human PK Studies
  5.3.4 - Reports of Human PD Studies
  5.3.5 - Reports of Efficacy and Safety Studies
  5.3.6 - Reports of Post-marketing Experience
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE OF HIGH-QUALITY LATEX OUTPUT:

\\section{{2.5.1 Product Development Rationale}}
\\label{{sec:2_5_1}}

\\subsection{{2.5.1.1 Pharmacological Class and Mechanism of Action}}
\\label{{subsec:2_5_1_mechanism}}

The investigational product [Drug Name] is a [pharmacological class] that exerts its therapeutic effect through [mechanism of action]. Detailed pharmacology studies are presented in \\modref{{5.3.1.1}}.

\\subsection{{2.5.1.2 Therapeutic Rationale}}
\\label{{subsec:2_5_1_rationale}}

The development program included multiple clinical studies as summarized in the tabular listing \\modref{{5.2}}. Key efficacy findings from pivotal trials are detailed in \\modref{{5.3.5.1}}.

OUTPUT REQUIREMENTS:
1. Return ONLY LaTeX code (no markdown code blocks, no explanations)
2. Start with \\section{{{section_id} Title}} - include the section number in the title!
3. Include \\label{{sec:{section_id.replace('.', '_')}}} after the section command
4. Do NOT include document preamble (\\documentclass, \\begin{{document}}, etc.)
5. Ensure all braces are balanced and environments are properly closed
6. Use \\modref{{}}, \\tableref{{}}, or \\studyref{{}} for references to Module 5 data
7. Use \\secref{{2.5.X}} for cross-references to other 2.5 sections (e.g., \\secref{{2.5.3}})

QUALITY STANDARDS:
✓ Comprehensive coverage of all guidance topics
✓ At least 3-5 references to Module 5 sections (5.2 or 5.3.x)
✓ Cross-references to related 2.5 sections using \\secref{{2.5.X}}
✓ Professional regulatory language
✓ Clear, logical structure with section numbers in titles
✓ Accurate scientific content
✓ No promotional language
✓ Proper abbreviation definitions"""

    agent = create_agent(
        model=llm,
        tools=[],
        system_prompt=system_prompt,
    )

    return agent


def planning_node(state: SectionWritingState) -> SectionWritingState:
    """Planning node: Load guidance, identify relevant papers, and load written sections."""
    start_time = datetime.datetime.now()

    section_id = state["section_id"]
    papers_data = state["papers_data"]
    output_dir = state.get("output_dir", "section2.5_tex")

    print(f"\n{'='*80}")
    print(f"📋 PLANNING PHASE: Agent for Section {section_id}")
    print(f"{'='*80}")
    print(f"⏰ Started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    # Load section guidance
    try:
        section_guidance = load_section_guidance(section_id)
        print(f"✅ Agent {section_id}: Loaded guidance from {section_id}.txt")
    except FileNotFoundError as e:
        print(f"❌ Error: {e}")
        return {
            "section_guidance": "",
            "messages": state["messages"] + [{
                "role": "assistant",
                "content": f"Error loading guidance: {str(e)}"
            }]
        }

    # Find relevant papers
    relevant_papers = find_relevant_papers(section_id, papers_data)
    print(f"✅ Agent {section_id}: Found {len(relevant_papers)} relevant papers for cross-referencing")

    # Get related sections within 2.5 (dependencies)
    all_sections = get_all_section_info()
    related_sections = get_related_sections(section_id, all_sections)

    # Get dependencies for this section
    dependencies = get_section_dependencies()
    section_deps = dependencies.get(section_id, [])

    print(f"✅ Agent {section_id}: Found {len(related_sections)} related sections for cross-referencing")
    if section_deps:
        print(f"   Dependencies: {', '.join(section_deps)}")

    # Load already-written LaTeX content from related sections (with context length management)
    related_sections_tex = {}
    max_chars_per_section = 3000  # Limit per section to manage total context length
    total_context_estimate = len(section_guidance) + len(str(relevant_papers))

    if related_sections:
        print(f"\n📂 Agent {section_id}: Checking for already-written sections in {output_dir}/")
        for related_id in related_sections.keys():
            # Adjust max_chars based on number of sections to load
            num_sections = len(related_sections)
            adjusted_max = max_chars_per_section if num_sections <= 2 else max_chars_per_section // 2

            written_content = load_written_section(related_id, output_dir, max_chars=adjusted_max)
            if written_content:
                original_length = len(written_content)
                # Further truncate if we have many sections
                if len(related_sections_tex) > 0 and total_context_estimate + len(written_content) > 15000:
                    written_content = summarize_latex_content(written_content, max_chars=1500)
                    print(f"   ✓ Found written content for {related_id} ({len(written_content)}/{original_length} chars, truncated for context)")
                else:
                    print(f"   ✓ Found written content for {related_id} ({len(written_content)} chars)")
                related_sections_tex[related_id] = written_content
                total_context_estimate += len(written_content)
            else:
                status = "⚠️  MISSING DEPENDENCY" if related_id in section_deps else "○"
                print(f"   {status} Section {related_id} not yet written (will use metadata only)")
                if related_id in section_deps:
                    print(f"      ⚠️  Warning: {section_id} depends on {related_id} but it's not written yet!")

        print(f"\n   📊 Context size estimate: ~{total_context_estimate:,} characters")
        if total_context_estimate > 20000:
            print(f"   ⚠️  Warning: Large context size may cause issues. Content has been truncated.")

    if related_sections:
        print(f"\n   Related sections:")
        for related_id in related_sections.keys():
            title = related_sections[related_id].get('title', 'N/A')
            has_content = "✓" if related_id in related_sections_tex else "○"
            print(f"   {has_content} {related_id}: {title}")

    print(f"\n{'='*80}")
    print(f"✅ Planning complete. Agent {section_id} ready to write...")
    print(f"{'='*80}\n")

    return {
        "section_guidance": section_guidance,
        "cross_references": relevant_papers,
        "other_sections": {sid: info.get("title", sid) for sid, info in related_sections.items()},
        "related_sections_tex": related_sections_tex,
        "output_dir": output_dir,
        "messages": state["messages"] + [{
            "role": "assistant",
            "content": f"Planning complete. Loaded guidance, found {len(relevant_papers)} relevant papers, {len(related_sections)} related sections ({len(related_sections_tex)} with written content)."
        }]
    }


def writing_node(state: SectionWritingState, model: str = "openai:gpt-4o",
                 temperature: float = 0.3) -> SectionWritingState:
    """Writing node: Generate LaTeX content for the section."""
    write_start = datetime.datetime.now()

    print(f"\n{'='*80}")
    print(f"✍️  WRITING PHASE: Generating LaTeX for Section {state['section_id']}")
    print(f"{'='*80}")
    print(f"⏰ Started at: {write_start.strftime('%Y-%m-%d %H:%M:%S')}\n")

    section_id = state["section_id"]
    section_guidance = state["section_guidance"]
    relevant_papers = state["cross_references"]
    papers_data = state["papers_data"]
    related_sections = state.get("other_sections", {})
    related_sections_tex = state.get("related_sections_tex", {})
    output_dir = state.get("output_dir", "section2.5_tex")

    # Get full related sections info
    all_sections = get_all_section_info()
    related_sections_full = {}
    for related_id in related_sections.keys():
        if related_id in all_sections:
            related_sections_full[related_id] = all_sections[related_id]

    print(f"🤖 Agent {section_id}: Creating specialized writing agent...")
    print(f"   - Model: {model}")
    print(f"   - Related sections with content: {len(related_sections_tex)}/{len(related_sections_full)}")

    # Create writing agent (each section has its own agent)
    agent = create_section_writer_agent(
        section_id,
        section_guidance,
        relevant_papers,
        related_sections=related_sections_full,
        related_sections_tex=related_sections_tex,
        output_dir=output_dir,
        model=model,
        temperature=temperature
    )

    # Create prompt for writing
    prompt = f"""Write the LaTeX content for Section {section_id} based on the guidance provided.

Ensure that:
1. All key points from the guidance are addressed
2. Relevant papers are cross-referenced appropriately
3. The LaTeX is properly formatted and structured
4. The content is comprehensive and suitable for regulatory submission

Return ONLY the LaTeX code starting with the appropriate sectioning command."""

    inputs = {"messages": [{"role": "user", "content": prompt}]}

    # Retry logic with exponential backoff for rate limits
    max_retries = 5
    base_delay = 2.0  # Start with 2 seconds
    result = None

    for attempt in range(max_retries):
        try:
            if attempt > 0:
                print(f"🤖 Agent {section_id}: Retrying... (Attempt {attempt + 1}/{max_retries})\n")
            else:
                print(f"🤖 Agent {section_id}: Generating LaTeX content...\n")

            result = agent.invoke(inputs)
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
                # Check for context length errors
                if "context_length" in error_str or "token" in error_str and ("limit" in error_str or "exceeded" in error_str):
                    print(f"❌ Agent {section_id}: Context length exceeded. Reducing context size...")
                    # This is handled by truncation functions, but we can retry with reduced context
                    if attempt < max_retries - 1:
                        # Reduce context on next attempt
                        print(f"   Reducing context size for retry...")
                        # The truncation functions should handle this, but we can break and let it retry
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

                print(f"⏳ Agent {section_id}: Rate limit hit. Waiting {delay:.1f}s before retry {attempt + 2}/{max_retries}...")
                time.sleep(delay)
                continue
            else:
                # Not a rate limit error, or max retries reached
                raise

    # Check if we got a result
    if result is None:
        raise Exception(f"Failed to get result after {max_retries} attempts")

    # Extract LaTeX from agent response
    try:
        latex_content = ""
        if result and "messages" in result:
            for message in reversed(result["messages"]):
                if hasattr(message, 'content') and message.content:
                    content = str(message.content)
                    # Look for LaTeX code blocks
                    latex_match = re.search(r'```(?:latex)?\s*(.*?)\s*```', content, re.DOTALL)
                    if latex_match:
                        latex_content = latex_match.group(1).strip()
                        break
                    # If no code block, check if content looks like LaTeX
                    if '\\section' in content or '\\subsection' in content:
                        latex_content = content.strip()
                        break

        if not latex_content:
            # Try to extract LaTeX from the last assistant message
            for message in reversed(result["messages"]):
                if hasattr(message, 'content') and message.content:
                    content = str(message.content)
                    # Remove markdown formatting if present
                    content = re.sub(r'^```(?:latex)?\s*', '', content, flags=re.MULTILINE)
                    content = re.sub(r'\s*```$', '', content, flags=re.MULTILINE)
                    if '\\section' in content or '\\subsection' in content:
                        latex_content = content.strip()
                        break

        if not latex_content:
            print("⚠️  Warning: Could not extract LaTeX from agent response. Using raw content.")
            if result and "messages" in result:
                for message in reversed(result["messages"]):
                    if hasattr(message, 'content') and message.content:
                        content = str(message.content)
                        # Check if content is too long (context length issue)
                        if len(content) > 50000:
                            print(f"⚠️  Warning: Response is very long ({len(content)} chars). Truncating...")
                            content = truncate_text(content, max_chars=50000)
                        latex_content = content.strip()
                        break

        write_end = datetime.datetime.now()
        duration = (write_end - write_start).total_seconds()

        print(f"\n{'='*80}")
        print(f"✅ WRITING COMPLETE - Agent {section_id}")
        print(f"{'='*80}")
        print(f"   Section: {section_id}")
        print(f"   Agent: Specialized writing agent for {section_id}")
        print(f"   LaTeX length: {len(latex_content)} characters")
        print(f"   Duration: {duration:.1f}s")
        print(f"   Output directory: {output_dir}/")
        print(f"{'='*80}\n")

        return {
            "output_tex": latex_content,
            "messages": state["messages"] + [{
                "role": "assistant",
                "content": f"LaTeX content generated successfully. Length: {len(latex_content)} characters."
            }]
        }
    except Exception as e:
        print(f"❌ Error in writing: {e}")
        import traceback
        traceback.print_exc()

        return {
            "output_tex": "",
            "messages": state["messages"] + [{
                "role": "assistant",
                "content": f"Error during writing: {str(e)}"
            }]
        }


def validate_latex_quality(latex_content: str, section_id: str,
                           expected_citations: int = 3) -> QualityReport:
    """Validate the quality of generated LaTeX content.

    Performs comprehensive quality checks including:
    - LaTeX syntax validation
    - Citation count and format
    - Section structure
    - Content length and completeness
    - Regulatory writing standards compliance

    Args:
        latex_content: The LaTeX content to validate
        section_id: The section ID for context
        expected_citations: Minimum expected citations

    Returns:
        QualityReport with validation results
    """
    issues = []
    suggestions = []
    latex_errors = []
    score = 100.0

    # Basic content checks
    if not latex_content or len(latex_content.strip()) == 0:
        return QualityReport(
            is_valid=False, score=0, issues=["Empty content"],
            suggestions=["Generate content"], latex_errors=[],
            citation_count=0, section_count=0, word_count=0
        )

    content_length = len(latex_content)
    word_count = len(latex_content.split())

    # Check minimum length
    if content_length < QUALITY_THRESHOLDS["min_length"]:
        issues.append(f"Content too short ({content_length} chars, minimum {QUALITY_THRESHOLDS['min_length']})")
        score -= 20
        suggestions.append("Expand content with more details and explanations")

    # Check maximum length
    if content_length > QUALITY_THRESHOLDS["max_length"]:
        issues.append(f"Content too long ({content_length} chars), may cause context issues")
        score -= 10

    # Count citations
    citation_pattern = r'\\cite\{[^}]+\}'
    citations = re.findall(citation_pattern, latex_content)
    citation_count = len(citations)

    if citation_count < expected_citations:
        issues.append(f"Low citation count ({citation_count}, expected at least {expected_citations})")
        score -= 15
        suggestions.append("Add more citations to support scientific claims")

    # Count section commands
    section_pattern = r'\\(section|subsection|subsubsection)\{[^}]+\}'
    sections = re.findall(section_pattern, latex_content)
    section_count = len(sections)

    if section_count < QUALITY_THRESHOLDS["min_sections"]:
        issues.append(f"Missing section structure (found {section_count} sections)")
        score -= 15
        suggestions.append("Add proper section and subsection structure")

    # Check for required elements
    for element in QUALITY_THRESHOLDS["required_elements"]:
        if element not in latex_content:
            issues.append(f"Missing required LaTeX element: {element}")
            score -= 10
            suggestions.append(f"Add {element} command to the content")

    # Check for label after section
    if "\\section" in latex_content and "\\label" not in latex_content:
        issues.append("Section without \\label - cross-referencing won't work")
        score -= 10
        suggestions.append("Add \\label{sec:...} after each section command")

    # LaTeX syntax validation
    # Check for unbalanced braces
    open_braces = latex_content.count('{')
    close_braces = latex_content.count('}')
    if open_braces != close_braces:
        latex_errors.append(f"Unbalanced braces: {open_braces} open, {close_braces} close")
        score -= 20

    # Check for unbalanced environments
    begin_count = len(re.findall(r'\\begin\{(\w+)\}', latex_content))
    end_count = len(re.findall(r'\\end\{(\w+)\}', latex_content))
    if begin_count != end_count:
        latex_errors.append(f"Unbalanced environments: {begin_count} \\begin, {end_count} \\end")
        score -= 15

    # Check for common LaTeX issues
    if re.search(r'(?<!\\)[%&$#_]', latex_content):
        # Check for unescaped special characters (rough check)
        matches = re.findall(r'(?<!\\)([%&$#_])', latex_content[:1000])
        if matches:
            issues.append(f"Possible unescaped special characters: {set(matches)}")
            score -= 5

    # Check for proper use of math mode
    if re.search(r'(?<!\$)\d+%(?!\$)', latex_content):
        suggestions.append("Consider using math mode for percentages: $X\\%$")

    # Check for itemize/enumerate structure
    if "\\item" in latex_content:
        if "\\begin{itemize}" not in latex_content and "\\begin{enumerate}" not in latex_content:
            latex_errors.append("\\item used without itemize or enumerate environment")
            score -= 10

    # Content quality checks
    # Check for regulatory language issues
    promotional_words = ["breakthrough", "revolutionary", "best", "guaranteed", "miracle"]
    found_promotional = [w for w in promotional_words if w.lower() in latex_content.lower()]
    if found_promotional:
        issues.append(f"Promotional language detected: {found_promotional}")
        score -= 10
        suggestions.append("Use objective, scientific language instead of promotional terms")

    # Check for abbreviations without definition
    # Simple heuristic: all-caps words that might be abbreviations
    abbreviations = re.findall(r'\b[A-Z]{2,6}\b', latex_content)
    if abbreviations:
        # Check if they're defined (rough check)
        undefined = []
        for abbr in set(abbreviations):
            if abbr not in ["ICH", "FDA", "EMA", "PMID", "N/A"]:  # Common allowed abbreviations
                # Look for definition pattern: "Full Name (ABBR)" or "(ABBR)"
                if f"({abbr})" not in latex_content:
                    undefined.append(abbr)
        if len(undefined) > 3:
            suggestions.append(f"Consider defining abbreviations on first use: {undefined[:5]}")

    # Ensure score doesn't go below 0
    score = max(0, score)

    # Determine validity
    is_valid = score >= 60 and len(latex_errors) == 0

    return QualityReport(
        is_valid=is_valid,
        score=score,
        issues=issues,
        suggestions=suggestions,
        latex_errors=latex_errors,
        citation_count=citation_count,
        section_count=section_count,
        word_count=word_count
    )


def format_papers_for_context(relevant_papers: List[Dict[str, Any]],
                               max_papers: int = 15,
                               include_key_findings: bool = True) -> Tuple[str, List[str]]:
    """Format papers/studies for agent context with Module 5 section references.

    Groups papers by Module 5.3 section and provides proper reference format.

    Args:
        relevant_papers: List of paper dictionaries
        max_papers: Maximum number of papers to include
        include_key_findings: Whether to extract and include key findings

    Returns:
        Tuple of (formatted context string, list of Module 5 section references)
    """
    if not relevant_papers:
        return "", []

    section_refs = []
    papers_context = f"\n\nCLINICAL STUDY DATA FROM MODULE 5 ({min(len(relevant_papers), max_papers)} of {len(relevant_papers)} studies):\n"
    papers_context += "=" * 60 + "\n"
    papers_context += """
IMPORTANT: Reference these using \\modref{5.3.X.X} format, NOT \\cite{}!
For the tabular listing of all studies, use \\modref{5.2}.
"""
    papers_context += "=" * 60 + "\n"

    # Group papers by Module 5.3 section
    section_groups = {
        "5.3.1": {"name": "Biopharmaceutic Studies", "papers": []},
        "5.3.2": {"name": "PK Using Human Biomaterials", "papers": []},
        "5.3.3": {"name": "Human PK Studies", "papers": []},
        "5.3.4": {"name": "Human PD Studies", "papers": []},
        "5.3.5": {"name": "Efficacy and Safety Studies", "papers": []},
        "5.3.6": {"name": "Post-marketing Experience", "papers": []},
    }

    for paper in relevant_papers[:max_papers]:
        title = paper.get("title", "").lower()
        abstract = paper.get("abstract", "").lower()
        # Get the source section if available
        source_section = paper.get("source_section", "")

        # Determine which 5.3 section this belongs to
        if source_section:
            # Use the source section from the paper data
            for sec_key in section_groups.keys():
                if source_section.startswith(sec_key):
                    section_groups[sec_key]["papers"].append(paper)
                    break
            else:
                # Default to 5.3.5 if no match
                section_groups["5.3.5"]["papers"].append(paper)
        else:
            # Infer from content
            if any(term in title + abstract for term in ["bioavailability", "bioequivalence", "dissolution"]):
                section_groups["5.3.1"]["papers"].append(paper)
            elif any(term in title + abstract for term in ["pharmacokinetic", "absorption", "distribution", "metabolism", "excretion"]):
                section_groups["5.3.3"]["papers"].append(paper)
            elif any(term in title + abstract for term in ["pharmacodynamic", "receptor", "mechanism"]):
                section_groups["5.3.4"]["papers"].append(paper)
            elif any(term in title + abstract for term in ["efficacy", "clinical trial", "phase", "randomized", "safety", "adverse"]):
                section_groups["5.3.5"]["papers"].append(paper)
            elif any(term in title + abstract for term in ["post-market", "surveillance", "real-world"]):
                section_groups["5.3.6"]["papers"].append(paper)
            else:
                section_groups["5.3.5"]["papers"].append(paper)  # Default

    idx = 1
    for sec_key, sec_data in section_groups.items():
        if not sec_data["papers"]:
            continue

        papers_context += f"\n--- Section {sec_key}: {sec_data['name']} ---\n"
        papers_context += f"Reference as: \\modref{{{sec_key}}} or \\modref{{{sec_key}.X}} for subsections\n\n"
        section_refs.append(sec_key)

        for paper in sec_data["papers"]:
            title = paper.get("title", "N/A")
            authors = paper.get("authors", [])
            journal = paper.get("journal", "")
            year = paper.get("year", "")
            abstract = paper.get("abstract", "")
            source_section = paper.get("source_section", sec_key)

            papers_context += f"[{idx}] {title}\n"
            if authors:
                author_str = ', '.join(authors[:3])
                if len(authors) > 3:
                    author_str += ' et al.'
                papers_context += f"    Authors: {author_str}\n"
            if journal and year:
                papers_context += f"    Published: {journal} ({year})\n"
            papers_context += f"    Module 5 Location: Section {source_section}\n"
            papers_context += f"    Reference: \\modref{{{source_section}}}\n"

            # Include abstract summary
            if abstract and include_key_findings:
                first_sentence = abstract.split('.')[0] + '.'
                if len(first_sentence) > 200:
                    first_sentence = abstract[:200] + "..."
                papers_context += f"    Key Finding: {first_sentence}\n"

            papers_context += "\n"
            idx += 1

    if len(relevant_papers) > max_papers:
        papers_context += f"\n[... {len(relevant_papers) - max_papers} additional studies available in Module 5 ...]\n"

    papers_context += "=" * 60 + "\n"
    papers_context += """
REMINDER: Use these reference formats:
  - \\modref{5.3.1} - for biopharmaceutic studies
  - \\modref{5.3.5.1} - for specific efficacy study reports
  - \\modref{5.2} - for the tabular listing of all clinical studies
  - \\tableref{X} - for specific study in Table 5.1
  - \\studyref{Study-ID} - for specific study by ID
"""
    papers_context += "=" * 60 + "\n"

    return papers_context, section_refs


def truncate_text(text: str, max_chars: int = 3000, preserve_structure: bool = True) -> str:
    """Truncate text while preserving structure.

    Args:
        text: Text to truncate
        max_chars: Maximum characters to keep
        preserve_structure: If True, try to truncate at sentence/paragraph boundaries

    Returns:
        Truncated text with ellipsis if truncated
    """
    if len(text) <= max_chars:
        return text

    if preserve_structure:
        # Try to truncate at a reasonable point (sentence end, paragraph, etc.)
        truncated = text[:max_chars]
        # Find last sentence end
        last_period = truncated.rfind('.')
        last_newline = truncated.rfind('\n')
        cut_point = max(last_period, last_newline)
        if cut_point > max_chars * 0.8:  # Only use if we're not losing too much
            truncated = truncated[:cut_point + 1]
        else:
            truncated = text[:max_chars]
    else:
        truncated = text[:max_chars]

    return truncated + "\n\n[... content truncated for context length ...]"


def summarize_latex_content(latex_content: str, max_chars: int = 2000) -> str:
    """Summarize LaTeX content by extracting key sections.

    Args:
        latex_content: Full LaTeX content
        max_chars: Maximum characters for summary

    Returns:
        Summarized LaTeX content
    """
    if len(latex_content) <= max_chars:
        return latex_content

    # Extract section headers and first few lines of each section
    lines = latex_content.split('\n')
    summary_lines = []
    current_section = None
    chars_used = 0

    for line in lines:
        stripped = line.strip()

        # Keep section headers
        if stripped.startswith('\\section{') or stripped.startswith('\\subsection{') or stripped.startswith('\\subsubsection{'):
            if chars_used + len(line) > max_chars * 0.9:
                break
            summary_lines.append(line)
            chars_used += len(line) + 1
            current_section = stripped
            continue

        # Keep first few non-empty lines of each section
        if stripped and not stripped.startswith('%'):
            if chars_used + len(line) > max_chars * 0.9:
                break
            summary_lines.append(line)
            chars_used += len(line) + 1
            # Limit lines per section
            if len([l for l in summary_lines if l.strip() and not l.strip().startswith('\\')]) > 10:
                # Skip remaining content of this section
                continue

    summary = '\n'.join(summary_lines)
    if len(latex_content) > len(summary):
        summary += "\n\n[... remaining content truncated for context length ...]"

    return summary


def load_written_section(section_id: str, output_dir: str = "section2.5_tex", max_chars: int = 3000) -> str:
    """Load already-written LaTeX content for a section.

    Args:
        section_id: Section ID (e.g., "2.5.1")
        output_dir: Output directory where .tex files are saved
        max_chars: Maximum characters to load (for context length management)

    Returns:
        LaTeX content if file exists, empty string otherwise
    """
    output_path = Path(output_dir)
    filename = f"{section_id.replace('.', '_')}.tex"
    filepath = output_path / filename

    if filepath.exists():
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
                # Remove comments and metadata, return just the LaTeX content
                lines = content.split('\n')
                latex_lines = []
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith('%') and 'Generated:' in stripped:
                        continue
                    if stripped.startswith('%') and 'Preamble' in stripped:
                        continue
                    if stripped.startswith('%') and 'Section' in stripped and 'Generated' in stripped:
                        continue
                    if not stripped or stripped == '%':
                        continue
                    latex_lines.append(line)

                latex_content = '\n'.join(latex_lines).strip()

                # Truncate if too long to manage context length
                if len(latex_content) > max_chars:
                    latex_content = summarize_latex_content(latex_content, max_chars)

                return latex_content
        except Exception as e:
            print(f"⚠️  Warning: Could not load written section {section_id}: {e}")
            return ""
    return ""


def save_tex_file(section_id: str, latex_content: str, preamble: str = None,
                  output_dir: str = "section2.5_tex") -> str:
    """Save LaTeX content to a file.

    Args:
        section_id: Section ID (e.g., "2.5.1")
        latex_content: LaTeX content to save
        preamble: Optional preamble content (for 2.5.txt)
        output_dir: Output directory

    Returns:
        Path to saved file
    """
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)

    # Sanitize section_id for filename
    filename = f"{section_id.replace('.', '_')}.tex"
    filepath = output_path / filename

    # If this is 2.5.txt (preamble), create a special preamble file
    if section_id == "2.5" and preamble:
        full_content = f"""% Preamble for Section 2.5: Clinical Overview
% Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

{preamble}

% This preamble should be included before other sections
"""
    else:
        # For regular sections, wrap in a minimal document structure if needed
        # But since we want separate files, we'll just save the section content
        full_content = f"""% Section {section_id}
% Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

{latex_content}
"""

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(full_content)

    print(f"   💾 Saved to: {filepath}")
    return str(filepath)


def generate_main_tex(output_dir: str = "section2.5_tex",
                      drug_name: str = "Drug Product",
                      sections: List[str] = None) -> str:
    """Generate the main.tex file that compiles all sections.

    This creates a complete LaTeX document with:
    - Proper preamble with all required packages
    - Professional header and footer
    - No title page or table of contents (regulatory style)
    - Manual section numbering (preserves 2.5.x format)
    - All section includes
    - References integrated within section 2.5.7 only

    Args:
        output_dir: Output directory for the main.tex file
        drug_name: Name of the drug product for the title
        sections: List of section IDs to include (default: all standard sections)

    Returns:
        Path to the generated main.tex file
    """
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)

    # Default sections if not provided
    if sections is None:
        sections = [
            "2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.5",
            "2.5.6", "2.5.6.1", "2.5.6.2", "2.5.6.3", "2.5.6.4", "2.5.7"
        ]

    # Check which sections actually exist
    existing_sections = []
    for section_id in sections:
        filename = f"{section_id.replace('.', '_')}.tex"
        if (output_path / filename).exists():
            existing_sections.append(section_id)

    # Generate section includes
    section_includes = ""
    section_titles = {
        "2.5.1": "Product Development Rationale",
        "2.5.2": "Overview of Biopharmaceutics",
        "2.5.3": "Overview of Clinical Pharmacology",
        "2.5.4": "Overview of Efficacy",
        "2.5.5": "Overview of Safety",
        "2.5.6": "Benefits and Risks Conclusions",
        "2.5.6.1": "Therapeutic Context",
        "2.5.6.2": "Benefits",
        "2.5.6.3": "Risks",
        "2.5.6.4": "Benefit-Risk Assessment",
        "2.5.7": "Literature References"
    }

    for section_id in existing_sections:
        filename = section_id.replace('.', '_')
        title = section_titles.get(section_id, section_id)
        section_includes += f"""
% =============================================================================
% SECTION {section_id} - {title}
% =============================================================================
\\input{{{filename}}}
\\newpage
"""

    # Generate the main.tex content (simplified - no title page, no TOC, no separate bibliography)
    main_tex_content = f'''% =============================================================================
% ICH Module 5 Section 2.5: Clinical Overview
% Main LaTeX Document
% =============================================================================
% Drug Product: {drug_name}
% Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
% =============================================================================

\\documentclass[11pt,a4paper]{{article}}

% =============================================================================
% PACKAGES
% =============================================================================

% Page layout and geometry
\\usepackage[margin=1in]{{geometry}}
\\usepackage{{setspace}}
\\onehalfspacing

% Font and encoding
\\usepackage[utf8]{{inputenc}}
\\usepackage[T1]{{fontenc}}
\\usepackage{{mathptmx}}  % Times New Roman-like font (regulatory standard)

% Tables and figures
\\usepackage{{booktabs}}
\\usepackage{{tabularx}}
\\usepackage{{longtable}}
\\usepackage{{graphicx}}
\\usepackage{{float}}

% Lists and formatting
\\usepackage{{enumitem}}
\\usepackage{{parskip}}

% Math support
\\usepackage{{amsmath}}
\\usepackage{{amssymb}}

% Cross-referencing and hyperlinks
\\usepackage{{hyperref}}
\\hypersetup{{
    colorlinks=true,
    linkcolor=blue,
    citecolor=blue,
    urlcolor=blue,
    pdfauthor={{Regulatory Documentation}},
    pdftitle={{ICH Module 5 Section 2.5 - Clinical Overview - {drug_name}}},
    pdfsubject={{Regulatory Submission}}
}}

% Better cross-references
\\usepackage[nameinlink]{{cleveref}}

% Headers and footers
\\usepackage{{fancyhdr}}
\\pagestyle{{fancy}}
\\fancyhf{{}}
\\fancyhead[L]{{\\small ICH Module 5 Section 2.5}}
\\fancyhead[R]{{\\small {drug_name}}}
\\fancyfoot[C]{{\\thepage}}
\\fancyfoot[R]{{\\small Confidential}}
\\renewcommand{{\\headrulewidth}}{{0.4pt}}
\\renewcommand{{\\footrulewidth}}{{0.4pt}}

% =============================================================================
% CUSTOM COMMANDS FOR MANUAL SECTION NUMBERING
% =============================================================================
% Use unnumbered sections but display manual numbers (preserves 2.5.x format)
\\setcounter{{secnumdepth}}{{0}}  % Disable automatic section numbering

% Custom reference commands
% Usage: \\modref{{5.3.1}} for Module 5 sections, \\secref{{2.5.1}} for internal sections
\\newcommand{{\\modref}}[1]{{(see Module 5, Section #1)}}
\\newcommand{{\\studyref}}[1]{{(see Section 5.2, Study #1)}}
\\newcommand{{\\tableref}}[1]{{(see Section 5.2, Table 5.1, Row #1)}}
\\newcommand{{\\secref}}[1]{{(see Section #1)}}  % For internal 2.5.x section references

% =============================================================================
% DOCUMENT CONTENT
% =============================================================================

\\begin{{document}}
{section_includes}
% =============================================================================
% DOCUMENT END
% =============================================================================

\\end{{document}}
'''

    # Save the main.tex file
    main_tex_path = output_path / "main.tex"
    with open(main_tex_path, 'w', encoding='utf-8') as f:
        f.write(main_tex_content)

    print(f"   📄 Generated main.tex: {main_tex_path}")
    print(f"   📚 Included {len(existing_sections)} sections")

    return str(main_tex_path)


def validation_node(state: SectionWritingState) -> SectionWritingState:
    """Validation node: Check quality of generated LaTeX content."""
    print(f"\n{'='*80}")
    print(f"🔍 VALIDATION PHASE: Checking quality of Section {state['section_id']}")
    print(f"{'='*80}\n")

    section_id = state["section_id"]
    latex_content = state.get("output_tex", "")
    expected_citations = len(state.get("cross_references", []))
    expected_citations = min(max(expected_citations, 3), 10)  # Between 3 and 10

    # Validate the content
    report = validate_latex_quality(latex_content, section_id, expected_citations)

    # Print quality report
    print(f"📊 Quality Report for Section {section_id}:")
    print(f"   Score: {report.score:.1f}/100")
    print(f"   Valid: {'✅ Yes' if report.is_valid else '❌ No'}")
    print(f"   Word count: {report.word_count}")
    print(f"   Citations: {report.citation_count}")
    print(f"   Sections: {report.section_count}")

    if report.issues:
        print(f"\n   ⚠️  Issues ({len(report.issues)}):")
        for issue in report.issues[:5]:
            print(f"      - {issue}")

    if report.latex_errors:
        print(f"\n   ❌ LaTeX Errors ({len(report.latex_errors)}):")
        for error in report.latex_errors[:5]:
            print(f"      - {error}")

    if report.suggestions:
        print(f"\n   💡 Suggestions ({len(report.suggestions)}):")
        for suggestion in report.suggestions[:3]:
            print(f"      - {suggestion}")

    print(f"\n{'='*80}\n")

    # Convert report to dict for state
    report_dict = {
        "is_valid": report.is_valid,
        "score": report.score,
        "issues": report.issues,
        "suggestions": report.suggestions,
        "latex_errors": report.latex_errors,
        "citation_count": report.citation_count,
        "section_count": report.section_count,
        "word_count": report.word_count
    }

    return {
        "quality_report": report_dict,
        "messages": state["messages"] + [{
            "role": "assistant",
            "content": f"Validation complete. Score: {report.score:.1f}/100. Valid: {report.is_valid}."
        }]
    }


def refinement_node(state: SectionWritingState, model: str = "openai:gpt-4o") -> SectionWritingState:
    """Refinement node: Improve content based on validation feedback."""
    print(f"\n{'='*80}")
    print(f"✨ REFINEMENT PHASE: Improving Section {state['section_id']}")
    print(f"{'='*80}\n")

    section_id = state["section_id"]
    current_content = state.get("output_tex", "")
    quality_report = state.get("quality_report", {})
    revision_count = state.get("revision_count", 0)

    # Check if refinement is needed
    if quality_report.get("is_valid", False) and quality_report.get("score", 0) >= 80:
        print(f"✅ Content already meets quality standards (score: {quality_report.get('score', 0):.1f})")
        print(f"   Skipping refinement phase.\n")
        return {"revision_count": revision_count}

    # Check max revisions
    max_revisions = 2
    if revision_count >= max_revisions:
        print(f"⚠️  Maximum revisions ({max_revisions}) reached. Proceeding with current content.")
        return {"revision_count": revision_count}

    print(f"🔄 Revision {revision_count + 1}/{max_revisions}")
    print(f"   Current score: {quality_report.get('score', 0):.1f}/100")

    # Build refinement prompt with specific feedback
    issues = quality_report.get("issues", [])
    suggestions = quality_report.get("suggestions", [])
    latex_errors = quality_report.get("latex_errors", [])

    feedback_prompt = f"""Please refine and improve the following LaTeX content for Section {section_id}.

CURRENT CONTENT:
```latex
{current_content}
```

ISSUES TO FIX:
{chr(10).join(f'- {issue}' for issue in issues) if issues else '- No major issues'}

LATEX ERRORS TO CORRECT:
{chr(10).join(f'- {error}' for error in latex_errors) if latex_errors else '- No LaTeX errors'}

IMPROVEMENTS TO MAKE:
{chr(10).join(f'- {suggestion}' for suggestion in suggestions) if suggestions else '- Polish and improve clarity'}

Please provide the complete, improved LaTeX content. Focus on:
1. Fixing all identified issues and errors
2. Improving clarity and flow
3. Ensuring proper citations and cross-references
4. Maintaining regulatory writing standards

Return ONLY the improved LaTeX code, starting with the section command."""

    # Create refinement agent
    llm = init_chat_model(model, temperature=0.2)  # Lower temperature for refinement

    try:
        # Use direct LLM call for refinement
        messages = [
            {"role": "system", "content": f"You are a LaTeX expert improving regulatory documentation for Section {section_id}. Fix all issues and improve quality."},
            {"role": "user", "content": feedback_prompt}
        ]

        response = llm.invoke(messages)
        refined_content = response.content if hasattr(response, 'content') else str(response)

        # Clean up the response
        # Remove markdown code blocks if present
        refined_content = re.sub(r'^```(?:latex)?\s*', '', refined_content, flags=re.MULTILINE)
        refined_content = re.sub(r'\s*```$', '', refined_content, flags=re.MULTILINE)
        refined_content = refined_content.strip()

        # Validate the refined content is actually LaTeX
        if '\\section' in refined_content or '\\subsection' in refined_content:
            print(f"   ✅ Refinement complete. New length: {len(refined_content)} chars")
            return {
                "output_tex": refined_content,
                "revision_count": revision_count + 1,
                "messages": state["messages"] + [{
                    "role": "assistant",
                    "content": f"Refinement {revision_count + 1} complete. Content improved."
                }]
            }
        else:
            print(f"   ⚠️  Refined content doesn't appear to be valid LaTeX. Keeping original.")
            return {"revision_count": revision_count + 1}

    except Exception as e:
        print(f"   ❌ Refinement error: {e}")
        return {"revision_count": revision_count + 1}


def should_refine(state: SectionWritingState) -> str:
    """Conditional edge: Determine if refinement is needed."""
    quality_report = state.get("quality_report", {})
    revision_count = state.get("revision_count", 0)

    # Check if content needs refinement
    score = quality_report.get("score", 0)
    is_valid = quality_report.get("is_valid", False)
    has_errors = len(quality_report.get("latex_errors", [])) > 0

    # Conditions to refine
    if revision_count >= 2:
        return "end"  # Max revisions reached

    if not is_valid or score < 70 or has_errors:
        return "refine"

    return "end"


def create_section_writing_graph(model: str = "openai:gpt-4o", temperature: float = 0.3,
                                  enable_refinement: bool = True):
    """Create a graph for writing sections with multi-step pipeline.

    Pipeline: planning -> writing -> validation -> [refinement loop] -> end

    Args:
        model: LLM model to use
        temperature: Temperature for LLM
        enable_refinement: Whether to enable the refinement loop
    """
    graph = StateGraph(SectionWritingState)

    # Add nodes
    graph.add_node("planning", planning_node)

    # Create writing node with model parameters
    def write_node(state: SectionWritingState) -> SectionWritingState:
        return writing_node(state, model=model, temperature=temperature)

    graph.add_node("writing", write_node)
    graph.add_node("validation", validation_node)

    # Create refinement node with model parameter
    def refine_node(state: SectionWritingState) -> SectionWritingState:
        return refinement_node(state, model=model)

    graph.add_node("refinement", refine_node)

    # Set entry point
    graph.set_entry_point("planning")

    # Connect nodes
    graph.add_edge("planning", "writing")
    graph.add_edge("writing", "validation")

    if enable_refinement:
        # Add conditional edge for refinement loop
        graph.add_conditional_edges(
            "validation",
            should_refine,
            {
                "refine": "refinement",
                "end": END
            }
        )
        # After refinement, re-validate
        graph.add_edge("refinement", "validation")
    else:
        # Direct to end without refinement
        graph.add_edge("validation", END)

    return graph.compile()


def write_all_sections(papers_json: str, sections: List[str] = None,
                       model: str = "openai:gpt-4o", output_dir: str = "section2.5_tex",
                       enable_refinement: bool = True) -> Dict[str, Any]:
    """Write multiple sections in dependency order.

    This function processes sections in topological order based on their
    dependencies, ensuring that dependent sections have access to already-written
    content from their dependencies.

    Args:
        papers_json: Path to combined papers JSON file
        sections: List of section IDs to write (default: all sections)
        model: LLM model to use
        output_dir: Output directory for .tex files
        enable_refinement: Whether to enable the refinement loop

    Returns:
        Dictionary with results for each section
    """
    # Default sections to write
    if sections is None:
        sections = [
            "2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.5",
            "2.5.6", "2.5.6.1", "2.5.6.2", "2.5.6.3", "2.5.6.4", "2.5.7"
        ]

    # Load papers data
    papers_data = load_papers_json(papers_json)

    # Sort sections by dependencies
    sorted_sections = topological_sort_sections(sections)

    print("\n" + "="*80)
    print("🚀 BATCH SECTION WRITING")
    print("="*80)
    print(f"📄 Sections to write: {len(sorted_sections)}")
    print(f"📋 Order: {' → '.join(sorted_sections)}")
    print(f"🤖 Model: {model}")
    print(f"📁 Output: {output_dir}/")
    print("="*80 + "\n")

    # Create the graph
    graph = create_section_writing_graph(
        model=model,
        enable_refinement=enable_refinement
    )

    results = {}
    successful = 0
    failed = 0

    for idx, section_id in enumerate(sorted_sections, 1):
        print(f"\n{'='*80}")
        print(f"📄 PROCESSING SECTION {idx}/{len(sorted_sections)}: {section_id}")
        print(f"{'='*80}\n")

        try:
            # Initial state
            initial_state = {
                "messages": [{"role": "user", "content": f"Write LaTeX section {section_id}"}],
                "section_id": section_id,
                "section_guidance": "",
                "papers_data": papers_data,
                "output_tex": "",
                "cross_references": [],
                "other_sections": {},
                "related_sections_tex": {},
                "output_dir": output_dir,
                "outline": "",
                "draft_tex": "",
                "quality_report": {},
                "revision_count": 0,
                "writing_phase": "full"
            }

            # Run the graph
            result = graph.invoke(initial_state)

            # Save the file
            if result.get("output_tex"):
                output_file = save_tex_file(
                    section_id,
                    result["output_tex"],
                    output_dir=output_dir
                )

                results[section_id] = {
                    "status": "success",
                    "file": output_file,
                    "length": len(result["output_tex"]),
                    "quality_score": result.get("quality_report", {}).get("score", 0)
                }
                successful += 1
                print(f"✅ Section {section_id} completed successfully")
            else:
                results[section_id] = {"status": "failed", "error": "No content generated"}
                failed += 1
                print(f"❌ Section {section_id} failed: No content generated")

        except Exception as e:
            results[section_id] = {"status": "failed", "error": str(e)}
            failed += 1
            print(f"❌ Section {section_id} failed: {e}")

        # Small delay between sections to avoid rate limits
        if idx < len(sorted_sections):
            time.sleep(2)

    # Print summary
    print("\n" + "="*80)
    print("📊 BATCH PROCESSING COMPLETE")
    print("="*80)
    print(f"✅ Successful: {successful}/{len(sorted_sections)}")
    print(f"❌ Failed: {failed}/{len(sorted_sections)}")

    for section_id, result in results.items():
        status = "✅" if result["status"] == "success" else "❌"
        if result["status"] == "success":
            print(f"   {status} {section_id}: {result['length']:,} chars, score: {result.get('quality_score', 0):.1f}")
        else:
            print(f"   {status} {section_id}: {result.get('error', 'Unknown error')}")

    # Generate main.tex to compile all sections
    print("\n" + "="*80)
    print("📄 GENERATING MAIN.TEX")
    print("="*80)
    drug_name = papers_data.get("drug_name", "Drug Product")
    main_tex_path = generate_main_tex(
        output_dir=output_dir,
        drug_name=drug_name,
        sections=sorted_sections
    )
    print(f"\n✅ Main document ready: {main_tex_path}")
    print(f"   To compile: cd {output_dir} && pdflatex main.tex && pdflatex main.tex")
    print("="*80 + "\n")

    return results


def main():
    """Main function to run the section writing system."""
    import sys
    import argparse

    parser = argparse.ArgumentParser(
        description="Multi-Agent System for Writing ICH Module 5 Section 2.5 LaTeX Documents",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Write a single section
  python multi_agent_section_writer.py 2.5.1 papers.json

  # Write with specific model
  python multi_agent_section_writer.py 2.5.2 papers.json --model openai:gpt-4o

  # Write without refinement (faster)
  python multi_agent_section_writer.py 2.5.4 papers.json --no-refinement

  # Write all sections in dependency order
  python multi_agent_section_writer.py --all papers.json

  # Write specific sections in batch
  python multi_agent_section_writer.py --batch 2.5.1,2.5.2,2.5.3 papers.json
        """
    )
    parser.add_argument("section_id", nargs="?", help="Section ID to write (e.g., 2.5.1, 2.5.2)")
    parser.add_argument("papers_json", help="Path to combined papers JSON file")
    parser.add_argument("--model", "-m", default="openai:gpt-4o",
                        help="LLM model to use (default: openai:gpt-4o)")
    parser.add_argument("--output-dir", "-o", default="section2.5_tex",
                        help="Output directory for .tex files (default: section2.5_tex)")
    parser.add_argument("--no-refinement", action="store_true",
                        help="Disable the refinement loop (faster but lower quality)")
    parser.add_argument("--temperature", "-t", type=float, default=0.3,
                        help="Temperature for LLM (default: 0.3)")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose output")
    parser.add_argument("--all", "-a", action="store_true",
                        help="Write all sections in dependency order")
    parser.add_argument("--batch", "-b", type=str,
                        help="Comma-separated list of sections to write in batch (e.g., 2.5.1,2.5.2,2.5.3)")
    parser.add_argument("--generate-main", "-g", action="store_true",
                        help="Generate main.tex file only (without writing sections)")
    parser.add_argument("--no-main", action="store_true",
                        help="Skip generating main.tex after writing sections")

    args = parser.parse_args()

    # Handle generate-main only mode
    if args.generate_main:
        if not os.path.exists(args.papers_json):
            print(f"❌ Error: Papers JSON file not found: {args.papers_json}")
        sys.exit(1)

        papers_data = load_papers_json(args.papers_json)
        drug_name = papers_data.get("drug_name", "Drug Product")

        print("\n" + "="*80)
        print("📄 GENERATING MAIN.TEX")
        print("="*80)

        main_tex_path = generate_main_tex(
            output_dir=args.output_dir,
            drug_name=drug_name
        )

        print(f"\n✅ Main document generated: {main_tex_path}")
        print(f"\n📋 To compile the document:")
        print(f"   cd {args.output_dir}")
        print(f"   pdflatex main.tex")
        print(f"   pdflatex main.tex  # Run twice for cross-references")
        print("="*80 + "\n")
        sys.exit(0)

    # Handle batch/all mode
    if args.all or args.batch:
        sections = None
        if args.batch:
            sections = [s.strip() for s in args.batch.split(",")]

        results = write_all_sections(
            papers_json=args.papers_json,
            sections=sections,
            model=args.model,
            output_dir=args.output_dir,
            enable_refinement=not args.no_refinement
        )

        # Exit with error code if any failed
        failed = sum(1 for r in results.values() if r["status"] == "failed")
        sys.exit(1 if failed > 0 else 0)

    # Single section mode requires section_id
    if not args.section_id:
        parser.error("section_id is required for single section mode (or use --all/--batch)")

    section_id = args.section_id
    papers_json = args.papers_json
    model = args.model
    output_dir = args.output_dir
    enable_refinement = not args.no_refinement
    temperature = args.temperature

    if not os.path.exists(papers_json):
        print(f"❌ Error: Papers JSON file not found: {papers_json}")
        sys.exit(1)

    # Validate section_id format
    if not re.match(r'^2\.5(\.\d+)*$', section_id):
        print(f"Error: Invalid section ID format: {section_id}")
        print("Expected format: 2.5, 2.5.1, 2.5.2, etc.")
        sys.exit(1)

    # Load papers data
    try:
        papers_data = load_papers_json(papers_json)
    except Exception as e:
        print(f"Error loading papers JSON: {e}")
        sys.exit(1)

    # Create the graph with refinement option
    graph = create_section_writing_graph(
        model=model,
        temperature=temperature,
        enable_refinement=enable_refinement
    )

    # Initial state with new fields
    initial_state = {
        "messages": [{"role": "user", "content": f"Write LaTeX section {section_id} with cross-references to relevant papers and related sections."}],
        "section_id": section_id,
        "section_guidance": "",
        "papers_data": papers_data,
        "output_tex": "",
        "cross_references": [],
        "other_sections": {},
        "related_sections_tex": {},
        "output_dir": output_dir,
        # New fields for enhanced pipeline
        "outline": "",
        "draft_tex": "",
        "quality_report": {},
        "revision_count": 0,
        "writing_phase": "full"
    }

    # Print startup banner
    print("\n" + "="*80)
    print("🚀 MULTI-AGENT SECTION WRITING SYSTEM v2.0")
    print("="*80)
    print(f"📄 Section: {section_id}")
    print(f"💊 Drug: {papers_data.get('drug_name', 'Unknown')}")
    print(f"🤖 Model: {model}")
    print(f"🌡️  Temperature: {temperature}")
    print(f"📁 Output: {output_dir}/")
    print(f"🔄 Refinement: {'Enabled' if enable_refinement else 'Disabled'}")
    print("="*80)
    print("\n📋 Pipeline: Planning → Writing → Validation" +
          (" → Refinement Loop" if enable_refinement else ""))
    print("="*80 + "\n")

    start_time = datetime.datetime.now()

    # Run the graph
    result = graph.invoke(initial_state)

    end_time = datetime.datetime.now()
    duration = (end_time - start_time).total_seconds()

    # Save the LaTeX file
    if "output_tex" in result and result["output_tex"]:
        # Load preamble if this is section 2.5
        preamble = None
        if section_id == "2.5":
            try:
                preamble = load_preamble()
            except Exception as e:
                print(f"⚠️  Warning: Could not load preamble: {e}")

        output_file = save_tex_file(
            section_id,
            result["output_tex"],
            preamble=preamble,
            output_dir=output_dir
        )

        # Get quality report if available
        quality_report = result.get("quality_report", {})
        revision_count = result.get("revision_count", 0)

        print("\n" + "="*80)
        print("✅ FINAL RESULTS")
        print("="*80)
        print(f"\n📄 Output file: {output_file}")
        print(f"📊 Section: {section_id}")
        print(f"📝 Content length: {len(result['output_tex']):,} characters")
        print(f"📚 Papers referenced: {len(result.get('cross_references', []))}")

        if quality_report:
            print(f"\n🎯 Quality Metrics:")
            print(f"   Score: {quality_report.get('score', 0):.1f}/100")
            print(f"   Valid: {'✅' if quality_report.get('is_valid', False) else '❌'}")
            print(f"   Word count: {quality_report.get('word_count', 0):,}")
            print(f"   Citations: {quality_report.get('citation_count', 0)}")
            print(f"   Sections: {quality_report.get('section_count', 0)}")
            print(f"   Revisions: {revision_count}")

        print(f"\n⏱️  Total time: {duration:.1f}s")
        print("="*80 + "\n")

        # Generate main.tex unless --no-main is specified
        if not args.no_main:
            print("📄 Updating main.tex...")
            main_tex_path = generate_main_tex(
                output_dir=output_dir,
                drug_name=papers_data.get("drug_name", "Drug Product")
            )
            print(f"\n📋 To compile the full document:")
            print(f"   cd {output_dir}")
            print(f"   pdflatex main.tex")
            print(f"   pdflatex main.tex  # Run twice for cross-references")
            print("="*80 + "\n")
    else:
        print("\n" + "="*80)
        print("❌ ERROR")
        print("="*80)
        print("No LaTeX content was generated. Please check the error messages above.")
        print(f"⏱️  Time elapsed: {duration:.1f}s")
        print("="*80 + "\n")
        sys.exit(1)


if __name__ == "__main__":
    main()

