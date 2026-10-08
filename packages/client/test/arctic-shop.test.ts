import {
	editedTileAt,
	getAnimal,
	isWalkable,
	landSeed,
	newGame,
	step,
	tileAtWorld,
	type AnimalInstance,
	type Direction,
	type GameEvent,
	type GridPos,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { language, t } from '../src/copy';
import { doctorWords } from '../src/doctor/lines';
import { ExploreController } from '../src/explore/controller';
import type { Keyboard } from '../src/input/keyboard';
import { moneyWords } from '../src/money';
import type { GameRenderer } from '../src/render/renderer';
import { game } from '../src/state/game.svelte';
import { NEEDS, PROMPTS, hud } from '../src/state/hud.svelte';
import { skyPieces } from './sky-pieces';
import { testStarter } from './minted';

/**
 * The Arctic's shop in the browser (#191 step 6): the land's money on every
 * screen that names it, the ice pick and the arctic axe at work, and fishing
 * at a fishing hole, from Enter to what the line says.
 */

const SEED = landSeed('arctic', 1);
const DIRS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const BACK: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** A tile of `kind` near spawn with ground a kid stands on beside it: the stand, facing it. */
function besideKind(
	kind: string,
	under?: string,
	stand: (ground: string) => boolean = (g) => isWalkable(g as never) && g !== 'ice'
): { pos: GridPos; facing: Direction; at: GridPos } {
	for (let r = 0; r < 200; r++) {
		for (let y = 9 - r; y <= 9 + r; y++) {
			for (let x = 5 - r; x <= 5 + r; x++) {
				if (Math.max(Math.abs(x - 5), Math.abs(y - 9)) !== r) continue;
				const tile = tileAtWorld(SEED, x, y);
				if (tile.kind !== kind || (under && tile.under !== under)) continue;
				for (const dir of DIRS) {
					const pos = step({ x, y }, BACK[dir]);
					const ground = tileAtWorld(SEED, pos.x, pos.y).kind;
					if (stand(ground)) return { pos, facing: dir, at: { x, y } };
				}
			}
		}
	}
	throw new Error(`no ${kind} near spawn`);
}

const animal = (speciesId: string, id = speciesId): AnimalInstance => ({
	id,
	speciesId,
	hp: getAnimal(speciesId).maxHp
});

/** An Arctic game standing at `pos` facing `facing`, owning `items`, with `party`. */
function arcticGame(
	pos: GridPos,
	facing: Direction,
	items: string[],
	party: AnimalInstance[] = [animal('fox')],
	tokens = 0
): SavedGame {
	return {
		...newGame(1, { ...testStarter(), id: 'n1' }),
		land: 'arctic',
		pos,
		facing,
		items,
		tokens,
		party,
		lands: [
			{
				land: 'nordland',
				party: [{ ...testStarter(), id: 'n1' }],
				tokens: 0,
				items: [],
				worlds: []
			}
		],
		unlocked: ['nordland', 'arctic']
	};
}

function setup(start: SavedGame) {
	const authority = new LocalAuthority();
	const sky = skyPieces();
	const casts: { hole: GridPos; outcome: string }[] = [];
	const renderer = {
		setWorld() {},
		setBoat() {},
		setGlider() {},
		castPlaying: false,
		setSkis() {},
		setSkiing() {},
		fish(hole: GridPos, outcome: string) {
			casts.push({ hole, outcome });
		},
		setLandingSpot() {},
		setPlayer() {},
		ensureChunksAround() {},
		cleared() {},
		trainerPoint: sky.trainerPoint,
		chaser: sky.chaser
	} as unknown as GameRenderer;
	const keyboard = {
		tick: () => {},
		takeTap: () => undefined,
		heldDirection: () => undefined,
		takeTeamPick: () => undefined,
		takeInteract: () => false,
		talkKey: 'enter',
		setGlider: () => {},
		takeTakeOff: () => false,
		flyHeld: () => false,
		windUp: () => 0,
		dropTaps: () => {}
	} as unknown as Keyboard;
	const explore = new ExploreController(authority, renderer, keyboard);
	const events: GameEvent[] = [];
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
		hud.apply(e);
		explore.handle(e);
	});
	authority.start({ game: start });
	hud.tick(0);
	const enter = () => {
		authority.dispatch({ type: 'interact' });
		hud.tick(1 / 60);
	};
	return { authority, events, enter, casts };
}

