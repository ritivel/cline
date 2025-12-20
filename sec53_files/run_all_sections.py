#!/usr/bin/env python3
"""Script to sequentially process all Module 5.3 sections and combine results.

Usage:
    python run_all_sections.py <drug_name> [model]

Examples:
    python run_all_sections.py "Levofloxacin USP 250mg"
    python run_all_sections.py "Levofloxacin USP 250mg" "openai:gpt-4o"
"""

import os
import sys
import json
import subprocess
import re
from pathlib import Path
from datetime import datetime


def sanitize_filename(name: str) -> str:
    """Sanitize a string for use in filenames.

    Replaces spaces and special characters with underscores.
    """
    # Replace spaces and special characters with underscores
    sanitized = re.sub(r'[^\w\-_\.]', '_', name)
    # Replace multiple underscores with single underscore
    sanitized = re.sub(r'_+', '_', sanitized)
    return sanitized.strip('_')


def run_section(regulation_file: str, drug_name: str, model: str = "openai:gpt-4o") -> bool:
    """Run multi_agent_research.py for a single section.

    Args:
        regulation_file: Path to regulation file
        drug_name: Name of the drug
        model: LLM model to use

    Returns:
        True if successful, False otherwise
    """
    print(f"\n{'='*80}")
    print(f"Processing: {regulation_file}")
    print(f"{'='*80}\n")

    cmd = [
        sys.executable,
        "multi_agent_research.py",
        regulation_file,
        drug_name,
        model
    ]

    try:
        result = subprocess.run(cmd, check=True, capture_output=False)
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Error processing {regulation_file}: {e}")
        return False
    except KeyboardInterrupt:
        print(f"\n⚠️  Interrupted while processing {regulation_file}")
        return False


def combine_results(drug_name: str, sections: list) -> dict:
    """Combine all section results into a single JSON structure.

    Args:
        drug_name: Name of the drug
        sections: List of section IDs (e.g., ['5.3.1', '5.3.2', ...])

    Returns:
        Combined JSON structure
    """
    results_dir = Path("module5Results")
    combined = {
        "drug_name": drug_name,
        "regulation_section": "5.3",
        "sections": {},
        "summary": {
            "total_unique_papers": 0,
            "total_mentions": 0,
            "papers_by_section": {},
            "deduplication_stats": {
                "duplicates_found": 0,
                "papers_removed": 0
            },
            "sections_processed": []
        },
        "combined_at": datetime.now().isoformat()
    }

    total_unique = 0
    total_mentions = 0
    all_papers_by_section = {}

    for section_id in sections:
        section_file = results_dir / f"{sanitize_filename(drug_name)}_{section_id}_papers.json"

        if not section_file.exists():
            print(f"⚠️  Warning: {section_file} not found, skipping...")
            continue

        try:
            with open(section_file, 'r', encoding='utf-8') as f:
                section_data = json.load(f)

            # Extract section information
            if "sections" in section_data:
                # New format with nested sections
                for sub_section_id, sub_section_info in section_data["sections"].items():
                    combined["sections"][sub_section_id] = sub_section_info
                    paper_count = len(sub_section_info.get("papers", []))
                    all_papers_by_section[sub_section_id] = paper_count
                    total_unique += paper_count
            else:
                # Old format - single section
                section_info = {
                    "title": section_data.get("regulation_section", section_id),
                    "description": "",
                    "papers": section_data.get("papers", [])
                }
                combined["sections"][section_id] = section_info
                paper_count = len(section_info["papers"])
                all_papers_by_section[section_id] = paper_count
                total_unique += paper_count

            # Add to summary
            if "summary" in section_data:
                section_summary = section_data["summary"]
                total_mentions += section_summary.get("total_mentions", 0)
                if "deduplication_stats" in section_summary:
                    combined["summary"]["deduplication_stats"]["duplicates_found"] += \
                        section_summary["deduplication_stats"].get("duplicates_found", 0)
                    combined["summary"]["deduplication_stats"]["papers_removed"] += \
                        section_summary["deduplication_stats"].get("papers_removed", 0)

            combined["summary"]["sections_processed"].append(section_id)
            print(f"✓ Loaded {section_id}: {paper_count} papers")

        except json.JSONDecodeError as e:
            print(f"⚠️  Error reading {section_file}: Invalid JSON - {e}")
        except Exception as e:
            print(f"⚠️  Error reading {section_file}: {e}")

    # Update combined summary
    combined["summary"]["total_unique_papers"] = total_unique
    combined["summary"]["total_mentions"] = total_mentions
    combined["summary"]["papers_by_section"] = all_papers_by_section

    return combined


