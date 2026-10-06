import { parseJson, type KeyValueStore } from '../save/storage';

/**
 * When the "keep your animals safe" card is due in a guest's game
 * ([[DECISIONS]] § Accounts): after every 1,000 steps, the game's own count
 * of them (the one saved with it, in every world together). What is kept is
 * only the step the card is due at, per game (its lineage), in the browser
 * beside the save, never in it: two tabs of one game would otherwise differ
 * in more than where they walked.
 *
 * Only the game being played is followed; a new game (a new lineage) starts
 * from its own steps.
 */

/** The steps between cards. `?steps=<n>` makes it fewer, to try the card. */
export const NUDGE_STEPS = 1000;

/** The key the next card's step is kept under. */
export const NUDGE_KEY = 'animath.nudge';

/** The key the hour clock that came before was kept under, cleared once read past. */
const RETIRED_KEY = 'animath.playtime';

interface Due {
	/** The game followed. */
	lineage: string;
	/** The step the card is due at. */
	next: number;
}

export class SaveNudge {
	private card: Due | null = null;

	constructor(
		private readonly store: KeyValueStore | null,
		private readonly every = NUDGE_STEPS
	) {
		store?.remove(RETIRED_KEY);
	}

	/** The next whole `every` past `steps`: one card, however many were missed. */
	private after(steps: number): number {
		return (Math.floor(steps / this.every) + 1) * this.every;
	}

	/**
	 * The card's step for `lineage`: the one kept, when it is that game's,
	 * else the next whole `every` past the steps it has, written at once, so
	 * a reload past it still finds the card due. A kept one is due at most
	 * `every` steps from now: one written with a longer stretch (before
	 * `?steps=` shortened it) would still wait for its own (#156).
	 */
	private of(lineage: string, steps: number): Due {
		if (this.card?.lineage === lineage) return this.card;
		const kept = this.read();
		if (kept?.lineage === lineage) {
			this.card = { lineage, next: Math.min(kept.next, steps + this.every) };
		} else {
			this.card = { lineage, next: this.after(steps) };
			this.write();
		}
		return this.card;
	}

	private read(): Due | null {
		const parsed = parseJson(this.store?.get(NUDGE_KEY) ?? '');
		if (typeof parsed !== 'object' || parsed === null) return null;
		const { lineage, next } = parsed as Record<string, unknown>;
		if (typeof lineage !== 'string' || typeof next !== 'number' || !Number.isFinite(next)) {
			return null;
		}
		return { lineage, next };
	}

	private write(): void {
		if (this.card) this.store?.set(NUDGE_KEY, JSON.stringify(this.card));
	}

	/** Whether the card is due for the game `lineage`, which has walked `steps`. */
	due(lineage: string, steps: number): boolean {
		return steps >= this.of(lineage, steps).next;
	}

	/**
	 * The card was answered (either way): it comes back once another whole
	 * `every` steps has been walked, whatever was missed while the kid was busy.
	 */
	answered(lineage: string, steps: number): void {
		this.of(lineage, steps).next = this.after(steps);
		this.write();
	}
}
