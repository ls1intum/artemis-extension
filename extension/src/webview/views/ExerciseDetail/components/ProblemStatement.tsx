import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { Container } from '../../../components/Container';
import { Button } from '../../../components/Button';
import { Skeleton } from '../../../components/Skeleton/Skeleton';
import type { ProblemStatementProps } from '../types';
import styles from './ProblemStatement.module.css';

const SSR_TIMEOUT_MS = 10_000;

/**
 * Strip KaTeX <script> and <link> tags from server HTML since we handle
 * KaTeX rendering client-side via the bundled npm package.
 */
function stripKatexTags(html: string): string {
    return html
        .replace(/<script[^>]*katex[^>]*><\/script>/gi, '')
        .replace(/<script>[\s\S]*?katex[\s\S]*?<\/script>/gi, '')
        .replace(/<link[^>]*katex[^>]*>/gi, '');
}

/**
 * Extract the inner body content from a full HTML document.
 * The server wraps in <!DOCTYPE><html><body>...</body></html> but we
 * inject via dangerouslySetInnerHTML which needs just the body content.
 */
function extractBodyContent(html: string): string {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
}

/**
 * Find all KaTeX formula placeholders and render them using the bundled
 * KaTeX library. The server provides <span class="katex-formula"
 * data-formula="..." data-display-mode="true|false"></span> placeholders.
 */
function renderKatexFormulas(container: HTMLElement): void {
    const formulas = container.querySelectorAll<HTMLElement>('.katex-formula');
    for (const el of formulas) {
        const formula = el.getAttribute('data-formula');
        if (!formula) { continue; }
        const displayMode = el.getAttribute('data-display-mode') === 'true';
        try {
            katex.render(formula, el, {
                displayMode,
                throwOnError: false,
                output: 'html',
            });
        } catch {
            el.textContent = formula;
        }
    }
}

/**
 * ProblemStatement component — displays server-rendered HTML from the Artemis
 * SSR endpoint. The server handles Markdown→HTML, PlantUML SVG inlining,
 * task markers with test status, and embedded CSS.
 *
 * KaTeX math rendering is handled client-side: the server provides formula
 * placeholders which are rendered using the bundled KaTeX npm package after
 * DOM injection.
 */
export function ProblemStatement({
    serverRenderedHtml,
    downloadLinks = [],
    onDownload,
}: ProblemStatementProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [timedOut, setTimedOut] = useState(false);

    const bodyHtml = useMemo(
        () => serverRenderedHtml ? stripKatexTags(extractBodyContent(serverRenderedHtml)) : undefined,
        [serverRenderedHtml]
    );

    // After HTML injection, render KaTeX formulas and execute interactive script
    useEffect(() => {
        if (!bodyHtml || !contentRef.current) { return; }
        renderKatexFormulas(contentRef.current);
    }, [bodyHtml]);

    // Timeout: if SSR hasn't arrived after 10s, show error
    useEffect(() => {
        if (serverRenderedHtml) {
            setTimedOut(false);
            return;
        }
        const timer = setTimeout(() => setTimedOut(true), SSR_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [serverRenderedHtml]);

    return (
        <Container header={<h3>Exercise Description</h3>}>
            {bodyHtml ? (
                <div
                    ref={contentRef}
                    className={styles.problemStatement}
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
            ) : timedOut ? (
                <div className={styles.errorContainer}>
                    <p>Failed to load the exercise description. The server may be unavailable.</p>
                </div>
            ) : (
                <div className={styles.skeletonContainer}>
                    <Skeleton width="75%" height="24px" />
                    <Skeleton width="100%" height="14px" />
                    <Skeleton width="100%" height="14px" />
                    <Skeleton width="85%" height="14px" />
                    <Skeleton width="50%" height="20px" />
                    <Skeleton width="100%" height="14px" />
                    <Skeleton width="100%" height="14px" />
                    <Skeleton width="60%" height="14px" />
                </div>
            )}
            {downloadLinks && downloadLinks.length > 0 && (
                <div className={styles.downloadSection}>
                    <h4 className={styles.downloadHeader}>Downloads</h4>
                    <div className={styles.downloadLinks}>
                        {downloadLinks.map((link, index) => (
                            <Button
                                key={index}
                                variant="secondary"
                                onClick={() => onDownload?.(link.url, link.name)}
                            >
                                {link.name}
                            </Button>
                        ))}
                    </div>
                </div>
            )}
        </Container>
    );
}
