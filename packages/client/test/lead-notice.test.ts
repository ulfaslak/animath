import type { AnimalInstance, PartyIntent } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import type { CueName } from '../src/audio/cues';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import { t } from '../src/copy';
import { parseParty } from '../src/flags';
import { animalWords } from '../src/names';
import { game } from '../src/state/game.svelte';
import { hud, leadNotice } from '../src/state/hud.svelte';

/**
 * The message line's word on who goes first. The authority sends only facts
 * (`party-edited`); the HUD turns them into a line, worded when shown. What it
 * must never do is keep a line that no longer matches the cards.
 */
function setup(startingParty: string) {
	const authority = new LocalAuthority({ party: parseParty(startingParty)! });
	authority.subscribe((e) => {
		game.apply(e);
		hud.apply(e);
	});
	authority.start();
	hud.tick(0);
	const edit = (intent: PartyIntent) => {
		authority.dispatch({ type: 'party', intent });
		hud.tick(0);
	};
	return { authority, edit };
}

/** A name is every form of itself, as a nickname is. */
const chosen = (name: string) => t('party.leadChosen', { animal: name });

describe('the line about who goes first', () => {
	it('names the lead after any edit that changes who it is, and only then', () => {
		const { edit } = setup('squirrel,rabbit,fox');
		const [squirrel, rabbit, fox] = game.party;
		expect(hud.message).toBe('');

		edit({ type: 'select-lead', animalId: fox!.id });
		expect(hud.message).toBe(chosen('Fox'));
		// The fox's card goes to the back (dragged, or the pause menu): the squirrel leads again.
		edit({ type: 'move-species', speciesId: fox!.speciesId, to: 2 });
		expect(hud.message).toBe(chosen('Squirrel'));
		// A new name for the lead shows in the line at once.
		edit({ type: 'rename', animalId: squirrel!.id, nickname: 'Pip' });
		expect(hud.message).toBe(chosen('Pip'));
		// Edits that leave the lead where it was say nothing new.
		edit({ type: 'rename', animalId: rabbit!.id, nickname: 'Hop' });
		edit({ type: 'move-species', speciesId: rabbit!.speciesId, to: 2 });
		expect(hud.message).toBe(chosen('Pip'));
	});

	it('names the lead a card chose, and the one a card dropped at the top leads with', () => {
		const { edit } = setup('squirrel,rabbit*3,fox');
		const [, hop] = game.party.filter((a) => a.speciesId === 'rabbit');
		edit({ type: 'rename', animalId: hop!.id, nickname: 'Hop' });
		// The rabbits' card goes first: its first rabbit standing leads.
		edit({ type: 'lead-species', speciesId: 'rabbit' });
		expect(hud.message).toBe(chosen('Rabbit'));
		// Chosen from the open card: that rabbit.
		edit({ type: 'select-lead', animalId: hop!.id });
		expect(hud.message).toBe(chosen('Hop'));
		// The fox's card dropped at the top.
		edit({ type: 'move-species', speciesId: 'fox', to: 0 });
		expect(hud.message).toBe(chosen('Fox'));
	});

	it('says why a lead was not chosen', () => {
		const { edit } = setup('squirrel,rabbit:0');
		const [squirrel, rabbit] = game.party;
		edit({ type: 'select-lead', animalId: rabbit!.id });
		expect(hud.message).toBe(t('party.leadTired', { animal: 'Rabbit' }));
		edit({ type: 'select-lead', animalId: squirrel!.id });
		expect(hud.message).toBe(t('party.leadAlready', { animal: 'Squirrel' }));
	});

	it('on land, says a sea animal lives in the sea, by its number or its card', () => {
		const { edit } = setup('squirrel,crab,whale,whale');
		const crab = game.party.find((a) => a.speciesId === 'crab')!;
		edit({ type: 'select-lead', animalId: crab.id });
		expect(hud.message).toBe(t('party.leadInTheSea', { animal: 'Crab' }));
		edit({ type: 'lead-species', speciesId: 'crab' });
		expect(hud.message).toBe(t('party.leadInTheSea', { animal: 'Crab' }));
		// A card of two: named by their kind.
		edit({ type: 'lead-species', speciesId: 'whale' });
		const whales = t('party.leadInTheSea', { animal: animalWords({ speciesId: 'whale' }) });
		expect(hud.message).toBe(whales);
		expect(whales).not.toBe(
			t('party.leadCantSwim', { animal: animalWords({ speciesId: 'whale' }) })
		);
		expect(game.party[0]!.speciesId).toBe('squirrel');
	});

	it('on land, a sea animal’s card put at the top says why it still doesn’t go first', () => {
		const { edit } = setup('squirrel,rabbit,crab,whale*2');
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		// Dropped at the top, or moved up to it in the pause menu: on top, and the squirrel leads.
		edit({ type: 'move-species', speciesId: 'crab', to: 0 });
		expect(game.party[0]!.speciesId).toBe('crab');
		expect(hud.message).toBe(t('party.leadInTheSea', { animal: 'Crab' }));
		edit({ type: 'move-species', speciesId: 'whale', to: 0 });
		expect(hud.message).toBe(
			t('party.leadInTheSea', { animal: animalWords({ speciesId: 'whale' }) })
		);
		// A refusal, heard as none: no ding.
		expect(cues).toEqual([]);
		stop();
		// Anywhere below the top it makes no promise, and says nothing new.
		edit({
			type: 'rename',
			animalId: game.party.find((a) => a.speciesId === 'rabbit')!.id,
			nickname: 'Hop'
		});
		edit({ type: 'move-species', speciesId: 'crab', to: 2 });
		expect(hud.message).toBe(
			t('party.leadInTheSea', { animal: animalWords({ speciesId: 'whale' }) })
		);
		// A land animal's card at the top goes first, as ever.
		edit({ type: 'move-species', speciesId: 'rabbit', to: 0 });
		expect(hud.message).toBe(chosen('Hop'));
	});

	it('a new lead dings with its line; a refusal, or an edit that keeps the lead, is quiet', () => {
		const { edit } = setup('squirrel,rabbit:0,fox');
		const [squirrel, rabbit, fox] = game.party;
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		edit({ type: 'select-lead', animalId: rabbit!.id }); // tired
		edit({ type: 'select-lead', animalId: squirrel!.id }); // already first
		edit({ type: 'rename', animalId: squirrel!.id, nickname: 'Pip' });
		expect(cues).toEqual([]);
		edit({ type: 'select-lead', animalId: fox!.id });
		expect(cues).toEqual(['lead']);
		// Moving the fox to the back puts the squirrel in front: a new lead too.
		edit({ type: 'move-species', speciesId: fox!.speciesId, to: 2 });
		expect(cues).toEqual(['lead', 'lead']);
		stop();
	});

	it('the newest line is the one shown', () => {
		const { authority, edit } = setup('squirrel,fox');
		const fox = game.party[1]!;
		authority.dispatch({ type: 'interact' }); // no tent in front: how to find one
		hud.tick(0);
		expect(hud.message).toBe(t('explore.notAtTent'));
		edit({ type: 'select-lead', animalId: fox.id });
		expect(hud.message).toBe(chosen('Fox'));
		authority.dispatch({ type: 'interact' });
		hud.tick(0);
		expect(hud.message).toBe(t('explore.notAtTent'));
	});

	it('goes when the world changes the party, since the lead may have changed with it', () => {
		const { edit } = setup('squirrel,fox');
		edit({ type: 'select-lead', animalId: game.party[1]!.id });
		expect(hud.message).toBe(chosen('Fox'));
		const tired = game.party.map((a) => ({ ...a, hp: 0 }));
		game.apply({ type: 'party-changed', party: tired });
		hud.apply({ type: 'party-changed', party: tired });
		expect(hud.message).toBe('');
	});
});

