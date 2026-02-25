import katex from 'katex';
import DOMPurify from 'dompurify';

/**
 * Process problem statement HTML with KaTeX math rendering,
 * PlantUML placeholder marking, task marker highlighting,
 * and link/image attribute injection.
 */
export function processProblemStatement(html: string): string {
    if (!html) return '';

    // 1. Sanitize HTML first (allow safe tags for rich content)
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

    // 2. Replace block math ($$...$$) — process BEFORE inline to avoid conflict
    processed = processed.replace(/\$\$([^$]+)\$\$/g, (_match, latex) => {
        return renderKaTeX(latex.trim(), true);
    });

    // 3. Replace inline math ($...$) — single $ delimiters
    // Use negative lookbehind/lookahead to avoid matching $$ or escaped \$
    processed = processed.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_match, latex) => {
        return renderKaTeX(latex.trim(), false);
    });

    // 4. Mark PlantUML blocks for async rendering
    // Artemis problem statements may contain <pre> blocks with @startuml...@enduml
    processed = processed.replace(
        /<pre[^>]*>(?:<code[^>]*>)?(@startuml[\s\S]*?@enduml)(?:<\/code>)?<\/pre>/gi,
        (_match, plantUml, _offset) => {
            const encoded = encodeURIComponent(plantUml.trim());
            return `<div class="plantuml-placeholder" data-plantuml="${encoded}">Loading diagram...</div>`;
        }
    );

    // 5. Highlight task markers: "Task N:" or "Subtask N:" patterns
    processed = processed.replace(
        /\b(Task\s+\d+(?:\.\d+)?|Subtask\s+\d+(?:\.\d+)?)\s*:/gi,
        '<span class="task-marker">$1:</span>'
    );

    // 6. Add data attributes for link and image handling
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
