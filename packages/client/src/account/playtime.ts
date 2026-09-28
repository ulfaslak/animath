import { parseJson, type KeyValueStore } from '../save/storage';

/**
 * How long a guest has played their game, and when the "keep your animals
 * safe" card is due ([[DECISIONS]] § Accounts): after every hour of play,
 * counted per game (its lineage) while the page is on screen. The count
 * lives in the browser beside the save, never in it: two tabs of one game
 * would otherwise differ in more than where they walked.
 *
 * Only the game being played is counted; a new game (a new lineage) starts
 * its own clock. The count is written every few seconds of play, so a reload
 * loses at most those.
 */

/** An hour of play. `?hour=<seconds>` makes it shorter, to try the card. */
export const PLAY_HOUR_MS = 60 * 60 * 1000;

/** The key the clock is kept under. */
export const PLAYTIME_KEY = 'animath.playtime';

/** How much play is counted between writes of the clock. */
const WRITE_EVERY_MS = 10_000;

interface Clock {
	/** The game counted. */
	lineage: string;
	/** Its play so far. */
	ms: number;
	/** When the card is due next, in `ms`. */
	next: number;
}

export class PlayClock {
	private clock: Clock | null = null;
	private unwritten = 0;

	constructor(
		private readonly store: KeyValueStore | null,
		private readonly hourMs = PLAY_HOUR_MS
	) {}

	/**
	 * The clock of `lineage`: the one kept, when it is that game's, else a new
	 * one. A kept clock is due at most an hour of this page's from now: one
	 * written with a longer hour (before `?hour=` shortened it) would still
	 * wait for its own (#156). One kept with this hour is read as it was, since
	 * its next card is never further than that.
	 */
	private of(lineage: string): Clock {
		if (this.clock?.lineage === lineage) return this.clock;
		const kept = this.read();
		this.clock =
			kept?.lineage === lineage
				? { ...kept, next: Math.min(kept.next, kept.ms + this.hourMs) }
				: { lineage, ms: 0, next: this.hourMs };
		return this.clock;
	}

	private read(): Clock | null {
		const parsed = parseJson(this.store?.get(PLAYTIME_KEY) ?? '');
		if (typeof parsed !== 'object' || parsed === null) return null;
		const { lineage, ms, next } = parsed as Record<string, unknown>;
		if (typeof lineage !== 'string' || typeof ms !== 'number' || typeof next !== 'number') {
			return null;
		}
		if (!Number.isFinite(ms) || !Number.isFinite(next) || ms < 0) return null;
		return { lineage, ms, next };
	}

	private write(): void {
		if (this.clock) this.store?.set(PLAYTIME_KEY, JSON.stringify(this.clock));
		this.unwritten = 0;
	}

	/** `seconds` more of play in the game `lineage`, the page on screen. */
	tick(lineage: string, seconds: number): void {
		if (!(seconds > 0)) return;
		const clock = this.of(lineage);
		const ms = seconds * 1000;
		clock.ms += ms;
		this.unwritten += ms;
		if (this.unwritten >= WRITE_EVERY_MS) this.write();
	}

	/** Whether the card is due for the game `lineage`: another hour of play has passed. */
	due(lineage: string): boolean {
		const clock = this.of(lineage);
		return clock.ms >= clock.next;
	}

	/**
	 * The card was answered (either way): it comes back once another whole
	 * hour of play has passed, whatever was missed while the kid was busy.
	 */
	answered(lineage: string): void {
		const clock = this.of(lineage);
		clock.next = (Math.floor(clock.ms / this.hourMs) + 1) * this.hourMs;
		this.write();
	}

	/** Keep what was counted: before the page goes. */
	flush(): void {
		if (this.unwritten > 0) this.write();
	}
}
