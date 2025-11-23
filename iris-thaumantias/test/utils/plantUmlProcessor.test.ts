import * as assert from 'assert';
import { processPlantUml } from '../../src/utils/plantUmlProcessor';

suite('PlantUML Processor Test Suite', () => {
    test('should replace simple testsColor', () => {
        const input = 'class A { testsColor(testMethod()) }';
        const expected = 'class A { green }';
        assert.strictEqual(processPlantUml(input), expected);
    });

    test('should replace testsColor with ID', () => {
        const input = 'class B { testsColor(<testid>12345</testid>) }';
        const expected = 'class B { green }';
        assert.strictEqual(processPlantUml(input), expected);
    });

    test('should replace multiple occurrences', () => {
        const input = 'A -> B : testsColor(test1())\nB -> C : testsColor(test2())';
        const expected = 'A -> B : green\nB -> C : green';
        assert.strictEqual(processPlantUml(input), expected);
    });

    test('should handle nested parentheses', () => {
        const input = 'testsColor(test(param))';
        const expected = 'green';
        assert.strictEqual(processPlantUml(input), expected);
    });

    test('should leave other text unchanged', () => {
        const input = 'class Student { String name }';
        assert.strictEqual(processPlantUml(input), input);
    });
});
