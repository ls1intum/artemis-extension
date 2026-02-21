import { ArtemisUser } from './core';

// --- WebView Messages ---

export class WebviewMessage {
    constructor(
        public readonly command: string,
    ) {}

    static fromJSON(data: unknown): WebviewMessage {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid WebviewMessage data');
        }
        const d = data as Record<string, unknown>;
        return new WebviewMessage(String(d.command));
    }
}

export class LoginMessage extends WebviewMessage {
    constructor(
        public readonly username: string,
        public readonly password: string,
        public readonly rememberMe: boolean,
    ) {
        super('login');
    }

    static override fromJSON(data: unknown): LoginMessage {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid LoginMessage data');
        }
        const d = data as Record<string, unknown>;
        return new LoginMessage(
            String(d.username),
            String(d.password),
            Boolean(d.rememberMe),
        );
    }
}

export class LogoutMessage extends WebviewMessage {
    constructor() {
        super('logout');
    }

    static override fromJSON(data: unknown): LogoutMessage {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid LogoutMessage data');
        }
        return new LogoutMessage();
    }
}

export class LoginSuccessMessage extends WebviewMessage {
    constructor(
        public readonly username: string,
        public readonly serverUrl: string,
        public readonly user?: ArtemisUser,
    ) {
        super('loginSuccess');
    }

    static override fromJSON(data: unknown): LoginSuccessMessage {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid LoginSuccessMessage data');
        }
        const d = data as Record<string, unknown>;
        return new LoginSuccessMessage(
            String(d.username),
            String(d.serverUrl),
            d.user && typeof d.user === 'object' ? ArtemisUser.fromJSON(d.user) : undefined,
        );
    }
}

export class LoginErrorMessage extends WebviewMessage {
    constructor(
        public readonly error: string,
    ) {
        super('loginError');
    }

    static override fromJSON(data: unknown): LoginErrorMessage {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid LoginErrorMessage data');
        }
        const d = data as Record<string, unknown>;
        return new LoginErrorMessage(String(d.error));
    }
}

export class LogoutSuccessMessage extends WebviewMessage {
    constructor() {
        super('logoutSuccess');
    }

    static override fromJSON(data: unknown): LogoutSuccessMessage {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid LogoutSuccessMessage data');
        }
        return new LogoutSuccessMessage();
    }
}
