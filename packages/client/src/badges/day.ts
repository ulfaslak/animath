import type { Intent } from '@mathgame/engine';

/**
 * The day on the kid's calendar, for the badges' days played ([[PRODUCT]] §4
 * "Badges"). The authority reads no clock ([[INVARIANTS]] § Authority): the
 * page reads it here and tells the authority with a `day` intent, at the
 * start and whenever the date turns, so a tab left open overnight counts the
 * next day too.
 */

/** Today on the browser's own calendar, in its time zone: `YYYY-MM-DD`, as the tally keeps a day. */
export function localDay(now = new Date()): string {
	const pad = (n: number, width: number) => String(n).padStart(width, '0');
	return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/** Seconds between two looks at the calendar: a day's turn is told within this. */
export const DAY_LOOK_SECONDS = 1;

/**
 * Tells `dispatch` the day: at once, then, every frame (`tick`), again once
 * the date has turned, looking at the clock once a `DAY_LOOK_SECONDS`.
 */
export class DayTeller {
	private told: string | null = null;
	private wait = 0;

	constructor(
		private readonly dispatch: (intent: Intent) => void,
		private readonly today: () => string = localDay
	) {
		this.look();
	}

	tick(dt: number): void {
		this.wait -= dt;
		if (this.wait <= 0) this.look();
	}

	private look(): void {
		this.wait = DAY_LOOK_SECONDS;
		const day = this.today();
		if (day === this.told) return;
		this.told = day;
		this.dispatch({ type: 'day', day });
	}
}