afterEach(() => language.set('en'));

describe("The Arctic's money", () => {
	it('is ice dollars on the HUD, in the shop and in every sum, in English and Danish; tokens in Nordland', () => {
		setup(arcticGame({ x: 5, y: 9 }, 'down', [], [animal('fox')], 21));
		expect(game.land).toBe('arctic');
		expect(t('hud.tokens', { count: 21, money: moneyWords() })).toBe('21 ice dollars');
		expect(t('hud.tokens', { count: 1, money: moneyWords() })).toBe('1 ice dollar');
		expect(doctorWords({ say: 'tokensGiven', amount: 6, tokens: 27 })).toBe(
			'Thank you! Here are 6 ice dollars. Now you have 27 ice dollars.'
		);
		expect(t('doctor.shop.price', { count: 13, money: moneyWords('arctic') })).toBe(
			'13 ice dollars'
		);
		expect(t('doctor.home.how', { money: moneyWords('arctic') })).toContain(
			'ice dollars as a thank-you'
		);
		// A sentence starting with the money says it with a capital.
		expect(t('currency.iceDollars.words')).toBe('ice dollars');
		language.set('da');
		expect(t('hud.tokens', { count: 21, money: moneyWords() })).toBe('21 iskroner');
		expect(t('hud.tokens', { count: 1, money: moneyWords() })).toBe('1 iskrone');
		expect(t('doctor.shop.count', { money: moneyWords() })).toBe(
			'Godt valg! Kan du tælle dine iskroner?'
		);
		language.set('en');
		expect(t('hud.tokens', { count: 21, money: moneyWords('nordland') })).toBe('21 tokens');
	});

	it('every prompt and every "you need" line the HUD can say is in English and Danish', () => {
		for (const lang of ['en', 'da'] as const) {
			language.set(lang);
			for (const key of [...Object.values(PROMPTS).flat(), ...Object.values(NEEDS)]) {
				expect(t(key), `${lang} ${key}`).not.toBe(key);
			}
		}
	});
});

