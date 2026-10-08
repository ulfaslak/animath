import {
	LEVEL_RUNS,
	TOP,
	getAnimal,
	landSeed,
	newGame,
	parseServerMessage,
	step,
	tileAtWorld,
	type Direction,
	type GameEvent,
	type GridPos,
	type SavedGame
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { testStarter } from './minted';

/**
 * Skis through the authority (#191 step 6): a held way builds speed, letting
 * go coasts, anything else the kid does stands them still, and nothing of a
 * ski run is ever saved.
 */

const SEED = landSeed('arctic', 1);

/** A start on snow with `n` tiles of snow ahead the way `dir` points. */
function snowRun(n: number): { pos: GridPos; dir: Direction } {
	for (let y = -60; y < 60; y++) {
		for (let x = -60; x < 60; x++) {
			for (const dir of ['right', 'left', 'up', 'down'] as const) {
				let at = { x, y };
				let ok = tileAtWorld(SEED, x, y).kind === 'snow';
				for (let k = 0; k < n && ok; k++) {
					at = step(at, dir);
					ok = tileAtWorld(SEED, at.x, at.y).kind === 'snow';
				}
				if (ok) return { pos: { x, y }, dir };
			}
		}
	}
	throw new Error('no run of snow');
}

function setup(items: string[], pos: GridPos, facing: Direction) {
	const game: SavedGame = {
		...newGame(1, { ...testStarter(), id: 'n1' }),
		land: 'arctic',
		pos,
		facing,
		items,
		party: [{ id: 'f', speciesId: 'arctic-fox', hp: getAnimal('arctic-fox').maxHp }],
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
	const authority = new LocalAuthority();
	const events: GameEvent[] = [];
	authority.subscribe((e) => events.push(e));
	authority.start({ game });
	const moved = () => events.filter((e) => e.type === 'player-moved');
	return { authority, events, moved };
}

describe('skis through the authority', () => {
	it('builds speed while one way is held, coasts on letting go, and stands still after', () => {
		const { pos, dir } = snowRun(LEVEL_RUNS[TOP]! + 6);
		const s = setup(['skis'], pos, dir);
		for (let i = 0; i < LEVEL_RUNS[TOP]! + 1; i++) s.authority.dispatch({ type: 'move', dir });
		const held = s.moved();
		expect(held.map((e) => e.type === 'player-moved' && e.speeds)).toEqual([
			[0],
			[0],
			[1],
			[1],
			[2],
			[2],
			[2],
			[3]
		]);
		const steps = s.authority.snapshot().steps;
		s.authority.dispatch({ type: 'coast' });
		const glided = s.moved().at(-1)!;
		expect(glided).toMatchObject({ coast: true, tiles: 3, speeds: [3, 2, 1] });
		expect(s.authority.snapshot().steps).toBe(steps + 3);
		// Standing still now: a second coast does nothing.
		const count = s.events.length;
		s.authority.dispatch({ type: 'coast' });
		expect(s.events.length).toBe(count);
	});

	it('is stood still by anything else the kid does, and by a reload: the save holds no speed', () => {
		const { pos, dir } = snowRun(LEVEL_RUNS[TOP]! + 4);
		const s = setup(['skis'], pos, dir);
		for (let i = 0; i < LEVEL_RUNS[TOP]!; i++) s.authority.dispatch({ type: 'move', dir });
		s.authority.dispatch({ type: 'interact' });
		const count = s.moved().length;
		s.authority.dispatch({ type: 'coast' });
		expect(s.moved().length).toBe(count);
		// Speed again, then a reload: picked up, the kid walks off from a standstill.
		for (let i = 0; i < LEVEL_RUNS[TOP]!; i++) s.authority.dispatch({ type: 'move', dir });
		const saved = s.authority.snapshot();
		expect(Object.keys(saved).filter((k) => k.startsWith('ski'))).toEqual([]);
		const again = new LocalAuthority();
		const after: GameEvent[] = [];
		again.subscribe((e) => after.push(e));
		again.start({ game: saved });
		again.dispatch({ type: 'move', dir });
		expect(after.at(-1)).toMatchObject({ type: 'player-moved', speeds: [0] });
	});

	it('changes nothing without skis, or in Nordland: no speeds, one step a press', () => {
		const { pos, dir } = snowRun(10);
		const s = setup([], pos, dir);
		for (let i = 0; i < 9; i++) s.authority.dispatch({ type: 'move', dir });
		for (const e of s.moved()) expect(e).not.toHaveProperty('speeds');
		s.authority.dispatch({ type: 'coast' });
		expect(s.moved()).toHaveLength(9);
	});
});

describe('skis seen by others', () => {
	it('crosses the wire only when owned, and only as true', () => {
		const peer = {
			t: 'peer',
			pid: 'peer-001',
			name: 'Ada',
			x: 1,
			y: 2,
			facing: 'down',
			lead: null,
			boat: false,
			busy: 'explore'
		};
		expect(parseServerMessage({ ...peer, skis: true })).toMatchObject({ skis: true });
		expect(parseServerMessage(peer)).toMatchObject({ t: 'peer', pid: 'peer-001' });
		expect(parseServerMessage(peer)).not.toHaveProperty('skis');
		expect(parseServerMessage({ ...peer, skis: false })).not.toHaveProperty('skis');
		expect(parseServerMessage({ ...peer, skis: 'yes' })).toBeNull();
	});
});

describe('the explore screen on skis', () => {
	it('sends coast once when the held arrow is let go (a key up, a blur), never after a tap', async () => {
		const { ExploreController } = await import('../src/explore/controller');
		const { pos, dir } = snowRun(LEVEL_RUNS[TOP]! + 6);
		const s = setup(['skis'], pos, dir);
		const sent: string[] = [];
		const authority = {
			dispatch: (i: { type: string }) => {
				sent.push(i.type);
				s.authority.dispatch(i as never);
			},
			subscribe: (l: (e: GameEvent) => void) => s.authority.subscribe(l)
		};
		let held: Direction | undefined = dir;
		const keyboard = {
			tick: () => {},
			takeTap: () => undefined,
			heldDirection: () => held,
			takeTeamPick: () => undefined,
			takeInteract: () => false,
			talkKey: 'enter',
			setGlider: () => {},
			takeTakeOff: () => false,
			flyHeld: () => false,
			windUp: () => 0,
			dropTaps: () => {}
		};
		const renderer = {
			setWorld() {},
			setBoat() {},
			setGlider() {},
			setSkis() {},
			setSkiing() {},
			setSled() {},
			castPlaying: false,
			fish() {},
			setLandingSpot() {},
			setPlayer() {},
			ensureChunksAround() {},
			cleared() {},
			trainerPoint: () => ({ x: 0, y: 0, z: 0 }),
			chaser: { update() {}, hide() {}, arriving: false, species: null }
		};
		const explore = new ExploreController(authority as never, renderer as never, keyboard as never);
		s.authority.subscribe((e) => explore.handle(e));
		explore.handle({ ...s.events[0]! } as never);
		for (let f = 0; f < 120; f++) explore.update(1 / 60);
		expect(sent.filter((t) => t === 'move').length).toBeGreaterThan(LEVEL_RUNS[TOP]!);
		held = undefined; // let go, or the window lost focus (the keyboard clears what is held)
		for (let f = 0; f < 120; f++) explore.update(1 / 60);
		expect(sent.filter((t) => t === 'coast')).toHaveLength(1);
		expect(s.moved().at(-1)).toMatchObject({ coast: true });
	});
});

describe('the dog sled seen by others', () => {
	it('crosses the wire only when owned, and only as true', () => {
		const peer = {
			t: 'peer',
			pid: 'peer-002',
			name: 'Bo',
			x: 1,
			y: 2,
			facing: 'down',
			lead: 'reindeer',
			boat: false,
			busy: 'explore'
		};
		expect(parseServerMessage({ ...peer, sled: true })).toMatchObject({ sled: true });
		expect(parseServerMessage(peer)).not.toHaveProperty('sled');
		expect(parseServerMessage({ ...peer, sled: 1 })).toBeNull();
	});
});
