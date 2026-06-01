export { AuthFlowHandler } from './authFlowHandler';
export { AuthManager } from './authManager';
// NOTE: ConsentService is intentionally NOT re-exported here. It must be imported
// directly from './consentService' so the Open VSX (clean) build, which only pulls
// AuthManager/AuthFlowHandler from this barrel, never drags consentService.ts into
// the bundle. Import it via '@extension/services/auth/consentService'.