describe('the ice pick and the arctic axe', () => {
	it('breaks the ice block the kid faces with the ice pick, and says it takes one without', () => {
		const { pos, facing, at } = besideKind('iceblock', 'snow');
		const without = setup(arcticGame(pos, facing, []));
		expect(hud.action).toBeNull();
		without.enter();
		expect(without.events.at(-1)).toMatchObject({
			type: 'tool-needed',
			kind: 'iceblock',
			tool: 'ice-pick'
		});
		// The Arctic's witch doctor sells the ice pick, so the line says so.
		expect(hud.message).toBe(t('explore.needIcePick'));

		const s = setup(arcticGame(pos, facing, ['ice-pick']));
		expect(hud.action).toBe('breakIce');
		expect(hud.hint).toBe('Press Enter to break the ice block');
		s.enter();
		expect(s.events.at(-1)).toMatchObject({
			type: 'tile-cleared',
			was: 'iceblock',
			tool: 'ice-pick',
			pos: at
		});
		expect(editedTileAt(SEED, game.edits, at.x, at.y).kind).toBe('snow');
		// A step onto where it stood.
		s.authority.dispatch({ type: 'move', dir: facing });
		expect(game.pos).toEqual(at);
	});

	it('leaves a fishing hole where a block stood on the ice', () => {
		const { pos, facing, at } = besideKind('iceblock', 'ice');
		const s = setup(arcticGame(pos, facing, ['ice-pick']));
		s.enter();
		expect(s.events.at(-1)).toMatchObject({ type: 'tile-cleared', was: 'iceblock' });
		expect(editedTileAt(SEED, game.edits, at.x, at.y).kind).toBe('hole');
		// Facing it now is facing a fishing hole: without a rod, Enter says the rod is what it takes.
		expect(hud.ahead).toEqual({ kind: 'hole', tool: 'fishing-rod' });
	});

	it('breaks a block afloat from the boat, and the water it leaves is water to every screen (the review of #201)', () => {
		const { pos, facing, at } = besideKind(
			'iceblock',
			'water',
			(g) => g === 'water' || g === 'deepwater'
		);
		const s = setup(arcticGame(pos, facing, ['ice-pick', 'boat']));
		expect(game.realm).toBe('water');
		s.enter();
		expect(s.events.at(-1)).toMatchObject({ type: 'tile-cleared', was: 'iceblock' });
		s.authority.dispatch({ type: 'move', dir: facing });
		expect(game.pos).toEqual(at);
		// Out on the water in the boat there, as the authority has it: the lead is a swimmer's.
		expect(game.realm).toBe('water');
	});

	it("cuts a spruce with the arctic axe, never with Nordland's axe", () => {
		const { pos, facing } = besideKind('tree');
		const nordlands = setup(arcticGame(pos, facing, ['axe']));
		nordlands.enter();
		expect(nordlands.events.at(-1)).toMatchObject({
			type: 'tool-needed',
			kind: 'tree',
			tool: 'arctic-axe'
		});
		const s = setup(arcticGame(pos, facing, ['arctic-axe']));
		expect(hud.hint).toBe('Press Enter to chop the tree');
		s.enter();
		expect(s.events.at(-1)).toMatchObject({
			type: 'tile-cleared',
			was: 'tree',
			tool: 'arctic-axe'
		});
	});
});

describe('fishing', () => {
	it('without a rod, says it takes one; with it and nobody who swims, nothing bites and the line says why', () => {
		const { pos, facing, at } = besideKind('hole');
		const without = setup(arcticGame(pos, facing, []));
		without.enter();
		expect(without.events.at(-1)).toMatchObject({
			type: 'tool-needed',
			kind: 'hole',
			tool: 'fishing-rod'
		});

		const s = setup(arcticGame(pos, facing, ['fishing-rod'], [animal('fox')]));
		expect(hud.action).toBe('fish');
		expect(hud.hint).toBe('Press Enter to fish');
		const steps = s.authority.snapshot().steps;
		s.enter();
		expect(s.events.at(-1)).toEqual({
			type: 'line-cast',
			playerId: 'local',
			hole: at,
			outcome: 'no-swimmer'
		});
		expect(hud.message).toBe(t('explore.noSwimmer'));
		// A cast is a step of the count, so the next one rolls anew; no rod swings without a swimmer.
		expect(s.authority.snapshot().steps).toBe(steps + 1);
		expect(s.casts).toEqual([]);
	});

	it('with a swimmer, casts a line into the hole: nothing in it yet, so nothing bites, every time', () => {
		const { pos, facing, at } = besideKind('hole');
		const s = setup(arcticGame(pos, facing, ['fishing-rod'], [animal('fox'), animal('otter')]));
		for (let i = 0; i < 12; i++) s.enter();
		const casts = s.events.filter((e) => e.type === 'line-cast');
		expect(casts).toHaveLength(12);
		// #192's third wave brings the holes' animals; until then a cast never starts a battle.
		for (const c of casts) expect(c).toMatchObject({ hole: at, outcome: 'nothing' });
		expect(s.events.some((e) => e.type === 'battle-started')).toBe(false);
		expect(s.casts).toHaveLength(12);
		// Said once the line is back, not as it is cast.
		expect(hud.message).not.toBe('Nothing bit this time. Try again!');
		for (let i = 0; i < 120; i++) hud.tick(1 / 60);
		expect(hud.message).toBe('Nothing bit this time. Try again!');
		// The kid is where they were, facing the hole.
		expect(game.pos).toEqual(pos);
	});
});
