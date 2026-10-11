export const PROFILE_IRIS = 'iris';

export interface ProfileInfo {
    readonly activeProfiles: string[];
    readonly activeModuleFeatures: string[];
    /** Artemis' own `build.version`, e.g. "9.9.2". Absent on a server that does not report one. */
    readonly serverVersion?: string;
    readonly buildName?: string;
    readonly buildArtifact?: string;
    readonly ribbonEnv?: string;
    readonly inProduction?: boolean;
    readonly openApiEnabled?: boolean;
    readonly saml2?: Saml2Config;
}

export interface Saml2Config {
    readonly enablePassword?: boolean;
    readonly buttonLabel?: string;
    readonly identityProviderName?: string;
}

export function parseProfileInfo(data: unknown): ProfileInfo {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ProfileInfo data');
    }
    const d = data as Record<string, unknown>;
    return {
        activeProfiles: Array.isArray(d.activeProfiles) ? d.activeProfiles.map(String) : [],
        activeModuleFeatures: Array.isArray(d.activeModuleFeatures) ? d.activeModuleFeatures.map(String) : [],
        serverVersion: readBuildVersion(d.build),
        buildName: readBuildName(d.build),
        buildArtifact: readBuildArtifact(d.build),
        ribbonEnv: typeof d.ribbonEnv === 'string' ? d.ribbonEnv : undefined,
        inProduction: typeof d.inProduction === 'boolean' ? d.inProduction : undefined,
        openApiEnabled: typeof d.openApiEnabled === 'boolean' ? d.openApiEnabled : undefined,
        saml2: readSaml2(d.saml2),
    };
}

function readSaml2(saml2: unknown): Saml2Config | undefined {
    if (!saml2 || typeof saml2 !== 'object') {
        return undefined;
    }
    const s = saml2 as Record<string, unknown>;
    return {
        enablePassword: typeof s.enablePassword === 'boolean' ? s.enablePassword : undefined,
        buttonLabel: typeof s.buttonLabel === 'string' ? s.buttonLabel : undefined,
        identityProviderName: typeof s.identityProviderName === 'string' ? s.identityProviderName : undefined,
    };
}

function readBuildVersion(build: unknown): string | undefined {
    if (!build || typeof build !== 'object') {
        return undefined;
    }
    const version = (build as Record<string, unknown>).version;
    return typeof version === 'string' ? version : undefined;
}

function readBuildName(build: unknown): string | undefined {
    if (!build || typeof build !== 'object') {
        return undefined;
    }
    const name = (build as Record<string, unknown>).name;
    return typeof name === 'string' ? name : undefined;
}

function readBuildArtifact(build: unknown): string | undefined {
    if (!build || typeof build !== 'object') {
        return undefined;
    }
    const artifact = (build as Record<string, unknown>).artifact;
    return typeof artifact === 'string' ? artifact : undefined;
}

export interface AuthenticationResult {
    readonly success: boolean;
    /** The cookie string the server issued, for the caller to validate and then commit. */
    readonly token: string;
}
export type LoginMethod = 'PASSWORD' | 'OIDC' | 'SAML2';

export interface LoginOptionsResponse {
    loginMethod: LoginMethod;
    /** Null for accounts that sign in with a password, so the client supplies its own label. */
    idpName: string | null;
}
