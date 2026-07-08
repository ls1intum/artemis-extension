import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { NudgeBanner } from '@webview/components/NudgeBanner';

function showBanner(episodeId = 'ep-1') {
    dispatchExtensionMessage({
        type: ExtensionMsg.ShowNudgeBanner,
        title: 'Hit a wall?',
        sub: "I've got a small nudge ready.",
        episodeId,
        timerMs: 10_000,
    });
}

describe('NudgeBanner', () => {
    it('renders nothing by default', () => {
        render(<NudgeBanner vscodeApi={createMockVsCodeApi()} />);
        expect(screen.queryByText('Hit a wall?')).toBeNull();
    });

    it('shows title + sub after a showNudgeBanner message', async () => {
        render(<NudgeBanner vscodeApi={createMockVsCodeApi()} />);
        showBanner();
        await waitFor(() => {
            expect(screen.getByText('Hit a wall?')).toBeInTheDocument();
        });
        expect(screen.getByText("I've got a small nudge ready.")).toBeInTheDocument();
    });

    it('hides again on a hideNudgeBanner message', async () => {
        render(<NudgeBanner vscodeApi={createMockVsCodeApi()} />);
        showBanner();
        await waitFor(() => {
            expect(screen.getByText('Hit a wall?')).toBeInTheDocument();
        });
        dispatchExtensionMessage({ type: ExtensionMsg.HideNudgeBanner });
        await waitFor(() => {
            expect(screen.queryByText('Hit a wall?')).toBeNull();
        });
    });

    it('"Show me" posts a showMe nudgeBannerAction and hides the banner', async () => {
        const vscodeApi = createMockVsCodeApi();
        render(<NudgeBanner vscodeApi={vscodeApi} />);
        showBanner('ep-1');
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
        expect(vscodeApi.postMessage).toHaveBeenCalledWith({
            type: 'command',
            command: WebviewCmd.NudgeBannerAction,
            payload: { action: 'showMe', episodeId: 'ep-1' },
        });
        expect(screen.queryByText('Hit a wall?')).toBeNull();
    });

    it('"Not now" posts a dismiss nudgeBannerAction and hides the banner', async () => {
        const vscodeApi = createMockVsCodeApi();
        render(<NudgeBanner vscodeApi={vscodeApi} />);
        showBanner('ep-1');
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(vscodeApi.postMessage).toHaveBeenCalledWith({
            type: 'command',
            command: WebviewCmd.NudgeBannerAction,
            payload: { action: 'dismiss', episodeId: 'ep-1' },
        });
        expect(screen.queryByText('Hit a wall?')).toBeNull();
    });

    it('the × close button also posts a dismiss nudgeBannerAction and hides the banner', async () => {
        const vscodeApi = createMockVsCodeApi();
        render(<NudgeBanner vscodeApi={vscodeApi} />);
        showBanner('ep-1');
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
        expect(vscodeApi.postMessage).toHaveBeenCalledWith({
            type: 'command',
            command: WebviewCmd.NudgeBannerAction,
            payload: { action: 'dismiss', episodeId: 'ep-1' },
        });
        expect(screen.queryByText('Hit a wall?')).toBeNull();
    });

    it('the countdown bar animationend posts a timeout nudgeBannerAction and hides the banner', async () => {
        const vscodeApi = createMockVsCodeApi();
        const { container } = render(<NudgeBanner vscodeApi={vscodeApi} />);
        showBanner('ep-1');
        await waitFor(() => {
            expect(container.querySelector('[data-testid="nudge-countdown"]')).not.toBeNull();
        });
        const bar = container.querySelector('[data-testid="nudge-countdown"]');
        fireEvent.animationEnd(bar as Element);
        expect(vscodeApi.postMessage).toHaveBeenCalledWith({
            type: 'command',
            command: WebviewCmd.NudgeBannerAction,
            payload: { action: 'timeout', episodeId: 'ep-1' },
        });
        expect(screen.queryByText('Hit a wall?')).toBeNull();
    });

    it('an abandon-moment banner shows the presence-check labels and posts accept', async () => {
        const vscodeApi = createMockVsCodeApi();
        render(<NudgeBanner vscodeApi={vscodeApi} />);
        dispatchExtensionMessage({
            type: ExtensionMsg.ShowNudgeBanner,
            title: 'Still on this?',
            sub: "I'll step back soon otherwise.",
            episodeId: 'ep-1',
            offerId: 'off-1',
            moment: 'abandon',
            timerMs: 60_000,
        });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'I need more help' })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: 'I need more help' }));
        expect(vscodeApi.postMessage).toHaveBeenCalledWith({
            type: 'command',
            command: WebviewCmd.NudgeBannerAction,
            payload: { moment: 'abandon', action: 'accept', episodeId: 'ep-1', offerId: 'off-1' },
        });
    });

    describe('with a #root data-iris-logo-uri attribute', () => {
        let root: HTMLDivElement;

        beforeEach(() => {
            root = document.createElement('div');
            root.id = 'root';
            root.dataset.irisLogoUri = 'test-iris-logo.svg';
            document.body.appendChild(root);
        });

        afterEach(() => {
            root.remove();
        });

        it('reads the Iris logo from the root data-iris-logo-uri attribute', async () => {
            const { container } = render(<NudgeBanner vscodeApi={createMockVsCodeApi()} />);
            showBanner();
            await waitFor(() => {
                expect(container.querySelector('img')).not.toBeNull();
            });
            const img = container.querySelector('img');
            expect(img?.getAttribute('src')).toBe('test-iris-logo.svg');
        });
    });
});
