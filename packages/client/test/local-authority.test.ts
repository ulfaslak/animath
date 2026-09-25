import {
	ATTACK_LEVELS,
	attackDamage,
	canTalkToDoctor,
	getAnimal,
	isEncounterTile,
	nearestTent,
	takeToDoctor,
	tileAtWorld,
	type AnimalInstance,
	type BattleState,
	type Direction,
	type DoctorIntent,
	type DoctorState,
	type GameEvent,
	type GridPos
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority, NOT_AT_A_TENT, type LocalAuthorityOptions } from '../src/authority/local';

/**
 * The single-player authority's own rules — the ones around the engine, not
 * in it: one encounter roll per completed step, keyed so a walk replays; the
 * battle's result written back into the world; the facing it keeps so that
 * Enter talks to a doctor only at a tent; the doctor visit and its seed; the
 * trip to the tent after a lost battle. The battle and the visit themselves
 * are the engine's (its `battle-reducer.test.ts` and `doctor.test.ts`).
 *
 * The prototype world's spawn tile, (-2, 6), has a river reed (tall grass)
 * straight to its left, so walking left and right from it meets animals
 * (squirrels and rabbits near home, now and then an otter). Seven steps
 * right, all on grass, is (5, 6), just above the tent at (5, 7).
 */
type Session = { authority: LocalAuthority; events: GameEvent[] };

function session(options?: LocalAuthorityOptions): Session {
	const authority = new LocalAuthority(options);
	const events: GameEvent[] = [];
	authority.subscribe((e) => events.push(e));
	authority.start();
	return { authority, events };
}

/** Index of the last event of `type`, or -1. (ES2022 has no `findLastIndex`.) */
function lastIndexOf(s: Session, type: GameEvent['type']): number {
	for (let i = s.events.length - 1; i >= 0; i--) if (s.events[i]!.type === type) return i;
	return -1;
}

function welcome(s: Session): Extract<GameEvent, { type: 'welcome' }> {
	const w = s.events.find((e) => e.type === 'welcome');
	if (w?.type !== 'welcome') throw new Error('no welcome');
	return w;
}

/** Walk left/right past the reed until a battle starts; the state it started with. */
function walkIntoBattle(s: Session, maxSteps = 400): BattleState {
	for (let i = 0; i < maxSteps; i++) {
		const from = s.events.length;
		s.authority.dispatch({ type: 'move', dir: i % 2 === 0 ? 'left' : 'right' });
		const started = s.events.slice(from).find((e) => e.type === 'battle-started');
		if (started?.type === 'battle-started') return started.state;
	}
	throw new Error(`no encounter in ${maxSteps} steps`);
}

function latestBattle(s: Session): BattleState {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (e.type === 'battle-updated' || e.type === 'battle-started') return e.state;
	}
	throw new Error('no battle yet');
}

/** Pick an attack and answer it, right or wrong on purpose. */
function attack(s: Session, attackIndex: number, level: 1 | 2 | 3, correct: boolean): void {
	s.authority.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex, level } });
	const phase = latestBattle(s).phase;
	if (phase.kind !== 'solving') throw new Error(`expected a puzzle, got ${phase.kind}`);
	const input = String(correct ? phase.puzzle.answer : phase.puzzle.answer + 1);
	s.authority.dispatch({ type: 'battle', intent: { type: 'answer', input } });
}

function party(s: Session): AnimalInstance[] {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (e.type === 'party-changed' || e.type === 'welcome' || e.type === 'taken-to-doctor') {
			return e.party;
		}
	}
	throw new Error('no party');
}

function lastMessage(s: Session): string {
	const m = s.events.filter((e) => e.type === 'message').at(-1);
	return m?.type === 'message' ? m.text : '';
}

/** Where the player stands, from the events. */
function position(s: Session): GridPos {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (
			e.type === 'player-moved' ||
			e.type === 'player-placed' ||
			e.type === 'taken-to-doctor' ||
			e.type === 'welcome'
		) {
			return e.pos;
		}
	}
	throw new Error('no position');
}

