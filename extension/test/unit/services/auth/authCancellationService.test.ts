import * as assert from 'assert';
import * as sinon from 'sinon';

import { AuthCancellationService } from '@extension/services/auth/authCancellationService';
import type { OidcLoginService } from '@extension/services/auth/oidcLoginService';

suite('AuthCancellationService Test Suite', () => {
    function build(oidcCancel: () => Promise<void> = async () => {}) {
        const oidc = { cancel: oidcCancel } as unknown as OidcLoginService;
        return new AuthCancellationService(oidc);
    }

    test('cancelAll aborts the registered attempt', async () => {
        const service = build();
        const controller = new AbortController();
        service.register(controller);

        await service.cancelAll();

        assert.strictEqual(controller.signal.aborted, true);
    });

    test('the abort happens before the OIDC cancel is even invoked', async () => {
        const controller = new AbortController();
        let abortedWhenOidcRan: boolean | undefined;
        const service = build(async () => { abortedWhenOidcRan = controller.signal.aborted; });
        service.register(controller);

        await service.cancelAll();

        // Command handlers are not awaited by the provider, so anything awaited before the abort gives a
        // newer attempt time to register and become the one that gets aborted instead.
        assert.strictEqual(abortedWhenOidcRan, true);
    });

    test('registering a new attempt aborts the previous one', () => {
        const service = build();
        const first = new AbortController();
        const second = new AbortController();

        service.register(first);
        service.register(second);

        assert.strictEqual(first.signal.aborted, true);
        assert.strictEqual(second.signal.aborted, false);
    });

    test('a finished attempt releasing itself cannot drop a newer attempt', async () => {
        const service = build();
        const finished = new AbortController();
        const current = new AbortController();
        service.register(finished);
        service.register(current);

        service.release(finished);
        await service.cancelAll();

        assert.strictEqual(current.signal.aborted, true, 'the newer attempt must still be cancellable');
    });

    test('cancelAll with nothing registered still cancels OIDC', async () => {
        const cancel = sinon.spy(async () => {});
        const service = build(cancel);

        await service.cancelAll();

        assert.ok(cancel.calledOnce);
    });
});
