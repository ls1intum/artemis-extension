import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { ServiceHealthComponent } from '../components/serviceHealth/serviceHealthComponent';
import { readCssFiles } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { TextInputComponent } from '../components/input/textInputComponent';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ContainerComponent } from '../components/container/containerComponent';

export class ServiceStatusView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(serverUrl?: string, webview?: vscode.Webview): string {
        const styles = readCssFiles(
            'components/backLink/back-link.css',
            'components/container/container.css',
            'serviceStatus/service-status.css',
            'components/serviceHealth/service-health.css',
            'components/input/input.css',
            'components/button/button.css'
        );
        
        return this._getServiceStatusHtml(styles, serverUrl);
    }

    private _getServiceStatusHtml(styles: string, serverUrl?: string): string {
        // Get icon SVGs
        const stethoscopeIcon = IconDefinitions.getIcon('stethoscope');
        
        // Header container
        const headerContainer = ContainerComponent.generate({
            className: 'header-container',
            header: {
                title: 'Service Status',
                subtitle: 'Real-time monitoring of Artemis services',
                titleSize: 'xlarge',
                icon: stethoscopeIcon
            }
        });

        // Server info container
        const serverInfoContainer = ContainerComponent.generate({
            className: 'server-info-container',
            header: {
                title: 'Connected Server'
            },
            bodyHtml: `
                ${TextInputComponent.generate({
                    id: 'serverUrl',
                    type: 'text',
                    value: serverUrl,
                    disabled: true,
                    fullWidth: true,
                })}
            `
        });

        // Service health container
        const healthContainer = ContainerComponent.generate({
            className: 'health-container',
            header: {
                title: 'Health Checks',
                subtitle: 'Click on each service to see detailed information',
                divider: true
            },
            bodyHtml: ServiceHealthComponent.generateHtml({ showTitle: false, compact: false, autoCheck: true })
        });
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Service Status</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    ${BackLinkComponent.generateHtml()}
    <div class="service-status-container">
        ${headerContainer}
        ${serverInfoContainer}
        ${healthContainer}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Initialize Service Health Component
        ${ServiceHealthComponent.generateScript()}
        
        ${BackLinkComponent.generateScript()}
        ${ContainerComponent.generateScript()}
    </script>
</body>
</html>`;
    }
}
