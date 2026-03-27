import { useEffect, useRef } from 'react';
import { Container } from '../../../components/Container';
import { Button } from '../../../components/Button';
import type { ProblemStatementProps } from '../types';
import styles from './ProblemStatement.module.css';

/**
 * ProblemStatement component — displays server-rendered HTML from the Artemis
 * SSR endpoint. The server handles Markdown→HTML, PlantUML SVG inlining,
 * KaTeX math, task markers with test status, and embedded CSS.
 */
export function ProblemStatement({
    markdown,
    serverRenderedHtml,
    serverInteractiveScript,
    downloadLinks = [],
    onDownload,
}: ProblemStatementProps) {
    const contentRef = useRef<HTMLDivElement>(null);

    // Execute interactive script for server-rendered content (task feedback modal)
    useEffect(() => {
        if (!serverRenderedHtml || !serverInteractiveScript || !contentRef.current) {return;}
        try {
            const nonce = document.getElementById('root')?.getAttribute('data-csp-nonce');
            const scriptEl = document.createElement('script');
            if (nonce) { scriptEl.nonce = nonce; }
            scriptEl.textContent = serverInteractiveScript;
            contentRef.current.appendChild(scriptEl);
        } catch {
            // Interactive script failed — task feedback modal won't be available
        }
    }, [serverRenderedHtml, serverInteractiveScript]);

    const html = serverRenderedHtml || `<p>${markdown || 'No description available'}</p>`;

    return (
        <Container header={<h3>Exercise Description</h3>}>
            <div
                ref={contentRef}
                className={styles.problemStatement}
                dangerouslySetInnerHTML={{ __html: html }}
            />
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
