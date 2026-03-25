import type { ArtemisUser } from './core';
import { parseArtemisUser } from './core';

export const PROFILE_IRIS = 'iris';

// --- Server Profile ---

export interface ProfileInfo {
    readonly activeProfiles: string[];
    readonly activeModuleFeatures: string[];
    readonly ribbonEnv?: string;
    readonly inProduction?: boolean;
    readonly openApiEnabled?: boolean;
}

export function parseProfileInfo(data: unknown): ProfileInfo {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ProfileInfo data');
    }
    const d = data as Record<string, unknown>;
    return {
        activeProfiles: Array.isArray(d.activeProfiles) ? d.activeProfiles.map(String) : [],
        activeModuleFeatures: Array.isArray(d.activeModuleFeatures) ? d.activeModuleFeatures.map(String) : [],
        ribbonEnv: typeof d.ribbonEnv === 'string' ? d.ribbonEnv : undefined,
        inProduction: typeof d.inProduction === 'boolean' ? d.inProduction : undefined,
        openApiEnabled: typeof d.openApiEnabled === 'boolean' ? d.openApiEnabled : undefined,
    };
}

// --- Authentication ---

export interface LoginCredentials {
    readonly username: string;
    readonly password: string;
    readonly rememberMe?: boolean;
}

export interface AuthenticationResult {
    readonly success: boolean;
    readonly token?: string;
    readonly cookie?: string;
    readonly user?: ArtemisUser;
}

export function parseAuthenticationResult(data: unknown): AuthenticationResult {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid AuthenticationResult data');
    }
    const d = data as Record<string, unknown>;
    return {
        success: Boolean(d.success),
        token: typeof d.token === 'string' ? d.token : undefined,
        cookie: typeof d.cookie === 'string' ? d.cookie : undefined,
        user: d.user && typeof d.user === 'object' ? parseArtemisUser(d.user) : undefined,
    };
}
