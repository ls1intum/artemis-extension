import { useEffect, useState } from 'react';
import type { ExtensionToWebviewMessage } from '../../../../../shared/messageContracts';
import { BackLink, Container, Button, Badge } from '../../components';
import type { RecommendedExtensionsViewProps, ExtensionCategory, Extension, RecommendedExtensionsPersistedState } from './types';

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

        // Request initial data
        vscodeApi.postMessage({
            type: 'command',
            command: 'requestRecommendedExtensions'
        });
    }, [vscodeApi]);

    // Persist selectedCategory changes
    useEffect(() => {
        vscodeApi.setState<RecommendedExtensionsPersistedState>({
            selectedCategory
        });
    }, [selectedCategory, vscodeApi]);

    // Message handler
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message: unknown = event.data;

            // Type guard
            if (typeof message !== 'object' || message === null || !('type' in message)) {
                return;
            }

            const typedMessage = message as ExtensionToWebviewMessage;

            switch (typedMessage.type) {
                case 'recommendedExtensionsInit':
                    setCategories(typedMessage.payload.categories);
                    setIsLoaded(true);
                    break;

                // Handle legacy command format for robustness
                default:
                    if ('command' in typedMessage && (typedMessage as any).command === 'recommendedExtensionsInit') {
                        const legacyMessage = typedMessage as any;
                        if (legacyMessage.categories) {
                            setCategories(legacyMessage.categories);
                            setIsLoaded(true);
                        }
                    }
                    break;
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

    // Empty state
    if (isLoaded && categories.length === 0) {
        return (
            <div>
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
        <div className="recommended-container">
            <BackLink onClick={handleBackToDashboard}>
                Back to Dashboard
            </BackLink>

            {/* Header */}
            <Container className="header-container">
                <div style={{ marginBottom: '16px' }}>
                    <h1 style={{
                        fontSize: '24px',
                        fontWeight: 600,
                        margin: '0 0 8px 0',
                        color: 'var(--vscode-foreground)'
                    }}>
                        Recommended Extensions
                    </h1>
                    <p style={{
                        margin: 0,
                        fontSize: '14px',
                        color: 'var(--vscode-descriptionForeground)'
                    }}>
                        Improve your Artemis workflow with curated VS Code extensions.
                    </p>
                </div>

                {/* Filter controls */}
                {isLoaded && categories.length > 0 && (
                    <div style={{ marginTop: '20px' }}>
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
                    </div>
                )}
            </Container>

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
