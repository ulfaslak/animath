import { accountsReady } from './api';

/**
 * Whether the server can make and keep an account now ([[ARCHITECTURE]]
 * § HTTP API, `GET /api/account/ready`): its database answers and has the
 * accounts' tables. A server can run without them (a development database
 * that `pnpm db:migrate` has not reached, a database that is down), and then
 * "Save my game" could only end in "We can't reach the game's home". So the
 * game offers an account only while the server says yes, asked as the page
 * starts and again every half minute while the page is on screen. No answer
 * is a no. An account already made plays on as it does offline: its save
 * waits in the browser until the server takes it again.
 */

/** How often a page on screen asks again. */
export const READY_EVERY_MS = 30_000;

export class ReadyWatch {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private asking = false;
	private askedAt = -Infinity;

	constructor(
		/** Told every answer. */
		private readonly heard: (ready: boolean) => void,
		private readonly ask: () => Promise<boolean> = () => accountsReady(),
		private readonly everyMs = READY_EVERY_MS,
		private readonly onScreen: () => boolean = () => document.visibilityState === 'visible',
		private readonly now: () => number = () => Date.now()
	) {}

	/** Ask now, then every `everyMs` while on screen. */
	start(): void {
		void this.check();
		this.timer = setTimeout(() => this.tick(), this.everyMs);
	}

	/** The page came back on screen: ask again, unless it asked a moment ago. */
	shown(): void {
		if (this.now() - this.askedAt >= this.everyMs / 3) void this.check();
	}

	stop(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	private tick(): void {
		if (this.onScreen()) void this.check();
		this.timer = setTimeout(() => this.tick(), this.everyMs);
	}

	private async check(): Promise<void> {
		if (this.asking) return;
		this.asking = true;
		this.askedAt = this.now();
		let ready = false;
		try {
			ready = await this.ask();
		} catch {
			ready = false;
		} finally {
			this.asking = false;
		}
		this.heard(ready);
	}
}

/**
 * Where a cursor goes when the rows it lights change under it (the account's
 * rows come or go): to the row it lit, where that row is now; when that row
 * went, to the next one still shown after it, else the last. `cursor` is an
 * index into `before`; the answer is one into `after`. A cursor past the rows
 * (nothing lit) stays where it is.
 */
export function relit<T>(before: readonly T[], after: readonly T[], cursor: number): number {
	const lit = before[cursor];
	if (lit === undefined || after.length === 0) return cursor;
	const at = after.indexOf(lit);
	if (at >= 0) return at;
	const next = before.slice(cursor + 1).find((row) => after.includes(row));
	return next === undefined ? after.length - 1 : after.indexOf(next);
}
