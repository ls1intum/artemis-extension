import * as vscode from 'vscode';
import { AiExtension } from '../app/appStateManager';
import { readCss } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ButtonComponent } from '../components/button/buttonComponent';

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
        const styles = readCss('aiChecker/ai-checker.css');
        const buttonStyles = readCss('components/button/button.css');
        const backLinkStyles = readCss('components/backLink/back-link.css');

        const groupedExtensions = this._groupExtensionsByProvider(aiExtensions);

        return this._getAiCheckerHtml(groupedExtensions, styles, buttonStyles, backLinkStyles);
    }

    private _getAiCheckerHtml(groups: ProviderGroup[], styles: string, buttonStyles: string, backLinkStyles: string): string {
        const providerOptions = groups
            .map(group => `<option value="${group.provider.toLowerCase()}">${group.provider}</option>`)
            .join('');

        const groupsMarkup = groups
            .map(group => {
                const extensionsMarkup = group.extensions.map(ext => {
                    const statusClass = ext.isInstalled
                        ? 'status-installed'
                        : 'status-missing';
                    const statusValue = ext.isInstalled ? 'installed' : 'missing';
                    const statusLabel = ext.isInstalled
                        ? '● Installed'
                        : '✖ Not installed';

                    return `
                        <div class="extension-item" data-provider="${group.provider.toLowerCase()}" data-status="${statusValue}" data-installed="${ext.isInstalled}" data-name="${ext.name.toLowerCase()}" data-ext-id="${ext.id}">
                            <div class="extension-content">
                                <div class="extension-top">
                                    <h3 class="extension-name">${ext.name}</h3>
                                    <span class="status-badge ${statusClass}">
                                        ${statusLabel}
                                    </span>
                                </div>
                                ${ext.isInstalled ? `
                                <div class="extension-details">
                                    <p class="extension-publisher">${ext.publisher}${ext.version !== '—' ? ` • v${ext.version}` : ''}</p>
                                    <p class="extension-description">${ext.description}</p>
                                    ${ButtonComponent.generate({
                                        label: 'View in Marketplace',
                                        variant: 'secondary',
                                        className: 'marketplace-btn',
                                        command: `searchMarketplace('${ext.id}')`
                                    })}
                                </div>
                                ` : `
                                <div class="extension-details">
                                    <p class="extension-description">${ext.description}</p>
                                    ${ButtonComponent.generate({
                                        label: 'View in Marketplace',
                                        variant: 'secondary',
                                        className: 'marketplace-btn',
                                        command: `searchMarketplace('${ext.id}')`
                                    })}
                                </div>
                                `}
                            </div>
                        </div>
                    `;
                }).join('');

                return `
                    <section class="provider-group" data-provider="${group.provider.toLowerCase()}">
                        <header class="provider-header">
                            <span class="provider-chip" style="background-color: ${group.color};">${group.provider}</span>
                            <span class="provider-count">${group.extensions.length} extension${group.extensions.length !== 1 ? 's' : ''}</span>
                        </header>
                        ${extensionsMarkup}
                    </section>
                `;
            }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Checker</title>
    <style>
        ${backLinkStyles}
        ${buttonStyles}
        ${styles}
    </style>

</head>
<body>
    <div class="ai-checker-container">
        ${BackLinkComponent.generateHtml()}
        
        <div class="header">
            <div class="header-content">
                <h1>AI Checker</h1>
                <p>Check and manage your AI-powered learning assistants</p>
            </div>
        </div>
        
        <div class="content">
            <div class="status-view">
                <h3>Installed AI Extensions</h3>
                ${groups.length > 0 ? `
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
                        <div class="refresh-btn-wrapper">
                            <button class="refresh-btn" onclick="refreshExtensions()">
                                <span>↻</span>
                                Refresh
                            </button>
                        </div>
                    </div>
                    <div class="extensions-list" id="extensionsList">
                        ${groupsMarkup}
                    </div>
                    <p class="no-extensions hidden" id="noExtensionsFiltered">No extensions match your filters.</p>
                ` : `
                    <p class="no-extensions">No AI extensions detected</p>
                `}
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        ${BackLinkComponent.generateScript()}

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
}
