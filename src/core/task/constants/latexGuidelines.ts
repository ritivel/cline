export const LATEX_FORMATTING_GUIDELINES = `## LaTeX FORMATTING GUIDELINES - CRITICAL

### ⚠️ MANDATORY: COMPLETE STANDALONE DOCUMENT

**Your output MUST be a complete, standalone LaTeX document that can compile independently.**

**REQUIRED STRUCTURE - FOLLOW THIS EXACTLY:**
\`\`\`latex
\\documentclass[11pt,a4paper]{article}

% ===== REQUIRED PACKAGES - INCLUDE ALL OF THESE =====
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[english]{babel}
\\usepackage{geometry}
\\usepackage{setspace}
\\usepackage{parskip}
\\usepackage{booktabs}      % For professional tables (\\toprule, \\midrule, \\bottomrule)
\\usepackage{longtable}     % For tables spanning multiple pages
\\usepackage{array}         % Enhanced table formatting
\\usepackage{graphicx}      % For images if needed
\\usepackage{hyperref}      % For clickable links
\\usepackage{amsmath}       % For mathematical notation
\\usepackage{siunitx}       % For units (\\SI{500}{\\mg})
\\usepackage{enumitem}      % For customized lists
\\usepackage{fancyhdr}      % For headers/footers
\\usepackage{textcomp}      % For \\textdegree and other symbols

% ===== PAGE SETUP =====
\\geometry{margin=2.5cm}
\\onehalfspacing

% ===== HEADER/FOOTER =====
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[C]{CTD Section X.X: Title}
\\fancyfoot[C]{\\thepage}

% ===== HYPERLINK SETUP =====
\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    urlcolor=blue
}

\\begin{document}

\\section{Section Title}

% Your section content here...

\\subsection{First Subsection}
Content...

\\subsection{Second Subsection}
Content with tables, lists, etc.

\\end{document}
\`\`\`

### ❌ NEVER START WITH JUST \\section{} - ALWAYS INCLUDE FULL PREAMBLE!

### Special Character Escaping - CRITICAL
You MUST escape these special characters in LaTeX:

| Character | Escape As | Example |
|-----------|-----------|---------|
| % | \\% | 50\\% purity |
| & | \\& | Smith \\& Co. |
| $ | \\$ | \\$100 |
| # | \\# | Batch \\#1 |
| _ | \\_ | process\\_step |
| { | \\{ | \\{range\\} |
| } | \\} | \\{range\\} |
| ~ | \\textasciitilde{} | approximately\\textasciitilde{}10 |
| ^ | \\textasciicircum{} | 10\\textasciicircum{}3 |

### Tables for Information
\`\`\`latex
\\begin{table}[htbp]
\\centering
\\caption{Table Caption}
\\begin{tabular}{p{4cm}p{8cm}}
\\toprule
\\textbf{Attribute} & \\textbf{Details} \\\\
\\midrule
Item 1 & Description 1 \\\\
Item 2 & Description 2 \\\\
\\bottomrule
\\end{tabular}
\\end{table}
\`\`\`

### Chemical and Scientific Notation
- Temperatures: \`20\\textdegree{}C\` or \`20~\\textdegree{}C\`
- Percentages: Always escape: \`50\\%\`
- Ranges: Use en-dash: \`20--25\\textdegree{}C\`
- Less than/equal: \`$\\leq$\` or \`$<$\`
- Greater than/equal: \`$\\geq$\` or \`$>$\`
- Plus/minus: \`$\\pm$\` for ±
- Greek letters: \`$\\alpha$\`, \`$\\beta$\`, \`$\\mu$\` (in math mode)
- Superscripts: \`\\textsuperscript{2}\` or \`$^{2}$\`
- Subscripts: \`\\textsubscript{2}\` or \`$_{2}$\`
- Units: Use siunitx: \`\\SI{500}{\\mg}\`, \`\\SI{25}{\\celsius}\`

### Quotation Marks
- Use \`\`text'' for double quotes
- Use \`text' for single quotes
- Do NOT use straight quotes " or '

### Lists
\`\`\`latex
\\begin{itemize}
    \\item First item
    \\item Second item
\\end{itemize}

\\begin{enumerate}
    \\item First numbered item
    \\item Second numbered item
\\end{enumerate}
\`\`\`

### Cross-References
\`\`\`latex
As detailed in Section X.X.X, the...
The diagram (see Section~X.X.X) illustrates...
\`\`\`

### Common Mistakes to AVOID
1. ❌ Starting with \\section{} without document preamble
2. ❌ Missing \\documentclass, \\begin{document}, or \\end{document}
3. ❌ Unescaped special characters: %, &, $, #, _, {, }
4. ❌ Straight quotes: "text" (use \`\`text'' instead)
5. ❌ Degree symbol: ° (use \\textdegree{} instead)
6. ❌ Unclosed environments (tables, itemize, etc.)
7. ❌ Missing \\\\  at end of table rows

### LaTeX Validation Checklist
- [ ] Document STARTS with \\documentclass[11pt,a4paper]{article}
- [ ] All required \\usepackage commands included
- [ ] Has \\begin{document} after packages
- [ ] Has \\end{document} at the very end
- [ ] All special characters escaped: %, &, $, #, _, {, }
- [ ] Quotation marks use LaTeX style: \`\`text''
- [ ] Tables have proper structure with \\\\  at row ends
- [ ] All \\begin{} have matching \\end{}`
