import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginScreen } from '../src/components/LoginScreen';

describe('LoginScreen', () => {
    it('shows the rater name field by default (rater mode)', () => {
        const onLogin = vi.fn().mockResolvedValue({ ok: true });
        render(<LoginScreen onLogin={onLogin} />);
        expect(screen.getByLabelText(/rater name/i)).toBeInTheDocument();
    });

    it('hides the rater name field when researcher mode is selected', () => {
        const onLogin = vi.fn().mockResolvedValue({ ok: true });
        render(<LoginScreen onLogin={onLogin} />);
        fireEvent.click(screen.getByRole('tab', { name: /researcher/i }));
        expect(screen.queryByLabelText(/rater name/i)).toBeNull();
    });

    it('submits rater mode with raterName in payload', async () => {
        const onLogin = vi.fn().mockResolvedValue({ ok: true });
        render(<LoginScreen onLogin={onLogin} />);
        fireEvent.change(screen.getByLabelText(/rater name/i), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByLabelText(/access token/i), { target: { value: 'tok' } });
        fireEvent.click(screen.getByRole('button', { name: /connect/i }));
        await Promise.resolve();
        expect(onLogin).toHaveBeenCalledWith({ mode: 'rater', token: 'tok', raterName: 'Alice' });
    });

    it('submits researcher mode without raterName', async () => {
        const onLogin = vi.fn().mockResolvedValue({ ok: true });
        render(<LoginScreen onLogin={onLogin} />);
        fireEvent.click(screen.getByRole('tab', { name: /researcher/i }));
        fireEvent.change(screen.getByLabelText(/access token/i), { target: { value: 'res' } });
        fireEvent.click(screen.getByRole('button', { name: /connect/i }));
        await Promise.resolve();
        expect(onLogin).toHaveBeenCalledWith({ mode: 'researcher', token: 'res' });
    });

    it('surfaces server error', async () => {
        const onLogin = vi.fn().mockResolvedValue({ ok: false, error: 'Rater name is required' });
        render(<LoginScreen onLogin={onLogin} />);
        fireEvent.change(screen.getByLabelText(/rater name/i), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByLabelText(/access token/i), { target: { value: 'tok' } });
        fireEvent.click(screen.getByRole('button', { name: /connect/i }));
        await new Promise(r => setTimeout(r, 0));
        expect(await screen.findByRole('alert')).toHaveTextContent('Rater name is required');
    });
});
