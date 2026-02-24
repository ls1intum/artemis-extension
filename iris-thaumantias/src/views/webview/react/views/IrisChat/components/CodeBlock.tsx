import { useState, useEffect, useMemo } from 'react';
// @ts-expect-error - shiki is ESM but TypeScript Node16 resolution complains. esbuild handles at bundle time.
import { createHighlighter, BundledLanguage, BundledTheme } from 'shiki';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
    language?: string;
    children?: string;
    code?: string;
}

// Singleton highlighter instance
let highlighterPromise: Promise<Awaited<ReturnType<typeof createHighlighter>>> | null = null;

const getHighlighter = () => {
    if (!highlighterPromise) {
        highlighterPromise = createHighlighter({
            themes: ['github-dark', 'github-light'],
            langs: [
                'java',
                'python',
                'c',
                'javascript',
                'typescript',
                'sql',
                'shellscript',
            ] as BundledLanguage[],
        });
    }
    return highlighterPromise;
};

export function CodeBlock({ language, children, code }: CodeBlockProps) {
    const [highlightedHtml, setHighlightedHtml] = useState<string>('');
    const [copyText, setCopyText] = useState('Copy');
    const codeContent = code || children || '';

    // Determine theme based on VS Code theme (use data attribute or CSS variable)
    const theme: BundledTheme = 'github-dark'; // Default dark, could detect from body class

    useEffect(() => {
        const highlight = async () => {
            try {
                const highlighter = await getHighlighter();
                const lang = (language || 'text') as BundledLanguage;

                // Check if the language is supported
                const loadedLangs = highlighter.getLoadedLanguages();
                const supportedLang = loadedLangs.includes(lang) ? lang : 'text';

                const html = highlighter.codeToHtml(codeContent, {
                    lang: supportedLang,
                    theme,
                });
                setHighlightedHtml(html);
            } catch (error) {
                console.error('Shiki highlighting error:', error);
                // Fallback to plain text
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

// Helper to escape HTML for fallback
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