describe('leadNotice', () => {
	const at = (...hp: number[]): AnimalInstance[] =>
		hp.map((h, i) => ({ id: `a${i}`, speciesId: 'squirrel', hp: h }));

	it('undoes a move to see who led before it', () => {
		// a0 moved from the front to the back: a1 leads now.
		const after = [...at(20, 20, 20).slice(1), at(20)[0]!];
		expect(leadNotice(after, [{ type: 'reordered', animalId: 'a0', from: 0, to: 2 }])).toEqual({
			lead: 'chosen',
			animalId: 'a1'
		});
		// Behind a tired a0, a2 moved up past a1: a2 leads now.
		const tiredFirst = at(0, 20, 20);
		const moved = [tiredFirst[0]!, tiredFirst[2]!, tiredFirst[1]!];
		expect(leadNotice(moved, [{ type: 'reordered', animalId: 'a2', from: 2, to: 1 }])).toEqual({
			lead: 'chosen',
			animalId: 'a2'
		});
		// The tired a0 moved to the front: a1 still leads, so there is nothing to say.
		expect(
			leadNotice(tiredFirst, [{ type: 'reordered', animalId: 'a0', from: 1, to: 0 }])
		).toBeNull();
	});

	it('undoes a card moved to another place to see who led before it', () => {
		const party = (...kinds: [string, number][]): AnimalInstance[] =>
			kinds.map(([speciesId, hp], i) => ({ id: `${speciesId}${i}`, speciesId, hp }));
		// Rabbits, then a fox: the fox's card moved from the back to the top.
		const after = party(['fox', 30], ['rabbit', 20], ['rabbit', 20]);
		const moved = { type: 'species-moved', speciesId: 'fox', from: 1, to: 0 } as const;
		expect(leadNotice(after, [moved])).toEqual({ lead: 'chosen', animalId: 'fox0' });
		// A card of tired rabbits moved to the top: the fox still leads.
		const tired = party(['rabbit', 0], ['rabbit', 0], ['fox', 30]);
		const back = { type: 'species-moved', speciesId: 'rabbit', from: 1, to: 0 } as const;
		expect(leadNotice(tired, [back])).toBeNull();
	});

	it('out on the water, a card that can’t swim put at the top says so; one that swims goes first', () => {
		const party = (...kinds: [string, number][]): AnimalInstance[] =>
			kinds.map(([speciesId, hp], i) => ({ id: `${speciesId}${i}`, speciesId, hp }));
		const after = party(['squirrel', 20], ['otter', 32], ['frog', 21]);
		const up = { type: 'species-moved', speciesId: 'squirrel', from: 2, to: 0 } as const;
		expect(leadNotice(after, [up], 'water')).toEqual({ lead: 'cantSwim', speciesId: 'squirrel' });
		// The same card on land leads.
		expect(leadNotice(after, [up], 'land')).toEqual({ lead: 'chosen', animalId: 'squirrel0' });
		// The frog's card put above the otter's, out on the water: the frog leads there now.
		const frogUp = party(['frog', 21], ['otter', 32], ['squirrel', 20]);
		const moved = { type: 'species-moved', speciesId: 'frog', from: 2, to: 0 } as const;
		expect(leadNotice(frogUp, [moved], 'water')).toEqual({ lead: 'chosen', animalId: 'frog0' });
	});
});
