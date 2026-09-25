import {
	leadIndex,
	type AnimalInstance,
	type GameEvent,
	type GridPos,
	type PartyEvent
} from '@mathgame/engine';

/**
 * What the message line says about the lead after a party edit, as facts the
 * HUD puts into words (`party.leadChosen`, `party.leadTired`,
 * `party.leadAlready`): the words are picked when shown, in the language on
 * screen. `animalId` names the animal; the HUD reads its name from the party.
 */
export interface PartyNotice {
	kind: 'chosen' | 'tired' | 'already';
	animalId: string;
}

/**
 * The UI's read-only view of the game. It is filled exclusively from
 * authority events — Svelte components never poke game state directly.
 *
 * `mode` is the authority's mode: it flips to `battle` on `battle-started`
 * and back on `battle-ended`. The battle *screen* stays up a little longer
 * than that (the last events are narrated, then a result card waits for
 * Enter); that presentation state lives in `battle.svelte.ts`.
 *
 * The message line shows the newest of `message` (the authority's line) and
 * `notice` (a line about the lead): each clears the other.
 */
class GameView {
	mode = $state<'loading' | 'explore' | 'battle'>('loading');
	playerId = $state<string>('');
	seed = $state<number>(0);
	pos = $state<GridPos>({ x: 0, y: 0 });
	party = $state<AnimalInstance[]>([]);
	message = $state<string>('');
	notice = $state<PartyNotice | null>(null);

	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.pos = event.pos;
				this.party = event.party;
				this.mode = 'explore';
				this.notice = null;
				break;
			case 'player-moved':
			case 'player-placed':
				if (event.playerId === this.playerId) this.pos = event.pos;
				break;
			case 'battle-started':
				this.mode = 'battle';
				break;
			case 'battle-ended':
				this.mode = 'explore';
				break;
			case 'party-changed':
				// The world changed the party (a battle's result, a rest): a line
				// about who goes first may no longer be true.
				this.party = event.party;
				this.notice = null;
				break;
			case 'party-edited': {
				const notice = leadNotice(this.party, event.party, event.events);
				this.party = event.party;
				if (notice) {
					this.notice = notice;
					this.message = '';
				}
				break;
			}
			case 'message':
				this.message = event.text;
				this.notice = null;
				break;
		}
	}
}

/**
 * The line a party edit puts on the message bar, if any. A lead that can't be
 * chosen is told why — nothing else on screen would say. Otherwise, whenever
 * the edit changed who goes first (a number key, a move in the pause menu),
 * the bar names the new lead, so an earlier "Fox goes first!" never outlives
 * the fox's place at the front. A notice names its animal by id and the HUD
 * reads the name when it draws, so a new name shows at once.
 */
export function leadNotice(
	before: readonly AnimalInstance[],
	after: readonly AnimalInstance[],
	events: readonly PartyEvent[]
): PartyNotice | null {
	for (const e of events) {
		if (e.type !== 'rejected' || e.animalId === undefined) continue;
		if (e.reason === 'tired') return { kind: 'tired', animalId: e.animalId };
		if (e.reason === 'already-lead') return { kind: 'already', animalId: e.animalId };
	}
	const was = before[leadIndex(before)];
	const is = after[leadIndex(after)];
	if (!is || was?.id === is.id) return null;
	return { kind: 'chosen', animalId: is.id };
}

export const game = new GameView();
