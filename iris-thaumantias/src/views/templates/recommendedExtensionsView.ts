import { ThemeManager } from '../../theme';
import { StyleManager } from '../styles';
import type { RecommendedExtensionCategory } from '../../utils/recommendedExtensions';
import { BackLinkComponent } from '../components/backLinkComponent';

export class RecommendedExtensionsView {
    private readonly _themeManager: ThemeManager;
    private readonly _styleManager: StyleManager;

    constructor(styleManager: StyleManager) {
        this._themeManager = new ThemeManager();
        this._styleManager = styleManager;
    }

    public generateHtml(categories: RecommendedExtensionCategory[] = []): string {
        const themeCSS = this._themeManager.getThemeCSS();
        const currentTheme = this._themeManager.getCurrentTheme();
        const styles = this._styleManager.getStyles(currentTheme, [
            'views/recommended-extensions.css'
        ]);
        const themeBootstrap = this._themeManager.getThemeBootstrapScript(currentTheme);

        const hasCategories = Array.isArray(categories) && categories.length > 0;

        const categorySections = hasCategories
            ? categories.map(category => this._renderCategory(category)).join('')
            : this._renderEmptyState();
        const filterControls = hasCategories ? this._renderFilterControls(categories) : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recommended Extensions</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

    <script>
        ${themeBootstrap}
    </script>

</head>
<body class="theme-${currentTheme}">
    <div class="recommended-container">
        ${BackLinkComponent.generateHtml()}
        <div class="view-header">
            <h1 class="view-title">Recommended Extensions</h1>
            <p class="view-subtitle">Improve your Artemis workflow with curated VS Code extensions.</p>
        </div>
        ${filterControls}
        ${categorySections}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        ${BackLinkComponent.generateScript()}

        document.querySelectorAll('.marketplace-button').forEach(button => {
            button.addEventListener('click', event => {
                const extensionId = event.currentTarget.getAttribute('data-extension-id');
                if (extensionId) {
                    vscode.postMessage({ command: 'searchMarketplace', extensionId });
                }
            });
        });

        const filterButtons = Array.from(document.querySelectorAll('.filter-button'));
        if (filterButtons.length > 0) {
            const categorySections = Array.from(document.querySelectorAll('.category-section'));

            const applyFilter = (categoryId) => {
                categorySections.forEach(section => {
                    const sectionId = section.getAttribute('data-category-id');
                    const shouldShow = categoryId === 'all' || categoryId === sectionId;
                    section.style.display = shouldShow ? '' : 'none';
                });
            };

            filterButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const selectedCategory = button.getAttribute('data-category');
                    filterButtons.forEach(btn => btn.classList.toggle('active', btn === button));
                    applyFilter(selectedCategory || 'all');
                });
            });
        }
    </script>
</body>
</html>`;
    }

    private _renderCategory(category: RecommendedExtensionCategory): string {
        const extensionsHtml = category.extensions.map(extension => this._renderExtensionCard(extension)).join('');

        return `
        <section class="category-section" data-category-id="${category.id}">
            <header class="category-header">
                <h2 class="category-name">${category.name}</h2>
                <p class="category-description">${category.description}</p>
            </header>
            <div class="extensions-grid">
                ${extensionsHtml}
            </div>
        </section>`;
    }

    private _renderExtensionCard(extension: RecommendedExtensionCategory['extensions'][number]): string {
        const isInstalled = extension.isInstalled === true;
        const optionalPill = extension.optional ? `<span class="optional-pill">Optional</span>` : '';
        const statusPill = `<span class="status-pill ${isInstalled ? 'installed' : 'missing'}">${isInstalled ? 'Installed' : 'Not installed'}</span>`;
        const publisherLine = extension.version ? `${extension.publisher} • v${extension.version}` : extension.publisher;

        return `
                <article class="extension-card" data-extension-id="${extension.id}" data-installed="${isInstalled}">
                    <div class="extension-header">
                        <div class="extension-header-details">
                            <h3 class="extension-name">${extension.name}</h3>
                            <p class="extension-publisher">${publisherLine}</p>
                        </div>
                        <div class="extension-pill-group">
                            ${statusPill}
                            ${optionalPill}
                        </div>
                    </div>
                    <p class="extension-description">${extension.description}</p>
                    <div class="extension-reason-block">
                        <div class="extension-reason-label">Why we recommend it</div>
                        <p class="extension-reason">${extension.reason}</p>
                    </div>
                    <button class="marketplace-button" data-extension-id="${extension.id}">View in Marketplace</button>
                </article>`;
    }

    private _renderFilterControls(categories: RecommendedExtensionCategory[]): string {
        const categoryButtons = categories.map(category => `
                <button class="filter-button" data-category="${category.id}">
                    ${category.name}
                </button>
        `).join('');

        return `
        <div class="filter-bar">
            <div class="filter-label">Filter</div>
            <div class="filter-controls">
                <button class="filter-button active" data-category="all">All categories</button>
                ${categoryButtons}
            </div>
        </div>`;
    }

    private _renderEmptyState(): string {
        return `<div class="empty-state">
            No recommended extensions available right now. Check back soon!
        </div>`;
    }
}
