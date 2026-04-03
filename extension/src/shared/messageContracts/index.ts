/**
 * Message contracts for typed extension-webview communication.
 *
 * Uses const object + Payload Map pattern: a single source of truth that
 * auto-generates discriminated unions for both directions.
 *
 * Adding a new message = add const entry + payload entry (compiler enforces completeness).
 */

export * from './domainTypes';
export * from './domainMappers';
export * from './extensionMessages';
export * from './webviewCommands';
export * from './typeGuards';
