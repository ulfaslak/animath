import type { BadgeCounts, GameEvent } from '@mathgame/engine';

/**
 * The kid's badges ([[PRODUCT]] §4 "Badges"; [[UI_SPEC]] § Explore mode,
 * "A new badge"): what the badges page shows, from `welcome` and every
 * `badges-changed`, and the note that celebrates each new one over the world.
 *
 * A badge earned while the world is not on screen (in a battle, at the
 * druid's, in the pause menu, during a trip) waits, and its note comes once
 * the kid is back in the world; several wait in a queue, shown one after the
 * other. A game picked up with badges it had not been given yet (one from
 * before badges) gets them without a note each: one line says how many
 * (`found`), and a reload drops the queue, as it drops a surprise party.
 */

/** Seconds a badge's note stays on screen. */
export const BADGE_NOTE_SECONDS = 3.5;

/** A note over the world: a badge just earned, or how many a game picked up was given. */
export type BadgeNote = { kind: 'new'; id: string } | { kind: 'found'; count: number };

class BadgesView {
	/** Every badge earned, by id, in the order earned (an id this build lacks among them). */
	earned = $state.raw<readonly string[]>([]);
	/** Each ladder's number (`badgeCounts`), by family id, as the authority last told it. */
	counts = $state.raw<BadgeCounts>({});
	/** The note on screen; else null. */
	note = $state.raw<BadgeNote | null>(null);
	/** The notes waiting for the world, the next first. */
	private due: BadgeNote[] = [];
	private left = 0;

	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.earned = event.badges;
				this.counts = event.counts;
				this.note = null;
				this.due = event.found > 0 ? [{ kind: 'found', count: event.found }] : [];
				break;
			case 'badges-changed':
				this.earned = event.badges;
				this.counts = event.counts;
				this.due.push(...event.fresh.map((id) => ({ kind: 'new' as const, id })));
				break;
			case 'game-left':
				this.note = null;
				this.due = [];
				break;
		}
	}

	/**
	 * Every frame: `showing` is whether the world is on screen with nothing
	 * over it. A note stays its time, then the next waiting comes. Says true
	 * the frame a badge's note starts (for its sound), never for `found`.
	 */
	tick(dt: number, showing: boolean): boolean {
		if (this.note) {
			// Its time runs only while it can be seen: a battle that covers it keeps it for after.
			if (showing) this.left -= dt;
			if (this.left > 0) return false;
			this.note = null;
		}
		const next = showing ? this.due.shift() : undefined;
		if (!next) return false;
		this.note = next;
		this.left = BADGE_NOTE_SECONDS;
		return next.kind === 'new';
	}
}

export const badges = new BadgesView();