/** Which way the player faces, from the events, as the client turns the figure. */
function facing(s: Session): Direction {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (e.type === 'player-moved' || e.type === 'player-blocked') return e.dir;
		if (e.type === 'taken-to-doctor') return e.dir;
		if (e.type === 'welcome') return 'down';
	}
	throw new Error('no facing');
}

function move(s: Session, ...dirs: Direction[]): void {
	for (const dir of dirs) s.authority.dispatch({ type: 'move', dir });
}

function doctorIntent(s: Session, intent: DoctorIntent): void {
	s.authority.dispatch({ type: 'doctor', intent });
}

/** The doctor visit as the last doctor event left it. */
function visit(s: Session): DoctorState {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (
			e.type === 'doctor-visit-started' ||
			e.type === 'doctor-visit-updated' ||
			e.type === 'doctor-visit-ended'
		) {
			return e.state;
		}
	}
	throw new Error('no doctor visit');
}

/** Seven steps right from spawn, all on grass, to (5, 6); then bump down into the tent at (5, 7). */
function walkToTent(s: Session): void {
	move(s, ...Array<Direction>(7).fill('right'));
	expect(position(s)).toEqual({ x: 5, y: 6 });
	move(s, 'down');
	expect(position(s)).toEqual({ x: 5, y: 6 });
	expect(facing(s)).toBe('down');
}

/** A hurt party: a squirrel at 5 of 20, a tired rabbit, a fox at full HP. */
function hurtParty(): AnimalInstance[] {
	return [
		{ id: 'a', speciesId: 'squirrel', hp: 5 },
		{ id: 'b', speciesId: 'rabbit', hp: 0 },
		{ id: 'c', speciesId: 'fox', hp: getAnimal('fox').maxHp }
	];
}

/** Answer the open doctor puzzle, right or wrong on purpose. */
function answerDoctor(s: Session, correct: boolean): void {
	const phase = visit(s).phase;
	if (phase.kind !== 'solving') throw new Error(`expected a doctor puzzle, got ${phase.kind}`);
	doctorIntent(s, {
		type: 'answer',
		input: String(correct ? phase.puzzle.answer : phase.puzzle.answer + 1)
	});
}

/** Win the current battle: the strongest attack at level 3, always right. */
function win(s: Session): void {
	while (latestBattle(s).phase.kind !== 'ended') {
		const state = latestBattle(s);
		attack(s, getAnimal(state.party[state.active]!.speciesId).attacks.length, 3, true);
	}
}

/** Lose the current battle: every answer wrong. */
function lose(s: Session): void {
	while (latestBattle(s).phase.kind !== 'ended') attack(s, 1, 1, false);
}

/**
 * Weaken the wild animal to a third of its HP with the hardest hits that
 * leave it standing, then throw the leash until the battle ends.
 */
function tryToCatch(s: Session): void {
	for (let turn = 0; turn < 80 && latestBattle(s).phase.kind !== 'ended'; turn++) {
		const state = latestBattle(s);
		const wild = state.opponent;
		const mine = getAnimal(state.party[state.active]!.speciesId);
		let best: { n: number; level: 1 | 2 | 3; damage: number } | null = null;
		for (let n = 1; n <= mine.attacks.length; n++) {
			for (const level of ATTACK_LEVELS) {
				const damage = attackDamage(mine, n, level, true);
				if (damage < wild.hp && (!best || damage > best.damage)) best = { n, level, damage };
			}
		}
		if (wild.hp * 3 > getAnimal(wild.speciesId).maxHp && best) {
			attack(s, best.n, best.level, true);
		} else {
			s.authority.dispatch({ type: 'battle', intent: { type: 'throw-leash' } });
		}
	}
}

/** The events a finished battle's last intent produced, from its `battle-updated` on. */
function closingEvents(s: Session): GameEvent[] {
	return s.events.slice(lastIndexOf(s, 'battle-updated'));
}

