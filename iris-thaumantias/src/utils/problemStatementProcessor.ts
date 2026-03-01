import katex from 'katex';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Configure marked for synchronous parsing
marked.use({ async: false });

/**
 * Process problem statement with Markdown-to-HTML conversion,
 * KaTeX math rendering, PlantUML placeholder marking,
 * Artemis task rendering, and link/image attribute injection.
 */
export function processProblemStatement(input: string): string {
    if (!input) {
        return '';
    }

    // 1. Extract PlantUML blocks before Markdown parsing.
    //    On main, @startuml...@enduml appeared as raw text (not in code fences),
    //    so marked would split them across <p> tags. Extract them first.
    let preprocessed = input.replace(
        /@startuml[\s\S]*?@enduml/gi,
        (match) => {
            const encoded = encodeURIComponent(match.trim());
            return `<div class="plantuml-placeholder" data-plantuml="${encoded}">Loading diagram...</div>`;
        }
    );

    // 2. Convert Artemis [task] markers to HTML placeholders before Markdown parsing.
    //    Patterns: [task][Title](testIds) or [task][Title]
    //    Without this, marked interprets them as reference-style links.
    preprocessed = preprocessed.replace(
        /\[task\]\[([^\]]+)\](?:\(([^)]*)\))?/gi,
        (_match, title: string) => {
            return `<span class="task-marker">${title}</span>`;
        }
    );

    // 3. Convert Markdown to HTML
    const html = marked.parse(preprocessed, { async: false }) as string;

    // 4. Sanitize HTML (allow safe tags for rich content)
    let processed = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
            'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'li',
            'code', 'pre',
            'a', 'img',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'blockquote', 'hr',
            'strong', 'em', 'b', 'i', 'u', 'del', 's',
            'br', 'span', 'div',
            'sup', 'sub',
        ],
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title', 'class',
            'data-plantuml', 'data-plantuml-index',
            'colspan', 'rowspan', 'scope',
        ]
    });

    // 5. Replace block math ($$...$$) — process BEFORE inline to avoid conflict
    processed = processed.replace(/\$\$([^$]+)\$\$/g, (_match: string, latex: string) => {
        return renderKaTeX(latex.trim(), true);
    });

    // 6. Replace inline math ($...$) — single $ delimiters
    // Use negative lookbehind/lookahead to avoid matching $$ or escaped \$
    processed = processed.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_match: string, latex: string) => {
        return renderKaTeX(latex.trim(), false);
    });

    // 7. Add data attributes for link and image handling
    // Links: add data-external-link for click interception
    processed = processed.replace(
        /<a\s+href="([^"]+)"/g,
        '<a href="$1" data-external-link="true"'
    );

    // Images: add data-clickable-image for click-to-preview
    processed = processed.replace(
        /<img\s+/g,
        '<img data-clickable-image="true" '
    );

    return processed;
}

/**
 * Render LaTeX to HTML via KaTeX.
 * Falls back to original text if parsing fails.
 */
function renderKaTeX(latex: string, displayMode: boolean): string {
    try {
        return katex.renderToString(latex, {
            displayMode,
            throwOnError: false,
            errorColor: 'var(--vscode-errorForeground)',
            output: 'html',  // Class-based output (CSP-safe, no inline styles)
        });
    } catch {
        // Return original text wrapped in a code element on error
        return displayMode
            ? `<pre class="katex-error"><code>${latex}</code></pre>`
            : `<code class="katex-error">${latex}</code>`;
    }
}
