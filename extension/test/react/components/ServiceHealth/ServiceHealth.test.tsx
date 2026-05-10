import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceHealth, ServiceInfo } from '../../../../src/webview/components/ServiceHealth/ServiceHealth';

const onlineService: ServiceInfo = {
	name: 'Artemis API',
	status: 'online',
	message: 'Connected',
	endpoint: 'https://artemis.example.com/api',
	httpStatus: '200',
};

const offlineService: ServiceInfo = {
	name: 'Iris AI',
	status: 'offline',
	message: 'Disconnected',
};

const checkingService: ServiceInfo = {
	name: 'WebSocket',
	status: 'checking',
	message: 'Checking...',
};

describe('ServiceHealth', () => {
	it('renders service names', () => {
		render(<ServiceHealth services={[onlineService, offlineService]} />);
		expect(screen.getByText('Artemis API')).toBeInTheDocument();
		expect(screen.getByText('Iris AI')).toBeInTheDocument();
	});

	it('renders service status messages', () => {
		render(<ServiceHealth services={[onlineService]} />);
		expect(screen.getByText('Connected')).toBeInTheDocument();
	});

	it('shows title by default', () => {
		render(<ServiceHealth services={[onlineService]} />);
		expect(screen.getByText(/Service Health Checks/)).toBeInTheDocument();
	});

	it('hides title when showTitle is false', () => {
		render(<ServiceHealth services={[onlineService]} showTitle={false} />);
		expect(screen.queryByText(/Service Health Checks/)).not.toBeInTheDocument();
	});

	it('shows "Check Status" refresh button when onRefresh provided', () => {
		render(<ServiceHealth services={[onlineService]} onRefresh={vi.fn()} />);
		expect(screen.getByRole('button', { name: /Check Status/ })).toBeInTheDocument();
	});

	it('calls onRefresh when Check Status button clicked', async () => {
		const handleRefresh = vi.fn();
		render(<ServiceHealth services={[onlineService]} onRefresh={handleRefresh} />);

		await userEvent.click(screen.getByRole('button', { name: /Check Status/ }));

		expect(handleRefresh).toHaveBeenCalledOnce();
	});

	it('disables refresh button and shows "Checking..." when isRefreshing', () => {
		render(<ServiceHealth services={[onlineService]} onRefresh={vi.fn()} isRefreshing />);
		const button = screen.getByRole('button', { name: /Checking/ });
		expect(button).toBeDisabled();
	});

	it('shows expanded service details when service item clicked', async () => {
		render(<ServiceHealth services={[onlineService]} />);

		await userEvent.click(screen.getByText('Artemis API'));

		expect(screen.getByText('Endpoint:')).toBeInTheDocument();
		expect(screen.getByText('https://artemis.example.com/api')).toBeInTheDocument();
		expect(screen.getByText('HTTP Status:')).toBeInTheDocument();
	});

	it('collapses service details when clicked again', async () => {
		render(<ServiceHealth services={[onlineService]} />);

		// Click to expand
		await userEvent.click(screen.getByText('Artemis API'));
		expect(screen.getByText('Endpoint:')).toBeInTheDocument();

		// Click again to collapse
		await userEvent.click(screen.getByText('Artemis API'));
		expect(screen.queryByText('Endpoint:')).not.toBeInTheDocument();
	});

	it('shows last checked time', () => {
		render(<ServiceHealth services={[onlineService]} lastCheckTime={new Date('2024-01-01T12:00:00')} />);
		expect(screen.getByText(/Last checked:/)).toBeInTheDocument();
	});

	it('shows "Never" when no lastCheckTime provided', () => {
		render(<ServiceHealth services={[onlineService]} />);
		expect(screen.getByText(/Last checked: Never/)).toBeInTheDocument();
	});

	it('renders multiple services independently', () => {
		render(<ServiceHealth services={[onlineService, offlineService, checkingService]} />);
		expect(screen.getByText('Artemis API')).toBeInTheDocument();
		expect(screen.getByText('Iris AI')).toBeInTheDocument();
		expect(screen.getByText('WebSocket')).toBeInTheDocument();
	});
});
