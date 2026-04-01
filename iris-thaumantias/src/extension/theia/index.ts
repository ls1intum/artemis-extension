export type { TheiaEnvironment, PlatformCapabilities } from './types';
export { VSCODE_ENVIRONMENT } from './types';
export { detectTheiaEnvironment } from './theiaEnvironment';
export { detectPlatformCapabilities } from './featureDetection';
export { readEnvVar, readEnvVars } from './envVarReader';
export { authenticateFromEnvironment } from './theiaAuthProvider';
export { cloneRepositoryProgrammatic, autoCloneIfNeeded, configureGitIdentityFromEnv } from './theiaCloneService';
