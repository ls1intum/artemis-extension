import { useEffect, useState } from 'react';

import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { BackLink, Badge, Button, Container, EmptyState, PageHeader, SkeletonList } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import styles from './RecommendedExtensionsView.module.css';
import type {
    Extension,
    ExtensionCategory,
    RecommendedExtensionsPersistedState,
    RecommendedExtensionsViewProps,
} from './types';

export function RecommendedExtensionsView({ vscodeApi }: RecommendedExtensionsViewProps) {
    const [categories, setCategories] = useState<ExtensionCategory[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const persistedState = vscodeApi.getState<RecommendedExtensionsPersistedState>();
        if (persistedState?.selectedCategory) {
            setSelectedCategory(persistedState.selectedCategory);
        }
    }, [vscodeApi]);

    useEffect(() => {
        vscodeApi.setState<RecommendedExtensionsPersistedState>({
            selectedCategory
        });
    }, [selectedCategory, vscodeApi]);

    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.RecommendedExtensionsInit) {
            setCategories(msg.categories);
            setIsLoaded(true);
        }
    }, [setCategories, setIsLoaded]);

    const handleBackToDashboard = () => {
        postCommand(vscodeApi, 'backToDashboard');
    };

    const handleCategoryFilter = (categoryId: string) => {
        setSelectedCategory(categoryId);
    };

    const handleViewInMarketplace = (extensionId: string) => {
        postCommand(vscodeApi, 'searchMarketplace', { extensionId });
    };

    const filteredCategories = selectedCategory === 'all'
        ? categories
        : categories.filter(cat => cat.id === selectedCategory);

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

    if (categories.length === 0) {
        return (
            <div className={styles.recommendedExtensionsView}>
                <BackLink onClick={handleBackToDashboard}>
                    Back to Dashboard
                </BackLink>
                <Container variant="muted">
                    <EmptyState
                        title="No recommended extensions available"
                        message="Check back soon for curated extension recommendations!"
                    />
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

            <p style={{
                margin: 0,
                fontSize: '14px',
                color: 'var(--vscode-foreground)',
                lineHeight: '1.5'
            }}>
                {extension.description}
            </p>

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
