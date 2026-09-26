import {
	Rng,
	getAnimal,
	isWalkable,
	step,
	tileAtWorld,
	type BattleState,
	type Direction,
	type DoctorState,
	type GameEvent,
	type GridPos,
	type SavedGame
} from '@mathgame/engine';
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LocalAuthority, WORLD_SEED } from '../src/authority/local';
import { DoctorController } from '../src/doctor/controller';
import { ExploreController } from '../src/explore/controller';
import { parseParty } from '../src/flags';
import { Keyboard } from '../src/input/keyboard';
import { Follower } from '../src/render/follower';
import type { GameRenderer } from '../src/render/renderer';
import { doctor } from '../src/state/doctor.svelte';
import { game } from '../src/state/game.svelte';

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
		for (const facing of facings) {
			const s = setup('rabbit', {
				seed: WORLD_SEED,
				pos,
				facing,
				steps: 0,
				visits: 0,
				party: [{ id: 'r', speciesId: 'rabbit', hp: getAnimal('rabbit').maxHp }],
				tokens: 0,
				items: [],
				battle: null,
				edits: []
			});
			expect(s.follower.tile).toEqual(placement(pos, facing));
			expect(standable(s.follower.tile!)).toBe(true);
		}
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
		expect(s.follower.tile).not.toBeNull();

		// Seven steps right to (5, 6), bump the tent below, talk.
		for (let i = 0; i < 7; i++) {
			s.authority.dispatch({ type: 'move', dir: 'right' });
			s.settle(0.2);
		}
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
		expect(standable(s.follower.tile!)).toBe(true);
	});
});
