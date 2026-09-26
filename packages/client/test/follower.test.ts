import {
	Rng,
	getAnimal,
	isWalkable,
	isWater,
	newGame,
	step,
	tileAtWorld,
	type BattleState,
	type Direction,
	type DoctorState,
	type GameEvent,
	type GridPos,
	type SavedGame
} from '@mathgame/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LocalAuthority, WORLD_SEED } from '../src/authority/local';
import { DoctorController } from '../src/doctor/controller';
import { ExploreController } from '../src/explore/controller';
import { parseParty } from '../src/flags';
import { Keyboard } from '../src/input/keyboard';
import { BOAT_STAND } from '../src/render/boat';
import { Follower, RIDE_AHEAD, RIDE_HEIGHT, RIDE_LENGTH } from '../src/render/follower';
import { WATER_TOP } from '../src/render/tiles';
import type { GameRenderer } from '../src/render/renderer';
import { doctor } from '../src/state/doctor.svelte';
import { game } from '../src/state/game.svelte';
import { besideA, gameBeside } from './clearing';

/**
 * The lead walking behind the trainer, driven as the game drives it: the real
 * authority's events through the real explore controller (and the doctor's
 * card, whose beat a heal waits for). The renderer is a stand-in that keeps
 * the figures the follower puts in the world.
 */
function setup(party: string, game0?: SavedGame) {
	const target = { addEventListener() {} } as unknown as Window;
	const figures: THREE.Group[] = [];
	const host = {
		addFigure: (f: THREE.Group) => void figures.push(f),
		removeFigure: (f: THREE.Group) => void figures.splice(figures.indexOf(f), 1)
	};
	const renderer = {
		setWorld() {},
		setBoat() {},
		setPlayer() {},
		ensureChunksAround() {},
		cleared() {}
	} as unknown as GameRenderer;
	const authority = new LocalAuthority({ party: parseParty(party)! });
	const follower = new Follower(host);
	const explore = new ExploreController(authority, renderer, new Keyboard(target), follower);
	const doctorCard = new DoctorController(authority);
	const events: GameEvent[] = [];
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
		explore.handle(e);
		doctorCard.handle(e);
	});
	doctor.reset();
	authority.start(game0 ? { game: game0 } : {});
	/** Frames enough for a step to land and a change of lead to play out. */
	const settle = (seconds = 1) => {
		for (let t = 0; t < seconds; t += 0.1) {
			explore.update(0.1);
			doctorCard.update(0.1);
		}
	};
	settle();
	const trainer = () => game.pos;
	return { authority, follower, figures, events, settle, trainer };
}

const standable = (p: GridPos) => isWalkable(tileAtWorld(WORLD_SEED, p.x, p.y).kind);
const same = (a: GridPos | null, b: GridPos | null) => !!a && !!b && a.x === b.x && a.y === b.y;
const beside = (a: GridPos | null, b: GridPos) =>
	!!a && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
const BEHIND: Record<Direction, Direction> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left'
};
const SIDES: Record<Direction, Direction[]> = {
	up: ['left', 'right'],
	down: ['right', 'left'],
	left: ['up', 'down'],
	right: ['down', 'up']
};
/** Where it should be put beside a trainer at `pos` facing `facing`: behind, a side, in front. */
const placement = (pos: GridPos, facing: Direction) =>
	[BEHIND[facing], ...SIDES[facing], facing].map((d) => step(pos, d)).find(standable) ?? null;

function latestBattle(events: GameEvent[]): BattleState {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i]!;
		if (e.type === 'battle-updated' || e.type === 'battle-started') return e.state;
	}
	throw new Error('no battle');
}

/** Left, right, … past the reed by the spawn until a battle starts. */
function walkIntoBattle(s: ReturnType<typeof setup>): void {
	for (let i = 0; i < 400; i++) {
		const from = s.events.length;
		s.authority.dispatch({ type: 'move', dir: i % 2 === 0 ? 'left' : 'right' });
		s.settle(0.2);
		if (s.events.slice(from).some((e) => e.type === 'battle-started')) return;
	}
	throw new Error('no battle');
}

