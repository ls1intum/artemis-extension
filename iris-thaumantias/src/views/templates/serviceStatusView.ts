import * as vscode from 'vscode';
import { ThemeStore } from '../../theme';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { ServiceHealthComponent } from '../components/serviceHealthComponent';
import { StyleManager } from '../styles';
import { BackLinkComponent } from '../components/backLinkComponent';

export class ServiceStatusView {
    private readonly _themeStore: ThemeStore;
    private _extensionContext: vscode.ExtensionContext;
    private _styleManager: StyleManager;

    constructor(themeStore: ThemeStore, extensionContext: vscode.ExtensionContext, styleManager: StyleManager) {
        this._themeStore = themeStore;
        this._extensionContext = extensionContext;
        this._styleManager = styleManager;
    }

    public generateHtml(serverUrl?: string, webview?: vscode.Webview): string {
        const themeCSS = this._themeStore.css;
        const currentTheme = this._themeStore.themeType;
        const styles = this._styleManager.getStyles(currentTheme, [
            'views/service-status.css',
            'components/service-health.css'
        ]);
        
        return this._getServiceStatusHtml(themeCSS, currentTheme, styles, serverUrl);
    }

    private _getServiceStatusHtml(themeCSS: string, currentTheme: string, styles: string, serverUrl?: string): string {
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
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
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
