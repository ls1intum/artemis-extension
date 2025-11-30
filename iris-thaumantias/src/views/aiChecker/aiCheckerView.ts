import * as vscode from 'vscode';
import { AiExtension } from '../app/appStateManager';
import { readCssFiles } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ContainerComponent } from '../components/container/containerComponent';
import { BadgeComponent } from '../components/badge/badgeComponent';
import { ListItemComponent } from '../components/listItem/listItemComponent';

interface ProviderGroup {
    provider: string;
    color: string;
    extensions: AiExtension[];
}

export class AiCheckerView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(aiExtensions: AiExtension[]): string {
        const styles = readCssFiles(
            'components/backLink/back-link.css',
            'components/button/button.css',
            'components/container/container.css',
            'components/badge/badge.css',
            'components/listItem/list-item.css',
            'aiChecker/ai-checker.css'
        );

        const groupedExtensions = this._groupExtensionsByProvider(aiExtensions);

        return this._getAiCheckerHtml(groupedExtensions, styles);
    }

    private _getAiCheckerHtml(groups: ProviderGroup[], styles: string): string {
        const providerOptions = groups
            .map(group => `<option value="${group.provider.toLowerCase()}">${group.provider}</option>`)
            .join('');

        const groupsMarkup = groups
            .map(group => {
                const extensionsMarkup = group.extensions.map(ext => {
                    const statusBadge = BadgeComponent.generate({
                        label: ext.isInstalled ? 'Installed' : 'Not installed',
                        variant: ext.isInstalled ? 'success' : 'secondary'
                    });
                    const statusValue = ext.isInstalled ? 'installed' : 'missing';
                    const publisherLine = ext.isInstalled && ext.version !== '—'
                        ? `${ext.publisher} • v${ext.version}`
                        : ext.publisher;

                    return ListItemComponent.generate(
                        {
                            className: 'extension-item',
                            clickable: false,
                            hover: true,
                            dataAttributes: {
                                'provider': group.provider.toLowerCase(),
                                'status': statusValue,
                                'installed': ext.isInstalled.toString(),
                                'name': ext.name.toLowerCase(),
                                'ext-id': ext.id
                            }
                        },
                        `
                            <div class="extension-header">
                                <div class="extension-info">
                                    <h3 class="extension-name">${ext.name}</h3>
                                    <p class="extension-publisher">${publisherLine}</p>
                                </div>
                                ${statusBadge}
                            </div>
                            <p class="extension-description">${ext.description}</p>
                            ${ButtonComponent.generate({
                            label: 'View in Marketplace',
                            variant: 'secondary',
                            className: 'marketplace-btn',
                            command: `searchMarketplace('${ext.id}')`
                        })}
                        `
                    );
                }).join('');

                return ContainerComponent.generate({
                    className: 'provider-group',
                    listMode: true,
                    header: {
                        title: group.provider,
                        badge: `${group.extensions.length}`,
                        actionsHtml: `<span class="provider-chip" style="background-color: ${group.color};"></span>`
                    },
                    bodyHtml: `<div class="extensions-list">${extensionsMarkup}</div>`,
                    dataAttributes: {
                        'provider': group.provider.toLowerCase()
                    }
                });
            }).join('');

        const headerContainer = ContainerComponent.generate({
            className: 'header-container',
            header: {
                title: 'AI Checker',
                subtitle: 'Check and manage your AI-powered learning assistants',
                titleSize: 'xlarge'
            },
            bodyHtml: groups.length > 0 ? this._renderFilterBar(providerOptions) : ''
        });

        const contentContainer = groups.length > 0
            ? `<div class="provider-groups" id="extensionsList">${groupsMarkup}</div>
               <p class="no-extensions hidden" id="noExtensionsFiltered">No extensions match your filters.</p>`
            : ContainerComponent.generate({
                className: 'empty-state',
                textAlign: 'center',
                state: {
                    type: 'info',
                    message: 'No AI extensions detected',
                    hint: 'AI extensions help you get intelligent assistance while coding.'
                }
            });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Checker</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    ${BackLinkComponent.generateHtml()}
    <div class="ai-checker-container">
        ${headerContainer}
        ${contentContainer}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        ${BackLinkComponent.generateScript()}
        ${ContainerComponent.generateScript()}

        function refreshExtensions() {
            vscode.postMessage({ command: 'showAiConfig' });
        }

        function searchMarketplace(extensionId) {
            vscode.postMessage({ 
                command: 'searchMarketplace',
                extensionId: extensionId
            });
        }

        const searchInput = document.getElementById('aiFilterSearch');
        const statusSelect = document.getElementById('aiFilterStatus');
        const providerSelect = document.getElementById('aiFilterProvider');
        const extensionItems = Array.from(document.querySelectorAll('.extension-item'));
        const providerGroups = Array.from(document.querySelectorAll('.provider-group'));
        const noExtensionsMsg = document.getElementById('noExtensionsFiltered');

        function applyFilters() {
            const searchTerm = (searchInput?.value || '').trim().toLowerCase();
            const statusFilter = statusSelect?.value || 'all';
            const providerFilter = providerSelect?.value || 'all';

            let visibleCount = 0;

            extensionItems.forEach(item => {
                const matchesSearch = !searchTerm || (item.dataset.name || '').includes(searchTerm);
                const matchesStatus = statusFilter === 'all' || item.dataset.status === statusFilter;
                const matchesProvider = providerFilter === 'all' || item.dataset.provider === providerFilter;

                const shouldShow = matchesSearch && matchesStatus && matchesProvider;
                item.classList.toggle('hidden', !shouldShow);
                if (shouldShow) {
                    visibleCount += 1;
                }
            });

            providerGroups.forEach(group => {
                const hasVisible = group.querySelector('.extension-item:not(.hidden)') !== null;
                group.classList.toggle('hidden', !hasVisible);
            });

            if (noExtensionsMsg) {
                noExtensionsMsg.classList.toggle('hidden', visibleCount !== 0);
            }
        }

        [
            { element: searchInput, event: 'input' },
            { element: statusSelect, event: 'change' },
            { element: providerSelect, event: 'change' }
        ].forEach(({ element, event }) => {
            element?.addEventListener(event, applyFilters);
        });

        applyFilters();
    </script>
</body>
</html>`;
    }

    private _groupExtensionsByProvider(aiExtensions: AiExtension[]): ProviderGroup[] {
        const groupsMap = new Map<string, ProviderGroup>();

        aiExtensions.forEach(ext => {
            const providerKey = ext.provider || 'Other';
            const existing = groupsMap.get(providerKey);

            if (existing) {
                existing.extensions.push(ext);
            } else {
                groupsMap.set(providerKey, {
                    provider: providerKey,
                    color: ext.providerColor,
                    extensions: [ext]
                });
            }
        });

        return Array.from(groupsMap.values())
            .map(group => ({
                ...group,
                extensions: [...group.extensions].sort((a, b) => a.name.localeCompare(b.name))
            }))
            .sort((a, b) => a.provider.localeCompare(b.provider));
    }

    private _renderFilterBar(providerOptions: string): string {
        return `
            <div class="filter-bar">
                <div class="filter-field">
                    <label for="aiFilterSearch">Search</label>
                    <input id="aiFilterSearch" type="search" placeholder="Search AI tools by name" />
                </div>
                <div class="filter-field">
                    <label for="aiFilterProvider">Provider</label>
                    <select id="aiFilterProvider">
                        <option value="all" selected>All providers</option>
                        ${providerOptions}
                    </select>
                </div>
                <div class="filter-field">
                    <label for="aiFilterStatus">Status</label>
                    <select id="aiFilterStatus">
                        <option value="all" selected>All statuses</option>
                        <option value="installed">Installed</option>
                        <option value="missing">Not installed</option>
                    </select>
                </div>
                ${ButtonComponent.generate({
            label: 'Clear',
            variant: 'secondary',
            className: 'refresh-btn',
            command: 'refreshExtensions()'
        })}
            </div>
        `;
    }
}
