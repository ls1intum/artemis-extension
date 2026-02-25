import { useState, useEffect } from 'react';
// @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
import { createHighlighterCore } from 'shiki/core';
// @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
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
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/themes/github-dark.mjs'),
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/themes/github-light.mjs'),
            ],
            langs: [
                // Artemis programming languages (20)
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/asm.mjs'),           // Assembler
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/shellscript.mjs'),   // Bash
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/c.mjs'),             // C
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/cpp.mjs'),           // C++
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/csharp.mjs'),        // C#
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/dart.mjs'),          // Dart
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/go.mjs'),            // Go
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/haskell.mjs'),       // Haskell
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/java.mjs'),          // Java
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/javascript.mjs'),    // JavaScript
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/kotlin.mjs'),        // Kotlin
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/matlab.mjs'),        // MATLAB
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/ocaml.mjs'),         // OCaml
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/python.mjs'),        // Python
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/r.mjs'),             // R
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/ruby.mjs'),          // Ruby
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/rust.mjs'),          // Rust
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/swift.mjs'),         // Swift
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/typescript.mjs'),    // TypeScript
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/vhdl.mjs'),          // VHDL
                // SQL
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/sql.mjs'),           // SQL
                // Common markup/config languages (6)
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/json.mjs'),          // JSON
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/yaml.mjs'),          // YAML
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/html.mjs'),          // HTML
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/css.mjs'),           // CSS
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
                import('shiki/langs/markdown.mjs'),      // Markdown
                // @ts-expect-error - shiki ESM imports resolved by esbuild at bundle time
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
            } catch (error) {
                console.error('Shiki highlighting error:', error);
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
        } catch (error) {
            console.error('Copy failed:', error);
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
                    {copyText === 'Copied!' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path
                                d="M20 6L9 17l-5-5"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <rect
                                x="9" y="9" width="13" height="13"
                                rx="2" ry="2"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                            <path
                                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    )}
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
