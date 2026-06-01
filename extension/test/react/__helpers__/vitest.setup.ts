/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { resetTestState } from './resetStores';
import { createMockVsCodeApi } from './vscodeApi';

// Reset all Zustand stores and VS Code API mock before each test
beforeEach(() => {
	resetTestState();
});

// Cleanup after each test
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

// Create default mock VS Code API
const mockVsCodeApi = createMockVsCodeApi();

// Define window.acquireVsCodeApi globally — configurable:true so resetTestState() can redefine it each test
Object.defineProperty(global.window, 'acquireVsCodeApi', {
	writable: true,
	configurable: true,
	value: () => mockVsCodeApi,
});
