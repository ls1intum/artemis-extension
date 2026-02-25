/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { createMockVsCodeApi } from './vscodeApi';

// Cleanup after each test
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

// Create default mock VS Code API
const mockVsCodeApi = createMockVsCodeApi();

// Define window.acquireVsCodeApi globally
Object.defineProperty(global.window, 'acquireVsCodeApi', {
	writable: true,
	value: () => mockVsCodeApi,
});