function answer(s: ReturnType<typeof setup>, correct: boolean): void {
	const phase = latestBattle(s.events).phase;
	if (phase.kind !== 'solving') throw new Error(`no puzzle: ${phase.kind}`);
	const input = String(correct ? phase.puzzle.answer : phase.puzzle.answer + 1);
	s.authority.dispatch({ type: 'battle', intent: { type: 'answer', input } });
}

describe('the lead walks behind the trainer', () => {
	it('steps onto the tile each step leaves: always walkable, beside the trainer, turned the way it walked', () => {
		// A bear leads: nothing near the spawn is big enough to come out, so the walk is never cut short.
		const s = setup('bear');
		expect(s.follower.species).toBe('bear');
		const rng = new Rng(2024);
		const dirs: Direction[] = ['up', 'down', 'left', 'right'];
		const bad: string[] = [];
		let steps = 0;
		let swaps = 0;
		for (let i = 0; i < 600; i++) {
			const before = { ...s.trainer() };
			const was = s.follower.tile;
			const from = s.events.length;
			const dir = dirs[Math.floor(rng.next() * 4)]!;
			s.authority.dispatch({ type: 'move', dir });
			const fresh = s.events.slice(from);
			if (fresh.some((e) => e.type === 'battle-started')) {
				s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
			}
			s.settle(0.2);
			const now = s.follower.tile;
			const at = `step ${i} (${dir}, trainer ${before.x},${before.y})`;
			if (fresh.some((e) => e.type === 'player-moved')) {
				steps++;
				if (same(was, s.trainer())) swaps++;
				if (!same(now, before)) bad.push(`${at}: not on the tile the trainer left`);
				const walked = dirs.find((d) => same(step(was!, d), now!));
				if (walked !== s.follower.direction) bad.push(`${at}: faces ${s.follower.direction}`);
			} else if (!same(now, was)) bad.push(`${at}: moved on a bump`);
			if (!now || !standable(now)) bad.push(`${at}: on ${JSON.stringify(now)}`);
			if (!beside(now, s.trainer())) bad.push(`${at}: not beside the trainer`);
			// The figure stands where the follower says, once the step has landed.
			const figure = s.figures[0]!;
			if (figure.position.x !== now?.x || figure.position.z !== now?.y) {
				bad.push(`${at}: the figure is at ${figure.position.x},${figure.position.z}`);
			}
		}
		expect(bad.slice(0, 5)).toEqual([]);
		// The walk turned back onto the follower's tile many times: they swapped, and it went round.
		expect(steps).toBeGreaterThan(300);
		expect(swaps).toBeGreaterThan(20);
		expect(s.figures).toHaveLength(1);
	});

	it('is put beside the trainer, never walked there: a new game, a game picked up, the trip to the tent', () => {
		const s = setup('squirrel:1,fox');
		expect(s.follower.tile).toEqual(placement(s.trainer(), game.facing));

		// A lost battle: the whole party tired, then beside the nearest tent, healed.
		walkIntoBattle(s);
		while (latestBattle(s.events).phase.kind !== 'ended') {
			const state = latestBattle(s.events);
			if (state.phase.kind === 'choose-animal') {
				const partyIndex = state.party.findIndex((a) => a.hp > 0);
				s.authority.dispatch({ type: 'battle', intent: { type: 'switch', partyIndex } });
				continue;
			}
			s.authority.dispatch({
				type: 'battle',
				intent: { type: 'attack', attackIndex: 1, level: 1 }
			});
			answer(s, false);
		}
		const taken = s.events.find((e) => e.type === 'taken-to-doctor');
		expect(taken?.type).toBe('taken-to-doctor');
		s.settle();
		expect(s.follower.tile).toEqual(placement(s.trainer(), game.facing));
		expect(s.follower.tile).not.toBeNull();
		// Put down, not walked across the map: the figure is already on its tile.
		const figure = s.figures.at(-1)!;
		expect([figure.position.x, figure.position.z]).toEqual([
			s.follower.tile!.x,
			s.follower.tile!.y
		]);

		// Quit to the title: gone. Continue: back beside the trainer.
		s.authority.dispatch({ type: 'leave-game' });
		expect(s.figures).toEqual([]);
		expect(s.follower.tile).toBeNull();
		s.authority.start({ game: s.authority.snapshot() });
		s.settle();
		expect(s.follower.tile).toEqual(placement(s.trainer(), game.facing));
		expect(s.figures.map((f) => f.name)).toEqual(['squirrel']);
	});

	it('beside water: behind is taken, so a side', () => {
		// Facing away from the river on the bank by the spawn: the tile behind is water.
		const pos = { x: -2, y: 6 };
		const facings = (['up', 'down', 'left', 'right'] as const).filter(
			(f) => !standable(step(pos, BEHIND[f])) && placement(pos, f)
		);
		expect(facings.length).toBeGreaterThan(0);
		// An otter could swim behind, but beside a trainer on land it stands on the ground.
		for (const facing of facings) {
			for (const speciesId of ['rabbit', 'otter']) {
				const s = setup(speciesId, {
					seed: WORLD_SEED,
					pos,
					facing,
					steps: 0,
					visits: 0,
					party: [{ id: 'r', speciesId, hp: getAnimal(speciesId).maxHp }],
					tokens: 0,
					items: [],
					battle: null,
					edits: []
				});
				expect(s.follower.tile, `${speciesId} facing ${facing}`).toEqual(placement(pos, facing));
				expect(standable(s.follower.tile!)).toBe(true);
			}
		}
	});

	it('follows through a tree the trainer chopped down, and is put on its stump when the trainer turns from it', () => {
		const tree = besideA('tree');
		const s = setup('rabbit', { ...gameBeside(tree, ['axe']), party: parseParty('rabbit')! });
		s.authority.dispatch({ type: 'interact' });
		s.authority.dispatch({ type: 'move', dir: tree.facing });
		s.settle();
		expect(s.trainer()).toEqual(tree.target);
		expect(s.follower.tile).toEqual(tree.stand);
		// Picked up again facing back where it came from: the stump is behind the trainer.
		s.authority.dispatch({ type: 'move', dir: BEHIND[tree.facing] });
		s.settle();
		expect(s.trainer()).toEqual(tree.stand);
		const saved = { ...s.authority.snapshot(), facing: BEHIND[tree.facing] };
		const t = setup('rabbit', saved);
		// The seeded world calls it a tree; the world as the kid left it, a stump to stand on.
		expect(standable(tree.target)).toBe(false);
		expect(t.follower.tile).toEqual(tree.target);
	});
});

