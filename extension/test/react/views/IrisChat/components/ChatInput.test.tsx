import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../../../../../src/webview/views/IrisChat/components/ChatInput';

describe('ChatInput', () => {
	it('renders a textarea element', () => {
		render(<ChatInput onSend={vi.fn()} disabled={false} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		expect(textarea).toBeInTheDocument();
	});

	it('renders with default placeholder when not disabled', () => {
		render(<ChatInput onSend={vi.fn()} disabled={false} />);
		const textarea = screen.getByPlaceholderText('Ask Iris anything...');
		expect(textarea).toBeInTheDocument();
	});

	it('renders with custom placeholder', () => {
		render(<ChatInput onSend={vi.fn()} disabled={false} placeholder="Type here..." />);
		expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
	});

	it('renders disabled placeholder when disabled', () => {
		render(<ChatInput onSend={vi.fn()} disabled={true} />);
		expect(
			screen.getByPlaceholderText('Select a course or exercise to start chatting')
		).toBeInTheDocument();
	});

	it('calls onSend when Enter pressed with content', async () => {
		const onSend = vi.fn();
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello{Enter}');

		expect(onSend).toHaveBeenCalledOnce();
		expect(onSend).toHaveBeenCalledWith('Hello');
	});

	it('does NOT call onSend on Shift+Enter (inserts newline instead)', async () => {
		const onSend = vi.fn();
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello{Shift>}{Enter}{/Shift}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('clears input after successful send via Enter', async () => {
		render(<ChatInput onSend={vi.fn()} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' }) as HTMLTextAreaElement;
		await userEvent.type(textarea, 'Hello{Enter}');

		expect(textarea.value).toBe('');
	});

	it('does not send empty message on Enter', async () => {
		const onSend = vi.fn();
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, '{Enter}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('does not send whitespace-only message', async () => {
		const onSend = vi.fn();
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, '   {Enter}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('send button is disabled when input is empty', () => {
		render(<ChatInput onSend={vi.fn()} disabled={false} />);
		const sendButton = screen.getByRole('button', { name: 'Send message' });
		expect(sendButton).toBeDisabled();
	});

	it('send button is enabled when input has content', async () => {
		render(<ChatInput onSend={vi.fn()} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello');

		const sendButton = screen.getByRole('button', { name: 'Send message' });
		expect(sendButton).not.toBeDisabled();
	});

	it('calls onSend when send button is clicked', async () => {
		const onSend = vi.fn();
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello');

		const sendButton = screen.getByRole('button', { name: 'Send message' });
		await userEvent.click(sendButton);

		expect(onSend).toHaveBeenCalledOnce();
		expect(onSend).toHaveBeenCalledWith('Hello');
	});

	it('clears input after send button click', async () => {
		render(<ChatInput onSend={vi.fn()} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' }) as HTMLTextAreaElement;
		await userEvent.type(textarea, 'Hello');
		const sendButton = screen.getByRole('button', { name: 'Send message' });
		await userEvent.click(sendButton);

		expect(textarea.value).toBe('');
	});

	it('disables textarea when disabled prop is true', () => {
		render(<ChatInput onSend={vi.fn()} disabled={true} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		expect(textarea).toBeDisabled();
	});

	it('does not send when disabled, even with Enter', async () => {
		const onSend = vi.fn();
		render(<ChatInput onSend={onSend} disabled={true} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		// Even if we somehow type into disabled textarea, it shouldn't send
		await userEvent.type(textarea, 'Hello{Enter}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('trims whitespace before sending', async () => {
		const onSend = vi.fn();
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, '  Hello  {Enter}');

		expect(onSend).toHaveBeenCalledWith('Hello');
	});

	it('renders send button with SVG icon', () => {
		render(<ChatInput onSend={vi.fn()} disabled={false} />);
		const sendButton = screen.getByRole('button', { name: 'Send message' });
		const svg = sendButton.querySelector('svg');
		expect(svg).toBeInTheDocument();
	});
});
