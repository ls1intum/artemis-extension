export { AuthCancellationService } from './authCancellationService';
export { AuthFlowHandler } from './authFlowHandler';
export { AuthManager } from './authManager';
export { LoginCancelledError } from './loginCancelledError';
export { OidcLoginService } from './oidcLoginService';
// NOTE: ConsentService is intentionally NOT re-exported here. It must be imported
// directly from './consentService' so the Open VSX (clean) build, which only pulls
// AuthManager/AuthFlowHandler from this barrel, never drags consentService.ts into
// the bundle. Import it via '@extension/services/auth/consentService'.
