import { useEffect, useState } from 'react';
import type { RecommendedExtensionsInitMessage } from '../../../../../shared/messageContracts';
import { BackLink, Container, Button, Badge, PageHeader, SkeletonList } from '../../components';
import styles from './RecommendedExtensionsView.module.css';
import type { RecommendedExtensionsViewProps, ExtensionCategory, Extension, RecommendedExtensionsPersistedState } from './types';
import { isTypedMessage } from '../../utils/messageValidation';

export function RecommendedExtensionsView({ vscodeApi }: RecommendedExtensionsViewProps) {
    const [categories, setCategories] = useState<ExtensionCategory[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [isLoaded, setIsLoaded] = useState(false);

    // Restore persisted state on mount
    useEffect(() => {
        const persistedState = vscodeApi.getState<RecommendedExtensionsPersistedState>();
        if (persistedState?.selectedCategory) {
            setSelectedCategory(persistedState.selectedCategory);
        }
    }, [vscodeApi]);

    // Persist selectedCategory changes
    useEffect(() => {
        vscodeApi.setState<RecommendedExtensionsPersistedState>({
            selectedCategory
        });
    }, [selectedCategory, vscodeApi]);

    // Message handler
    useEffect(() => {
        const handleMessage = (event: MessageEvent<unknown>) => {
            if (!isTypedMessage(event.data)) {
                return;
            }

            if (event.data.type === 'recommendedExtensionsInit') {
                const initMsg = event.data as unknown as RecommendedExtensionsInitMessage;
                setCategories(initMsg.categories);
                setIsLoaded(true);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleBackToDashboard = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'backToDashboard'
        });
    };

    const handleCategoryFilter = (categoryId: string) => {
        setSelectedCategory(categoryId);
    };

    const handleViewInMarketplace = (extensionId: string) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'searchMarketplace',
            payload: { extensionId }
        });
    };

    // Filter categories based on selection
    const filteredCategories = selectedCategory === 'all'
        ? categories
        : categories.filter(cat => cat.id === selectedCategory);

    // Loading state
    if (!isLoaded) {
        return (
            <div className={styles.recommendedExtensionsView}>
                <BackLink onClick={handleBackToDashboard}>
                    Back to Dashboard
                </BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Empty state
    if (categories.length === 0) {
        return (
            <div className={styles.recommendedExtensionsView}>
                <BackLink onClick={handleBackToDashboard}>
                    Back to Dashboard
                </BackLink>
                <Container className="empty-state" variant="muted">
                    <div style={{
                        textAlign: 'center',
                        padding: '40px 20px',
                        color: 'var(--vscode-descriptionForeground)'
                    }}>
                        <p style={{
                            fontSize: '16px',
                            fontWeight: 600,
                            margin: '0 0 8px 0',
                            color: 'var(--vscode-foreground)'
                        }}>
                            No recommended extensions available
                        </p>
                        <p style={{ margin: 0, fontSize: '14px' }}>
                            Check back soon for curated extension recommendations!
                        </p>
                    </div>
                </Container>
            </div>
        );
    }

    return (
        <div className={styles.recommendedExtensionsView}>
            <BackLink onClick={handleBackToDashboard}>
                Back to Dashboard
            </BackLink>

            <PageHeader
                title="Recommended Extensions"
                subtitle="Improve your Artemis workflow with curated VS Code extensions."
            />

            {/* Filter controls */}
            {isLoaded && categories.length > 0 && (
                <Container>
                    <div style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        letterSpacing: '0.5px',
                        color: 'var(--vscode-descriptionForeground)',
                        marginBottom: '8px'
                    }}>
                        FILTER
                    </div>
                    <div style={{
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap'
                    }}>
                        <Button
                            variant={selectedCategory === 'all' ? 'primary' : 'secondary'}
                            onClick={() => handleCategoryFilter('all')}
                        >
                            All categories
                        </Button>
                        {categories.map(category => (
                            <Button
                                key={category.id}
                                variant={selectedCategory === category.id ? 'primary' : 'secondary'}
                                onClick={() => handleCategoryFilter(category.id)}
                            >
                                {category.name}
                            </Button>
                        ))}
                    </div>
                </Container>
            )}

            {/* Category sections */}
            {isLoaded && filteredCategories.map(category => (
                <Container
                    key={category.id}
                    className="category-section"
                    listMode={true}
                >
                    <div style={{ marginBottom: '16px' }}>
                        <h2 style={{
                            fontSize: '20px',
                            fontWeight: 600,
                            margin: '0 0 8px 0',
                            color: 'var(--vscode-foreground)'
                        }}>
                            {category.name}
                        </h2>
                        <p style={{
                            margin: 0,
                            fontSize: '14px',
                            color: 'var(--vscode-descriptionForeground)'
                        }}>
                            {category.description}
                        </p>
                        <div style={{
                            height: '1px',
                            background: 'var(--vscode-panel-border)',
                            margin: '12px 0 0 0'
                        }} />
                    </div>

                    <div className="extensions-list">
                        {category.extensions.map(extension => (
                            <ExtensionCard
                                key={extension.id}
                                extension={extension}
                                onViewInMarketplace={handleViewInMarketplace}
                            />
                        ))}
                    </div>
                </Container>
            ))}
        </div>
    );
}

/**
 * Extension card component composed from Phase 2 shared components.
 */
function ExtensionCard({
    extension,
    onViewInMarketplace
}: {
    extension: Extension;
    onViewInMarketplace: (id: string) => void;
}) {
    const publisherLine = extension.version
        ? `${extension.publisher} • v${extension.version}`
        : extension.publisher;

    return (
        <div style={{
            padding: '16px',
            borderBottom: '1px solid var(--vscode-panel-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
        }}>
            {/* Header with name, publisher, and badges */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px'
            }}>
                <div style={{ flex: 1 }}>
                    <h3 style={{
                        fontSize: '16px',
                        fontWeight: 600,
                        margin: '0 0 4px 0',
                        color: 'var(--vscode-foreground)'
                    }}>
                        {extension.name}
                    </h3>
                    <p style={{
                        margin: 0,
                        fontSize: '13px',
                        color: 'var(--vscode-descriptionForeground)'
                    }}>
                        {publisherLine}
                    </p>
                </div>
                <div style={{
                    display: 'flex',
                    gap: '6px',
                    flexShrink: 0
                }}>
                    <Badge
                        variant={extension.isInstalled ? 'success' : 'default'}
                    >
                        {extension.isInstalled ? 'Installed' : 'Not installed'}
                    </Badge>
                    {extension.optional && (
                        <Badge variant="muted">
                            Optional
                        </Badge>
                    )}
                </div>
            </div>

            {/* Description */}
            <p style={{
                margin: 0,
                fontSize: '14px',
                color: 'var(--vscode-foreground)',
                lineHeight: '1.5'
            }}>
                {extension.description}
            </p>

            {/* Why we recommend it */}
            <div>
                <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--vscode-descriptionForeground)',
                    marginBottom: '4px'
                }}>
                    Why we recommend it
                </div>
                <p style={{
                    margin: 0,
                    fontSize: '13px',
                    color: 'var(--vscode-descriptionForeground)',
                    lineHeight: '1.4'
                }}>
                    {extension.reason}
                </p>
            </div>

            {/* Action button */}
            <div>
                <Button
                    variant="secondary"
                    onClick={() => onViewInMarketplace(extension.id)}
                >
                    View in Marketplace
                </Button>
            </div>
        </div>
    );
}
