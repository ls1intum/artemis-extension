import katex from 'katex';
import { type MouseEvent, useEffect, useMemo, useState } from 'react';

import { Container } from '@webview/components/Container';
import { Skeleton } from '@webview/components/Skeleton/Skeleton';
import { useProblemStatementTracking } from '@webview/hooks/useProblemStatementTracking';
import type { ProblemStatementProps } from '@webview/views/ExerciseDetail/types';

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
    formulas.forEach((el) => {
        const formula = el.getAttribute('data-formula');
        if (!formula) { return; }
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
    });
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
    onTaskClick,
    vscodeApi,
}: ProblemStatementProps) {
    const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
    const [timedOut, setTimedOut] = useState(false);

    const bodyHtml = useMemo(
        () => serverRenderedHtml ? stripKatexTags(extractBodyContent(serverRenderedHtml)) : undefined,
        [serverRenderedHtml]
    );

    // After HTML injection, render KaTeX formulas client-side from server placeholders
    useEffect(() => {
        if (!bodyHtml || !contentEl) { return; }
        renderKatexFormulas(contentEl);
    }, [bodyHtml, contentEl]);

    useProblemStatementTracking(contentEl, bodyHtml, vscodeApi);

    // Timeout: if SSR hasn't arrived after 10s, show error
    useEffect(() => {
        if (serverRenderedHtml) {
            setTimedOut(false);
            return;
        }
        const timer = setTimeout(() => setTimedOut(true), SSR_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [serverRenderedHtml]);

    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
        if (!onTaskClick) { return; }
        const target = event.target as HTMLElement;
        const taskEl = target.closest<HTMLElement>('.artemis-task[data-test-ids]');
        if (!taskEl) { return; }
        const taskName = taskEl.getAttribute('data-task-name') ?? '';
        const rawIds = taskEl.getAttribute('data-test-ids') ?? '';
        const testIds = rawIds.split(',')
            .map(s => parseInt(s.trim(), 10))
            .filter(n => Number.isFinite(n));
        if (!taskName || testIds.length === 0) { return; }
        onTaskClick({ taskName, testIds });
    };

    return (
        <Container header={<h3 className={styles.heading}>Exercise Description</h3>}>
            {bodyHtml ? (
                <div
                    ref={setContentEl}
                    className={styles.problemStatement}
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                    onClick={handleClick}
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
        </Container>
    );
}
