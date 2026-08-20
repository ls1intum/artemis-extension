/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { resetTestState } from './resetStores';
import { createMockVsCodeApi } from './vscodeApi';

beforeEach(() => {
	resetTestState();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const mockVsCodeApi = createMockVsCodeApi();

// configurable:true so resetTestState() can redefine it for each test.
Object.defineProperty(global.window, 'acquireVsCodeApi', {
	writable: true,
	configurable: true,
	value: () => mockVsCodeApi,
});
