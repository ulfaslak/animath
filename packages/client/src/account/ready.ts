import { bundles } from '@mathgame/engine';
import { game } from '../state/game.svelte';
import { menuItems, pause } from '../state/pause.svelte';
import { title } from '../state/title.svelte';
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
 * Runs `change`, which may add or take away the account's rows, and keeps
 * the pause menu's cursor and the title's on the rows they lit (`relit`).
 * A pause menu row that went leaves the cursor on Keep playing, never on
 * the row after it: after "Log in" comes "Log out", which acts at once.
 */
export function keepingCursors(change: () => void): void {
	const cards = bundles(game.party).length;
	const items = menuItems();
	const rows = title.rows;
	change();
	if (pause.cursor >= cards) {
		pause.cursor = cards + relit(items, menuItems(), pause.cursor - cards, 'resume');
	}
	title.cursor = relit(rows, title.rows, title.cursor);
}

/**
 * Where a cursor goes when the rows it lights change under it (the account's
 * rows come or go): to the row it lit, where that row is now. When that row
 * went, to `safe` when it is shown (a row whose Enter changes nothing that
 * matters, such as Keep playing: a kid mid-press on "Log in" must never land
 * on "Log out"), else to the next one still shown after it, else the last.
 * `cursor` is an index into `before`; the answer is one into `after`. A
 * cursor past the rows (nothing lit) stays where it is.
 */
export function relit<T>(
	before: readonly T[],
	after: readonly T[],
	cursor: number,
	safe?: T
): number {
	const lit = before[cursor];
	if (lit === undefined || after.length === 0) return cursor;
	const at = after.indexOf(lit);
	if (at >= 0) return at;
	if (safe !== undefined && after.includes(safe)) return after.indexOf(safe);
	const next = before.slice(cursor + 1).find((row) => after.includes(row));
	return next === undefined ? after.length - 1 : after.indexOf(next);
}
