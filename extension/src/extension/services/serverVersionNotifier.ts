import { isSupportedVersion, MIN_ARTEMIS_VERSION, parseProfileInfo } from '@extension/domain';
import { LogCategory, logger } from '@extension/services/loggingService';
import { normalizeServerUrl } from '@extension/services/session/identityKeys';
import { CONFIG } from '@extension/utils';

export interface ServerVersionNotifierDeps {
    /**
     * An UNAUTHENTICATED GET. Never `makeRequest` or `getProfileInfo`: their 401
     * branch clears the stored credential and fires the auth-expired handler
     * (`artemisApi.ts:106-125`), and this check runs beside a fresh sign-in. A
     * diagnostic must not be able to sign the user out.
     *
     * Takes `init` rather than building it here on purpose: that is what lets the
     * test assert no headers are sent. With a URL-only dependency the decision
     * would live in the caller, where no test of this class could see it.
     */
    fetchInfo(url: string, init: RequestInit): Promise<Response>;
    showWarning(message: string): void;
}

/**
 * Tells the user once when their Artemis is too old for this extension.
 *
 * The unit is one normalized server URL per extension-host session, so switching
 * `artemis.serverUrl` and signing in elsewhere is checked again while repeated
 * navigation to the same server is not.
 */
export class ServerVersionNotifier {
    private readonly _inFlight = new Map<string, Promise<void>>();

    constructor(private readonly _deps: ServerVersionNotifierDeps) { }

    /** Fire and forget. Never throws, never delays its caller. */
    public check(rawServerUrl: string): void {
        const key = normalizeServerUrl(rawServerUrl);
        if (key === null || this._inFlight.has(key)) {
            return;
        }

        // The slot is reserved before _probe can run at all. Calling
        // `this._probe(key)` directly would execute its body up to the first
        // await BEFORE the set() below, so a reentrant fetchInfo could slip past
        // the has() check above. Deferring to a microtask closes that window.
        const run = Promise.resolve().then(() => this._probe(key));
        this._inFlight.set(key, run);

        void run.catch((error: unknown) => {
            // A probe that never answered says nothing about the version, so it
            // must not consume the one attempt. Withdrawn only if this is still
            // the current entry, so an older failure cannot clear a newer try.
            if (this._inFlight.get(key) === run) {
                this._inFlight.delete(key);
            }
            logger.warn('Could not determine the Artemis server version', LogCategory.API, error);
        });
    }

    private async _probe(serverUrl: string): Promise<void> {
        // No headers. Not a Cookie, not an Authorization. This is the one line
        // the notifier exists to keep honest, and its test asserts on it.
        const response = await this._deps.fetchInfo(
            `${serverUrl}${CONFIG.API.ENDPOINTS.MANAGEMENT_INFO}`,
            { method: 'GET' },
        );
        if (!response.ok) {
            // Explicit, because falling through would look like a successful
            // check that simply found no version, which reads as "supported".
            throw new Error(`${CONFIG.API.ENDPOINTS.MANAGEMENT_INFO} answered ${response.status}`);
        }

        const info = parseProfileInfo(await response.json());
        if (isSupportedVersion(info.serverVersion)) {
            return;
        }

        this._deps.showWarning(
            `This Artemis server runs version ${info.serverVersion}. `
            + `The extension needs ${MIN_ARTEMIS_VERSION} or newer. Course contents will not load.`,
        );
    }
}
