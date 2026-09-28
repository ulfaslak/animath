import {
	bundles,
	leadIndex,
	newGame,
	type BattleState,
	type Direction,
	type GameEvent,
	type GridPos,
	type SavedGame
} from '@mathgame/engine';
import { describe, expect, it, vi } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { t } from '../src/copy';
import { parseParty } from '../src/flags';
import { ExploreController } from '../src/explore/controller';
import { HOLD_TO_FLY, Keyboard } from '../src/input/keyboard';
import { PICK_QUIET_SECONDS } from '../src/input/pick-guard';
import { animalKey, bundleKey, moveKey, openKey } from '../src/input/press';
import { DESCEND_SECONDS, GLIDE_SECONDS, RISE_SECONDS } from '../src/render/trainer';
import { PauseController } from '../src/pause/controller';
import type { GameRenderer } from '../src/render/renderer';
import { game } from '../src/state/game.svelte';
import { skyPieces } from './sky-pieces';
import { hud } from '../src/state/hud.svelte';
import { team } from '../src/state/team.svelte';

/**
 * Explore input against the real authority: what a frame sends, and in which
 * order. The window and the renderer are stand-ins; the keyboard, the
 * controller and the authority are the real ones.
 */
function setup(startingParty: string, saved?: SavedGame) {
	const listeners = new Map<string, (e: unknown) => void>();
	const target = {
		addEventListener: (type: string, listener: (e: unknown) => void) =>
			listeners.set(type, listener)
	} as unknown as Window;
	const keyboard = new Keyboard(target);
	keyboard.setEnabled(true); // explore has the screen, as main.ts says each frame
	/** Where the landing ring was put, each time, and the tool over it. */
	const rings: ({ x: number; y: number; tool: string | null } | null)[] = [];
	const sky = skyPieces();
	const renderer = {
		setWorld() {},
		setBoat() {},
		setGlider() {},
		setLandingSpot(at: GridPos | null, tool: string | null = null) {
			rings.push(at && { ...at, tool });
		},
		setPlayer() {},
		ensureChunksAround() {},
		cleared() {},
		trainerPoint: sky.trainerPoint,
		chaser: sky.chaser
	} as unknown as GameRenderer;
	const authority = new LocalAuthority({ party: parseParty(startingParty)! });
	const explore = new ExploreController(authority, renderer, keyboard);
	// Every party-edited reaches the pause menu too, open or not, as in main.ts.
	const pauseMenu = new PauseController(authority);
	const events: GameEvent[] = [];
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
		hud.apply(e);
		explore.handle(e);
		pauseMenu.handle(e);
	});
	authority.start(saved ? { game: saved } : {});
	team.close();
	// Past Talk's quiet moment: explore has had the screen a while.
	keyboard.tick(PICK_QUIET_SECONDS);
	/** A key pressed in explore, handed over as main.ts hands it. */
	const press = (key: string, extra: Partial<KeyboardEvent> = {}) =>
		keyboard.keydown({
			key,
			repeat: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			preventDefault() {},
			...extra
		} as unknown as KeyboardEvent);
	const release = (key: string) => listeners.get('keyup')!({ key });
	/** A key, then the frame that takes it. */
	const frame = (key: string) => {
		press(key);
		explore.update(1 / 60);
		hud.tick(1 / 60);
	};
	/** `seconds` of frames, a sixtieth at a time. */
	const run = (seconds: number) => {
		for (let s = 0; s < seconds - 1e-9; s += 1 / 60) {
			explore.update(1 / 60);
			hud.tick(1 / 60);
		}
	};
	/** The species of the cards, top to bottom. */
	const cards = () => bundles(game.party).map((b) => b.speciesId);
	return { authority, explore, events, press, release, frame, run, cards, rings, listeners, sky };
}

