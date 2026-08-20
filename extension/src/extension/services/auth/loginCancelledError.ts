/**
 * A sign-in that stopped because the user said so.
 *
 * It exists so the two login paths can tell "this failed" from "you cancelled this" without matching on
 * message text. A cancellation is never reported to the user: they already know, and an error toast
 * would contradict the button they just pressed.
 */
export class LoginCancelledError extends Error {
    constructor(message = 'This sign-in was cancelled.') {
        super(message);
        this.name = 'LoginCancelledError';
    }
}
