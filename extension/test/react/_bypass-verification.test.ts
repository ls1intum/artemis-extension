import { test, expect } from 'vitest';

// Intentional failing test. Used to verify that the CI gate fails when a
// dependency job (here: Unit tests) fails, and that a forged "CI gate"
// commit status from outside the GitHub Actions app does not satisfy the
// required check (because branch protection binds the requirement to
// app_id 15368). To be removed before this PR is closed.
test('intentional ci-gate verification failure', () => {
    expect(true).toBe(false);
});
