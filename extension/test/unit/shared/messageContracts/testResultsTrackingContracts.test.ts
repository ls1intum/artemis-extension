import * as assert from 'assert';
import { COMMANDS_REQUIRING_PAYLOAD, WebviewCmd } from '../../../../src/shared/messageContracts/webviewCommands';

suite('Test-results tracking command contracts', () => {
    test('all four new commands require a payload', () => {
        assert.ok(COMMANDS_REQUIRING_PAYLOAD.has(WebviewCmd.TestResultsOverviewOpened),
            'testResultsOverviewOpened missing from COMMANDS_REQUIRING_PAYLOAD');
        assert.ok(COMMANDS_REQUIRING_PAYLOAD.has(WebviewCmd.TestResultsOverviewClosed),
            'testResultsOverviewClosed missing from COMMANDS_REQUIRING_PAYLOAD');
        assert.ok(COMMANDS_REQUIRING_PAYLOAD.has(WebviewCmd.TaskFeedbackOpened),
            'taskFeedbackOpened missing from COMMANDS_REQUIRING_PAYLOAD');
        assert.ok(COMMANDS_REQUIRING_PAYLOAD.has(WebviewCmd.TaskFeedbackClosed),
            'taskFeedbackClosed missing from COMMANDS_REQUIRING_PAYLOAD');
    });
});