describe('LocalAuthority: encounters', () => {
	it('a walk meets the same animals and puzzles at the same steps, each with a fresh id', () => {
		const a = session();
		const b = session();
		for (let n = 0; n < 4; n++) {
			const fromA = a.events.length;
			const fromB = b.events.length;
			const first = walkIntoBattle(a);
			const second = walkIntoBattle(b);
			expect(a.events.length - fromA).toBe(b.events.length - fromB);
			expect(second.opponent.speciesId).toBe(first.opponent.speciesId);
			expect(second.opponent.id).not.toBe(first.opponent.id);
			for (const s of [a, b]) {
				s.authority.dispatch({
					type: 'battle',
					intent: { type: 'attack', attackIndex: 1, level: n % 3 === 0 ? 1 : 2 }
				});
			}
			expect(latestBattle(b).phase).toEqual(latestBattle(a).phase);
			for (const s of [a, b]) {
				s.authority.dispatch({ type: 'battle', intent: { type: 'answer', input: '1' } });
				if (latestBattle(s).phase.kind !== 'ended') {
					s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
				}
			}
			expect(party(b)).toEqual(party(a));
		}
	});

	it('starts a battle only right after a step onto an encounter tile, at full HP', () => {
		const s = session();
		const { seed } = welcome(s);
		for (let n = 0; n < 6; n++) {
			const state = walkIntoBattle(s);
			const i = lastIndexOf(s, 'battle-started');
			const step = s.events[i - 1];
			if (step?.type !== 'player-moved') throw new Error(`battle after ${step?.type}`);
			expect(isEncounterTile(tileAtWorld(seed, step.pos.x, step.pos.y).kind)).toBe(true);
			expect(state.opponent.hp).toBe(getAnimal(state.opponent.speciesId).maxHp);
			s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		}
	});

	it('mid-battle, walking and talking do nothing; outside one, battle intents do nothing', () => {
		const s = session();
		const idle = s.events.length;
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(s.events.length).toBe(idle);

		walkIntoBattle(s);
		const before = s.events.length;
		const pos = position(s);
		s.authority.dispatch({ type: 'move', dir: 'right' });
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.length).toBe(before);
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(position(s)).toEqual(pos);
	});
});

describe('LocalAuthority: outcomes', () => {
	it('won: HP lost in the battle stays lost, into the next battle too', () => {
		const s = session();
		// Wild animals sometimes miss, so win until a battle has cost some HP.
		let final: BattleState | null = null;
		for (let n = 0; n < 20 && !final; n++) {
			walkIntoBattle(s);
			win(s);
			const end = latestBattle(s);
			if (end.party[0]!.hp < getAnimal('squirrel').maxHp) final = end;
		}
		if (!final) throw new Error('twenty wins without losing any HP');
		expect(final.phase).toEqual({ kind: 'ended', outcome: 'won' });
		expect(party(s)).toEqual(final.party);
		expect(closingEvents(s).map((e) => e.type)).toEqual([
			'battle-updated',
			'battle-ended',
			'party-changed',
			'message'
		]);
		// The next walk goes on from where the battle was, and the next battle
		// starts with the HP this one left.
		const from = position(s);
		s.authority.dispatch({ type: 'move', dir: 'right' });
		expect(position(s)).toEqual({ x: from.x + 1, y: from.y });
		expect(walkIntoBattle(s).party).toEqual(final.party);
	});

	it('fled: nothing changes but a message', () => {
		const s = session();
		walkIntoBattle(s);
		const before = party(s);
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(latestBattle(s).phase).toEqual({ kind: 'ended', outcome: 'fled' });
		expect(party(s)).toEqual(before);
		expect(lastMessage(s)).toMatch(/stays in the grass/);
	});

	it('lost: taken to the nearest tent on foot, facing it, with everyone healed', () => {
		const s = session();
		const { seed } = welcome(s);
		walkIntoBattle(s);
		const lostOn = position(s);
		lose(s);
		const end = latestBattle(s);
		expect(end.phase).toEqual({ kind: 'ended', outcome: 'lost' });
		expect(closingEvents(s).map((e) => e.type)).toEqual([
			'battle-updated',
			'battle-ended',
			'taken-to-doctor',
			'message'
		]);
		const rescue = takeToDoctor(seed, lostOn, end.party);
		const taken = s.events.find((e) => e.type === 'taken-to-doctor');
		expect(taken).toEqual({
			type: 'taken-to-doctor',
			playerId: welcome(s).playerId,
			pos: rescue.pos,
			dir: rescue.facing,
			tent: rescue.tent,
			party: rescue.party
		});
		// Near spawn that is the tent at (5, 7), from its left.
		expect(rescue).toMatchObject({ tent: { x: 5, y: 7 }, pos: { x: 4, y: 7 }, facing: 'right' });
		for (const a of party(s)) expect(a.hp).toBe(getAnimal(a.speciesId).maxHp);
		expect(lastMessage(s)).toBe(rescue.message);

		// The authority faces the tent too: Enter talks to the doctor at once.
		expect(canTalkToDoctor(seed, position(s), facing(s))).toBe(true);
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.at(-1)?.type).toBe('doctor-visit-started');
		doctorIntent(s, { type: 'leave' });

		// And it walks on from the tent, not from where the battle was.
		move(s, 'left');
		expect(position(s)).toEqual({ x: 3, y: 7 });
	});

	it('caught: joins the party with the HP it had; a seventh animal is let go', () => {
		const s = session();
		let caught = 0;
		for (let battles = 0; battles < 200 && party(s).length < 7; battles++) {
			const before = party(s).length;
			walkIntoBattle(s);
			tryToCatch(s);
			const end = latestBattle(s);
			if (end.phase.kind !== 'ended' || end.phase.outcome !== 'caught') continue;
			caught++;
			const ended = closingEvents(s).find((e) => e.type === 'battle-updated');
			const event =
				ended?.type === 'battle-updated' ? ended.events.find((e) => e.type === 'ended') : null;
			const animal = event?.type === 'ended' ? event.caught : undefined;
			expect(animal).toBeDefined();
			if (before < 6) {
				expect(party(s)).toHaveLength(before + 1);
				expect(party(s).at(-1)).toEqual(animal);
				expect(lastMessage(s)).toMatch(/joins your team/);
			} else {
				expect(party(s)).toHaveLength(6);
				expect(party(s).map((a) => a.id)).not.toContain(animal!.id);
				expect(lastMessage(s)).toMatch(/team is full/);
				return;
			}
		}
		throw new Error(`the party never filled up (${caught} caught)`);
	});
});

