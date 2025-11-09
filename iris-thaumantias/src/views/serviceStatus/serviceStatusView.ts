import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { ServiceHealthComponent } from '../components/serviceHealth/serviceHealthComponent';
import { readCssFiles } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';

export class ServiceStatusView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(serverUrl?: string, webview?: vscode.Webview): string {
        const styles = readCssFiles(
            'components/backLink/back-link.css',
            'serviceStatus/service-status.css',
            'components/serviceHealth/service-health.css'
        );
        
        return this._getServiceStatusHtml(styles, serverUrl);
    }

    private _getServiceStatusHtml(styles: string, serverUrl?: string): string {
        // Get icon SVGs
        const stethoscopeIcon = IconDefinitions.getIcon('stethoscope');
        const refreshIcon = IconDefinitions.getIcon('refresh');
        
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
    <div class="service-status-container">
        ${BackLinkComponent.generateHtml()}
        
        <div class="header">
            <h1 class="header-title">
                <span class="header-icon">${stethoscopeIcon}</span>
                Service Status
            </h1>
            <p class="header-subtitle">Real-time monitoring of Artemis services</p>
        </div>
        
        <div class="server-info">
            <h3 class="server-info-title">Connected Server</h3>
            <div class="server-url" id="serverUrl">${serverUrl || 'https://artemis.tum.de'}</div>
        </div>
        
        ${ServiceHealthComponent.generateHtml({ showTitle: true, compact: false, autoCheck: true })}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Initialize Service Health Component
        ${ServiceHealthComponent.generateScript()}
        
        ${BackLinkComponent.generateScript()}
    </script>
</body>
</html>`;
    }
}