describe('who follows', () => {
	it('the lead: a number key, and a knock-out in a battle the next animal wins', () => {
		const pick = setup('squirrel,fox,rabbit');
		expect(pick.follower.species).toBe('squirrel');
		pick.authority.dispatch({
			type: 'party',
			intent: { type: 'select-lead', animalId: 'party-3' }
		});
		pick.settle();
		expect(pick.follower.species).toBe('rabbit');
		expect(pick.figures.map((f) => f.name)).toEqual(['rabbit']);

		// The squirrel in front gets tired in a battle the fox wins: the fox follows.
		const s = setup('squirrel:1,fox');
		expect(s.follower.species).toBe('squirrel');
		walkIntoBattle(s);
		for (let turn = 0; turn < 60 && latestBattle(s.events).phase.kind !== 'ended'; turn++) {
			const state = latestBattle(s.events);
			if (state.phase.kind === 'choose-animal') {
				s.authority.dispatch({ type: 'battle', intent: { type: 'switch', partyIndex: 1 } });
				continue;
			}
			const mine = state.party[state.active]!;
			const attacks = getAnimal(mine.speciesId).attacks.length;
			s.authority.dispatch({
				type: 'battle',
				intent: { type: 'attack', attackIndex: mine.speciesId === 'fox' ? attacks : 1, level: 3 }
			});
			answer(s, mine.speciesId === 'fox');
		}
		expect(game.party[0]!.hp).toBe(0);
		s.settle();
		expect(s.follower.species).toBe('fox');
		expect(s.figures.map((f) => f.name)).toEqual(['fox']);
	});

	it('nobody while every animal is tired; the first one the doctor makes fit comes out on the heal', () => {
		const s = setup('squirrel:0,rabbit:0');
		expect(s.follower.species).toBeNull();
		expect(s.figures).toEqual([]);
		// Nobody is there, so nobody stands anywhere yet.
		expect(s.follower.tile).toBeNull();

		// Seven steps right to (5, 6), bump the tent below, talk.
		for (let i = 0; i < 7; i++) {
			s.authority.dispatch({ type: 'move', dir: 'right' });
			s.settle(0.2);
		}
		// Unseen, it keeps to the tile the trainer left: where the first one made fit comes out.
		expect(s.follower.tile).toEqual({ x: s.trainer().x - 1, y: s.trainer().y });
		s.authority.dispatch({ type: 'move', dir: 'down' });
		s.authority.dispatch({ type: 'interact' });
		s.settle();
		expect(doctor.active).toBe(true);
		s.authority.dispatch({ type: 'doctor', intent: { type: 'pick-patient', partyIndex: 1 } });
		s.settle(0.2);
		const visit = (() => {
			for (let i = s.events.length - 1; i >= 0; i--) {
				const e = s.events[i]!;
				if (e.type === 'doctor-visit-updated' || e.type === 'doctor-visit-started') return e.state;
			}
			throw new Error('no visit');
		})() as DoctorState;
		if (visit.phase.kind !== 'solving') throw new Error('no puzzle');
		s.authority.dispatch({
			type: 'doctor',
			intent: { type: 'answer', input: String(visit.phase.puzzle.answer) }
		});
		// The authority has healed the rabbit; the card says "Correct!" first, and nobody comes yet.
		expect(game.party[1]!.hp).toBeGreaterThan(0);
		s.settle(0.3);
		expect(s.follower.species).toBeNull();
		// Then the heal plays on the card, and the rabbit grows in behind the trainer.
		s.settle(1.5);
		expect(s.follower.species).toBe('rabbit');
		expect(s.follower.tile).toEqual({ x: s.trainer().x - 1, y: s.trainer().y });
		expect(standable(s.follower.tile!)).toBe(true);
	});
});

