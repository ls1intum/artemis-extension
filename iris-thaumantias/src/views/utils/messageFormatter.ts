/**
 * Utility functions for formatting chat message content.
 * Handles markdown-like parsing for code blocks, inline code, bold, italic, and line breaks.
 */

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * @param text - The raw text to escape
 * @returns HTML-safe string
 */
export function escapeHtml(text: string): string {
    const htmlEscapes: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, char => htmlEscapes[char]);
}

/**
 * Formats message content with markdown-like syntax support.
 * Supports:
 * - Code blocks (```language\ncode```)
 * - Inline code (`code`)
 * - Bold text (**text**)
 * - Italic text (*text*)
 * - Line breaks (converted to <br>)
 * 
 * @param text - The raw message text to format
 * @returns HTML-formatted string
 */
export function formatMessageContent(text: string): string {
    // First, escape HTML to prevent XSS
    let formatted = escapeHtml(text);
    
    // Parse code blocks FIRST with placeholders to protect from line break conversion
    // Match and consume newlines around code blocks so they don't become <br> tags
    const codeBlockPlaceholders: string[] = [];
    formatted = formatted.replace(
        /(\n\n)?\n*```(\w+)?\n([\s\S]*?)```\n*(\n\n)?/g, 
        (match, beforeNewlines, language, code, afterNewlines) => {
            const index = codeBlockPlaceholders.length;
            const classAttr = language ? ` class="language-${escapeHtml(language)}"` : '';
            const placeholder = `___CODEBLOCK_${index}___`;
            codeBlockPlaceholders.push(
                `<pre class="code-block"><code${classAttr}>${code.trimEnd()}</code></pre>`
            );
            return placeholder;
        }
    );
    
    // Parse inline code (single backticks)
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Parse bold: **text**
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Parse italic: *text* (but not if part of **)
    formatted = formatted.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    
    // Convert line breaks to <br> (code blocks are protected by placeholders)
    formatted = formatted.replace(/\n/g, '<br>');
    
    // Restore code blocks from placeholders
    codeBlockPlaceholders.forEach((codeBlock, index) => {
        formatted = formatted.replace(`___CODEBLOCK_${index}___`, codeBlock);
    });
    
    return formatted;
}

/**
 * Generates the JavaScript function definitions for use in webview scripts.
 * This allows the formatting logic to be used in the browser context.
 * 
 * @returns JavaScript code string containing escapeHtml and formatMessageContent functions
 */
export function getMessageFormatterScript(): string {
    return `
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatMessageContent(text) {
            // First, escape HTML to prevent XSS
            let formatted = escapeHtml(text);
            
            // Parse code blocks FIRST with placeholders to protect from line break conversion
            // Match and consume newlines around code blocks so they don't become <br> tags
            const codeBlockPlaceholders = [];
            formatted = formatted.replace(/(\\n\\n)?\\n*\\\`\\\`\\\`(\\w+)?\\n([\\s\\S]*?)\\\`\\\`\\\`\\n*(\\n\\n)?/g, (match, beforeNewlines, language, code, afterNewlines) => {
                const index = codeBlockPlaceholders.length;
                const classAttr = language ? ' class="language-' + escapeHtml(language) + '"' : '';
                const placeholder = '___CODEBLOCK_' + index + '___';
                codeBlockPlaceholders.push('<pre class="code-block"><code' + classAttr + '>' + code.trimEnd() + '</code></pre>');
                return placeholder;
            });
            
            // Parse inline code (single backticks)
            formatted = formatted.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
            
            // Parse bold: **text**
            formatted = formatted.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
            
            // Parse italic: *text* (but not if part of **)
            formatted = formatted.replace(/(?<!\\*)\\*(?!\\*)(.+?)(?<!\\*)\\*(?!\\*)/g, '<em>$1</em>');
            
            // Convert line breaks to <br> (code blocks are protected by placeholders)
            formatted = formatted.replace(/\\n/g, '<br>');
            
            // Restore code blocks from placeholders
            codeBlockPlaceholders.forEach((codeBlock, index) => {
                formatted = formatted.replace('___CODEBLOCK_' + index + '___', codeBlock);
            });
            
            return formatted;
        }
    `;
}
