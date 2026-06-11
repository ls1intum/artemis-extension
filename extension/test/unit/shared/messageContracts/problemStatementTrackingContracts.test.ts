import * as assert from 'assert';

import { COMMANDS_REQUIRING_PAYLOAD, WebviewCmd } from '@shared/messageContracts/webviewCommands';

suite('Problem-statement tracking command contracts', () => {
    test('both commands require a payload', () => {
        assert.ok(COMMANDS_REQUIRING_PAYLOAD.has(WebviewCmd.ProblemStatementScroll),
            'problemStatementScroll missing from COMMANDS_REQUIRING_PAYLOAD');
        assert.ok(COMMANDS_REQUIRING_PAYLOAD.has(WebviewCmd.ProblemStatementSelection),
            'problemStatementSelection missing from COMMANDS_REQUIRING_PAYLOAD');
    });
});
