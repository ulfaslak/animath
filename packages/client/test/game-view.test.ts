import type { PartyIntent } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority, partyFromParam } from '../src/authority/local';
import { game } from '../src/state/game.svelte';

/**
 * The game view's line about the lead: the authority sends only facts
 * (`party-edited`), and the view turns them into a notice the HUD words in
 * the language on screen. What it must never do is keep an old line that no
 * longer matches the cards.
 */
function setup(startingParty: string) {
	const authority = new LocalAuthority({ party: partyFromParam(startingParty) });
	authority.subscribe((e) => game.apply(e));
	authority.start();
	const edit = (intent: PartyIntent) => authority.dispatch({ type: 'party', intent });
	return { authority, edit };
}

describe('the notice about the lead', () => {
	it('names the lead after any edit that changes who it is, and only then', () => {
		const { edit } = setup('squirrel,rabbit,fox');
		const [squirrel, rabbit, fox] = game.party;
		expect(game.notice).toBeNull();

		edit({ type: 'select-lead', animalId: fox!.id });
		expect(game.notice).toEqual({ kind: 'chosen', animalId: fox!.id });
		// The pause menu moves the fox to the back: the squirrel leads again.
		edit({ type: 'reorder', animalId: fox!.id, to: 2 });
		expect(game.notice).toEqual({ kind: 'chosen', animalId: squirrel!.id });
		// Edits that leave the lead where it was keep the line (a new name for
		// the lead shows through it, since the HUD reads the name by id).
		const kept = game.notice;
		edit({ type: 'rename', animalId: squirrel!.id, nickname: 'Pip' });
		edit({ type: 'rename', animalId: rabbit!.id, nickname: 'Hop' });
		edit({ type: 'reorder', animalId: rabbit!.id, to: 2 });
		expect(game.notice).toBe(kept);
	});

	it('says why a lead was not chosen', () => {
		const { edit } = setup('squirrel,rabbit:0');
		const [squirrel, rabbit] = game.party;
		edit({ type: 'select-lead', animalId: rabbit!.id });
		expect(game.notice).toEqual({ kind: 'tired', animalId: rabbit!.id });
		edit({ type: 'select-lead', animalId: squirrel!.id });
		expect(game.notice).toEqual({ kind: 'already', animalId: squirrel!.id });
	});

	it('the newest of an authority message and a notice is the one shown', () => {
		const { authority, edit } = setup('squirrel,fox');
		const fox = game.party[1]!;
		authority.dispatch({ type: 'interact' });
		expect(game.message).not.toBe('');
		edit({ type: 'select-lead', animalId: fox.id });
		expect(game.notice).not.toBeNull();
		expect(game.message).toBe('');
		authority.dispatch({ type: 'interact' });
		expect(game.notice).toBeNull();
		expect(game.message).not.toBe('');
	});
});