describe('out on the water', () => {
	/** A game at the spawn tile with the boat, this party, standing at `pos`. */
	const withBoat = (team: string, pos?: GridPos): SavedGame => ({
		...newGame(WORLD_SEED),
		party: parseParty(team)!,
		items: ['boat'],
		...(pos ? { pos } : {})
	});
	const water = (p: GridPos | null) => !!p && isWater(tileAtWorld(WORLD_SEED, p.x, p.y).kind);
	/** Straight up from the spawn tile: the lake, shallow for three tiles, then deep. */
	const sail = (s: ReturnType<typeof setup>, dirs: Direction[]) => {
		for (const dir of dirs) {
			s.authority.dispatch({ type: 'move', dir });
			// A step into the boat or out of it takes longer, while the boat swings, and
			// then the lead may hop in or out.
			s.settle(1.2);
		}
	};

	it('one that swims swims behind the boat: over 600 random steps, beside the trainer, never where it can’t go', () => {
		const s = setup('otter', withBoat('otter'));
		const rng = new Rng(77);
		const dirs: Direction[] = ['up', 'down', 'left', 'right'];
		const bad: string[] = [];
		let wet = 0;
		for (let i = 0; i < 600; i++) {
			const before = { ...s.trainer() };
			const from = s.events.length;
			// Mostly up and down across the lake's shore, so it sails out and lands often.
			const dir = rng.next() < 0.6 ? (rng.next() < 0.55 ? 'up' : 'down') : dirs[rng.int(0, 3)]!;
			s.authority.dispatch({ type: 'move', dir });
			if (s.events.slice(from).some((e) => e.type === 'battle-started')) {
				s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
			}
			s.settle(0.7);
			const now = s.follower.tile;
			const at = `step ${i} (${dir}, trainer ${before.x},${before.y})`;
			if (s.follower.species !== 'otter') bad.push(`${at}: ${s.follower.species} follows`);
			if (s.follower.inBoat) bad.push(`${at}: in the boat`);
			if (!now || !(standable(now) || water(now))) bad.push(`${at}: on ${JSON.stringify(now)}`);
			if (!beside(now, s.trainer())) bad.push(`${at}: not beside the trainer`);
			if (water(now)) wet++;
		}
		expect(bad.slice(0, 5)).toEqual([]);
		expect(wet).toBeGreaterThan(100);
	});

	it('with nobody standing who swims, the lead rides in the boat once the trainer is in it, and walks on land', () => {
		const s = setup('squirrel', withBoat('squirrel'));
		expect(s.follower.species).toBe('squirrel');
		sail(s, ['up']);
		expect(s.follower.inBoat).toBe(true);
		expect(s.follower.species).toBe('squirrel');
		expect(s.follower.tile).toBeNull();
		// It sails along with the trainer: in the boat, right there with them.
		sail(s, ['up', 'up', 'left', 'right']);
		expect(s.follower.inBoat).toBe(true);
		const rider = s.figures.at(-1)!;
		expect(
			Math.hypot(rider.position.x - s.trainer().x, rider.position.z - s.trainer().y)
		).toBeLessThan(0.5);
		// Its figure is small enough to fit in the boat.
		expect(rider.scale.x).toBeLessThan(1);
		// Back on land it walks behind again, on ground, never on the water it left.
		sail(s, ['down', 'down', 'down', 'down']);
		expect(tileAtWorld(WORLD_SEED, s.trainer().x, s.trainer().y).kind).toBe('grass');
		expect(s.follower.inBoat).toBe(false);
		expect(s.follower.species).toBe('squirrel');
		expect(standable(s.follower.tile!)).toBe(true);
		expect(beside(s.follower.tile, s.trainer())).toBe(true);
		expect(s.figures).toHaveLength(1);
	});

	it('back on land at once, before the lead has hopped into the boat: it comes back beside the trainer, never on their tile', () => {
		const s = setup('squirrel', withBoat('squirrel'));
		// Onto the water: the step lands, and the squirrel starts to hop into the boat…
		s.authority.dispatch({ type: 'move', dir: 'up' });
		s.settle(0.6);
		// …as the trainer steps straight back onto the shore it was standing on.
		s.authority.dispatch({ type: 'move', dir: 'down' });
		s.settle(1.2);
		expect(s.trainer()).toEqual({ x: -2, y: 6 });
		expect(s.follower.species).toBe('squirrel');
		expect(s.follower.inBoat).toBe(false);
		expect(same(s.follower.tile, s.trainer())).toBe(false);
		expect(beside(s.follower.tile, s.trainer())).toBe(true);
		expect(standable(s.follower.tile!)).toBe(true);
		expect(s.figures).toHaveLength(1);
	});

	it('one that can’t swim, over 600 quick steps on and off the water: never on the trainer’s tile, never in the water', () => {
		const s = setup('squirrel', withBoat('squirrel'));
		const rng = new Rng(78);
		const dirs: Direction[] = ['up', 'down', 'left', 'right'];
		const bad: string[] = [];
		let rides = 0;
		for (let i = 0; i < 600; i++) {
			const before = { ...s.trainer() };
			const dir = rng.next() < 0.6 ? (rng.next() < 0.5 ? 'up' : 'down') : dirs[rng.int(0, 3)]!;
			s.authority.dispatch({ type: 'move', dir });
			// Just long enough for a step into the boat or out of it to land: the next one
			// often comes while the lead is still hopping in or out.
			s.settle(rng.next() < 0.5 ? 0.6 : 0.7);
			const at = `step ${i} (${dir}, trainer ${before.x},${before.y})`;
			if (s.follower.inBoat) {
				rides++;
				continue;
			}
			const now = s.follower.tile;
			if (s.follower.species && same(now, s.trainer())) bad.push(`${at}: on the trainer's tile`);
			if (s.follower.species && now && water(now)) bad.push(`${at}: in the water`);
			if (s.figures.length > 1) bad.push(`${at}: ${s.figures.length} figures`);
		}
		expect(bad.slice(0, 5)).toEqual([]);
		expect(rides).toBeGreaterThan(50);
	});

	it('a squirrel first and an otter behind it: out on the water the otter follows, on land the squirrel', () => {
		const s = setup('squirrel,otter', withBoat('squirrel,otter'));
		expect(s.follower.species).toBe('squirrel');
		sail(s, ['up', 'up']);
		expect(s.follower.species).toBe('otter');
		expect(water(s.follower.tile)).toBe(true);
		sail(s, ['down', 'down']);
		expect(s.follower.species).toBe('squirrel');
		expect(standable(s.follower.tile!)).toBe(true);
		expect(s.figures).toHaveLength(1);
	});

	it('picked up in the boat beside a beach: one that swims swims behind it, never on the sand (#79)', () => {
		// On the shallows by the spawn facing the beach, and by the tree that can be chopped from the boat.
		const spots = [
			{ pos: { x: -2, y: 5 }, facing: 'down' },
			{ pos: { x: 21, y: 33 }, facing: 'down' }
		] as const;
		for (const { pos, facing } of spots) {
			const behind = step(pos, BEHIND[facing]);
			expect(water(behind)).toBe(true);
			// A beach beside the boat, where the lead used to be put before anyone knew who leads.
			expect(SIDES[facing].some((d) => standable(step(pos, d)))).toBe(true);
			for (const team of ['otter', 'frog', 'crab,rabbit']) {
				const s = setup(team, { ...withBoat(team, pos), facing });
				expect(s.follower.species).toBe(team.split(',')[0]);
				expect(s.follower.tile, `${team} at ${pos.x}, ${pos.y}`).toEqual(behind);
				// Swimming: low in the water, not standing on it.
				const figure = s.figures.at(-1)!;
				expect(figure.position.y).toBeLessThan(WATER_TOP);
			}
		}
	});

	it('with nobody who swims, the lead sits at the bow facing forward, big enough to know: every one that walks', () => {
		for (const id of ['squirrel', 'rabbit', 'fox', 'deer', 'wolf', 'bear']) {
			const s = setup(id, withBoat(id));
			sail(s, ['up', 'up']);
			expect(s.follower.inBoat, id).toBe(true);
			const rider = s.figures.at(-1)!;
			// Ahead of the trainer, who faces up (−z), and facing that way too.
			expect(rider.position.x).toBeCloseTo(s.trainer().x, 6);
			expect(rider.position.z).toBeCloseTo(s.trainer().y - RIDE_AHEAD, 6);
			expect(rider.rotation.y).toBeCloseTo(Math.PI, 6);
			// Made smaller only to fit: no longer or taller than the bow holds, and never tiny.
			const box = new THREE.Box3().setFromObject(rider);
			const size = box.getSize(new THREE.Vector3());
			expect(Math.max(size.x, size.z), id).toBeLessThanOrEqual(RIDE_LENGTH + 1e-6);
			expect(size.y, id).toBeLessThanOrEqual(RIDE_HEIGHT + 1e-6);
			expect(Math.max(size.x, size.y, size.z), id).toBeGreaterThan(0.45);
			// Sitting: its legs down in the hull, under the floor the trainer stands on.
			expect(box.min.y, id).toBeLessThan(WATER_TOP + BOAT_STAND - 0.01);
		}
	});

	it('picked up out on the water: one that swims beside the boat, or else the lead in it', () => {
		const deep = { x: -2, y: 2 };
		const swimmer = setup('otter', withBoat('otter', deep));
		expect(swimmer.follower.species).toBe('otter');
		expect(water(swimmer.follower.tile)).toBe(true);
		expect(beside(swimmer.follower.tile, deep)).toBe(true);
		const rider = setup('squirrel', withBoat('squirrel', deep));
		expect(rider.follower.species).toBe('squirrel');
		expect(rider.follower.inBoat).toBe(true);
	});
});
