import type { GameEvent } from '@mathgame/engine';

/**
 * A listener that keeps the events of the rules a test is about in `events`:
 * the badges' own (`badges-changed`), which follow whatever counts for one (a
 * catch, a tree cleared, a trip, a visit to the druid), go to `badges` when it
 * is given and nowhere else, so a test of a walk, a catch or a trip reads its
 * own events. `local-authority.test.ts` § badges reads them.
 */
export function rulesOf(events: GameEvent[], badges?: GameEvent[]): (e: GameEvent) => void {
	return (e) => {
		if (e.type !== 'badges-changed') events.push(e);
		else badges?.push(e);
	};
}
