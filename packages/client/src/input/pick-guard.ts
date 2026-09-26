/**
 * The one guard every screen that puts up a choice keeps on its picks: the
 * battle's menu, its switch lists and its result card, the doctor's list, the
 * title's confirm, starters and name box, and Talk in explore (UI_SPEC § Battle
 * mode, "A quiet moment"). A choice takes a pick only after a quiet moment:
 * `PICK_QUIET_SECONDS` of frame time since it came up on screen, and since the
 * last key a kid mashes (Enter, Space or a number key), whether that press
 * counted or not. So a key mashed through the battle text, a result or a
 * heal never picks on the screen that follows, however long the mash goes
 * on: every press starts the moment again. The first press after a pause
 * does. A pointer's press is a key press here too (`input/press.ts`).
 *
 * One clock for both halves of the rule on purpose. A guard of a fixed time
 * after the choice came up, plus a mash measured as the gap between two
 * presses, failed twice: a mash outlasted the first, and one slightly slow
 * press in an uneven mash broke the second (#27, #37).
 */

/**
 * Frame seconds of quiet a new choice needs before it takes a pick. Longer
 * than a child's reaction to something new on screen (about half a second),
 * and longer than any gap in a mash down to two presses a second as a hand
 * mashes, unevenly (±30%: gaps of 0.35 to 0.65 s). Frame time, clamped at
 * 0.1 s a frame, so a page too busy to draw the choice doesn't count the
 * moment as seen, and never runs faster than the clock.
 */
export const PICK_QUIET_SECONDS = 0.8;

/** The keys a kid mashes to hurry a screen along, and the ones that pick: Enter, Space, a number. */
export function isMashKey(key: string): boolean {
	return key === 'Enter' || key === ' ' || /^[0-9]$/.test(key);
}

export class PickGuard {
	/** Frame seconds since the choice came up or a mashed key went down, whichever is later. */
	private quiet = 0;

	/** A new choice is on screen: it waits a quiet moment before it takes a pick. */
	show(): void {
		this.quiet = 0;
	}

	/** Frame time, from the screen's `update`. */
	tick(dt: number): void {
		this.quiet += dt;
	}

	/** A pick would count now. */
	get ready(): boolean {
		return this.quiet >= PICK_QUIET_SECONDS;
	}

	/**
	 * A key a kid mashes went down (never auto-repeat, which is not a press):
	 * whether it may pick. Either way the quiet moment starts again.
	 */
	press(): boolean {
		const ready = this.ready;
		this.quiet = 0;
		return ready;
	}
}
