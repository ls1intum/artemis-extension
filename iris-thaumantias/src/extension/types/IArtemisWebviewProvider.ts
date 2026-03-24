/**
 * Minimal interface for ArtemisWebviewProvider as consumed by ProviderRegistry.
 * Extracted to sever the circular import: artemisWebviewProvider -> ProviderRegistry.
 * Currently empty — ProviderRegistry stores and retrieves the provider but callers
 * do not call methods on it through the registry getter.
 */
export interface IArtemisWebviewProvider {
    // Intentionally empty: ProviderRegistry stores and retrieves the provider but callers
    // do not call methods on it through the registry getter.
}
