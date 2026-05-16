import * as vscode from 'vscode';
import { logger, LogCategory } from '../loggingService';
import { VSCODE_CONFIG } from '@extension/utils';

/**
 * Consent levels for data collection.
 */
export enum ConsentLevel {
    /** User has not yet made a decision */
    Pending = 'pending',
    /** User explicitly declined data collection */
    Declined = 'declined',
    /** User consented to basic (anonymized) data collection */
    Basic = 'basic',
    /** User consented to extended data collection (detailed recordings) */
    Extended = 'extended',
}

/**
 * Service that manages user consent for data collection.
 * Provides a startup notification when consent is pending and allows
 * programmatic access to the current consent level.
 */
export class ConsentService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    private readonly _onConsentChanged = new vscode.EventEmitter<ConsentLevel>();
    public readonly onConsentChanged = this._onConsentChanged.event;

    constructor() {
        this._initialize();
    }

    public dispose(): void {
        this._onConsentChanged.dispose();
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }
    }

    /**
     * Returns the current consent level from configuration.
     */
    public get consentLevel(): ConsentLevel {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const value = config.get<string>(VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY, ConsentLevel.Pending);
        return this._parseConsentLevel(value);
    }

    /**
     * Returns true if extended data collection is enabled.
     */
    public get isExtendedCollectionEnabled(): boolean {
        return this.consentLevel === ConsentLevel.Extended;
    }

    private _initialize(): void {
        // Listen for configuration changes
        const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY}`)) {
                const newLevel = this.consentLevel;
                logger.info(`Data collection consent changed to: ${newLevel}`, LogCategory.GENERAL);
                this._onConsentChanged.fire(newLevel);
            }
        });
        this._disposables.push(configListener);
    }

    /**
     * Shows a notification prompting the user for consent if they haven't decided yet.
     * Does nothing if consent is already set to declined, basic, or extended.
     */
    public async promptIfPending(): Promise<void> {
        if (this.consentLevel !== ConsentLevel.Pending) {
            return;
        }

        const message = 'Help improve Iris by sharing anonymous usage data. You can change this anytime in Settings.';

        const selection = await vscode.window.showInformationMessage(
            message,
            'Accept',
            'Decline',
            'Settings'
        );

        if (selection === 'Accept') {
            await this.setConsent(ConsentLevel.Basic);
            logger.info('User accepted basic data collection', LogCategory.GENERAL);
        } else if (selection === 'Decline') {
            await this.setConsent(ConsentLevel.Declined);
            logger.info('User declined data collection', LogCategory.GENERAL);
        } else if (selection === 'Settings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                `${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY}`
            );
        }
        // If dismissed (selection is undefined), do nothing - will prompt again next time
    }

    /**
     * Programmatically sets the consent level.
     */
    public async setConsent(level: ConsentLevel): Promise<void> {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        await config.update(VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY, level, vscode.ConfigurationTarget.Global);
    }

    private _parseConsentLevel(value: string): ConsentLevel {
        switch (value) {
            case 'declined':
                return ConsentLevel.Declined;
            case 'basic':
                return ConsentLevel.Basic;
            case 'extended':
                return ConsentLevel.Extended;
            case 'pending':
            default:
                return ConsentLevel.Pending;
        }
    }
}
