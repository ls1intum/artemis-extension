export const PROFILE_IRIS = 'iris';

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

export interface AuthenticationResult {
    readonly success: boolean;
    /** The cookie string the server issued, for the caller to validate and then commit. */
    readonly token: string;
}
export type LoginMethod = 'PASSWORD' | 'OIDC' | 'SAML2'
export interface LoginOptionsResponse {
    loginMethod: LoginMethod;
    idpName: string;
}
