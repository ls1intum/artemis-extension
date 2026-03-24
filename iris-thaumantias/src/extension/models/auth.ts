import { ArtemisUser } from './core';

export const PROFILE_IRIS = 'iris';

// --- Server Profile ---

export class ProfileInfo {
    constructor(
        public readonly activeProfiles: string[],
        public readonly activeModuleFeatures: string[],
        public readonly ribbonEnv?: string,
        public readonly inProduction?: boolean,
        public readonly openApiEnabled?: boolean,
    ) {}

    static fromJSON(data: unknown): ProfileInfo {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ProfileInfo data');
        }
        const d = data as Record<string, unknown>;
        return new ProfileInfo(
            Array.isArray(d.activeProfiles) ? d.activeProfiles.map(String) : [],
            Array.isArray(d.activeModuleFeatures) ? d.activeModuleFeatures.map(String) : [],
            typeof d.ribbonEnv === 'string' ? d.ribbonEnv : undefined,
            typeof d.inProduction === 'boolean' ? d.inProduction : undefined,
            typeof d.openApiEnabled === 'boolean' ? d.openApiEnabled : undefined,
        );
    }
}

// --- Authentication ---

export class LoginCredentials {
    constructor(
        public readonly username: string,
        public readonly password: string,
        public readonly rememberMe?: boolean,
    ) {}
}

export class AuthenticationResult {
    constructor(
        public readonly success: boolean,
        public readonly token?: string,
        public readonly cookie?: string,
        public readonly user?: ArtemisUser,
    ) {}

    static fromJSON(data: unknown): AuthenticationResult {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid AuthenticationResult data');
        }
        const d = data as Record<string, unknown>;
        return new AuthenticationResult(
            Boolean(d.success),
            typeof d.token === 'string' ? d.token : undefined,
            typeof d.cookie === 'string' ? d.cookie : undefined,
            d.user && typeof d.user === 'object' ? ArtemisUser.fromJSON(d.user) : undefined,
        );
    }
}
