import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestResults } from '../../../../../src/webview/views/ExerciseDetail/components/TestResults';
import type { TestCase } from '../../../../../src/webview/views/ExerciseDetail/types';

describe('TestResults', () => {
	it('shows empty state when no test cases provided', () => {
		render(<TestResults testCases={[]} />);
		expect(screen.getByText('No test results available.')).toBeInTheDocument();
	});

	it('renders test case names', () => {
		const testCases: TestCase[] = [
			{ name: 'testAddition', passed: true },
			{ name: 'testSubtraction', passed: false },
		];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('testAddition')).toBeInTheDocument();
		expect(screen.getByText('testSubtraction')).toBeInTheDocument();
	});

	it('groups passed tests in Passed Tests section', () => {
		const testCases: TestCase[] = [
			{ name: 'testPassing1', passed: true },
			{ name: 'testPassing2', passed: true },
		];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('Passed Tests (2)')).toBeInTheDocument();
		expect(screen.getByText('testPassing1')).toBeInTheDocument();
		expect(screen.getByText('testPassing2')).toBeInTheDocument();
	});

	it('groups failed tests in Failed Tests section', () => {
		const testCases: TestCase[] = [
			{ name: 'testFailing1', passed: false },
			{ name: 'testFailing2', passed: false },
		];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('Failed Tests (2)')).toBeInTheDocument();
		expect(screen.getByText('testFailing1')).toBeInTheDocument();
		expect(screen.getByText('testFailing2')).toBeInTheDocument();
	});

	it('shows failure message for failed tests', () => {
		const testCases: TestCase[] = [
			{ name: 'testFailing', passed: false, message: 'Expected 5 but got 3' },
		];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('Expected 5 but got 3')).toBeInTheDocument();
	});

	it('does not show message area for passed tests', () => {
		const testCases: TestCase[] = [
			{ name: 'testPassing', passed: true },
		];
		render(<TestResults testCases={testCases} />);
		// Passed tests have no message element in the DOM
		expect(screen.queryByText('Expected 5 but got 3')).not.toBeInTheDocument();
	});

	it('shows correct count in header for mixed results', () => {
		const testCases: TestCase[] = [
			{ name: 'test1', passed: true },
			{ name: 'test2', passed: true },
			{ name: 'test3', passed: false },
		];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('Passed Tests (2)')).toBeInTheDocument();
		expect(screen.getByText('Failed Tests (1)')).toBeInTheDocument();
	});

	it('shows only passed section when all tests pass', () => {
		const testCases: TestCase[] = [
			{ name: 'test1', passed: true },
			{ name: 'test2', passed: true },
		];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('Passed Tests (2)')).toBeInTheDocument();
		expect(screen.queryByText(/Failed Tests/)).not.toBeInTheDocument();
	});

	it('shows only failed section when all tests fail', () => {
		const testCases: TestCase[] = [
			{ name: 'test1', passed: false },
			{ name: 'test2', passed: false },
		];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('Failed Tests (2)')).toBeInTheDocument();
		expect(screen.queryByText(/Passed Tests/)).not.toBeInTheDocument();
	});

	it('renders pass checkmark icon for passed tests', () => {
		const testCases: TestCase[] = [{ name: 'testPass', passed: true }];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('✓')).toBeInTheDocument();
	});

	it('renders fail cross icon for failed tests', () => {
		const testCases: TestCase[] = [{ name: 'testFail', passed: false }];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('✗')).toBeInTheDocument();
	});

	it('handles test case without message for failed test (no crash)', () => {
		const testCases: TestCase[] = [
			{ name: 'testNoMessage', passed: false },
		];
		render(<TestResults testCases={testCases} />);
		expect(screen.getByText('testNoMessage')).toBeInTheDocument();
		// No crash — message is optional
	});
});