describe('LocalAuthority: facing', () => {
	it('faces down from the start, then the way of every move, walked or blocked', () => {
		const s = session();
		const { seed } = welcome(s);
		expect(facing(s)).toBe('down');
		move(s, 'up'); // the river, above the spawn tile
		expect(s.events.at(-1)).toMatchObject({ type: 'player-blocked', dir: 'up' });
		move(s, 'right');
		expect(s.events.at(-1)).toMatchObject({ type: 'player-moved', dir: 'right' });

		// Beside the tent but facing away, Enter only says how to reach a doctor.
		move(s, ...Array<Direction>(6).fill('right'));
		expect(position(s)).toEqual({ x: 5, y: 6 });
		expect(canTalkToDoctor(seed, position(s), 'down')).toBe(true);
		const before = s.events.length;
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.slice(before)).toEqual([{ type: 'message', text: NOT_AT_A_TENT }]);

		// Bumping into the tent turns the player to it; now Enter talks.
		move(s, 'down');
		expect(s.events.at(-1)).toMatchObject({ type: 'player-blocked', dir: 'down' });
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.at(-1)).toMatchObject({ type: 'doctor-visit-started' });
	});

	it('a nearest-tent stand from far away is one the player faces the tent from', () => {
		// The knock-out rule and the authority agree on facing for any tent, not only (5, 7).
		const s = session();
		const { seed } = welcome(s);
		for (const from of [
			{ x: 40, y: -30 },
			{ x: -60, y: 45 }
		]) {
			const spot = nearestTent(seed, from);
			if (!spot) continue;
			expect(canTalkToDoctor(seed, spot.stand, spot.facing)).toBe(true);
		}
	});
});

