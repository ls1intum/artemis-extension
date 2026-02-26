import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Container } from '../../../components/Container';
import { Button } from '../../../components/Button';
import { processProblemStatement } from '../../../../../../utils/problemStatementProcessor';
import type { ProblemStatementProps } from '../types';
import styles from './ProblemStatement.module.css';

/**
 * Enhanced ProblemStatement component with KaTeX math, PlantUML diagrams,
 * clickable links/images, and comprehensive VS Code-native styling.
 */
export function ProblemStatement({
    markdown,
    downloadLinks = [],
    onDownload,
    vscodeApi,
}: ProblemStatementProps) {
    const contentRef = useRef<HTMLDivElement>(null);

    // Process HTML through KaTeX, sanitizer, and marker pipeline
    const processedHtml = useMemo(() => processProblemStatement(markdown), [markdown]);

    // Event delegation for links and images
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;

        const handleClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;

            // Handle external links
            const link = target.closest('a[data-external-link]') as HTMLAnchorElement;
            if (link) {
                event.preventDefault();
                const href = link.getAttribute('href');
                if (href && vscodeApi) {
                    vscodeApi.postMessage({
                        type: 'command',
                        command: 'openExternalLink',
                        payload: { url: href },
                    });
                }
                return;
            }

            // Handle clickable images
            const img = target.closest('img[data-clickable-image]') as HTMLImageElement;
            if (img) {
                const src = img.getAttribute('src');
                if (src && vscodeApi) {
                    vscodeApi.postMessage({
                        type: 'command',
                        command: 'openImagePreview',
                        payload: { uri: src },
                    });
                }
                return;
            }
        };

        container.addEventListener('click', handleClick);
        return () => container.removeEventListener('click', handleClick);
    }, [processedHtml, vscodeApi]);

    // PlantUML async rendering
    useEffect(() => {
        const container = contentRef.current;
        if (!container || !vscodeApi) return;

        const plantUmlElements = container.querySelectorAll('.plantuml-placeholder[data-plantuml]');
        if (plantUmlElements.length === 0) return;

        // Request PlantUML rendering from extension
        plantUmlElements.forEach((element, index) => {
            const encoded = element.getAttribute('data-plantuml');
            if (!encoded) return;

            const plantUml = decodeURIComponent(encoded);
            element.setAttribute('data-plantuml-index', String(index));

            vscodeApi.postMessage({
                type: 'command',
                command: 'renderPlantUmlInline',
                payload: { plantUml, index },
            });
        });

        // Listen for rendered SVG responses
        const handleMessage = (event: MessageEvent<unknown>) => {
            const message = event.data;

            if (typeof message !== 'object' || message === null || !('command' in message)) {
                return;
            }

            const typedMessage = message as { command: string; index?: number; svg?: string };

            if (typedMessage.command === 'plantUmlRendered' && container) {
                const element = container.querySelector(
                    `[data-plantuml-index="${typedMessage.index ?? ''}"]`
                );
                if (element && typeof typedMessage.svg === 'string') {
                    element.innerHTML = DOMPurify.sanitize(typedMessage.svg, {
                        ALLOWED_TAGS: ['svg', 'g', 'path', 'rect', 'circle', 'ellipse',
                                      'line', 'polyline', 'polygon', 'text', 'tspan',
                                      'defs', 'clipPath', 'use', 'style'],
                        ALLOWED_ATTR: ['viewBox', 'width', 'height', 'fill', 'stroke',
                                      'stroke-width', 'd', 'x', 'y', 'cx', 'cy', 'r',
                                      'rx', 'ry', 'transform', 'class', 'id',
                                      'font-size', 'font-family', 'text-anchor',
                                      'dominant-baseline', 'points', 'x1', 'y1', 'x2', 'y2'],
                    });
                    element.classList.remove('plantuml-placeholder');
                    element.classList.add('plantuml-rendered');
                }
            }

            if (typedMessage.command === 'plantUmlError' && container) {
                const element = container.querySelector(
                    `[data-plantuml-index="${typedMessage.index ?? ''}"]`
                );
                if (element) {
                    element.textContent = 'Failed to render diagram';
                    element.classList.add('plantuml-error');
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [processedHtml, vscodeApi]);

    return (
        <Container header={<h3>Exercise Description</h3>}>
            <div
                ref={contentRef}
                className={styles.problemStatement}
                dangerouslySetInnerHTML={{ __html: processedHtml }}
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
