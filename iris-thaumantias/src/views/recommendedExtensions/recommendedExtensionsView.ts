import { readCssFiles } from '../utils';
import type { RecommendedExtensionCategory } from '../../utils/recommendedExtensions';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ListItemComponent } from '../components/listItem/listItemComponent';
import { BadgeComponent } from '../components/badge/badgeComponent';
import { ContainerComponent } from '../components/container/containerComponent';

export class RecommendedExtensionsView {
    public generateHtml(categories: RecommendedExtensionCategory[] = []): string {
        const styles = readCssFiles(
            'components/backLink/back-link.css',
            'components/button/button.css',
            'components/listItem/list-item.css',
            'components/badge/badge.css',
            'components/container/container.css',
            'recommendedExtensions/recommended-extensions.css'
        );

        const hasCategories = Array.isArray(categories) && categories.length > 0;

        const categorySections = hasCategories
            ? categories.map(category => this._renderCategory(category)).join('')
            : this._renderEmptyState();
        const filterControls = hasCategories ? this._renderFilterControls(categories) : '';

        const headerContainer = ContainerComponent.generate({
            className: 'header-container',
            header: {
                title: 'Recommended Extensions',
                subtitle: 'Improve your Artemis workflow with curated VS Code extensions.',
                titleSize: 'xlarge'
            },
            bodyHtml: filterControls
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recommended Extensions</title>
    <style>
        ${styles}
    </style>

</head>
<body>
    ${BackLinkComponent.generateHtml()}
    <div class="recommended-container">
        ${headerContainer}
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

        // Filter functionality
        const filterButtons = Array.from(document.querySelectorAll('.filter-button'));
        const categorySections = Array.from(document.querySelectorAll('.category-section'));

        window.filterCategory = function(categoryId) {
            categorySections.forEach(section => {
                const sectionId = section.getAttribute('data-category-id');
                const shouldShow = categoryId === 'all' || categoryId === sectionId;
                section.style.display = shouldShow ? '' : 'none';
            });

            // Update button states
            filterButtons.forEach(btn => {
                const btnCategory = btn.getAttribute('data-category');
                if (btnCategory === categoryId) {
                    btn.classList.add('active');
                    btn.classList.remove('btn-secondary');
                    btn.classList.add('btn-primary');
                } else {
                    btn.classList.remove('active');
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-secondary');
                }
            });
        };

        ${ContainerComponent.generateScript()}
    </script>
</body>
</html>`;
    }

    private _renderCategory(category: RecommendedExtensionCategory): string {
        const extensionsHtml = category.extensions.map(extension => this._renderExtensionCard(extension)).join('');

        return ContainerComponent.generate({
            className: 'category-section',
            listMode: true,
            header: {
                title: category.name,
                subtitle: category.description,
                titleSize: 'large',
                divider: true
            },
            bodyHtml: `<div class="extensions-list">${extensionsHtml}</div>`,
            dataAttributes: {
                'category-id': category.id
            }
        });
    }

    private _renderExtensionCard(extension: RecommendedExtensionCategory['extensions'][number]): string {
        const isInstalled = extension.isInstalled === true;
        
        // Use BadgeComponent for status and optional pills
        const statusBadge = BadgeComponent.generate({
            label: isInstalled ? 'Installed' : 'Not installed',
            variant: isInstalled ? 'success' : 'secondary',
            className: 'status-badge'
        });
        
        const optionalBadge = extension.optional 
            ? BadgeComponent.generate({
                label: 'Optional',
                variant: 'secondary',
                className: 'optional-badge'
            })
            : '';
        
        const publisherLine = extension.version ? `${extension.publisher} • v${extension.version}` : extension.publisher;

        return ListItemComponent.generate(
            {
                className: 'extension-card',
                clickable: false,
                hover: false,
                dataAttributes: {
                    'extension-id': extension.id,
                    'installed': isInstalled.toString()
                }
            },
            `
                <div class="extension-header">
                    <div class="extension-header-details">
                        <h3 class="extension-name">${extension.name}</h3>
                        <p class="extension-publisher">${publisherLine}</p>
                    </div>
                    <div class="extension-pill-group">
                        ${statusBadge}
                        ${optionalBadge}
                    </div>
                </div>
                <p class="extension-description">${extension.description}</p>
                <div class="extension-reason-block">
                    <div class="extension-reason-label">Why we recommend it</div>
                    <p class="extension-reason">${extension.reason}</p>
                </div>
                ${ButtonComponent.generate({
                    label: 'View in Marketplace',
                    variant: 'secondary',
                    className: 'marketplace-button',
                    command: `openExtensionMarketplace('${extension.id}')`
                })}
            `
        );
    }

    private _renderFilterControls(categories: RecommendedExtensionCategory[]): string {
        const categoryButtons = categories.map(category => 
            ButtonComponent.generate({
                label: category.name,
                variant: 'secondary',
                className: 'filter-button',
                command: `filterCategory('${category.id}')`,
                dataAttributes: { 'category': category.id }
            })
        ).join('');

        return `
        <div class="filter-bar">
            <div class="filter-label">FILTER</div>
            <div class="filter-controls">
                ${ButtonComponent.generate({
                    label: 'All categories',
                    variant: 'primary',
                    className: 'filter-button active',
                    command: `filterCategory('all')`,
                    dataAttributes: { 'category': 'all' }
                })}
                ${categoryButtons}
            </div>
        </div>`;
    }

    private _renderEmptyState(): string {
        return ContainerComponent.generate({
            className: 'empty-state',
            textAlign: 'center',
            state: {
                type: 'info',
                message: 'No recommended extensions available',
                hint: 'Check back soon for curated extension recommendations!'
            }
        });
    }
}
