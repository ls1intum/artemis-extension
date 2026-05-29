import { describe, it, expect, vi, afterEach } from 'vitest';
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

    describe('URL param prefill', () => {
        afterEach(() => {
            // Reset the URL so prefilled params do not bleed into other tests.
            window.history.replaceState({}, '', '/');
        });

        it('prefills rater name and token from ?type=rater&name=&pw=', async () => {
            window.history.replaceState({}, '', '/?type=rater&name=Alice&pw=secret');
            const onLogin = vi.fn().mockResolvedValue({ ok: true });
            render(<LoginScreen onLogin={onLogin} />);
            expect(screen.getByLabelText(/rater name/i)).toHaveValue('Alice');
            expect(screen.getByLabelText(/access token/i)).toHaveValue('secret');
            fireEvent.click(screen.getByRole('button', { name: /connect/i }));
            await Promise.resolve();
            expect(onLogin).toHaveBeenCalledWith({ mode: 'rater', token: 'secret', raterName: 'Alice' });
        });

        it('selects researcher mode and prefills token from ?type=researcher&pw=', () => {
            window.history.replaceState({}, '', '/?type=researcher&pw=res');
            const onLogin = vi.fn().mockResolvedValue({ ok: true });
            render(<LoginScreen onLogin={onLogin} />);
            expect(screen.getByRole('tab', { name: /researcher/i })).toHaveAttribute('aria-selected', 'true');
            expect(screen.queryByLabelText(/rater name/i)).toBeNull();
            expect(screen.getByLabelText(/access token/i)).toHaveValue('res');
        });

        it('defaults to empty rater mode when no params are present', () => {
            const onLogin = vi.fn().mockResolvedValue({ ok: true });
            render(<LoginScreen onLogin={onLogin} />);
            expect(screen.getByRole('tab', { name: /rater/i })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByLabelText(/rater name/i)).toHaveValue('');
            expect(screen.getByLabelText(/access token/i)).toHaveValue('');
        });
    });
});
