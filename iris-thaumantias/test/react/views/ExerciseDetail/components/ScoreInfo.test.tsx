import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreInfo } from '../../../../../src/views/webview/views/ExerciseDetail/components/ScoreInfo';

describe('ScoreInfo', () => {
	it('renders score and max score', () => {
		render(<ScoreInfo score={85} maxScore={100} />);
		expect(screen.getByText('85')).toBeInTheDocument();
		expect(screen.getByText('100')).toBeInTheDocument();
	});

	it('renders score separator', () => {
		render(<ScoreInfo score={50} maxScore={100} />);
		expect(screen.getByText('/')).toBeInTheDocument();
	});

	it('renders percentage display', () => {
		render(<ScoreInfo score={85} maxScore={100} />);
		expect(screen.getByText('(85.0%)')).toBeInTheDocument();
	});

	it('renders zero score correctly', () => {
		render(<ScoreInfo score={0} maxScore={100} />);
		expect(screen.getByText('0')).toBeInTheDocument();
		expect(screen.getByText('(0.0%)')).toBeInTheDocument();
	});

	it('renders perfect score (100%)', () => {
		render(<ScoreInfo score={100} maxScore={100} />);
		// Both score value and max score are "100" — use getAllByText
		const hundredElements = screen.getAllByText('100');
		expect(hundredElements).toHaveLength(2);
		expect(screen.getByText('(100.0%)')).toBeInTheDocument();
	});

	it('handles null score gracefully (falls back to 0)', () => {
		render(<ScoreInfo score={null} maxScore={100} />);
		expect(screen.getByText('0')).toBeInTheDocument();
		expect(screen.getByText('(0.0%)')).toBeInTheDocument();
	});

	it('renders bonus points when bonusPoints > 0', () => {
		render(<ScoreInfo score={80} maxScore={100} bonusPoints={10} />);
		expect(screen.getByText('(+10 bonus)')).toBeInTheDocument();
	});

	it('does not render bonus points section when bonusPoints is 0', () => {
		render(<ScoreInfo score={80} maxScore={100} bonusPoints={0} />);
		expect(screen.queryByText(/bonus/)).not.toBeInTheDocument();
	});

	it('renders assessmentType when provided', () => {
		render(<ScoreInfo score={75} maxScore={100} assessmentType="AUTOMATIC" />);
		expect(screen.getByText('Assessment: AUTOMATIC')).toBeInTheDocument();
	});

	it('does not render assessmentType when not provided', () => {
		render(<ScoreInfo score={75} maxScore={100} />);
		expect(screen.queryByText(/Assessment:/)).not.toBeInTheDocument();
	});

	it('renders completionDate when provided', () => {
		render(<ScoreInfo score={90} maxScore={100} completionDate="2025-01-15T10:00:00Z" />);
		expect(screen.getByText(/Completed:/)).toBeInTheDocument();
	});

	it('does not render completionDate when not provided', () => {
		render(<ScoreInfo score={90} maxScore={100} />);
		expect(screen.queryByText(/Completed:/)).not.toBeInTheDocument();
	});

	it('calculates 0% when maxScore is 0', () => {
		render(<ScoreInfo score={0} maxScore={0} />);
		expect(screen.getByText('(0.0%)')).toBeInTheDocument();
	});

	it('renders partial score percentage correctly', () => {
		render(<ScoreInfo score={33} maxScore={100} />);
		expect(screen.getByText('(33.0%)')).toBeInTheDocument();
	});
});
