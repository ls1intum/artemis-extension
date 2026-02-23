import { Container } from '../../../components/Container';
import { Button } from '../../../components/Button';
import type { ProblemStatementProps } from '../types';
import styles from './ProblemStatement.module.css';

/**
 * Extracted ProblemStatement component for Phase 5 reuse.
 * Renders processed markdown HTML and optional download links.
 */
export function ProblemStatement({ markdown, downloadLinks = [], onDownload }: ProblemStatementProps) {
    return (
        <Container header={<h3>Exercise Description</h3>}>
            <div
                className={styles.problemStatement}
                dangerouslySetInnerHTML={{ __html: markdown }}
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
