import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatInput } from '@webview/views/IrisChat/components/ChatInput';

describe('ChatInput', () => {
	it('renders a textarea element', () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		expect(textarea).toBeInTheDocument();
	});

	it('renders with default placeholder when not disabled', () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} />);
		const textarea = screen.getByPlaceholderText('Ask Iris anything...');
		expect(textarea).toBeInTheDocument();
	});

	it('renders with custom placeholder', () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} placeholder="Type here..." />);
		expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
	});

	it('renders disabled placeholder when disabled', () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={true} />);
		expect(
			screen.getByPlaceholderText('Select a course or exercise to start chatting')
		).toBeInTheDocument();
	});

	it('calls onSend when Enter pressed with content', async () => {
		const onSend = vi.fn(() => true);
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello{Enter}');

		expect(onSend).toHaveBeenCalledOnce();
		expect(onSend).toHaveBeenCalledWith('Hello');
	});

	it('does NOT call onSend on Shift+Enter (inserts newline instead)', async () => {
		const onSend = vi.fn(() => true);
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello{Shift>}{Enter}{/Shift}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('clears input after successful send via Enter', async () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' }) as HTMLTextAreaElement;
		await userEvent.type(textarea, 'Hello{Enter}');

		expect(textarea.value).toBe('');
	});

	it('keeps the draft when the send is refused', async () => {
		// `canSend` is only as fresh as the last committed render, so an Enter
		// can still reach a funnel that refuses it from live state. Clearing on
		// a refusal deletes text that was never sent and that no failed bubble
		// is carrying either.
		const onSend = vi.fn(() => false);
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' }) as HTMLTextAreaElement;
		await userEvent.type(textarea, 'Hello{Enter}');

		expect(onSend).toHaveBeenCalledWith('Hello');
		expect(textarea.value).toBe('Hello');
	});

	it('does not send empty message on Enter', async () => {
		const onSend = vi.fn(() => true);
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, '{Enter}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('does not send whitespace-only message', async () => {
		const onSend = vi.fn(() => true);
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, '   {Enter}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('send button is disabled when input is empty', () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} />);
		const sendButton = screen.getByRole('button', { name: 'Send message' });
		expect(sendButton).toBeDisabled();
	});

	it('send button is enabled when input has content', async () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello');

		const sendButton = screen.getByRole('button', { name: 'Send message' });
		expect(sendButton).not.toBeDisabled();
	});

	it('calls onSend when send button is clicked', async () => {
		const onSend = vi.fn(() => true);
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello');

		const sendButton = screen.getByRole('button', { name: 'Send message' });
		await userEvent.click(sendButton);

		expect(onSend).toHaveBeenCalledOnce();
		expect(onSend).toHaveBeenCalledWith('Hello');
	});

	it('clears input after send button click', async () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' }) as HTMLTextAreaElement;
		await userEvent.type(textarea, 'Hello');
		const sendButton = screen.getByRole('button', { name: 'Send message' });
		await userEvent.click(sendButton);

		expect(textarea.value).toBe('');
	});

	it('disables textarea when disabled prop is true', () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={true} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		expect(textarea).toBeDisabled();
	});

	it('does not send when disabled, even with Enter', async () => {
		const onSend = vi.fn(() => true);
		render(<ChatInput onSend={onSend} disabled={true} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello{Enter}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('trims whitespace before sending', async () => {
		const onSend = vi.fn(() => true);
		render(<ChatInput onSend={onSend} disabled={false} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, '  Hello  {Enter}');

		expect(onSend).toHaveBeenCalledWith('Hello');
	});

	it('renders send button with SVG icon', () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} />);
		const sendButton = screen.getByRole('button', { name: 'Send message' });
		const svg = sendButton.querySelector('svg');
		expect(svg).toBeInTheDocument();
	});

	it('keeps the textarea editable while only sending is blocked', async () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} sendDisabled={true} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });

		expect(textarea).toBeEnabled();
		await userEvent.type(textarea, 'Draft');
		expect(textarea).toHaveValue('Draft');
	});

	it('disables the send button while sending is blocked, even with text', async () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} sendDisabled={true} />);
		await userEvent.type(screen.getByRole('textbox', { name: 'Chat input' }), 'Draft');

		expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
	});

	it('does not send on Enter while sending is blocked', async () => {
		const onSend = vi.fn(() => true);
		render(<ChatInput onSend={onSend} disabled={false} sendDisabled={true} />);
		await userEvent.type(screen.getByRole('textbox', { name: 'Chat input' }), 'Draft{Enter}');

		expect(onSend).not.toHaveBeenCalled();
	});

	it('keeps the draft when Enter is pressed while sending is blocked', async () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={false} sendDisabled={true} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Draft{Enter}');

		expect(textarea).toHaveValue('Draft');
	});

	it('still disables the textarea when composing is disabled', () => {
		render(<ChatInput onSend={vi.fn(() => true)} disabled={true} sendDisabled={false} />);

		expect(screen.getByRole('textbox', { name: 'Chat input' })).toBeDisabled();
	});

	it('shows the reason on the send button while only sending is blocked', () => {
		render(
			<ChatInput
				onSend={vi.fn(() => true)}
				disabled={false}
				sendDisabled={true}
				sendDisabledLabel="Iris is still answering"
			/>
		);

		expect(screen.getByTitle('Iris is still answering')).toBeInTheDocument();
	});

	it('shows no send reason when composing is disabled too', () => {
		render(
			<ChatInput
				onSend={vi.fn(() => true)}
				disabled={true}
				sendDisabled={true}
				sendDisabledLabel="Iris is still answering"
			/>
		);

		expect(screen.queryByTitle('Iris is still answering')).not.toBeInTheDocument();
	});

	it('describes the textarea with the reason while only sending is blocked', () => {
		const { rerender } = render(
			<ChatInput
				onSend={vi.fn(() => true)}
				disabled={false}
				sendDisabled={true}
				sendDisabledLabel="Iris is still answering"
			/>
		);
		expect(screen.getByRole('textbox', { name: 'Chat input' }))
			.toHaveAccessibleDescription('Iris is still answering');

		rerender(<ChatInput onSend={vi.fn(() => true)} disabled={false} sendDisabled={false} />);
		expect(screen.getByRole('textbox', { name: 'Chat input' }))
			.not.toHaveAccessibleDescription();
	});
});