describe('LocalAuthority: the doctor', () => {
	it('heals one animal per solved puzzle; a miss costs nothing; walking waits', () => {
		const s = session({ party: hurtParty() });
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		expect(visit(s).phase).toEqual({ kind: 'choose-patient' });
		expect(visit(s).log).toEqual(['Hello! Who needs help today?']);

		// Walking and battle intents wait until the visit ends.
		const pos = position(s);
		const quiet = s.events.length;
		move(s, 'up', 'left');
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(s.events.length).toBe(quiet);

		// A healthy animal can't be picked: the engine says why, nothing changes.
		doctorIntent(s, { type: 'pick-patient', partyIndex: 2 });
		expect(s.events.at(-1)).toMatchObject({ type: 'doctor-visit-updated' });
		expect(visit(s).phase).toEqual({ kind: 'choose-patient' });

		// A miss: the HP stays, another puzzle, no party change.
		doctorIntent(s, { type: 'pick-patient', partyIndex: 1 });
		const first = visit(s).phase;
		const beforeMiss = s.events.length;
		answerDoctor(s, false);
		const missed = s.events.slice(beforeMiss);
		expect(missed.map((e) => e.type)).toEqual(['doctor-visit-updated']);
		expect(visit(s).party[1]!.hp).toBe(0);
		expect(visit(s).phase).toMatchObject({ kind: 'solving', partyIndex: 1 });
		expect(visit(s).phase).not.toEqual(first);
		expect(visit(s).log.at(-1)).toBe("Not quite! Let's try another one.");

		// A right answer heals that one animal, and the party is written back at once.
		answerDoctor(s, true);
		expect(s.events.at(-1)).toEqual({
			type: 'party-changed',
			party: [hurtParty()[0], { ...hurtParty()[1], hp: getAnimal('rabbit').maxHp }, hurtParty()[2]]
		});

		// Switching mid-puzzle swaps it; leaving mid-puzzle heals nobody else.
		doctorIntent(s, { type: 'pick-patient', partyIndex: 0 });
		expect(visit(s).phase).toMatchObject({ kind: 'solving', partyIndex: 0 });
		const beforeLeave = s.events.length;
		doctorIntent(s, { type: 'leave' });
		expect(s.events.slice(beforeLeave).map((e) => e.type)).toEqual([
			'doctor-visit-updated',
			'doctor-visit-ended',
			'message'
		]);
		expect(lastMessage(s)).toBe('Bye! Come back any time.');
		expect(visit(s).party.map((a) => a.hp)).toEqual([
			5,
			getAnimal('rabbit').maxHp,
			getAnimal('fox').maxHp
		]);

		// Walking works again, from where the visit was; doctor intents do nothing now.
		const after = s.events.length;
		doctorIntent(s, { type: 'leave' });
		expect(s.events.length).toBe(after);
		move(s, 'left');
		expect(position(s)).toEqual({ x: pos.x - 1, y: pos.y });
	});

	it('with nobody hurt, the doctor says so and the visit can only end', () => {
		const s = session();
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		expect(visit(s).log).toEqual(['Hello! Your animals are all fit and happy.']);
		doctorIntent(s, { type: 'pick-patient', partyIndex: 0 });
		expect(visit(s).phase).toEqual({ kind: 'choose-patient' });
		doctorIntent(s, { type: 'leave' });
		expect(s.events.at(-2)).toMatchObject({ type: 'doctor-visit-ended' });
	});

	it('a visit replays from the same intents, and a second visit asks new puzzles', () => {
		const prompts = (s: Session): string[] => {
			s.authority.dispatch({ type: 'interact' });
			const seen: string[] = [];
			doctorIntent(s, { type: 'pick-patient', partyIndex: 0 });
			for (let i = 0; i < 6; i++) {
				const phase = visit(s).phase;
				if (phase.kind === 'solving') seen.push(phase.puzzle.prompt);
				answerDoctor(s, false);
			}
			doctorIntent(s, { type: 'leave' });
			return seen;
		};
		const a = session({ party: hurtParty() });
		const b = session({ party: hurtParty() });
		walkToTent(a);
		walkToTent(b);
		const firstA = prompts(a);
		expect(prompts(b)).toEqual(firstA);
		// Same tile, same step count, a new visit: the seed is fresh.
		expect(prompts(a)).not.toEqual(firstA);
	});

	it('a doctor visit never shows its seed', () => {
		const s = session({ party: hurtParty() });
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		doctorIntent(s, { type: 'pick-patient', partyIndex: 0 });
		for (const e of s.events) {
			if (e.type.startsWith('doctor-')) expect(JSON.stringify(e)).not.toMatch(/seed/i);
		}
	});
});
