import Check from 'lucide-react/dist/esm/icons/check';
import Copy from 'lucide-react/dist/esm/icons/copy';
import { useEffect, useState } from 'react';
// @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time (TS1479: Node16 module resolution vs ESM)
import { createHighlighterCore } from 'shiki/core';
// @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time (TS1479: Node16 module resolution vs ESM)
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import styles from './CodeBlock.module.css';

interface CodeBlockProps {
    language?: string;
    children?: string;
    code?: string;
}

// Singleton highlighter instance (JS engine — no WASM, CSP-safe)
let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null;

const getHighlighter = () => {
    if (!highlighterPromise) {
        highlighterPromise = createHighlighterCore({
            themes: [
                import('shiki/themes/github-dark.mjs'),
                import('shiki/themes/github-light.mjs'),
            ],
            langs: [
                // Artemis programming languages (20)
                import('shiki/langs/asm.mjs'),           // Assembler
                import('shiki/langs/shellscript.mjs'),   // Bash
                import('shiki/langs/c.mjs'),             // C
                import('shiki/langs/cpp.mjs'),           // C++
                import('shiki/langs/csharp.mjs'),        // C#
                import('shiki/langs/dart.mjs'),          // Dart
                import('shiki/langs/go.mjs'),            // Go
                import('shiki/langs/haskell.mjs'),       // Haskell
                import('shiki/langs/java.mjs'),          // Java
                import('shiki/langs/javascript.mjs'),    // JavaScript
                import('shiki/langs/kotlin.mjs'),        // Kotlin
                import('shiki/langs/matlab.mjs'),        // MATLAB
                import('shiki/langs/ocaml.mjs'),         // OCaml
                import('shiki/langs/python.mjs'),        // Python
                import('shiki/langs/r.mjs'),             // R
                import('shiki/langs/ruby.mjs'),          // Ruby
                import('shiki/langs/rust.mjs'),          // Rust
                import('shiki/langs/swift.mjs'),         // Swift
                import('shiki/langs/typescript.mjs'),    // TypeScript
                import('shiki/langs/vhdl.mjs'),          // VHDL
                // SQL
                import('shiki/langs/sql.mjs'),           // SQL
                // Common markup/config languages (6)
                import('shiki/langs/json.mjs'),          // JSON
                import('shiki/langs/yaml.mjs'),          // YAML
                import('shiki/langs/html.mjs'),          // HTML
                import('shiki/langs/css.mjs'),           // CSS
                import('shiki/langs/markdown.mjs'),      // Markdown
                import('shiki/langs/xml.mjs'),           // XML
            ],
            engine: createJavaScriptRegexEngine(),
        });
    }
    return highlighterPromise;
};

export function CodeBlock({ language, children, code }: CodeBlockProps) {
    const [highlightedHtml, setHighlightedHtml] = useState<string>('');
    const [copyText, setCopyText] = useState('Copy');
    const codeContent = code || children || '';

    const theme = 'github-dark';

    useEffect(() => {
        const highlight = async () => {
            try {
                const highlighter = await getHighlighter();
                const lang = language || 'text';

                const loadedLangs = highlighter.getLoadedLanguages();
                const supportedLang = loadedLangs.includes(lang) ? lang : 'text';

                const html = highlighter.codeToHtml(codeContent, {
                    lang: supportedLang,
                    theme,
                });
                setHighlightedHtml(html);
            } catch {
                // Fallback to plain text if highlighting fails
                setHighlightedHtml(`<pre><code>${escapeHtml(codeContent)}</code></pre>`);
            }
        };

        highlight();
    }, [codeContent, language, theme]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(codeContent);
            setCopyText('Copied!');
            setTimeout(() => setCopyText('Copy'), 2000);
        } catch {
            // Silently fail - clipboard API may not be available
            setCopyText('Failed');
            setTimeout(() => setCopyText('Copy'), 2000);
        }
    };

    return (
        <div className={styles.codeBlock}>
            <div className={styles.header}>
                <span className={styles.language}>{language || 'text'}</span>
                <button
                    className={styles.copyButton}
                    onClick={handleCopy}
                    aria-label="Copy code"
                >
                    {copyText === 'Copied!' ? <Check size={14} /> : <Copy size={14} />}
                    <span className={styles.copyText}>{copyText}</span>
                </button>
            </div>
            <div
                className={styles.code}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
        </div>
    );
}

function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
