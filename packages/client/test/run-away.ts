import { answerText, type Puzzle } from '@mathgame/engine';
import type { LocalAuthority } from '../src/authority/local';

/**
 * Run away from the battle under way: Run, then the escape puzzle answered
 * right, as a kid who gets away does. A Run the authority refuses (no battle,
 * or not the moment to choose) is all that is sent. Not a test file itself.
 */
export function runAway(authority: LocalAuthority): void {
	let puzzle: Puzzle | null = null;
	const off = authority.subscribe((e) => {
		if (e.type === 'battle-updated' && e.state.phase.kind === 'escaping')
			puzzle = e.state.phase.puzzle;
	});
	authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
	off();
	const asked = puzzle as Puzzle | null;
	if (asked)
		authority.dispatch({ type: 'battle', intent: { type: 'answer', input: answerText(asked) } });
}
