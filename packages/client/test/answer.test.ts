import { checkAnswer, type Puzzle } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { answerKey, shownAnswer } from '../src/input/answer';

/** Keys typed one after another into an empty answer, as a kid types them. */
function typed(keys: string[], form: 'number' | 'time' = 'number') {
	let input = '';
	let submitted: string | null = null;
	for (const key of keys) {
		const step = answerKey(input, key, form);
		input = step.input;
		if (step.submit) submitted = input;
	}
	return { input, submitted, shown: shownAnswer(input, form) };
}

const split = (text: string) => [...text];

describe('typing a time (a clock’s answer)', () => {
	const quarterPast3: Puzzle = {
		kind: 'clock',
		difficulty: 3,
		prompt: 'clock(0, 3, 15, 0, 0)',
		answer: 195
	};

	it('takes hours, a colon or a dot, and two digits of minutes, and shows the colon itself', () => {
		expect(typed([...split('3:15'), 'Enter'], 'time')).toEqual({
			input: '3:15',
			submitted: '3:15',
			shown: '3:15'
		});
		expect(typed([...split('3.15'), 'Enter'], 'time').submitted).toBe('3:15');
		// Without a colon, the last two digits are the minutes.
		expect(typed([...split('315'), 'Enter'], 'time')).toEqual({
			input: '315',
			submitted: '315',
			shown: '3:15'
		});
		expect(typed([...split('1515'), 'Enter'], 'time').shown).toBe('15:15');
		for (const answer of ['3:15', '315', '1515', '15:15'])
			expect(checkAnswer(quarterPast3, typed([...split(answer), 'Enter'], 'time').submitted!)).toBe(
				true
			);
	});

	it('never spends a turn on half a time', () => {
		for (const keys of ['', '3', '31', '3:', '3:1', ':'])
			expect(typed([...split(keys), 'Enter', 'Enter'], 'time').submitted, keys).toBeNull();
	});

	it('takes no more than a time holds, one colon, and no minus', () => {
		expect(typed(split('12345'), 'time').input).toBe('1234');
		expect(typed(split('3:155'), 'time').input).toBe('3:15');
		expect(typed(split('123:'), 'time').input).toBe('123');
		expect(typed(split('3::'), 'time').input).toBe('3:');
		expect(typed(split(':3'), 'time').input).toBe('3');
		expect(typed(['-', '3'], 'time').input).toBe('3');
		expect(typed(['3', ':', 'Backspace', 'Backspace'], 'time').input).toBe('');
	});

	it('leaves a number typed as it was', () => {
		expect(typed(['-', '2', 'Enter'])).toEqual({ input: '-2', submitted: '-2', shown: '-2' });
		expect(answerKey('3', ':').handled).toBe(false);
	});
});
