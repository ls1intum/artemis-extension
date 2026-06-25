import * as vscode from 'vscode';

import { CONFIG } from '@extension/utils';

/** The in-flight state of a browser-delegated login, persisted between opening the browser and the callback. */
export interface PendingExternalLogin {
    /** The PKCE code verifier; possession of it authorizes the code exchange. Sensitive. */
    verifier: string;
    /** The anti-forgery state echoed back via the callback. */
    state: string;
    /** Epoch millis when the flow was started, used to expire abandoned flows. */
    createdAt: number;
    /** The server URL active when the flow started, to detect a mid-flow settings change. */
    serverUrl: string;
}

// Generous window covering the whole browser login (which includes the user typing credentials / using
// a passkey). The server-side one-time code has its own short TTL once it is actually issued.
const TTL_MS = 10 * 60 * 1000;

/**
 * Persists the in-flight browser-login state in {@link vscode.SecretStorage}. The verifier is
 * security-sensitive, so SecretStorage (encrypted at rest) is used rather than globalState.
 */
export class PendingExternalLoginStore {
    constructor(private readonly context: vscode.ExtensionContext) {}

    async save(pending: PendingExternalLogin): Promise<void> {
        await this.context.secrets.store(CONFIG.SECRET_KEYS.PENDING_EXTERNAL_LOGIN, JSON.stringify(pending));
    }

    async load(): Promise<PendingExternalLogin | undefined> {
        const raw = await this.context.secrets.get(CONFIG.SECRET_KEYS.PENDING_EXTERNAL_LOGIN);
        if (!raw) {
            return undefined;
        }
        try {
            return JSON.parse(raw) as PendingExternalLogin;
        } catch {
            return undefined;
        }
    }

    async clear(): Promise<void> {
        await this.context.secrets.delete(CONFIG.SECRET_KEYS.PENDING_EXTERNAL_LOGIN);
    }

    isExpired(pending: PendingExternalLogin, now: number = Date.now()): boolean {
        return now - pending.createdAt > TTL_MS;
    }
}
