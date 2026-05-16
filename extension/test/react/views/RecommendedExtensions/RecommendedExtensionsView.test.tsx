import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecommendedExtensionsView } from '@webview/views/RecommendedExtensions/RecommendedExtensionsView';
import type { ExtensionCategory } from '@webview/views/RecommendedExtensions/types';

import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';

function makeCategory(overrides: Partial<ExtensionCategory> = {}): ExtensionCategory {
	return {
		id: 'test-cat',
		name: 'Test Category',
		description: 'A test category',
		extensions: [
			{
				id: 'test.ext1',
				name: 'Test Extension 1',
				publisher: 'Test Publisher',
				description: 'A useful extension',
				reason: 'Makes things easier',
				isInstalled: false,
			},
		],
		...overrides,
	};
}

describe('RecommendedExtensionsView', () => {
	it('renders back link to Dashboard', () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);
		expect(screen.getByText('Back to Dashboard')).toBeInTheDocument();
	});

	it('clicking back link sends backToDashboard postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByText('Back to Dashboard'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToDashboard',
			})
		);
	});

	it('shows empty state when recommendedExtensionsInit received with empty categories', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [],
		});

		await waitFor(() => {
			expect(screen.getByText('No recommended extensions available')).toBeInTheDocument();
		});
	});

	it('displays extension list from recommendedExtensionsInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		const category = makeCategory();
		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [category],
		});

		await waitFor(() => {
			expect(screen.getByText('Test Extension 1')).toBeInTheDocument();
		});
	});

	it('shows extension name and description', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [makeCategory()],
		});

		await waitFor(() => {
			expect(screen.getByText('A useful extension')).toBeInTheDocument();
		});
	});

	it('shows "Not installed" badge for non-installed extension', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [makeCategory()],
		});

		await waitFor(() => {
			expect(screen.getByText('Not installed')).toBeInTheDocument();
		});
	});

	it('shows "Installed" badge for installed extension', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		const category = makeCategory({
			extensions: [{
				id: 'test.installed',
				name: 'Installed Extension',
				publisher: 'Publisher',
				description: 'Already installed',
				reason: 'For testing',
				isInstalled: true,
			}],
		});

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [category],
		});

		await waitFor(() => {
			expect(screen.getByText('Installed')).toBeInTheDocument();
		});
	});

	it('View in Marketplace button sends searchMarketplace postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [makeCategory()],
		});

		await waitFor(() => {
			expect(screen.getByText('View in Marketplace')).toBeInTheDocument();
		});

		await userEvent.click(screen.getByText('View in Marketplace'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'searchMarketplace',
				payload: expect.objectContaining({ extensionId: 'test.ext1' }),
			})
		);
	});

	it('shows category filter buttons when categories are loaded', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [
				makeCategory({ id: 'cat1', name: 'Category 1' }),
				makeCategory({ id: 'cat2', name: 'Category 2', extensions: [] }),
			],
		});

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'All categories' })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Category 1' })).toBeInTheDocument();
		});
	});

	it('clicking category filter filters extension list', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [
				makeCategory({ id: 'cat1', name: 'Category 1', extensions: [
					{ id: 'ext1', name: 'Ext One', publisher: 'P', description: 'D', reason: 'R', isInstalled: false },
				]}),
				makeCategory({ id: 'cat2', name: 'Category 2', extensions: [
					{ id: 'ext2', name: 'Ext Two', publisher: 'P', description: 'D', reason: 'R', isInstalled: false },
				]}),
			],
		});

		await waitFor(() => {
			expect(screen.getByText('Ext One')).toBeInTheDocument();
			expect(screen.getByText('Ext Two')).toBeInTheDocument();
		});

		// Filter to Category 1 only
		await userEvent.click(screen.getByRole('button', { name: 'Category 1' }));

		expect(screen.getByText('Ext One')).toBeInTheDocument();
		expect(screen.queryByText('Ext Two')).not.toBeInTheDocument();
	});

	it('shows "Recommended Extensions" header once categories are loaded', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [makeCategory()],
		});

		await waitFor(() => {
			expect(screen.getByText('Recommended Extensions')).toBeInTheDocument();
		});
	});

	it('shows Optional badge for optional extensions', async () => {
		const mockApi = createMockVsCodeApi();
		render(<RecommendedExtensionsView vscodeApi={mockApi} />);

		const category = makeCategory({
			extensions: [{
				id: 'opt.ext',
				name: 'Optional Extension',
				publisher: 'Pub',
				description: 'An optional one',
				reason: 'Nice to have',
				isInstalled: false,
				optional: true,
			}],
		});

		dispatchExtensionMessage({
			type: 'recommendedExtensionsInit',
			categories: [category],
		});

		await waitFor(() => {
			expect(screen.getByText('Optional')).toBeInTheDocument();
		});
	});
});