def main():
    """Main function to run all sections sequentially and combine results."""
    if len(sys.argv) < 2:
        print("Usage: python run_all_sections.py <drug_name> [model]")
        print("\nArguments:")
        print("  drug_name: Name of the drug (e.g., 'Levofloxacin USP 250mg')")
        print("  model: (optional) LLM model (default: 'openai:gpt-4o')")
        print("\nExamples:")
        print("  python run_all_sections.py 'Levofloxacin USP 250mg'")
        print("  python run_all_sections.py 'Levofloxacin USP 250mg' 'openai:gpt-4o'")
        sys.exit(1)

    drug_name = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else "openai:gpt-4o"

    # All sections to process
    sections = ["5.3.1", "5.3.2", "5.3.3", "5.3.4", "5.3.5", "5.3.6", "5.3.7"]
    regulation_dir = Path("Module5Regulation")

    print("="*80)
    print("MODULE 5.3 SEQUENTIAL PROCESSING")
    print("="*80)
    print(f"Drug: {drug_name}")
    print(f"Model: {model}")
    print(f"Sections to process: {', '.join(sections)}")
    print("="*80)

    # Process each section sequentially
    start_time = datetime.now()
    successful_sections = []
    failed_sections = []

    for section_id in sections:
        regulation_file = regulation_dir / f"{section_id}.txt"

        if not regulation_file.exists():
            print(f"\n⚠️  Warning: {regulation_file} not found, skipping...")
            failed_sections.append(section_id)
            continue

        section_start = datetime.now()
        success = run_section(str(regulation_file), drug_name, model)
        section_end = datetime.now()
        duration = (section_end - section_start).total_seconds()

        if success:
            successful_sections.append(section_id)
            print(f"\n✅ {section_id} completed in {duration:.1f}s")
        else:
            failed_sections.append(section_id)
            print(f"\n❌ {section_id} failed after {duration:.1f}s")

    total_duration = (datetime.now() - start_time).total_seconds()

    print(f"\n{'='*80}")
    print("PROCESSING SUMMARY")
    print(f"{'='*80}")
    print(f"Successful: {len(successful_sections)} sections")
    print(f"Failed: {len(failed_sections)} sections")
    if failed_sections:
        print(f"Failed sections: {', '.join(failed_sections)}")
    print(f"Total time: {total_duration/60:.1f} minutes")
    print(f"{'='*80}\n")

    # Combine results
    if successful_sections:
        print("="*80)
        print("COMBINING RESULTS")
        print("="*80)

        combined = combine_results(drug_name, successful_sections)

        # Save combined results
        results_dir = Path("module5Results")
        results_dir.mkdir(exist_ok=True)

        # Sanitize drug name for filename
        combined_file = results_dir / f"{sanitize_filename(drug_name)}_5.3_combined_papers.json"

        with open(combined_file, 'w', encoding='utf-8') as f:
            json.dump(combined, f, indent=2, ensure_ascii=False)

        print(f"\n✅ Combined results saved to: {combined_file}")
        print(f"\nSummary:")
        print(f"  Total unique papers: {combined['summary']['total_unique_papers']}")
        print(f"  Total mentions: {combined['summary']['total_mentions']}")
        print(f"  Sections processed: {len(combined['summary']['sections_processed'])}")
        print(f"  Duplicates found: {combined['summary']['deduplication_stats']['duplicates_found']}")
        print(f"  Papers removed: {combined['summary']['deduplication_stats']['papers_removed']}")
        print("="*80)
    else:
        print("⚠️  No successful sections to combine.")


if __name__ == "__main__":
    main()

