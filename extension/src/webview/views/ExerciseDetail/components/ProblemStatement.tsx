import { useEffect, useRef, useState } from 'react';
import { Container } from '../../../components/Container';
import { Button } from '../../../components/Button';
import { Skeleton } from '../../../components/Skeleton/Skeleton';
import type { ProblemStatementProps } from '../types';
import styles from './ProblemStatement.module.css';

const SSR_TIMEOUT_MS = 10_000;

/**
 * ProblemStatement component — displays server-rendered HTML from the Artemis
 * SSR endpoint in an iframe. The server returns a full HTML document with
 * Markdown→HTML, PlantUML SVG inlining, KaTeX math, task markers with test
 * status, embedded CSS, and interactive JS.
 *
 * An iframe is used instead of dangerouslySetInnerHTML because:
 * - Scripts execute in iframe srcdoc (innerHTML ignores them)
 * - External resources (KaTeX JS/CSS) load without CSP restrictions
 * - The document context enables proper KaTeX rendering
 */
export function ProblemStatement({
    serverRenderedHtml,
    downloadLinks = [],
    onDownload,
}: ProblemStatementProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [timedOut, setTimedOut] = useState(false);

    // Auto-resize iframe to fit content
    useEffect(() => {
        if (!serverRenderedHtml || !iframeRef.current) {return;}
        const iframe = iframeRef.current;
        const resizeObserver = new ResizeObserver(() => {
            const body = iframe.contentDocument?.body;
            if (body) {
                iframe.style.height = body.scrollHeight + 'px';
            }
        });

        const handleLoad = () => {
            const body = iframe.contentDocument?.body;
            if (body) {
                iframe.style.height = body.scrollHeight + 'px';
                resizeObserver.observe(body);
            }
        };

        iframe.addEventListener('load', handleLoad);
        return () => {
            iframe.removeEventListener('load', handleLoad);
            resizeObserver.disconnect();
        };
    }, [serverRenderedHtml]);

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
                <iframe
                    ref={iframeRef}
                    srcDoc={serverRenderedHtml}
                    sandbox="allow-scripts"
                    className={styles.problemStatement}
                    style={{ width: '100%', border: 'none', overflow: 'hidden' }}
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
