import { useEffect, useMemo, useRef } from 'react';
import { Container } from '../../../components/Container';
import { Button } from '../../../components/Button';
import { processProblemStatement } from '../../../../../../utils/problemStatementProcessor';
import { ExtensionMsg, postCommand } from '../../../../../../shared/messageContracts';
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
                    postCommand(vscodeApi, 'openExternalLink', { url: href });
                }
                return;
            }

            // Handle clickable images
            const img = target.closest('img[data-clickable-image]') as HTMLImageElement;
            if (img) {
                const src = img.getAttribute('src');
                if (src && vscodeApi) {
                    postCommand(vscodeApi, 'openImagePreview', { uri: src });
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

            postCommand(vscodeApi, 'renderPlantUmlInline', { plantUml, index });
        });

        // Listen for rendered SVG responses
        const handleMessage = (event: MessageEvent<unknown>) => {
            const message = event.data;

            if (typeof message !== 'object' || message === null || !('type' in message)) {
                return;
            }

            const typedMessage = message as { type: string; index?: number; svg?: string };

            if (typedMessage.type === ExtensionMsg.PlantUmlRendered && container) {
                const placeholder = container.querySelector(
                    `[data-plantuml-index="${typedMessage.index ?? ''}"]`
                );
                if (placeholder && placeholder.parentNode && typeof typedMessage.svg === 'string') {
                    // Replace placeholder with new div — exactly like main
                    const rendered = document.createElement('div');
                    rendered.className = 'plantuml-rendered';
                    rendered.innerHTML = typedMessage.svg;
                    placeholder.parentNode.replaceChild(rendered, placeholder);
                }
            }

            if (typedMessage.type === ExtensionMsg.PlantUmlError && container) {
                const placeholder = container.querySelector(
                    `[data-plantuml-index="${typedMessage.index ?? ''}"]`
                );
                if (placeholder && placeholder.parentNode) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'plantuml-error';
                    errorDiv.textContent = `Error rendering PlantUML: ${(typedMessage as { error?: string }).error ?? 'Unknown error'}`;
                    placeholder.parentNode.replaceChild(errorDiv, placeholder);
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
