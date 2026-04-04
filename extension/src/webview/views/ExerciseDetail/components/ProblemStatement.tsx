import { useEffect, useRef, useState } from 'react';
import { Container } from '../../../components/Container';
import { Button } from '../../../components/Button';
import { Skeleton } from '../../../components/Skeleton/Skeleton';
import type { ProblemStatementProps } from '../types';
import styles from './ProblemStatement.module.css';

const SSR_TIMEOUT_MS = 10_000;

/**
 * ProblemStatement component — displays server-rendered HTML from the Artemis
 * SSR endpoint. The server handles Markdown→HTML, PlantUML SVG inlining,
 * KaTeX math, task markers with test status, and embedded CSS.
 */
export function ProblemStatement({
    serverRenderedHtml,
    serverInteractiveScript,
    downloadLinks = [],
    onDownload,
}: ProblemStatementProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [timedOut, setTimedOut] = useState(false);

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
            {serverRenderedHtml ? (
                <div
                    ref={contentRef}
                    className={styles.problemStatement}
                    dangerouslySetInnerHTML={{ __html: serverRenderedHtml }}
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
