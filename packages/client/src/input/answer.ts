/**
 * Typing a puzzle answer, shared by every screen that asks one (battle now,
 * the doctor later). Pure: the key and the text so far in, the new text and
 * whether to submit out. Judging the answer is the engine's job, never this.
 *
 * The rules: digits append, a minus only as the first character, Backspace
 * deletes, at most `MAX_ANSWER_LENGTH` characters (a sign and six digits;
 * every answer in the game is shorter), and Enter submits only once a digit
 * has been typed, so a mashed Enter never spends a turn on an empty answer.
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

export function answerKey(input: string, key: string): AnswerKey {
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
