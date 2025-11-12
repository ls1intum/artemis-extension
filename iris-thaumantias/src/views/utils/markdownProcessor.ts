/**
 * Result of markdown processing with extracted metadata
 */
export interface MarkdownProcessingResult {
  html: string;
  downloadLinks: Array<{ text: string; url: string }>;
  plantUmlDiagrams: string[];
}

/**
 * Processes markdown content and converts it to HTML with support for:
 * - File download link extraction
 * - PlantUML diagram placeholders
 * - Code blocks with syntax highlighting
 * - Tables with alignment
 * - Task containers with metadata stripping
 * - Headers, bold, lists, and paragraphs
 */
export function processMarkdown(markdown: string): MarkdownProcessingResult {
  let problemStatement = markdown || "No description available";
  const downloadLinks: Array<{ text: string; url: string }> = [];
  const plantUmlDiagrams: string[] = [];

  // Extract markdown links for file downloads
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownLinkRegex.exec(problemStatement)) !== null) {
    if (
      match[2].includes("/api/core/files/") ||
      match[1].includes(".pdf") ||
      match[1].includes(".png")
    ) {
      downloadLinks.push({
        text: match[1],
        url: match[2],
      });
    }
  }

  // Remove markdown links from problem statement for cleaner display
  problemStatement = problemStatement.replace(markdownLinkRegex, "$1");

  // Extract PlantUML diagrams and replace with placeholders for auto-rendering
  const plantUmlRegex = /@startuml([^@]*)@enduml/g;
  let plantUmlIndex = 0;
  problemStatement = problemStatement.replace(
    plantUmlRegex,
    (match: string) => {
      plantUmlDiagrams.push(match);
      const placeholder = `<div class="plantuml-placeholder" data-index="${plantUmlIndex}" data-plantuml="${encodeURIComponent(
        match
      )}">Loading PlantUML diagram...</div>`;
      plantUmlIndex++;
      return placeholder;
    }
  );

  // Preserve fenced code blocks before further processing
  const codeBlocks: Array<{ placeholder: string; html: string }> = [];
  problemStatement = problemStatement.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (
      _fullMatch: string,
      language: string | undefined,
      codeContent: string
    ) => {
      const index = codeBlocks.length;
      const placeholder = `__CODE_BLOCK_${index}__`;
      const escapedCode = codeContent
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      const classAttr = language ? ` class="language-${language}"` : "";
      codeBlocks.push({
        placeholder,
        html: `<pre class="code-block"><code${classAttr}>${escapedCode.trimEnd()}</code></pre>`,
      });
      return placeholder;
    }
  );

  // Clean up excessive whitespace and normalize line breaks
  problemStatement = problemStatement
    .replace(/\r\n/g, "\n") // Normalize line endings
    .replace(/\n{3,}/g, "\n\n") // Replace 3+ line breaks with 2
    .replace(/[ \t]+/g, " ") // Replace multiple spaces/tabs with single space
    .trim(); // Remove leading/trailing whitespace

  // Convert markdown tables to HTML tables
  problemStatement = convertTablesToHtml(problemStatement);

  // Convert numbered tasks with [task][task name](<testid>...) pattern to container with structured layout
  problemStatement = convertTasksToHtml(problemStatement);

  // Convert backticks to code tags for syntax highlighting AFTER tasks
  problemStatement = problemStatement.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Convert markdown headers to proper HTML - from largest to smallest to avoid conflicts
  problemStatement = problemStatement
    .replace(/^###### (.*$)/gm, "<h6>$1</h6>")
    .replace(/^##### (.*$)/gm, "<h5>$1</h5>")
    .replace(/^#### (.*$)/gm, "<h4>$1</h4>")
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^# (.*$)/gm, "<h1>$1</h1>");

  // Convert --- to horizontal rule
  problemStatement = problemStatement.replace(/^---$/gm, "<hr>");

  // Convert **bold** to <strong>
  problemStatement = problemStatement.replace(
    /\*\*(.*?)\*\*/g,
    "<strong>$1</strong>"
  );

  // Convert bullet points (- item) to proper HTML lists
  problemStatement = problemStatement.replace(/^- (.+)$/gm, "<li>$1</li>");

  // Wrap consecutive <li> items in <ul> tags
  problemStatement = problemStatement.replace(
    /(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs,
    "<ul>$1</ul>"
  );

  // Convert double line breaks to paragraphs
  problemStatement = problemStatement.replace(/\n\n/g, "</p><p>");
  problemStatement = "<p>" + problemStatement + "</p>";

  // Clean up empty paragraphs and fix paragraph around other elements
  problemStatement = problemStatement
    .replace(/<p><\/p>/g, "") // Remove empty paragraphs
    .replace(/<p>(<h[1-6]>)/g, "$1") // Don't wrap headers in paragraphs
    .replace(/(<\/h[1-6]>)<\/p>/g, "$1") // Don't wrap headers in paragraphs
    .replace(/<p>(<ul>)/g, "$1") // Don't wrap lists in paragraphs
    .replace(/(<\/ul>)<\/p>/g, "$1") // Don't wrap lists in paragraphs
    .replace(/<p>(<div class="task-container">)/g, "$1") // Don't wrap tasks in paragraphs
    .replace(/(<\/div>)<\/p>/g, "$1") // Don't wrap tasks in paragraphs
    .replace(/<p>(<pre class="code-block">)/g, "$1") // Don't wrap code blocks in paragraphs
    .replace(/(<\/pre>)<\/p>/g, "$1") // Don't wrap code blocks in paragraphs
    .replace(/<p>(<div class="table-wrapper">)/g, "$1") // Don't wrap tables in paragraphs
    .replace(/(<\/div>)<\/p>/g, "$1"); // Don't wrap div closings in paragraphs

  // Restore preserved code blocks
  for (const block of codeBlocks) {
    problemStatement = problemStatement.replace(block.placeholder, block.html);
  }

  return {
    html: problemStatement,
    downloadLinks,
    plantUmlDiagrams,
  };
}

/**
 * Converts markdown tables to HTML tables with proper alignment
 */
function convertTablesToHtml(text: string): string {
  // Match tables: header row, separator row, and data rows
  const tableRegex =
    /^(\|[^\n]+\|\r?\n)(\|[\s:|-]+\|\r?\n)((?:\|[^\n]+\|\r?\n?)+)/gm;
  
  return text.replace(
    tableRegex,
    (
      match: string,
      headerRow: string,
      separatorRow: string,
      dataRows: string
    ) => {
      // Parse header
      const headers = headerRow
        .trim()
        .split("|")
        .filter((cell: string) => cell.trim())
        .map((cell: string) => cell.trim());

      // Parse separator to detect alignment
      const separators = separatorRow
        .trim()
        .split("|")
        .filter((cell: string) => cell.trim());
      const alignments = separators.map((sep: string) => {
        const trimmed = sep.trim();
        if (trimmed.startsWith(":") && trimmed.endsWith(":")) {
          return "center";
        }
        if (trimmed.endsWith(":")) {
          return "right";
        }
        if (trimmed.startsWith(":")) {
          return "left";
        }
        return "";
      });

      // Parse data rows
      const rows = dataRows
        .trim()
        .split("\n")
        .map((row: string) =>
          row
            .trim()
            .split("|")
            .filter((cell: string) => cell.trim())
            .map((cell: string) => cell.trim())
        );

      // Build HTML table
      let tableHtml =
        '<div class="table-wrapper"><table class="markdown-table">\n<thead>\n<tr>\n';
      headers.forEach((header: string, i: number) => {
        const align = alignments[i]
          ? ` style="text-align: ${alignments[i]}"`
          : "";
        tableHtml += `<th${align}>${header}</th>\n`;
      });
      tableHtml += "</tr>\n</thead>\n<tbody>\n";

      rows.forEach((row: string[]) => {
        tableHtml += "<tr>\n";
        row.forEach((cell: string, i: number) => {
          const align = alignments[i]
            ? ` style="text-align: ${alignments[i]}"`
            : "";
          tableHtml += `<td${align}>${cell}</td>\n`;
        });
        tableHtml += "</tr>\n";
      });
      tableHtml += "</tbody>\n</table></div>";

      return tableHtml;
    }
  );
}

/**
 * Converts numbered task patterns to structured HTML containers
 * Handles patterns like: 1. [task][task name](<testid>...)
 */
function convertTasksToHtml(text: string): string {
  return text.replace(
    /(^|\n)\s*(\d+)\.\s*\[task\](?:\[([^\]]+)\])?(?:\(([^)]*)\))?\s*([^\n]*)/g,
    (
      _match: string,
      prefix: string,
      index: string,
      explicitTitle: string | undefined,
      testsBlock: string | undefined,
      remainder: string
    ) => {
      const stripTaskMetadata = (text: string) => {
        if (!text) {
          return "";
        }

        let cleaned = text
          .replace(/<testid>\s*\d+\s*<\/testid>/gi, " ")
          .replace(/\btest[A-Za-z0-9_]*\s*\(\s*\)/gi, " ")
          .replace(/\b\d{4,}\b/g, " ")
          .replace(/\s*,\s*/g, " ");

        cleaned = cleaned
          .replace(/\(\s*\)/g, " ")
          .replace(/\s{2,}/g, " ")
          .replace(/^\s+|\s+$/g, "")
          .replace(/^[,;:]+/, "")
          .replace(/[,;:]+$/, "")
          .replace(/[()]+$/, "")
          .replace(/^[()]+/, "")
          .trim();

        return cleaned;
      };

      const normalizedRemainder = remainder?.trim() || "";

      let headerText = explicitTitle?.trim() || "";
      let bodyText = "";

      if (!headerText && normalizedRemainder) {
        const firstSentenceMatch = normalizedRemainder.match(
          /^(.{1,120}?[.!?])(\s+.*)?$/
        );
        if (firstSentenceMatch) {
          headerText = firstSentenceMatch[1].trim();
          bodyText = (firstSentenceMatch[2] || "").trim();
        } else {
          headerText = normalizedRemainder;
        }
      } else {
        bodyText = normalizedRemainder;
      }

      if (testsBlock) {
        headerText = headerText.replace(testsBlock, "");
        bodyText = bodyText.replace(testsBlock, "");
      }

      headerText = stripTaskMetadata(headerText);
      bodyText = stripTaskMetadata(bodyText);

      if (!headerText) {
        headerText = `Task ${index}`;
      }

      const descriptionHtml = bodyText
        ? `<div class="task-body">${bodyText}</div>`
        : "";

      const headerHtml = `<div class="task-header">Task ${index}${
        headerText ? `: ${headerText}` : ""
      }</div>`;

      return `${prefix}<div class="task-container">${headerHtml}${descriptionHtml}</div>`;
    }
  );
}
