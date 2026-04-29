export type { PlatformCapabilities } from './types';
export { initializeTheiaContext, getTheiaEnvironment } from './theiaEnvironment';
export { detectPlatformCapabilities } from './featureDetection';
export { readEnvVar } from './envVarReader';
export { probeDataBridge, KNOWN_BRIDGE_KEYS } from './dataBridgeReader';
export type { DataBridgeProbeResult, KnownBridgeKey } from './dataBridgeReader';
export { authenticateFromEnvironment } from './theiaAuthProvider';
export { cloneRepositoryProgrammatic, autoCloneIfNeeded } from './theiaCloneService';