describe('explore input', () => {
	it('a number pressed on the frame a step starts a battle picks the animal that fights', () => {
		const { authority, explore, events, press, release } = setup('squirrel,rabbit');
		const rabbit = game.party[1]!;
		// Left, right, … from the spawn tile: the 11th step meets a wild animal.
		// Take the first ten straight from the authority, then let the tween land.
		for (let i = 0; i < 10; i++)
			authority.dispatch({ type: 'move', dir: i % 2 === 0 ? 'left' : 'right' });
		explore.update(1);
		expect(events.some((e) => e.type === 'battle-started')).toBe(false);

		// The 11th step and the number 2 arrive in the same frame.
		press('ArrowLeft');
		press('2');
		explore.update(1 / 60);
		release('ArrowLeft');

		const started = events.find((e) => e.type === 'battle-started');
		expect(started).toBeDefined();
		const state = (started as { state: BattleState }).state;
		expect(state.party[state.active]!.id).toBe(rabbit.id);
	});

	it('a number key picks the card in that place, whose first animal standing goes first', () => {
		const { frame, cards } = setup('squirrel,rabbit:0,rabbit*2,fox');
		expect(cards()).toEqual(['squirrel', 'rabbit', 'fox']);
		frame('2');
		// The rabbits' card goes to the top; its first rabbit is tired, so the next one leads.
		expect(cards()).toEqual(['rabbit', 'squirrel', 'fox']);
		expect(game.party.map((a) => a.hp > 0)).toEqual([true, false, true, true, true]);
		expect(hud.message).toBe(t('party.leadChosen', { animal: 'Rabbit' }));
		frame('3');
		expect(cards()).toEqual(['fox', 'rabbit', 'squirrel']);
		// A number past the last card does nothing.
		const before = game.party.map((a) => a.id);
		frame('9');
		expect(game.party.map((a) => a.id)).toEqual(before);
	});

	it('a number key for the lead, or for a card of tired animals, is answered on the HUD, and logs no warning (#59)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { frame } = setup('squirrel,rabbit:0,fox:0*2');
			frame('1');
			expect(hud.message).toBe(t('party.leadAlready', { animal: 'Squirrel' }));
			frame('2');
			expect(hud.message).toBe(t('party.leadTired', { animal: 'Rabbit' }));
			frame('3');
			expect(hud.message).toBe(t('party.leadAllTired'));
			expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
		} finally {
			warn.mockRestore();
		}
	});

	it("turns the party column's pointer keys into party intents, and opens a card", () => {
		const { frame, cards, press, release, explore } = setup('squirrel,rabbit*3,fox');
		const hop = game.party.filter((a) => a.speciesId === 'rabbit')[1]!;
		// A card of several opens, and closes again.
		frame(openKey('rabbit'));
		expect(team.open).toBe('rabbit');
		frame(openKey('rabbit'));
		expect(team.open).toBeNull();
		// An animal on an open card goes first, and the card closes.
		frame(openKey('rabbit'));
		frame(animalKey(hop.id));
		expect(game.party[0]!.id).toBe(hop.id);
		expect(team.open).toBeNull();
		// A card of one animal goes first as a whole.
		frame(bundleKey('fox'));
		expect(cards()).toEqual(['fox', 'rabbit', 'squirrel']);
		// A card dropped at another place moves there.
		frame(moveKey('squirrel', 0));
		expect(cards()).toEqual(['squirrel', 'fox', 'rabbit']);
		// A step puts an open card away.
		frame(openKey('rabbit'));
		expect(team.open).toBe('rabbit');
		press('ArrowRight');
		explore.update(1 / 60);
		release('ArrowRight');
		expect(team.open).toBeNull();
	});
});

