import { describe, expect, it, vi } from 'vitest';

import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { ProactiveControlCommandModule } from '@extension/controller/commands/proactiveControlCommands';

function harness(over: {
    on?: boolean;
    paused?: boolean;
    degraded?: boolean;
    noAi?: boolean;
    settings?: unknown;
    profileActive?: boolean;
} = {}) {
    const pref = { isProactiveOn: vi.fn(() => over.on ?? true), setProactiveOn: vi.fn() };
    const control = {
        isProactivePaused: vi.fn(() => over.paused ?? false),
        setStudentProactive: vi.fn(),
        resumeProactive: vi.fn(),
        isProactiveDegraded: vi.fn(() => over.degraded ?? false),
    };
    const artemisApi = {
        getProfileInfo: vi.fn(async () => ({})),
        isIrisProfileActive: vi.fn(() => over.profileActive ?? true),
        getIrisCourseChatSettings: vi.fn(async () =>
            over.settings ?? { settings: { enabled: true, proactiveStruggleEnabled: true } }),
    };
    const providerRegistry = {
        getChatWebviewProvider: vi.fn(() => ({ isNoAiEnabled: () => over.noAi ?? false, whenNoAiReady: async () => {} })),
    };
    const sent: any[] = [];
    const ctx = { proactivePreference: pref, proactiveControl: control, artemisApi, providerRegistry, sendMessage: (m: any) => sent.push(m) } as any;
    return { mod: new ProactiveControlCommandModule(ctx), pref, control, artemisApi, sent };
}
const cmd = (command: string, payload: any) => ({ command, payload } as any);

describe('ProactiveControlCommandModule', () => {
    it('request pushes the current preference + pause state', async () => {
        const h = harness({ on: true, paused: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(h.sent[0]).toMatchObject({ type: ExtensionMsg.UpdateProactiveControl, exerciseId: 42, preference: 'on', autoPaused: true });
    });

    it('Off wins over Auto-paused in the badge (precedence)', async () => {
        const h = harness({ on: false, paused: true });   // backoff paused, but student turned it off
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(h.sent[0]).toMatchObject({ preference: 'off', autoPaused: false });
    });

    it('setEnabled(false) persists + applies + re-pushes', async () => {
        const h = harness({ on: false });
        await h.mod.getHandlers()[WebviewCmd.SetProactiveEnabled](cmd('setProactiveEnabled', { exerciseId: 42, enabled: false }));
        expect(h.pref.setProactiveOn).toHaveBeenCalledWith(42, false);
        expect(h.control.setStudentProactive).toHaveBeenCalledWith(42, false);
        expect(h.sent[0]).toMatchObject({ preference: 'off' });
    });

    it('resume delegates to the engine + re-pushes', async () => {
        const h = harness();
        await h.mod.getHandlers()[WebviewCmd.ResumeProactive](cmd('resumeProactive', { exerciseId: 42 }));
        expect(h.control.resumeProactive).toHaveBeenCalledWith(42);
        expect(h.sent[0]).toMatchObject({ exerciseId: 42 });
    });

    it('pushes nothing when there is no proactive engine (clean build → switch stays hidden)', async () => {
        const sent: any[] = [];
        const pref = { isProactiveOn: vi.fn(() => true), setProactiveOn: vi.fn() };
        const ctx = { proactivePreference: pref, proactiveControl: undefined, sendMessage: (m: any) => sent.push(m) } as any;
        const mod = new ProactiveControlCommandModule(ctx);
        await mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(sent).toHaveLength(0);
    });

    // ── Slice 5c: card-state derivation ────────────────────────────────────
    it('all signals ok (with courseId) → available', async () => {
        const h = harness({});
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ exerciseId: 42, cardState: 'available' });
    });

    it('.noai → unavailable/noai', async () => {
        const h = harness({ noAi: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'noai' });
    });

    it('course proactive off → off-course', async () => {
        const h = harness({ settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'off-course', cardReason: 'course-off' });
    });

    it('iris disabled (settings.enabled=false) → unavailable/iris-off', async () => {
        const h = harness({ settings: { settings: { enabled: false } } });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'iris-off' });
    });

    it('degraded seam → degraded', async () => {
        const h = harness({ degraded: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'degraded', cardReason: 'limited' });
    });

    it('no courseId → optimistic available (availability fetch skipped, self-heals next push)', async () => {
        const h = harness({});
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(h.artemisApi.getIrisCourseChatSettings).not.toHaveBeenCalled();
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'available' });
    });
});
