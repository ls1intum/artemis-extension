export type { PlatformCapabilities } from './types';
export { initializeTheiaContext, getTheiaEnvironment } from './theiaEnvironment';
export { detectPlatformCapabilities } from './featureDetection';
export { probeDataBridge, KNOWN_BRIDGE_KEYS } from './dataBridgeReader';
export { authenticateFromEnvironment } from './theiaAuthProvider';
export { cloneRepositoryProgrammatic, autoCloneIfNeeded } from './theiaCloneService';
