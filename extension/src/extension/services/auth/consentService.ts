import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';
import { VSCODE_CONFIG } from '@extension/utils';

export enum ConsentLevel {
    /** User has not yet made a decision */
    Pending = 'pending',
    /** User explicitly declined data collection */
    Declined = 'declined',
    /** User consented to data collection: detailed session recordings for the study */
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

    /** Read live from configuration, never cached. */
    public get consentLevel(): ConsentLevel {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const value = config.get<string>(VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY, ConsentLevel.Pending);
        return this._parseConsentLevel(value);
    }

    public get isExtendedCollectionEnabled(): boolean {
        return this.consentLevel === ConsentLevel.Extended;
    }

    private _initialize(): void {
        const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY}`)) {
                const newLevel = this.consentLevel;
                logger.info(`Data collection consent changed to: ${newLevel}`, LogCategory.GENERAL);
                this._onConsentChanged.fire(newLevel);
            }
        });
        this._disposables.push(configListener);
    }

    /** Prompts only while consent is still `Pending`. */
    public async promptIfPending(): Promise<void> {
        if (this.consentLevel !== ConsentLevel.Pending) {
            return;
        }

        // Names what is actually written, including the two a student would not guess: whole-file
        // snapshots (snapshots/snapshotManager.ts) and terminal output (TerminalCommandEvent.output).
        // "Recording", not "sharing": the recorder writes to globalStorageUri and the extension has
        // no upload path, so the copy must not imply one.
        const message = 'Help improve Iris by recording your exercise sessions for research: your edits and the contents of your files, builds, terminal commands and their output, and your Iris chats. The recording is stored on this computer. You can change this anytime in Settings.';

        const selection = await vscode.window.showInformationMessage(
            message,
            'Accept',
            'Decline',
            'Settings'
        );

        if (selection === 'Accept') {
            await this.setConsent(ConsentLevel.Extended);
            logger.info('User accepted data collection', LogCategory.GENERAL);
        } else if (selection === 'Decline') {
            await this.setConsent(ConsentLevel.Declined);
            logger.info('User declined data collection', LogCategory.GENERAL);
        } else if (selection === 'Settings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                `${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY}`
            );
        }
        // Dismissed (selection undefined): leave it Pending so the next startup prompts again.
    }

    public async setConsent(level: ConsentLevel): Promise<void> {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        await config.update(VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY, level, vscode.ConfigurationTarget.Global);
    }

    private _parseConsentLevel(value: string): ConsentLevel {
        switch (value) {
            case 'declined':
                return ConsentLevel.Declined;
            // Legacy: `basic` was offered by an earlier prompt but gated nothing, so a profile
            // carrying it consented to no collection that ever ran. It must not be promoted to the
            // level that does record, and reading it as declined would be just as wrong: that was a
            // yes, to terms that no longer exist. Pending asks again, with copy that says what is
            // recorded, which is the only route by which such a profile can take part at all.
            case 'basic':
                return ConsentLevel.Pending;
            case 'extended':
                return ConsentLevel.Extended;
            case 'pending':
            default:
                return ConsentLevel.Pending;
        }
    }
}