describe('the glider', () => {
	const SPAWN = { x: -2, y: 6 };
	/** A game in World 1 at `pos`, facing `facing`, owning the glider and `items`. */
	function flyer(pos: GridPos, facing: Direction, items: string[] = []): SavedGame {
		return { ...newGame(1), pos, facing, items: ['glider', ...items] };
	}
	const count = (events: GameEvent[], type: GameEvent['type']) =>
		events.filter((e) => e.type === type).length;

	it('Space held flies over the lake: up after the wind-up, a glide a tile at a time while held, and let go, on to the far shore and down', () => {
		const s = setup('squirrel', flyer(SPAWN, 'up'));
		s.press(' ');
		s.run(HOLD_TO_FLY * 0.8);
		expect(count(s.events, 'took-off')).toBe(0);
		s.run(HOLD_TO_FLY * 0.3);
		expect(count(s.events, 'took-off')).toBe(1);
		expect(game.flying).toBe(true);
		expect(s.explore.flying).toBe(true);
		// The ring stands on the sand of the far shore: letting go over the water lands there.
		expect(s.rings.at(-1)).toEqual({ x: -2, y: -8, tool: null });
		// Up, then a tile every GLIDE_SECONDS while Space is held.
		s.run(RISE_SECONDS + GLIDE_SECONDS * 4 + 0.05);
		expect(count(s.events, 'glided')).toBeGreaterThanOrEqual(4);
		expect(count(s.events, 'glided')).toBeLessThanOrEqual(5);
		s.release(' ');
		s.run(GLIDE_SECONDS * 10 + 0.1);
		// Let go over the water: glided on, a tile at a time, to the sand, and landed there.
		const landed = s.events.find((e) => e.type === 'landed');
		expect(landed).toMatchObject({ pos: { x: -2, y: -8 }, flown: 14 });
		expect(count(s.events, 'glided')).toBe(14);
		expect(game.flying).toBe(false);
		// Coming down, then down: the ring gone, the menu and the party column free again.
		expect(s.explore.flying).toBe(true);
		s.run(DESCEND_SECONDS + 0.05);
		expect(s.explore.flying).toBe(false);
		expect(s.rings.at(-1)).toBeNull();
		expect(s.authority.snapshot()).toMatchObject({ pos: { x: -2, y: -8 }, steps: 14 });
	});

	it('in the air, arrows, Enter and number keys do nothing; an arrow still held walks on from the landing tile', () => {
		const s = setup('squirrel,rabbit', flyer(SPAWN, 'up'));
		const cards = s.cards();
		s.press(' ');
		s.run(HOLD_TO_FLY + RISE_SECONDS + 0.05);
		expect(count(s.events, 'took-off')).toBe(1);
		s.press('ArrowRight');
		s.press('2');
		s.press('Enter');
		s.press(bundleKey('rabbit'));
		s.run(0.3);
		expect(count(s.events, 'player-moved')).toBe(0);
		expect(count(s.events, 'party-edited')).toBe(0);
		expect(count(s.events, 'nothing-to-interact')).toBe(0);
		expect(s.cards()).toEqual(cards);
		s.release(' ');
		s.run(3);
		expect(count(s.events, 'landed')).toBe(1);
		// Down, the arrow held all along walks on: a step right from the landing tile, onto the sand.
		const moved = s.events.find((e) => e.type === 'player-moved');
		expect(moved).toMatchObject({ pos: { x: -1, y: -8 }, dir: 'right' });
		// The number key and the card pressed in the air did nothing, then or after.
		expect(s.cards()).toEqual(cards);
	});

	it('up in the air who goes first is the lead in the air, the first bird standing: over the water never the swimmer, and with no bird nobody (#91)', () => {
		const s = setup('squirrel', {
			...flyer(SPAWN, 'up'),
			party: [
				{ id: 'nut', speciesId: 'squirrel', hp: 20 },
				{ id: 'fin', speciesId: 'otter', hp: 25 },
				{ id: 'red', speciesId: 'robin', hp: 19 }
			]
		});
		const lead = () => game.party[leadIndex(game.party, game.realm)]?.id ?? null;
		expect([game.realm, lead()]).toEqual(['land', 'nut']);
		s.press(' ');
		s.run(HOLD_TO_FLY + RISE_SECONDS + GLIDE_SECONDS * 3 + 0.05);
		expect(game.flying).toBe(true);
		expect(game.pos.y).toBeLessThanOrEqual(3);
		expect([game.realm, lead()]).toEqual(['air', 'red']);
		s.release(' ');
		s.run(3);
		expect(game.flying).toBe(false);
		expect(game.realm).toBe('land');
		// A team with no bird: up in the air nobody goes first, and nobody follows.
		const none = setup('squirrel', {
			...flyer(SPAWN, 'up'),
			party: [
				{ id: 'nut', speciesId: 'squirrel', hp: 20 },
				{ id: 'fin', speciesId: 'otter', hp: 25 }
			]
		});
		none.press(' ');
		none.run(HOLD_TO_FLY + RISE_SECONDS + GLIDE_SECONDS * 3 + 0.05);
		expect([game.realm, lead()]).toEqual(['air', null]);
	});

	it('a bird that notices the glider chases it, a "!" over it and a squawk, and swoops in to hover in front of the kid once they are down (#91)', () => {
		// A robin in the team, from the start up over the lake: a robin notices on step 4.
		const s = setup('robin', {
			...flyer(SPAWN, 'up'),
			party: [{ id: 'red', speciesId: 'robin', hp: 19 }]
		});
		s.press(' ');
		s.run(HOLD_TO_FLY + RISE_SECONDS + GLIDE_SECONDS * 4 + 0.05);
		expect(count(s.events, 'bird-follows')).toBe(1);
		expect(s.sky.chaser.species).toBe('robin');
		expect(s.sky.chaser.marked).toBe(true);
		expect(hud.message).toBe('A grumpy Robin is following you!');
		expect(s.explore.landing).toBe(true);
		// Held on to the reach: down, the battle starts, and the bird swoops in.
		s.run(3);
		expect(count(s.events, 'landed')).toBe(1);
		expect(count(s.events, 'battle-started')).toBe(1);
		expect(s.explore.flying).toBe(false);
		// Hovering in front of the kid now: the landing on screen is over, so the iris may close.
		expect(s.sky.chaser.arriving).toBe(false);
		expect(s.explore.landing).toBe(false);
		// Its battle over, the bird is gone.
		s.release(' ');
		for (let i = 0; i < 40 && count(s.events, 'battle-ended') === 0; i++)
			s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(count(s.events, 'battle-ended')).toBe(1);
		expect(s.sky.chaser.species).toBe(null);
	});

	it('holding on comes down at the reach by itself, and Space still held takes nobody up again', () => {
		// Three tiles of ground, then water, trees and rocks past the 20th.
		const s = setup('squirrel', flyer({ x: 110, y: -154 }, 'right'));
		s.press(' ');
		s.run(HOLD_TO_FLY + RISE_SECONDS + GLIDE_SECONDS * 3 + DESCEND_SECONDS + 0.2);
		expect(s.events.find((e) => e.type === 'landed')).toMatchObject({
			pos: { x: 113, y: -154 },
			flown: 3
		});
		expect(s.explore.flying).toBe(false);
		s.run(2);
		expect(count(s.events, 'took-off')).toBe(1);
	});

	it('a take-off with nowhere to land that way hops where it stands and says why', () => {
		const s = setup('squirrel', flyer({ x: 144, y: -152 }, 'down'));
		s.press(' ');
		s.run(HOLD_TO_FLY + 0.05);
		expect(count(s.events, 'take-off-refused')).toBe(1);
		expect(s.explore.flying).toBe(false);
		expect(hud.message).toBe(t('explore.tooFar'));
		expect(s.authority.snapshot().pos).toEqual({ x: 144, y: -152 });
	});

	it('a tap of Space with nothing in front says how to fly; Enter there still says how to find a doctor', () => {
		const s = setup('squirrel', flyer(SPAWN, 'up'));
		s.press(' ');
		s.run(HOLD_TO_FLY / 2);
		s.release(' ');
		s.run(1 / 60);
		expect(count(s.events, 'nothing-to-interact')).toBe(1);
		expect(hud.message).toBe(t('explore.holdToFly'));
		s.run(PICK_QUIET_SECONDS);
		s.frame('Enter');
		expect(count(s.events, 'nothing-to-interact')).toBe(2);
		expect(hud.message).toBe(t('explore.notAtTent'));
	});

	it('the ring over a tree the axe will clear carries the axe; the landing chops it as the trainer comes down', () => {
		const s = setup('squirrel', flyer({ x: 96, y: -102 }, 'down', ['axe']));
		s.press(' ');
		s.run(HOLD_TO_FLY + 0.02);
		expect(s.rings.at(-1)).toEqual({ x: 96, y: -101, tool: 'axe' });
		s.run(RISE_SECONDS + GLIDE_SECONDS * 2);
		s.release(' ');
		s.run(0.5);
		const landed = s.events.find((e) => e.type === 'landed');
		expect(landed?.type === 'landed' && landed.flown).toBeGreaterThan(0);
		const at = landed?.type === 'landed' ? landed.pos : null;
		expect(s.events.find((e) => e.type === 'tile-cleared')).toMatchObject({ pos: at, was: 'tree' });
		s.run(1);
		expect(game.edits.has(at!.x, at!.y)).toBe(true);
	});
});
