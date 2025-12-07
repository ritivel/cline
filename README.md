<div align="center"><sub>
English | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/ko/README.md" target="_blank">한국어</a>
</sub></div>

# Ritivel

<p align="center">
  <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>Download on VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/for-new-coders" target="_blank"><strong>Getting Started</strong></a>
</td>
</tbody>
</table>
</div>

Meet Ritivel, an AI-native editor for regulatory teams in life-sciences.

Ritivel streamlines regulatory document creation, CTD dossier management, and compliance workflows with intelligent assistance. Thanks to [Claude Sonnet's agentic capabilities](https://www.anthropic.com/claude/sonnet), Ritivel can handle complex regulatory documentation tasks step-by-step. With tools that let it create & edit files, explore large document repositories, use the browser, and execute terminal commands (after you grant permission), Ritivel assists regulatory teams in ways that go beyond simple document editing. Ritivel can even use the Model Context Protocol (MCP) to create new tools and extend its capabilities. While autonomous AI scripts traditionally run in sandboxed environments, this extension provides a human-in-the-loop GUI to approve every file change and terminal command, providing a safe and accessible way to leverage AI for regulatory work.

1. Enter your regulatory documentation task and add context from existing documents or regulatory guidelines.
2. Ritivel starts by analyzing your document structure, running searches, and reading relevant files to understand your regulatory project. By carefully managing what information is added to context, Ritivel can provide valuable assistance even for large, complex regulatory dossiers without overwhelming the context window.
3. Once Ritivel has the information it needs, it can:
    - Create and edit regulatory documents + monitor formatting and compliance requirements along the way, proactively fixing issues like missing sections and formatting errors.
    - Execute commands directly in your terminal and monitor their output as it works, allowing it to react to document processing issues after editing files.
    - For regulatory workflows, Ritivel can launch documents in a browser, navigate through CTD structures, and capture information, allowing it to assist with regulatory submissions and compliance checks.
4. When a task is completed, Ritivel will present the result to you with clear documentation of changes made.

> [!TIP]
> Follow [this guide](https://docs.cline.bot/features/customization/opening-cline-in-sidebar) to open Ritivel on the right side of your editor. This lets you use Ritivel side-by-side with your file explorer, and see how it changes your workspace more clearly.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### Use any API and Model

Ritivel supports API providers like OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras and Groq. You can also configure any OpenAI compatible API, or use a local model through LM Studio/Ollama. If you're using OpenRouter, the extension fetches their latest model list, allowing you to use the newest models as soon as they're available.

The extension also keeps track of total tokens and API usage cost for the entire task loop and individual requests, keeping you informed of spend every step of the way.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### Run Commands in Terminal

Thanks to the new [shell integration updates in VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), Ritivel can execute commands directly in your terminal and receive the output. This allows it to perform a wide range of tasks, from processing documents and running validation scripts to managing regulatory workflows, all while adapting to your environment & toolchain to get the job done right.

For long running processes like document processing, use the "Proceed While Running" button to let Ritivel continue in the task while the command runs in the background. As Ritivel works it'll be notified of any new terminal output along the way, letting it react to issues that may come up, such as formatting errors when editing documents.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### Create and Edit Files

Ritivel can create and edit files directly in your editor, presenting you a diff view of the changes. You can edit or revert Ritivel's changes directly in the diff view editor, or provide feedback in chat until you're satisfied with the result. Ritivel also monitors formatting and compliance requirements so it can fix issues that come up along the way on its own.

All changes made by Ritivel are recorded in your file's Timeline, providing an easy way to track and revert modifications if needed.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### Use the Browser

With Claude Sonnet's new [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) capability, Ritivel can launch a browser, click elements, type text, and scroll, capturing screenshots and console logs at each step. This allows for interactive document review, regulatory portal navigation, and compliance checking! This gives it autonomy to navigate regulatory websites and extract information without you needing to manually copy-paste content.

Try asking Ritivel to "review this regulatory submission", and watch as it navigates regulatory portals, extracts relevant information, and helps ensure compliance.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "add a tool that..."

Thanks to the [Model Context Protocol](https://github.com/modelcontextprotocol), Ritivel can extend its capabilities through custom tools. While you can use [community-made servers](https://github.com/modelcontextprotocol/servers), Ritivel can instead create and install tools tailored to your specific regulatory workflow. Just ask Ritivel to "add a tool" and it will handle everything, from creating a new MCP server to installing it into the extension. These custom tools then become part of Ritivel's toolkit, ready to use in future tasks.

-   "add a tool that fetches regulatory guidelines": Retrieve FDA/EMA guidelines and put Ritivel to work
-   "add a tool that manages CTD dossier structure": Check dossier completeness and organize sections
-   "add a tool that pulls the latest regulatory updates": Fetch details and ask Ritivel to update documents

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### Add Context

**`@url`:** Paste in a URL for the extension to fetch and convert to markdown, useful when you want to give Ritivel the latest regulatory guidelines

**`@problems`:** Add workspace errors and warnings ('Problems' panel) for Ritivel to fix

**`@file`:** Adds a file's contents so you don't have to waste API requests approving read file (+ type to search files)

**`@folder`:** Adds folder's files all at once to speed up your regulatory workflow even more

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### Checkpoints: Compare and Restore

As Ritivel works through a task, the extension takes a snapshot of your workspace at each step. You can use the 'Compare' button to see a diff between the snapshot and your current workspace, and the 'Restore' button to roll back to that point.

For example, when working with regulatory documents, you can use 'Restore Workspace Only' to quickly test different versions of your documents, then use 'Restore Task and Workspace' when you find the version you want to continue building from. This lets you safely explore different approaches without losing progress.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Contributing

To contribute to the project, start with our [Contributing Guide](CONTRIBUTING.md) to learn the basics.

## Enterprise

Get the same Ritivel experience with enterprise-grade controls: SSO (SAML/OIDC), global policies and configuration, observability with audit trails, private networking (VPC/private link), and self-hosted or on-prem deployments, and enterprise support.

## License

[Apache 2.0](./LICENSE)
