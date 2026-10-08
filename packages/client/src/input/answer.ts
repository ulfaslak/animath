import type { AnswerForm } from '@mathgame/engine';

/**
 * Typing a puzzle answer, shared by every screen that asks one (a battle, a
 * friendly match, the witch doctor). Pure: the key and the text so far in,
 * the new text and whether to submit out. Judging the answer is the engine's
 * job, never this.
 *
 * A number: digits append, a minus only as the first character, Backspace
 * deletes, at most `MAX_ANSWER_LENGTH` characters (a sign and six digits;
 * every answer in the game is shorter), and Enter submits only once a digit
 * has been typed, so a mashed Enter never spends a turn on an empty answer.
 *
 * A time (`form` `time`, a clock's answer): hours, a colon, two digits of
 * minutes. Digits append, at most two before the colon and two after it
 * (four in all without one); the colon comes with `:` or `.` (a Danish
 * keyboard's "kl. 3.15"), once, after one or two digits; Backspace deletes;
 * and Enter submits only a whole time, hours and two digits of minutes, with
 * or without its colon ("3:15", "315"), so "3:5" is never spent as an answer.
 * `shownAnswer` shows "315" as "3:15".
 */
export const MAX_ANSWER_LENGTH = 7;

export interface AnswerKey {
	/** The answer text after the key. */
	input: string;
	/** True when the key submits `input`. */
	submit: boolean;
	/** False for keys that mean nothing while typing an answer. */
	handled: boolean;
}

/** A whole time as `answerKey` lets one go: one or two digits of hours, a colon or not, two of minutes. */
const WHOLE_TIME = /^\d{1,2}:?\d{2}$/;

export function answerKey(input: string, key: string, form: AnswerForm = 'number'): AnswerKey {
	if (form === 'time') return timeKey(input, key);
	if (/^[0-9]$/.test(key)) {
		return {
			input: input.length < MAX_ANSWER_LENGTH ? input + key : input,
			submit: false,
			handled: true
		};
	}
	if (key === '-') return { input: input === '' ? '-' : input, submit: false, handled: true };
	if (key === 'Backspace') return { input: input.slice(0, -1), submit: false, handled: true };
	if (key === 'Enter') return { input, submit: /\d/.test(input), handled: true };
	return { input, submit: false, handled: false };
}

function timeKey(input: string, key: string): AnswerKey {
	const [hours, minutes] = input.split(':') as [string, string | undefined];
	if (/^[0-9]$/.test(key)) {
		const fits = minutes === undefined ? hours.length < 4 : minutes.length < 2;
		return { input: fits ? input + key : input, submit: false, handled: true };
	}
	if (key === ':' || key === '.') {
		const fits = minutes === undefined && hours.length >= 1 && hours.length <= 2;
		return { input: fits ? `${input}:` : input, submit: false, handled: true };
	}
	if (key === 'Backspace') return { input: input.slice(0, -1), submit: false, handled: true };
	if (key === 'Enter') return { input, submit: WHOLE_TIME.test(input), handled: true };
	// A minus means nothing on a clock: taken, so it never reaches another screen.
	if (key === '-') return { input, submit: false, handled: true };
	return { input, submit: false, handled: false };
}

/**
 * The answer as the puzzle card shows it: a time typed without its colon
 * shows one before its last two digits once it has three ("315" is "3:15"),
 * so the kid sees the time they mean. Anything else as typed.
 */
export function shownAnswer(input: string, form: AnswerForm = 'number'): string {
	if (form !== 'time' || input.includes(':') || input.length < 3) return input;
	return `${input.slice(0, -2)}:${input.slice(-2)}`;
}
