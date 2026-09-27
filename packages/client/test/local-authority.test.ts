import {
	ATTACK_LEVELS,
	EDITS_BUDGET,
	ITEM_IDS,
	Rng,
	WorldEdits,
	arrivalSpot,
	attackDamage,
	canTalkToDoctor,
	encounterTable,
	getAnimal,
	TENT_SEARCH_STEPS,
	isBundled,
	isEncounterTile,
	isWalkable,
	isWater,
	itemsForSale,
	joinParty,
	leadIndex,
	nearestTent,
	newGame,
	step as stepFrom,
	readSave,
	restoreGame,
	STARTERS,
	saveDocument,
	spawnPoint,
	startBattle,
	takeToDoctor,
	tileAtWorld,
	type AnimalInstance,
	type BattleState,
	type Direction,
	type DoctorIntent,
	type DoctorState,
	type GameEvent,
	type GridPos,
	type Intent,
	type SavedGame,
	worldSeed
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority, WORLD_SEED, type LocalAuthorityOptions } from '../src/authority/local';
import { parseParty } from '../src/flags';
import { game } from '../src/state/game.svelte';
import { besideA, gameBeside } from './clearing';

/**
 * The single-player authority's own rules — the ones around the engine, not
 * in it: one encounter roll per completed step, keyed so a walk replays; the
 * battle's result written back into the world; the facing it keeps so that
 * Enter talks to a doctor only at a tent; the doctor visit and its seed; the
 * trip to the tent after a lost battle; what it tells the engine the player
 * is doing when the party is edited. The battle, the visit and the party
 * rules themselves are the engine's (its `battle-reducer.test.ts`,
 * `doctor.test.ts` and `party.test.ts`).
 *
 * The prototype world's spawn tile, (-2, 6), has a river reed (tall grass)
 * straight to its left, with the lake all round it, so walking left and right
 * from it meets animals (with the starter squirrel in front: mostly the frogs
 * that live by the water, the squirrels and rabbits that come down to it near
 * home, now and then an otter). Seven steps right, all on grass, is (5, 6),
 * just above the tent at (5, 7).
 */
type Session = { authority: LocalAuthority; events: GameEvent[] };

function session(options?: LocalAuthorityOptions): Session {
	const authority = new LocalAuthority(options);
	const events: GameEvent[] = [];
	authority.subscribe((e) => events.push(e));
	authority.start();
	return { authority, events };
}

/** Options that start with a party written as `?party=` would write it. */
function withParty(param: string): LocalAuthorityOptions {
	return { party: parseParty(param)! };
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

/**
 * Hand the authority a party before any battle, as a loaded save would.
 * `LocalAuthority` has no way to take one yet, so this sets the field itself.
 */
function giveParty(s: Session, party: AnimalInstance[]): void {
	(s.authority as unknown as { party: AnimalInstance[] }).party = party.map((a) => ({ ...a }));
}

const animal = (speciesId: string, hp = getAnimal(speciesId).maxHp): AnimalInstance => ({
	id: `${speciesId}-${hp}`,
	speciesId,
	hp
});

/**
 * Press Left, Right, Left, … from the spawn tile for `steps` steps, running
 * from every battle: every Left lands on the reed. Which animal came out on
 * which step, and which of the player's animals stepped in against it.
 */
function reedWalk(s: Session, steps: number): { step: number; wild: string; lead: string }[] {
	const met: { step: number; wild: string; lead: string }[] = [];
	for (let step = 1; step <= steps; step++) {
		const from = s.events.length;
		s.authority.dispatch({ type: 'move', dir: step % 2 === 1 ? 'left' : 'right' });
		const fresh = s.events.slice(from);
		if (!fresh.some((e) => e.type === 'player-moved')) throw new Error(`step ${step} was blocked`);
		const started = fresh.find((e) => e.type === 'battle-started');
		if (started?.type !== 'battle-started') continue;
		const { opponent, party, active } = started.state;
		met.push({ step, wild: opponent.speciesId, lead: party[active]!.speciesId });
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
	}
	return met;
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

/** After a knock-out, send in the first animal still standing; otherwise nothing. */
function stepIn(s: Session): void {
	const state = latestBattle(s);
	if (state.phase.kind !== 'choose-animal') return;
	const partyIndex = state.party.findIndex((a) => a.hp > 0);
	s.authority.dispatch({ type: 'battle', intent: { type: 'switch', partyIndex } });
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
		if (
			e.type === 'party-changed' ||
			e.type === 'party-edited' ||
			e.type === 'welcome' ||
			e.type === 'taken-to-doctor'
		) {
			return e.party;
		}
	}
	throw new Error('no party');
}

/** The key of the last line the authority said: which line, not its words (those are the client's). */
function lastMessage(s: Session): string {
	const m = s.events.filter((e) => e.type === 'message').at(-1);
	return m?.type === 'message' ? m.line.key : '';
}

/** Where the player stands, from the events. */
function position(s: Session): GridPos {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (
			e.type === 'player-moved' ||
			e.type === 'player-placed' ||
			e.type === 'taken-to-doctor' ||
			e.type === 'travelled' ||
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
		if (e.type === 'taken-to-doctor' || e.type === 'player-placed') return e.dir;
		if (e.type === 'welcome' || e.type === 'travelled') return e.facing;
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

/** Answer the open doctor puzzle (a heal, or a token sum), right or wrong on purpose. */
function answerDoctor(s: Session, correct: boolean): void {
	const phase = visit(s).phase;
	if (phase.kind === 'choose-patient' || phase.kind === 'ended')
		throw new Error(`expected a doctor puzzle, got ${phase.kind}`);
	doctorIntent(s, {
		type: 'answer',
		input: String(correct ? phase.puzzle.answer : phase.puzzle.answer + 1)
	});
}

/** Win the current battle: the strongest attack at level 3, always right. */
function win(s: Session): void {
	while (latestBattle(s).phase.kind !== 'ended') {
		stepIn(s);
		const state = latestBattle(s);
		attack(s, getAnimal(state.party[state.active]!.speciesId).attacks.length, 3, true);
	}
}

/** Lose the current battle: every answer wrong. */
function lose(s: Session): void {
	while (latestBattle(s).phase.kind !== 'ended') {
		stepIn(s);
		attack(s, 1, 1, false);
	}
}

/**
 * Weaken the wild animal to a third of its HP with the hardest hits that
 * leave it standing, then throw the leash until the battle ends.
 */
function tryToCatch(s: Session): void {
	for (let turn = 0; turn < 80 && latestBattle(s).phase.kind !== 'ended'; turn++) {
		stepIn(s);
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

describe('LocalAuthority: the lead decides who comes out', () => {
	it('with the starter in front, the reed meets a Brown rat on step 11, a Frog on step 15, the first Otter on step 53 and the first Toad on step 71', () => {
		const met = reedWalk(session(), 200);
		expect(met[0]).toEqual({ step: 11, wild: 'brown-rat', lead: 'squirrel' });
		expect(met[1]).toEqual({ step: 15, wild: 'frog', lead: 'squirrel' });
		expect(met.find((m) => m.wild === 'otter')?.step).toBe(53);
		expect(met.find((m) => m.wild === 'common-toad')?.step).toBe(71);
		// Only what a tier-1 lead meets in the reeds: the river's own small and tier-2 animals,
		// and the small ones that come down to the water.
		const river = encounterTable('river', 0, 1).map((e) => e.species.id);
		expect(met.every((m) => river.includes(m.wild))).toBe(true);
		expect(met.map((m) => m.wild)).toContain('wood-mouse');
	});

	it("the first animal that is not tired leads: with a fox in front the reed has the river's tier-2 animals and now and then a small one, on the same steps", () => {
		const starter = reedWalk(session(), 200);
		for (const party of [
			[animal('fox'), animal('squirrel')],
			[animal('squirrel', 0), animal('fox')]
		]) {
			const s = session();
			giveParty(s, party);
			const met = reedWalk(s, 200);
			expect(met.map((m) => m.step)).toEqual(starter.map((m) => m.step));
			// The river's small animals are one tier below a fox: 3 challengers in 43 there.
			const small = ['frog', 'brown-rat', 'common-toad'];
			expect(met.filter((m) => small.includes(m.wild)).map((m) => m.step)).toEqual([53, 107, 117]);
			const bigger = ['otter', 'grey-heron', 'raccoon', 'beaver'];
			expect(met.filter((m) => !small.includes(m.wild)).every((m) => bigger.includes(m.wild))).toBe(
				true
			);
			expect(new Set(met.map((m) => m.lead))).toEqual(new Set(['fox']));
		}
		// Behind a standing squirrel, a fox changes nothing.
		const s = session();
		giveParty(s, [animal('squirrel'), animal('fox')]);
		expect(reedWalk(s, 200)).toEqual(starter);
	});

	it('choosing a lead in explore changes who comes out, on the same steps', () => {
		const starter = reedWalk(session(), 60);
		const s = session(withParty('squirrel,fox'));
		const fox = party(s)[1]!;
		s.authority.dispatch({ type: 'party', intent: { type: 'select-lead', animalId: fox.id } });
		const met = reedWalk(s, 60);
		expect(met.length).toBeGreaterThan(0);
		expect(met.map((m) => m.step)).toEqual(starter.map((m) => m.step));
		expect(new Set(met.map((m) => m.wild))).toEqual(new Set(['grey-heron', 'otter', 'brown-rat']));
		expect(new Set(met.map((m) => m.lead))).toEqual(new Set(['fox']));
	});

	it('with a bear in front, nothing at the river is big enough to come out', () => {
		for (const party of [[animal('bear')], [animal('squirrel', 0), animal('bear')]]) {
			const s = session();
			giveParty(s, party);
			expect(reedWalk(s, 400)).toEqual([]);
		}
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
		expect(lastMessage(s)).toBe('battle.closing.fled');
	});

	it('lost: taken to the nearest tent on foot, facing it, with everyone healed', () => {
		const s = session();
		const { seed } = welcome(s);
		walkIntoBattle(s);
		const lostOn = position(s);
		lose(s);
		const end = latestBattle(s);
		expect(end.phase).toEqual({ kind: 'ended', outcome: 'lost' });
		// No `message`: the client words the doctor's line from the event.
		expect(closingEvents(s).map((e) => e.type)).toEqual([
			'battle-updated',
			'battle-ended',
			'taken-to-doctor'
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

		// The authority faces the tent too: Enter talks to the doctor at once.
		expect(canTalkToDoctor(seed, position(s), facing(s))).toBe(true);
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.at(-1)?.type).toBe('doctor-visit-started');
		doctorIntent(s, { type: 'leave' });

		// And it walks on from the tent, not from where the battle was.
		move(s, 'left');
		expect(position(s)).toEqual({ x: 3, y: 7 });
	});

	it('caught: joins the party with the HP it had, at the end of its bundle, the seventh and on too', () => {
		const s = session();
		for (let battles = 0; battles < 300 && party(s).length < 9; battles++) {
			const before = party(s);
			walkIntoBattle(s);
			tryToCatch(s);
			const end = latestBattle(s);
			if (end.phase.kind !== 'ended' || end.phase.outcome !== 'caught') continue;
			const ended = closingEvents(s).find((e) => e.type === 'battle-updated');
			const event =
				ended?.type === 'battle-updated' ? ended.events.find((e) => e.type === 'ended') : null;
			const animal = event?.type === 'ended' ? event.caught : undefined;
			expect(animal).toBeDefined();
			// No cap: every catch joins, behind the others of its kind (the party's HP as
			// the battle left it).
			expect(party(s)).toEqual(joinParty(end.party, animal!));
			expect(isBundled(party(s))).toBe(true);
			expect(lastMessage(s)).toBe('battle.closing.joined');
			expect(party(s)).toHaveLength(before.length + 1);
		}
		expect(party(s)).toHaveLength(9);
	});
});

describe('LocalAuthority: saved games', () => {
	/** Whether a battle is in progress, from the events. */
	function inBattle(s: Session): boolean {
		return lastIndexOf(s, 'battle-started') > lastIndexOf(s, 'battle-ended');
	}

	/** What a scripted kid does next: walk the reed, fight, get one in four wrong, leash the weak. */
	function nextIntent(s: Session, i: number): Intent {
		if (!inBattle(s)) return { type: 'move', dir: i % 2 === 0 ? 'left' : 'right' };
		const state = latestBattle(s);
		if (state.phase.kind === 'choose-animal') {
			// A knock-out: send in the first one standing.
			const partyIndex = state.party.findIndex((a) => a.hp > 0);
			return { type: 'battle', intent: { type: 'switch', partyIndex } };
		}
		if (state.phase.kind === 'solving') {
			const { answer } = state.phase.puzzle;
			const input = String(i % 4 === 0 ? answer + 1 : answer);
			return { type: 'battle', intent: { type: 'answer', input } };
		}
		const wild = state.opponent;
		if (wild.hp * 3 < getAnimal(wild.speciesId).maxHp) {
			return { type: 'battle', intent: { type: 'throw-leash' } };
		}
		return { type: 'battle', intent: { type: 'attack', attackIndex: 1, level: 1 } };
	}

	/** An event with minted ids left out: what must match between two runs of one game. */
	function fingerprint(e: GameEvent): unknown {
		const party = (p: readonly AnimalInstance[]) => p.map((a) => [a.speciesId, a.hp]);
		switch (e.type) {
			case 'battle-started':
			case 'battle-ended':
				return [
					e.type,
					e.state.opponent.speciesId,
					e.state.opponent.hp,
					party(e.state.party),
					e.state.phase
				];
			case 'battle-updated':
				return [
					e.type,
					e.state.step,
					party(e.state.party),
					e.state.phase,
					e.events.map((x) => x.type)
				];
			case 'party-changed':
				return [e.type, party(e.party)];
			case 'taken-to-doctor':
				return [e.type, e.pos, e.dir, e.tent, party(e.party)];
			case 'doctor-visit-started':
			case 'doctor-visit-updated':
			case 'doctor-visit-ended':
				return [e.type, e.visit, party(e.state.party), e.state.phase];
			default:
				return e;
		}
	}

	/** A save round trip, as the autosave and a reload do it: JSON through storage, then restore. */
	function throughSave(game: SavedGame): SavedGame {
		const doc = saveDocument(game, { lineage: 'test', seq: 1 });
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save);
	}

	it('a restored game plays on exactly as the original does, cut anywhere, mid-puzzle included', () => {
		const cuts = { explore: 0, choose: 0, solving: 0 };
		for (const cut of [3, 11, 12, 13, 14, 20, 33, 47, 60, 75]) {
			const a = session();
			let i = 0;
			for (; i < cut; i++) a.authority.dispatch(nextIntent(a, i));
			const saved = throughSave(a.authority.snapshot());
			if (!saved.battle) cuts.explore++;
			else if (saved.battle.phase.kind === 'solving') cuts.solving++;
			else cuts.choose++;

			const b: Session = { authority: new LocalAuthority(), events: [] };
			b.authority.subscribe((e) => b.events.push(e));
			b.authority.start({ game: saved });
			expect(inBattle(b)).toBe(inBattle(a));
			const fromA = a.events.length;
			const fromB = b.events.length;
			for (; i < cut + 60; i++) {
				a.authority.dispatch(nextIntent(a, i));
				b.authority.dispatch(nextIntent(b, i));
			}
			expect(b.events.slice(fromB).map(fingerprint)).toEqual(
				a.events.slice(fromA).map(fingerprint)
			);
		}
		// The cuts land in explore, at the battle menu and in the middle of a puzzle.
		expect(cuts.explore).toBeGreaterThan(0);
		expect(cuts.choose).toBeGreaterThan(0);
		expect(cuts.solving).toBeGreaterThan(0);
	});

	it('start picks up a saved battle: welcome, then battle-started with the saved state', () => {
		const a = session();
		walkIntoBattle(a);
		a.authority.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex: 1, level: 2 } });
		const saved = throughSave(a.authority.snapshot());
		expect(saved.battle?.phase.kind).toBe('solving');

		const b: Session = { authority: new LocalAuthority(), events: [] };
		b.authority.subscribe((e) => b.events.push(e));
		b.authority.start({ game: saved });
		expect(b.events.map((e) => e.type)).toEqual(['welcome', 'battle-started']);
		expect(welcome(b)).toMatchObject({ pos: saved.pos, facing: saved.facing, party: saved.party });
		expect(latestBattle(b)).toEqual(latestBattle(a));
		// Walking waits for the battle, as it would have before the reload.
		b.authority.dispatch({ type: 'move', dir: 'up' });
		expect(b.events.length).toBe(2);
	});

	it('mid-battle, the snapshot holds the battle and its party as they stand; in explore, no battle', () => {
		const s = session();
		expect(s.authority.snapshot().battle).toBeNull();
		walkIntoBattle(s);
		lose(s);
		walkIntoBattle(s);
		attack(s, 1, 1, false);
		const state = latestBattle(s);
		const snap = s.authority.snapshot();
		expect(snap.battle).toEqual(state);
		expect(snap.party).toEqual(state.party);
		expect(snap.pos).toEqual(position(s));
	});

	it('keeps the facing the client shows: down at first, then every move, walked or blocked', () => {
		const s = session();
		expect(welcome(s).facing).toBe('down');
		expect(s.authority.snapshot().facing).toBe('down');
		for (const dir of ['up', 'left', 'down', 'right'] as const) {
			s.authority.dispatch({ type: 'move', dir });
			expect(s.authority.snapshot().facing).toBe(dir);
		}
		// The spawn tile has water beside it: walk until something blocks, and the facing follows.
		const blockedAt = s.events.length;
		for (
			let n = 0;
			n < 40 && !s.events.slice(blockedAt).some((e) => e.type === 'player-blocked');
			n++
		) {
			if (inBattle(s)) s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
			s.authority.dispatch({ type: 'move', dir: 'up' });
		}
		expect(s.events.slice(blockedAt).some((e) => e.type === 'player-blocked')).toBe(true);
		expect(s.authority.snapshot().facing).toBe('up');
	});

	it('a restored game asks the doctor puzzles the original would have', () => {
		const a = session({ party: hurtParty() });
		walkToTent(a);
		// A visit before the save: a look at the squirrel's puzzle, then leave.
		a.authority.dispatch({ type: 'interact' });
		doctorIntent(a, { type: 'pick-patient', partyIndex: 0 });
		doctorIntent(a, { type: 'leave' });
		const saved = throughSave(a.authority.snapshot());
		expect(saved.visits).toBe(1);

		const b: Session = { authority: new LocalAuthority(), events: [] };
		b.authority.subscribe((e) => b.events.push(e));
		b.authority.start({ game: saved });
		expect(facing(b)).toBe('down');
		// The next visit, in both: the same puzzle for the same animal.
		for (const s of [a, b]) {
			s.authority.dispatch({ type: 'interact' });
			doctorIntent(s, { type: 'pick-patient', partyIndex: 0 });
		}
		const [first, second] = [visit(a).phase, visit(b).phase];
		expect(first.kind).toBe('solving');
		expect(second).toEqual(first);
	});

	it('keeps the party as the kid arranged it: the chosen lead, the order and the nicknames', () => {
		const a = session({ party: hurtParty() });
		const [squirrel, rabbit, fox] = party(a);
		a.authority.dispatch({ type: 'party', intent: { type: 'select-lead', animalId: fox!.id } });
		a.authority.dispatch({
			type: 'party',
			intent: { type: 'rename', animalId: squirrel!.id, nickname: '  Nøddi  ' }
		});
		a.authority.dispatch({
			type: 'party',
			intent: { type: 'reorder', animalId: rabbit!.id, to: 0 }
		});
		const arranged = party(a);
		const saved = throughSave(a.authority.snapshot());
		expect(saved.party).toEqual(arranged);

		const b: Session = { authority: new LocalAuthority(), events: [] };
		b.authority.subscribe((e) => b.events.push(e));
		b.authority.start({ game: saved });
		expect(welcome(b).party).toEqual(arranged);
		expect(welcome(b).party.find((x) => x.id === squirrel!.id)?.nickname).toBe('Nøddi');
		// The rabbit is tired, so the fox still goes first.
		expect(leadIndex(party(b))).toBe(leadIndex(arranged));
		expect(party(b)[leadIndex(party(b))]!.id).toBe(fox!.id);
	});

	it('cleans a saved nickname the way a rename would, in the party and in a saved battle', () => {
		const a = session();
		walkIntoBattle(a);
		const game = a.authority.snapshot();
		const messy = '  Bob\u200b  ';
		const doc = saveDocument(
			{
				...game,
				party: game.party.map((x) => ({ ...x, nickname: messy })),
				battle: game.battle && {
					...game.battle,
					party: game.battle.party.map((x) => ({ ...x, nickname: messy }))
				}
			},
			{ lineage: 'test', seq: 1 }
		);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		const restored = restoreGame(read.save);
		expect(restored.party[0]!.nickname).toBe('Bob');
		// The battle still fits the (cleaned) party, so it comes back.
		expect(restored.battle?.party[0]!.nickname).toBe('Bob');
	});

	it('catches up with another tab: counts only rise', () => {
		const s = session();
		move(s, 'right', 'left');
		expect(s.authority.snapshot().steps).toBe(2);
		s.authority.catchUp({ steps: 40, visits: 3 });
		expect(s.authority.snapshot()).toMatchObject({ steps: 40, visits: 3 });
		s.authority.catchUp({ steps: 10, visits: 1 });
		expect(s.authority.snapshot()).toMatchObject({ steps: 40, visits: 3 });
	});

	it('catches up during a doctor visit: the visit keeps its number, the next one follows on (#58)', () => {
		const s = session();
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		const opened = s.events[lastIndexOf(s, 'doctor-visit-started')];
		if (opened?.type !== 'doctor-visit-started') throw new Error('no visit');
		const steps = s.authority.snapshot().steps;
		s.authority.catchUp({ steps: steps + 50, visits: 9 });
		expect(s.authority.snapshot()).toMatchObject({ steps: steps + 50, visits: 9 });
		doctorIntent(s, { type: 'leave' });
		const ended = s.events[lastIndexOf(s, 'doctor-visit-ended')];
		expect(ended?.type === 'doctor-visit-ended' && ended.visit).toBe(opened.visit);
		s.authority.dispatch({ type: 'interact' });
		const next = s.events[lastIndexOf(s, 'doctor-visit-started')];
		expect(next?.type === 'doctor-visit-started' && next.visit).toBe(10);
	});

	it('catches up mid-battle keyed as its save is: a restored copy plays on the same (#58)', () => {
		const b = session();
		walkIntoBattle(b);
		const steps = b.authority.snapshot().steps;
		b.authority.catchUp({ steps: steps + 50, visits: 9 });
		const saved = b.authority.snapshot();
		expect(saved).toMatchObject({ steps: steps + 50, visits: 9 });
		const c = session();
		c.authority.start({ game: saved });
		for (let i = 0; i < 8 && latestBattle(b).phase.kind !== 'ended'; i++) {
			stepIn(b);
			stepIn(c);
			attack(b, 1, 1, i % 3 === 0);
			attack(c, 1, 1, i % 3 === 0);
			expect(latestBattle(c)).toEqual(latestBattle(b));
		}
	});

	it('ignores intents until it has started', () => {
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.dispatch({ type: 'move', dir: 'left' });
		authority.dispatch({ type: 'interact' });
		expect(events).toEqual([]);
	});
});

describe('LocalAuthority: the party', () => {
	/** The `party-edited` the last party intent produced. */
	function lastEdit(s: Session): Extract<GameEvent, { type: 'party-edited' }> {
		const e = s.events[lastIndexOf(s, 'party-edited')];
		if (e?.type !== 'party-edited') throw new Error('no party-edited');
		return e;
	}

	it('a chosen lead is the animal that steps into the next battle', () => {
		const s = session(withParty('squirrel,rabbit,fox'));
		const fox = party(s)[2]!;
		s.authority.dispatch({ type: 'party', intent: { type: 'select-lead', animalId: fox.id } });
		expect(lastEdit(s).events).toEqual([{ type: 'lead-selected', animalId: fox.id, from: 2 }]);
		expect(party(s).map((a) => a.speciesId)).toEqual(['fox', 'squirrel', 'rabbit']);
		const battle = walkIntoBattle(s);
		expect(battle.party[battle.active]!.id).toBe(fox.id);
	});

	it('a tired animal is not chosen, and the refusal names it; no sentence is sent', () => {
		const s = session(withParty('squirrel,rabbit:0'));
		const before = party(s);
		const rabbit = before[1]!;
		const sent = s.events.length;
		s.authority.dispatch({ type: 'party', intent: { type: 'select-lead', animalId: rabbit.id } });
		expect(lastEdit(s).events).toEqual([
			{ type: 'rejected', reason: 'tired', animalId: rabbit.id }
		]);
		expect(party(s)).toEqual(before);
		// The facts only: the client words them in the language on screen.
		expect(s.events.slice(sent).map((e) => e.type)).toEqual(['party-edited']);
	});

	it('with the first animal tired, the next one standing leads the battle', () => {
		const s = session(withParty('squirrel:0,rabbit'));
		const battle = walkIntoBattle(s);
		expect(battle.active).toBe(1);
		expect(battle.party[1]!.speciesId).toBe('rabbit');
	});

	it('a name given in explore is the name the battle uses', () => {
		const s = session();
		const starter = party(s)[0]!;
		const nickname = '  Sir Fluffington the Third ';
		s.authority.dispatch({
			type: 'party',
			intent: { type: 'rename', animalId: starter.id, nickname }
		});
		expect(party(s)[0]!.nickname).toBe('Sir Fluffing');
		const battle = walkIntoBattle(s);
		expect(battle.party[battle.active]!.nickname).toBe('Sir Fluffing');
	});

	it('a party it starts with is cleaned like a rename', () => {
		const authority = new LocalAuthority({
			party: [
				{ id: 'a', speciesId: 'fox', hp: 3, nickname: '  \u{1F600} ' },
				{ id: 'b', speciesId: 'rabbit', hp: 1, nickname: ' Hop   Hop ' }
			]
		});
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start();
		const start = events.find((e) => e.type === 'welcome');
		expect(start?.type === 'welcome' && start.party).toStrictEqual([
			{ id: 'a', speciesId: 'fox', hp: 3 },
			{ id: 'b', speciesId: 'rabbit', hp: 1, nickname: 'Hop Hop' }
		]);
	});

	it('mid-battle every party edit is refused, and the battle writes back the party it began with', () => {
		const s = session(withParty('squirrel,rabbit'));
		const [squirrel, rabbit] = party(s);
		walkIntoBattle(s);
		for (const intent of [
			{ type: 'select-lead', animalId: rabbit!.id },
			{ type: 'reorder', animalId: rabbit!.id, to: 0 },
			{ type: 'rename', animalId: squirrel!.id, nickname: 'Pip' }
		] as const) {
			s.authority.dispatch({ type: 'party', intent });
			expect(lastEdit(s).events).toEqual([{ type: 'rejected', reason: 'not-exploring' }]);
		}
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(party(s).map((a) => [a.id, a.nickname])).toEqual([
			[squirrel!.id, undefined],
			[rabbit!.id, undefined]
		]);
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

		// Beside the tent but facing away, Enter changes nothing, and the event
		// says so without words (the client says how to reach a doctor).
		move(s, ...Array<Direction>(6).fill('right'));
		expect(position(s)).toEqual({ x: 5, y: 6 });
		expect(canTalkToDoctor(seed, position(s), 'down')).toBe(true);
		const before = s.events.length;
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.slice(before)).toEqual([
			{ type: 'nothing-to-interact', playerId: welcome(s).playerId }
		]);

		// Bumping into the tent turns the player to it; now Enter talks.
		move(s, 'down');
		expect(s.events.at(-1)).toMatchObject({ type: 'player-blocked', dir: 'down' });
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.at(-1)).toMatchObject({ type: 'doctor-visit-started', visit: 1 });
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
	it('heals the picked animal (and its kind) per solved puzzle; a miss costs nothing; walking waits', () => {
		const s = session({ party: hurtParty() });
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		expect(visit(s).phase).toEqual({ kind: 'choose-patient' });
		expect(visit(s).party).toEqual(hurtParty());

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
			'doctor-visit-ended'
		]);
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

	it('animals gone home and tokens given, and an item bought, are written back at once; a miss changes nothing', () => {
		const s = session({ party: hurtParty(), tokens: 20, shop: ITEM_IDS });
		expect(s.events[0]).toMatchObject({ type: 'welcome', tokens: 20, items: [] });
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		expect(visit(s)).toMatchObject({ tokens: 20, items: [], shop: ['axe', 'pickaxe', 'boat'] });

		doctorIntent(s, { type: 'hand-over', ids: ['a'] });
		expect(visit(s).phase).toMatchObject({ kind: 'handing-over', reward: 2 });
		let from = s.events.length;
		answerDoctor(s, false);
		expect(s.events.slice(from).map((e) => e.type)).toEqual(['doctor-visit-updated']);
		from = s.events.length;
		answerDoctor(s, true);
		expect(s.events.slice(from)).toMatchObject([
			{ type: 'doctor-visit-updated' },
			{ type: 'party-changed', party: [hurtParty()[1], hurtParty()[2]] },
			{ type: 'belongings-changed', tokens: 22, items: [] }
		]);

		doctorIntent(s, { type: 'buy', itemId: 'axe' });
		from = s.events.length;
		answerDoctor(s, false);
		expect(s.events.slice(from).map((e) => e.type)).toEqual(['doctor-visit-updated']);
		from = s.events.length;
		answerDoctor(s, true);
		expect(s.events.slice(from)).toMatchObject([
			{ type: 'doctor-visit-updated' },
			{ type: 'belongings-changed', tokens: 14, items: ['axe'] }
		]);
		doctorIntent(s, { type: 'leave' });

		// The game holds it all, through a save and a reload; the next visit starts from it.
		const game = s.authority.snapshot();
		expect(game).toMatchObject({ tokens: 14, items: ['axe'] });
		expect(game.party.map((a) => a.id)).toEqual(['b', 'c']);
		const t: Session = { authority: new LocalAuthority({ shop: ITEM_IDS }), events: [] };
		t.authority.subscribe((e) => t.events.push(e));
		const doc = saveDocument(game, { lineage: 'test', seq: 1 });
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		t.authority.start({ game: restoreGame(read.save) });
		expect(t.events[0]).toMatchObject({ type: 'welcome', tokens: 14, items: ['axe'] });
		t.authority.dispatch({ type: 'interact' });
		expect(visit(t)).toMatchObject({ tokens: 14, items: ['axe'] });
		doctorIntent(t, { type: 'buy', itemId: 'axe' });
		expect(t.events.at(-1)).toMatchObject({
			type: 'doctor-visit-updated',
			events: [{ type: 'rejected', reason: 'already-owned' }]
		});
	});

	it('sells only what the catalog has on sale, unless it was started with the whole shop (`?shop`)', () => {
		const s = session({ party: hurtParty(), tokens: 50 });
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		expect(visit(s).shop).toEqual(itemsForSale());
		// Every tool does its job now (the axe and the pickaxe clear, the boat sails);
		// anything not on sale can't be bought.
		expect(visit(s).shop).toEqual(['axe', 'pickaxe', 'boat']);
		for (const itemId of ITEM_IDS.filter((id) => !itemsForSale().includes(id))) {
			doctorIntent(s, { type: 'buy', itemId });
			expect(s.events.at(-1)).toMatchObject({
				events: [{ type: 'rejected', reason: 'not-for-sale' }]
			});
		}
		doctorIntent(s, { type: 'buy', itemId: 'boat' });
		expect(visit(s).phase).toMatchObject({ kind: 'buying', itemId: 'boat' });
	});

	it('with nobody hurt, a visit still opens, and nobody can be picked to heal', () => {
		const s = session();
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.at(-1)).toMatchObject({ type: 'doctor-visit-started' });
		doctorIntent(s, { type: 'pick-patient', partyIndex: 0 });
		expect(visit(s).phase).toEqual({ kind: 'choose-patient' });
		doctorIntent(s, { type: 'leave' });
		expect(s.events.at(-1)).toMatchObject({ type: 'doctor-visit-ended' });
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

	it('numbers its visits: every event of one visit carries its number, the next visit the next', () => {
		const s = session({ party: hurtParty() });
		walkToTent(s);
		for (const n of [1, 2]) {
			const from = s.events.length;
			s.authority.dispatch({ type: 'interact' });
			doctorIntent(s, { type: 'pick-patient', partyIndex: 0 });
			doctorIntent(s, { type: 'leave' });
			const visits = s.events
				.slice(from)
				.flatMap((e) =>
					e.type === 'doctor-visit-started' ||
					e.type === 'doctor-visit-updated' ||
					e.type === 'doctor-visit-ended'
						? [e.visit]
						: []
				);
			expect(visits).toEqual([n, n, n, n]);
		}
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

describe('LocalAuthority: the boat', () => {
	// Straight up from the spawn tile, (-2, 6): the lake, shallow at (-2, 5),
	// (-2, 4) and (-2, 3), deep from (-2, 2) on.
	const UP_TO_DEEP: Direction[] = ['up', 'up', 'up', 'up'];

	/** A game at the spawn tile with this party and these items, as a save would hand it over. */
	function withItems(items: string[], team: AnimalInstance[] = [animal('squirrel')]): Session {
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({ game: { ...newGame(1), party: team, items } });
		return { authority, events };
	}

	it('without the boat the water stops the trainer; with it, they sail out, shallow and deep, and back', () => {
		const onFoot = withItems(['axe']);
		move(onFoot, 'up');
		expect(onFoot.events.at(-1)).toMatchObject({ type: 'player-blocked', dir: 'up' });
		expect(position(onFoot)).toEqual({ x: -2, y: 6 });

		const s = withItems(['boat']);
		const been: string[] = [];
		for (const dir of [...UP_TO_DEEP, 'left', 'right', 'down', 'down', 'down', 'down'] as const) {
			move(s, dir);
			expect(s.events.at(-1)).toMatchObject({ type: 'player-moved', dir });
			const at = position(s);
			been.push(tileAtWorld(WORLD_SEED, at.x, at.y).kind);
		}
		expect(been).toEqual([
			'water',
			'water',
			'water',
			'deepwater',
			'deepwater',
			'deepwater',
			'water',
			'water',
			'water',
			'grass'
		]);
		// A tent stops a boat as it stops a walk: the one at (5, 7), from above.
		for (let i = 0; i < 7; i++) move(s, 'right');
		expect(position(s)).toEqual({ x: 5, y: 6 });
		move(s, 'down');
		expect(s.events.at(-1)).toMatchObject({ type: 'player-blocked', dir: 'down' });
	});

	it('the deep water is the sea animals’ tall grass: with a swimmer in front only they come out, and never in the shallows', () => {
		const s = withItems(['boat'], [animal('otter'), animal('frog')]);
		// The shallows, three tiles of them: nobody's.
		move(s, 'up', 'up', 'up');
		expect(s.events.some((e) => e.type === 'battle-started')).toBe(false);
		// Out on the deep water, back and forth, running from each one that comes out.
		const met: string[] = [];
		move(s, 'up');
		for (let i = 0; i < 300; i++) {
			const from = s.events.length;
			move(s, i % 2 === 0 ? 'left' : 'right');
			for (const e of s.events.slice(from)) {
				if (e.type !== 'battle-started') continue;
				met.push(e.state.opponent.speciesId);
				expect(e.state.realm).toBe('water');
				expect(e.state.party[e.state.active]!.speciesId).toBe('otter');
				s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
				// It stays in the water, not in the grass.
				expect(lastMessage(s)).toBe('battle.closing.fledSea');
			}
			expect(tileAtWorld(WORLD_SEED, position(s).x, position(s).y).kind).toBe('deepwater');
		}
		// About one step in ten, and every one a sea animal (near home, turtles mostly).
		expect(met.length).toBeGreaterThan(15);
		expect(met.length).toBeLessThan(50);
		for (const id of met) expect(getAnimal(id).realms, id).toEqual(['water']);
		// With nobody standing who swims, nothing comes out, deep water or not.
		const dry = withItems(['boat'], [animal('squirrel'), animal('otter', 0)]);
		move(dry, ...UP_TO_DEEP);
		for (let i = 0; i < 300; i++) move(dry, i % 2 === 0 ? 'left' : 'right');
		expect(isWater(tileAtWorld(WORLD_SEED, position(dry).x, position(dry).y).kind)).toBe(true);
		expect(dry.events.some((e) => e.type === 'battle-started')).toBe(false);
	});

	it('the sea recipe: a game at (-2, 2) with the otter in front meets a Turtle on step 11, Left and Right in turn', () => {
		// [[CHEATSHEET]] § The sea animals and [[DEVELOPMENT]] § Looking at the game say so: change them
		// with it. A game saved on the deep water with no steps walked yet: the steps are what the roll reads.
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({
			game: {
				...newGame(1),
				pos: { x: -2, y: 2 },
				party: [animal('otter'), animal('squirrel')],
				items: ['boat']
			}
		});
		const sea = { authority, events };
		const met: { step: number; wild: string }[] = [];
		for (let step = 1; step <= 11; step++) {
			const from = sea.events.length;
			move(sea, step % 2 === 1 ? 'left' : 'right');
			for (const e of sea.events.slice(from)) {
				if (e.type === 'battle-started') met.push({ step, wild: e.state.opponent.speciesId });
			}
		}
		expect(met).toEqual([{ step: 11, wild: 'turtle' }]);
	});

	it('out on the water only an animal that swims goes first; the refusal names the one that can’t', () => {
		const s = withItems(['boat'], [animal('squirrel'), animal('otter')]);
		const [squirrel, otter] = party(s);
		move(s, 'up');
		const pick = (animalId: string) =>
			s.authority.dispatch({ type: 'party', intent: { type: 'select-lead', animalId } });
		pick(squirrel!.id);
		expect(s.events.at(-1)).toMatchObject({
			type: 'party-edited',
			events: [{ type: 'rejected', reason: 'cannot-fight-here', animalId: squirrel!.id }]
		});
		// The otter leads out here already, behind the squirrel on land.
		pick(otter!.id);
		expect(s.events.at(-1)).toMatchObject({
			events: [{ type: 'rejected', reason: 'already-lead', animalId: otter!.id }]
		});
		// Back on land the squirrel leads, and the otter can be chosen to.
		move(s, 'down');
		pick(otter!.id);
		expect(s.events.at(-1)).toMatchObject({
			events: [{ type: 'lead-selected', animalId: otter!.id }]
		});
		expect(party(s).map((a) => a.speciesId)).toEqual(['otter', 'squirrel']);
	});

	it('a battle lost on the water, the squirrel still in the boat: over the water to a tent, everyone healed', () => {
		const team = [animal('squirrel'), animal('otter', 3)];
		const at = { x: -2, y: 2 };
		const battle = startBattle(
			team,
			{ id: 'wild', speciesId: 'otter', hp: 32 },
			{ realm: 'water' }
		);
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({
			game: { ...newGame(1), pos: at, party: team, items: ['boat'], battle }
		});
		const s = { authority, events };
		expect(latestBattle(s).realm).toBe('water');
		while (latestBattle(s).phase.kind !== 'ended') attack(s, 1, 1, false);
		const end = latestBattle(s);
		expect(end.phase).toEqual({ kind: 'ended', outcome: 'lost' });
		expect(end.party.map((a) => a.hp)).toEqual([20, 0]);
		const rescue = takeToDoctor(WORLD_SEED, at, end.party, WorldEdits.none, {
			gear: { boat: true },
			realm: 'water'
		});
		expect(rescue.pos).toEqual(
			nearestTent(WORLD_SEED, at, TENT_SEARCH_STEPS, WorldEdits.none, { boat: true })!.stand
		);
		expect(events.find((e) => e.type === 'taken-to-doctor')).toMatchObject({
			pos: rescue.pos,
			dir: rescue.facing,
			party: [animal('squirrel'), { ...team[1]!, hp: 32 }]
		});
		expect(isWalkable(tileAtWorld(WORLD_SEED, rescue.pos.x, rescue.pos.y).kind)).toBe(true);
		expect(canTalkToDoctor(WORLD_SEED, position(s), facing(s))).toBe(true);
	});
});

describe('LocalAuthority: the title', () => {
	/** An authority at the title: nothing started yet. */
	function atTitle(options?: LocalAuthorityOptions): Session {
		const authority = new LocalAuthority(options);
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		return { authority, events };
	}

	it('starts a new game with any starter: alone in the party, at full HP, at the spawn tile', () => {
		for (const speciesId of STARTERS) {
			const s = atTitle();
			s.authority.dispatch({ type: 'new-game', speciesId });
			expect(s.events.map((e) => e.type)).toEqual(['welcome']);
			const w = welcome(s);
			expect(w).toMatchObject({ newGame: true, pos: spawnPoint(w.seed), facing: 'down' });
			expect(w.party).toHaveLength(1);
			// No nickname key: the starter goes by its species' name.
			expect(w.party[0]).toStrictEqual({
				id: w.party[0]!.id,
				speciesId,
				hp: getAnimal(speciesId).maxHp
			});
			expect(s.authority.snapshot()).toMatchObject({ steps: 0, visits: 0, battle: null });
		}
	});

	it('gives each starter a fresh id, and cleans its name as a rename does', () => {
		const a = atTitle();
		const b = atTitle();
		a.authority.dispatch({ type: 'new-game', speciesId: 'rabbit', nickname: '  Hop  🐇 ' });
		b.authority.dispatch({ type: 'new-game', speciesId: 'rabbit', nickname: '🐇' });
		expect(welcome(a).party[0]).toMatchObject({ speciesId: 'rabbit', nickname: 'Hop' });
		expect(welcome(b).party[0]).not.toHaveProperty('nickname');
		expect(welcome(a).party[0]!.id).not.toBe(welcome(b).party[0]!.id);
	});

	it('every starter meets the same animals on the same steps: all starters are one size', () => {
		const walks = STARTERS.map((speciesId) => {
			// In World 1, whose spawn has the reed beside it.
			const s = atTitle({ homeWorld: () => 1 });
			s.authority.dispatch({ type: 'new-game', speciesId });
			return reedWalk(s, 40).map(({ step, wild }) => [step, wild]);
		});
		expect(walks[0]!.length).toBeGreaterThan(0);
		for (const walk of walks) expect(walk).toEqual(walks[0]);
	});

	it('refuses a species that is not a starter, and nothing starts', () => {
		for (const speciesId of ['fox', 'bear', 'dragon']) {
			const s = atTitle();
			s.authority.dispatch({ type: 'new-game', speciesId });
			expect(s.events).toEqual([{ type: 'new-game-refused', reason: 'not-a-starter' }]);
			move(s, 'left', 'right', 'left');
			s.authority.dispatch({ type: 'interact' });
			expect(s.events).toHaveLength(1);
		}
		const s = atTitle();
		s.authority.dispatch({ type: 'new-game', speciesId: 'squirrel', nickname: 7 } as never);
		expect(s.events).toEqual([{ type: 'new-game-refused', reason: 'not-text' }]);
	});

	it('refuses a new game while one is under way, and the game goes on as it was', () => {
		const s = session();
		move(s, 'right', 'left');
		const before = s.authority.snapshot();
		const from = s.events.length;
		s.authority.dispatch({ type: 'new-game', speciesId: 'rabbit' });
		expect(s.events.slice(from)).toEqual([
			{ type: 'new-game-refused', reason: 'game-in-progress' }
		]);
		expect(s.authority.snapshot()).toEqual(before);
		// Mid-battle too: no way out of a battle through a new game.
		walkIntoBattle(s);
		const inBattle = s.events.length;
		s.authority.dispatch({ type: 'new-game', speciesId: 'rabbit' });
		expect(s.events.slice(inBattle)).toEqual([
			{ type: 'new-game-refused', reason: 'game-in-progress' }
		]);
	});

	it('before any game and after leaving one, nothing walks, rolls or talks', () => {
		const fresh = atTitle();
		move(fresh, 'left', 'right');
		fresh.authority.dispatch({ type: 'leave-game' });
		fresh.authority.dispatch({ type: 'interact' });
		expect(fresh.events).toEqual([]);

		const s = session();
		s.authority.dispatch({ type: 'leave-game' });
		expect(s.events.at(-1)).toEqual({ type: 'game-left' });
		const left = s.events.length;
		const game = s.authority.snapshot();
		// The reed by the start: a walk here with a game under way meets animals.
		for (let i = 0; i < 40; i++) move(s, i % 2 === 0 ? 'left' : 'right');
		s.authority.dispatch({ type: 'interact' });
		s.authority.dispatch({
			type: 'party',
			intent: { type: 'rename', animalId: 'starter', nickname: 'Pip' }
		});
		s.authority.dispatch({ type: 'leave-game' });
		expect(s.events.length).toBe(left);
		expect(s.authority.snapshot()).toEqual(game);
	});

	it('a game left and picked up again plays on exactly as if it had never been left', () => {
		const a = session();
		const b = session();
		const walk = (s: Session, from: number, to: number) => {
			for (let i = from; i < to; i++) move(s, i % 2 === 0 ? 'left' : 'right');
			if (lastIndexOf(s, 'battle-started') > lastIndexOf(s, 'battle-ended')) {
				s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
			}
		};
		walk(a, 0, 5);
		walk(b, 0, 5);
		b.authority.dispatch({ type: 'leave-game' });
		b.authority.start({ game: b.authority.snapshot() });
		expect(b.events.at(-1)).toMatchObject({ type: 'welcome', newGame: false });
		const from = { a: a.events.length, b: b.events.length };
		walk(a, 5, 60);
		walk(b, 5, 60);
		const species = (s: Session, start: number) =>
			s.events
				.slice(start)
				.flatMap((e) => (e.type === 'battle-started' ? [e.state.opponent.speciesId] : []));
		expect(species(a, from.a).length).toBeGreaterThan(0);
		expect(species(b, from.b)).toEqual(species(a, from.a));
	});

	it('in a battle or at the doctor, leaving does nothing, so no new game opens a way out', () => {
		const s = session();
		walkIntoBattle(s);
		// Mid-puzzle: the attack is committed.
		s.authority.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex: 1, level: 2 } });
		const battle = latestBattle(s);
		expect(battle.phase.kind).toBe('solving');
		const inBattle = s.events.length;
		s.authority.dispatch({ type: 'leave-game' });
		s.authority.dispatch({ type: 'new-game', speciesId: 'rabbit' });
		expect(s.events.slice(inBattle)).toEqual([
			{ type: 'new-game-refused', reason: 'game-in-progress' }
		]);
		expect(latestBattle(s)).toEqual(battle);
		// The battle goes on: the puzzle is still there to answer.
		if (battle.phase.kind !== 'solving') throw new Error('no puzzle');
		const input = String(battle.phase.puzzle.answer);
		s.authority.dispatch({ type: 'battle', intent: { type: 'answer', input } });
		expect(s.events.slice(inBattle + 1).some((e) => e.type === 'battle-updated')).toBe(true);

		const d = session({ party: hurtParty() });
		walkToTent(d);
		d.authority.dispatch({ type: 'interact' });
		const atDoctor = d.events.length;
		d.authority.dispatch({ type: 'leave-game' });
		expect(d.events.length).toBe(atDoctor);
		doctorIntent(d, { type: 'pick-patient', partyIndex: 1 });
		expect(visit(d).phase).toMatchObject({ kind: 'solving', partyIndex: 1 });
		// Once the visit is over, leaving works.
		doctorIntent(d, { type: 'leave' });
		d.authority.dispatch({ type: 'leave-game' });
		expect(d.events.at(-1)).toEqual({ type: 'game-left' });
	});

	it('a new game after leaving one starts fresh at the spawn tile, with the new starter only', () => {
		const s = session();
		move(s, 'right', 'right', 'right');
		s.authority.dispatch({ type: 'leave-game' });
		s.authority.dispatch({ type: 'new-game', speciesId: 'rabbit', nickname: 'Hop' });
		const w = s.events.at(-1);
		expect(w).toMatchObject({ type: 'welcome', newGame: true, facing: 'down' });
		expect(s.authority.snapshot()).toMatchObject({
			pos: spawnPoint(worldSeed(s.authority.snapshot().world)),
			steps: 0,
			visits: 0,
			battle: null,
			party: [{ speciesId: 'rabbit', nickname: 'Hop', hp: 22 }]
		});
	});

	it('a game started without a save is new; one picked up from a save is not', () => {
		expect(welcome(session())).toMatchObject({ newGame: true });
		const s = atTitle();
		s.authority.start({ game: session().authority.snapshot() });
		expect(welcome(s)).toMatchObject({ newGame: false });
	});
});

describe('LocalAuthority: trees and rocks', () => {
	const tree = besideA('tree');
	const rock = besideA('rock', (height) => height < 3);
	const peak = besideA('rock', (height) => height >= 3);
	const BACK: Record<Direction, Direction> = {
		up: 'down',
		down: 'up',
		left: 'right',
		right: 'left'
	};

	function from(game: SavedGame): Session {
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({ game });
		return { authority, events };
	}

	/** A save round trip, as the autosave and a reload do it: JSON through storage, then restore. */
	function throughSave(game: SavedGame): SavedGame {
		const read = readSave(JSON.parse(JSON.stringify(saveDocument(game, { lineage: 't', seq: 1 }))));
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save);
	}

	it('Enter facing a tree with the axe chops it down: ground to walk on from then on, in the save too', () => {
		const s = from(gameBeside(tree, ['axe']));
		expect(welcome(s).edits).toEqual([]);
		move(s, tree.facing);
		expect(s.events.at(-1)).toMatchObject({ type: 'player-blocked', dir: tree.facing });
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.at(-1)).toEqual({
			type: 'tile-cleared',
			playerId: 'local',
			pos: tree.target,
			was: 'tree',
			tool: 'axe',
			regrown: []
		});
		move(s, tree.facing);
		expect(position(s)).toEqual(tree.target);
		expect(s.authority.snapshot().edits).toEqual(WorldEdits.none.with(tree.target).encode());
		// A second Enter where the tree stood chops nothing more.
		move(s, BACK[tree.facing], tree.facing);
		move(s, BACK[tree.facing]);
		const before = s.events.length;
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.slice(before).map((e) => e.type)).toEqual(['nothing-to-interact']);
	});

	it('the pickaxe breaks a rock, a snow-capped peak too; the axe does not, nor bare hands, and then nothing changes', () => {
		for (const spot of [rock, peak]) {
			for (const items of [[], ['axe'], ['axe', 'boat']]) {
				const s = from(gameBeside(spot, items));
				s.authority.dispatch({ type: 'interact' });
				expect(s.events.at(-1)).toEqual({
					type: 'tool-needed',
					playerId: 'local',
					kind: 'rock',
					tool: 'pickaxe'
				});
				move(s, spot.facing);
				expect(s.events.at(-1)).toMatchObject({ type: 'player-blocked' });
				expect(s.authority.snapshot().edits).toEqual([]);
			}
			const s = from(gameBeside(spot, ['pickaxe']));
			s.authority.dispatch({ type: 'interact' });
			expect(s.events.at(-1)).toMatchObject({ type: 'tile-cleared', was: 'rock', tool: 'pickaxe' });
			move(s, spot.facing);
			expect(position(s)).toEqual(spot.target);
		}
		// And without the axe, a tree says which tool it takes.
		const t = from(gameBeside(tree, ['pickaxe']));
		t.authority.dispatch({ type: 'interact' });
		expect(t.events.at(-1)).toMatchObject({ type: 'tool-needed', kind: 'tree', tool: 'axe' });
	});

	it('a game picked up from a save keeps the gap, stands in it and walks through it', () => {
		const a = from(gameBeside(tree, ['axe']));
		a.authority.dispatch({ type: 'interact' });
		move(a, tree.facing);
		const saved = throughSave(a.authority.snapshot());
		// Standing where the tree stood: not moved to the spawn tile as a tree would have it.
		expect(saved.pos).toEqual(tree.target);
		const b = from(saved);
		expect(welcome(b)).toMatchObject({ pos: tree.target, edits: saved.edits });
		move(b, BACK[tree.facing]);
		expect(position(b)).toEqual(tree.stand);
		move(b, tree.facing);
		expect(position(b)).toEqual(tree.target);
	});

	it('a walk that chops and breaks replays exactly, and so does a copy picked up from a save anywhere along it', () => {
		/** A kid wandering the woods by the tree with both tools: walks, Enter, and runs from any battle. */
		const script = (s: Session, i: number): Intent => {
			if (lastIndexOf(s, 'battle-started') > lastIndexOf(s, 'battle-ended')) {
				return { type: 'battle', intent: { type: 'flee' } };
			}
			const rng = new Rng(i * 7919 + 13);
			if (rng.chance(0.3)) return { type: 'interact' };
			return { type: 'move', dir: rng.pick(['up', 'down', 'left', 'right'] as const) };
		};
		/** An event without the ids minted for wild animals, which differ from run to run by design. */
		const strip = (e: GameEvent) =>
			e.type === 'battle-started' || e.type === 'battle-updated' || e.type === 'battle-ended'
				? { type: e.type, opponent: e.state.opponent.speciesId, hp: e.state.opponent.hp }
				: e;
		const start = gameBeside(tree, ['axe', 'pickaxe']);
		const a = from(start);
		const b = from(start);
		for (let i = 0; i < 400; i++) {
			a.authority.dispatch(script(a, i));
			b.authority.dispatch(script(b, i));
		}
		expect(b.events.map(strip)).toEqual(a.events.map(strip));
		const cleared = a.events.filter((e) => e.type === 'tile-cleared');
		expect(cleared.length).toBeGreaterThan(3);
		// Cut the walk through a save at a few points: the copy plays on the same.
		for (const cut of [37, 150, 290]) {
			const c = from(start);
			let i = 0;
			for (; i < cut; i++) c.authority.dispatch(script(c, i));
			const d = from(throughSave(c.authority.snapshot()));
			const [fromC, fromD] = [c.events.length, d.events.length];
			for (let j = i; j < 400; j++) {
				c.authority.dispatch(script(c, j));
				d.authority.dispatch(script(d, j));
			}
			expect(d.events.slice(fromD).map(strip)).toEqual(c.events.slice(fromC).map(strip));
			expect(d.authority.snapshot().edits).toEqual(c.authority.snapshot().edits);
		}
	});

	it("the screen's copy of the world is the authority's after every clear, far chunks growing back included", () => {
		// A save already near the budget: one tile cleared in each of many far chunks.
		let far = WorldEdits.none;
		for (let i = 0; i < 1800; i++) far = far.with({ x: 5000 + i * 16, y: -7000 - (i % 40) * 16 });
		const s = from({ ...gameBeside(tree, ['axe', 'pickaxe']), edits: [...far.encode()] });
		// The UI's view of the game, filled from the events as `main.ts` fills it.
		for (const e of s.events) game.apply(e);
		expect(game.edits.encode()).toEqual(s.authority.snapshot().edits);
		const rng = new Rng(5);
		let regrown = 0;
		for (let i = 0; i < 300; i++) {
			const before = s.events.length;
			s.authority.dispatch(
				rng.chance(0.4)
					? { type: 'interact' }
					: { type: 'move', dir: rng.pick(['up', 'down', 'left', 'right'] as const) }
			);
			for (const e of s.events.slice(before)) {
				game.apply(e);
				if (e.type === 'battle-started')
					s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
				if (e.type !== 'tile-cleared') continue;
				regrown += e.regrown.length;
				expect(game.edits.encode()).toEqual(s.authority.snapshot().edits);
			}
		}
		expect(regrown).toBeGreaterThan(0);
		expect(JSON.stringify(s.authority.snapshot().edits).length).toBeLessThanOrEqual(EDITS_BUDGET);
		// About 0.35 s alone (a save of 1,800 far chunks built a tile at a time, then 300 random
		// steps and clears, each checked against the screen's copy); 2.6 s at a load average of 40.
	}, 30_000);

	it('a battle lost in a spot walled in by trees the kid chopped open: off to the tent along the path they cut', () => {
		// A walkable tile with a tree or a rock on every side and a tent in reach once they are
		// cleared: the kid chopped their way in, and a wild animal was waiting.
		let found: { pos: GridPos; edits: WorldEdits } | null = null;
		for (let y = -150; y < 150 && !found; y++)
			for (let x = -150; x < 150 && !found; x++) {
				if (!isWalkable(tileAtWorld(WORLD_SEED, x, y).kind)) continue;
				const around = (['up', 'down', 'left', 'right'] as const).map((d) => stepFrom({ x, y }, d));
				const walls = around.map((p) => tileAtWorld(WORLD_SEED, p.x, p.y).kind);
				if (!walls.every((k) => k === 'tree' || k === 'rock')) continue;
				const edits = around.reduce((e, p) => e.with(p), WorldEdits.none);
				if (nearestTent(WORLD_SEED, { x, y }, undefined, edits)) found = { pos: { x, y }, edits };
			}
		expect(found).not.toBeNull();
		const { pos, edits } = found!;
		const party = [animal('squirrel', 1)];
		const s = from({
			...gameBeside(tree, ['axe']),
			pos,
			party,
			edits: [...edits.encode()],
			battle: startBattle(party, { id: 'wild-bear', speciesId: 'bear', hp: 50 })
		});
		lose(s);
		const spot = nearestTent(WORLD_SEED, pos, undefined, edits)!;
		expect(s.events.find((e) => e.type === 'taken-to-doctor')).toMatchObject({
			pos: spot.stand,
			dir: spot.facing,
			tent: spot.tent
		});
		// The seeded world alone has the spot walled in: a doctor would have come to the player.
		expect(nearestTent(WORLD_SEED, pos)).toBeNull();
	});
});

describe('LocalAuthority: names and worlds', () => {
	function atTitle(options?: LocalAuthorityOptions): Session {
		const authority = new LocalAuthority(options);
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		return { authority, events };
	}

	function from(game: SavedGame): Session {
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({ game });
		return { authority, events };
	}

	/** A save round trip, as the autosave and a reload do it: JSON through storage, then restore. */
	function throughSave(game: SavedGame): SavedGame {
		const read = readSave(JSON.parse(JSON.stringify(saveDocument(game, { lineage: 't', seq: 1 }))));
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save);
	}

	function travelTo(s: Session, world: number): GameEvent[] {
		const from = s.events.length;
		s.authority.dispatch({ type: 'travel', world });
		return s.events.slice(from);
	}

	it('a new game starts in its home: a world picked at random from 2 to 9999, at its spawn', () => {
		const homes = new Set<number>();
		for (let i = 0; i < 12; i++) {
			const s = atTitle();
			s.authority.dispatch({ type: 'new-game', speciesId: 'rabbit' });
			const w = welcome(s);
			expect(w.home).toBe(w.world);
			expect(w.world).toBeGreaterThanOrEqual(2);
			expect(w.world).toBeLessThanOrEqual(9999);
			expect(w.seed).toBe(worldSeed(w.world));
			expect(w.pos).toEqual(spawnPoint(w.seed));
			homes.add(w.world);
		}
		expect(homes.size).toBeGreaterThan(1);
		// A throwaway game (`?new`, `?party=`, …) is in World 1, its home.
		expect(welcome(session())).toMatchObject({ world: 1, home: 1, seed: WORLD_SEED, name: null });
	});

	it("takes the player's name with a new game, tidied, or refuses the game and nothing starts", () => {
		const named = atTitle({ homeWorld: () => 5 });
		named.authority.dispatch({ type: 'new-game', speciesId: 'frog', name: '  Ida   Marie ' });
		expect(welcome(named)).toMatchObject({ name: 'Ida Marie', world: 5, home: 5 });
		expect(named.authority.snapshot()).toMatchObject({ name: 'Ida Marie', world: 5, home: 5 });

		for (const name of ['', 'A', 'Fuck', 'Pip!', 7]) {
			const s = atTitle();
			s.authority.dispatch({ type: 'new-game', speciesId: 'frog', name } as Intent);
			expect(s.events, String(name)).toEqual([{ type: 'new-game-refused', reason: 'not-a-name' }]);
			move(s, 'left');
			expect(s.events).toHaveLength(1);
		}
		// Without one, the game starts with no name, and asks for it later.
		const nameless = atTitle();
		nameless.authority.dispatch({ type: 'new-game', speciesId: 'frog' });
		expect(welcome(nameless).name).toBeNull();
	});

	it('choose-name names the player whatever they are doing; a name it refuses changes nothing', () => {
		const s = session();
		s.authority.dispatch({ type: 'choose-name', name: 'Fuck' });
		expect(s.events.at(-1)).toEqual({ type: 'name-refused', reason: 'rude' });
		s.authority.dispatch({ type: 'choose-name', name: 'x' });
		expect(s.events.at(-1)).toEqual({ type: 'name-refused', reason: 'short' });
		expect(s.authority.snapshot().name).toBeNull();
		s.authority.dispatch({ type: 'choose-name', name: ' Nini ' });
		expect(s.events.at(-1)).toEqual({ type: 'name-chosen', playerId: 'local', name: 'Nini' });
		expect(s.authority.snapshot().name).toBe('Nini');
		// Mid-battle too (a game saved mid-battle asks before it goes on), and the battle goes on.
		const battle = walkIntoBattle(s);
		s.authority.dispatch({ type: 'choose-name', name: 'Bo' });
		expect(s.events.at(-1)).toEqual({ type: 'name-chosen', playerId: 'local', name: 'Bo' });
		expect(s.authority.snapshot().battle).toEqual(battle);
		// Before any game, nothing.
		const title = atTitle();
		title.authority.dispatch({ type: 'choose-name', name: 'Nini' });
		expect(title.events).toEqual([]);
	});

	it('travel goes to another world while exploring: its spawn on a first visit; party, tokens, items, name and counts go along', () => {
		const s = from({ ...newGame(1, undefined, 'Nini'), tokens: 7, items: ['axe'] });
		move(s, 'right', 'right', 'down');
		const left = { pos: position(s), facing: facing(s) };
		const before = s.authority.snapshot();
		const events = travelTo(s, 42);
		expect(events).toEqual([
			{
				type: 'travelled',
				playerId: 'local',
				world: 42,
				seed: worldSeed(42),
				pos: spawnPoint(worldSeed(42)),
				facing: 'down',
				edits: [],
				firstVisit: true
			}
		]);
		const after = s.authority.snapshot();
		expect(after).toEqual({
			...before,
			world: 42,
			pos: spawnPoint(worldSeed(42)),
			facing: 'down',
			edits: [],
			worlds: [{ world: 1, ...left, edits: [] }]
		});
		// Walking goes on in the new world, the step count going on from where it was.
		move(s, 'up');
		expect(s.authority.snapshot().steps).toBeGreaterThanOrEqual(before.steps);
	});

	it('refuses a world that is not one, and the world the player is in, and nothing changes', () => {
		const s = session();
		const before = s.authority.snapshot();
		expect(travelTo(s, 0)).toEqual([{ type: 'travel-refused', reason: 'not-a-world' }]);
		expect(travelTo(s, 10_000)).toEqual([{ type: 'travel-refused', reason: 'not-a-world' }]);
		expect(travelTo(s, 1.5)).toEqual([{ type: 'travel-refused', reason: 'not-a-world' }]);
		expect(travelTo(s, 1)).toEqual([{ type: 'travel-refused', reason: 'already-there' }]);
		expect(s.authority.snapshot()).toEqual(before);
	});

	it('in a battle or at the doctor, travel does nothing', () => {
		const s = session();
		walkIntoBattle(s);
		const before = s.authority.snapshot();
		expect(travelTo(s, 42)).toEqual([]);
		expect(s.authority.snapshot()).toEqual(before);

		// Seven steps right, and down to the tent at (5, 7).
		const d = session();
		move(d, 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'down');
		d.authority.dispatch({ type: 'interact' });
		expect(d.events.at(-1)?.type).toBe('doctor-visit-started');
		expect(travelTo(d, 42)).toEqual([]);
		expect(d.authority.snapshot().world).toBe(1);
	});

	it('going back picks a world up exactly as it was left: where, which way, and the trees chopped there', () => {
		const tree = besideA('tree');
		const s = from(gameBeside(tree, ['axe']));
		s.authority.dispatch({ type: 'interact' });
		const cleared = s.authority.snapshot().edits;
		expect(cleared).toEqual(WorldEdits.none.with(tree.target).encode());
		travelTo(s, 7);
		move(s, 'up', 'left');
		const inSeven = { pos: position(s), facing: facing(s) };
		const back = travelTo(s, 1);
		expect(back).toEqual([
			{
				type: 'travelled',
				playerId: 'local',
				world: 1,
				seed: WORLD_SEED,
				pos: tree.stand,
				facing: tree.facing,
				edits: cleared,
				firstVisit: false
			}
		]);
		// Where the tree stood is ground in World 1 again, and World 7 is remembered.
		move(s, tree.facing);
		expect(position(s)).toEqual(tree.target);
		expect(s.authority.snapshot().worlds).toEqual([{ world: 7, ...inSeven, edits: [] }]);
		const again = travelTo(s, 7);
		expect(again[0]).toMatchObject({ world: 7, ...inSeven, firstVisit: false });
	});

	it('a game saved in another world picks up there, and plays on exactly as the original does', () => {
		const a = session();
		move(a, 'right', 'left');
		travelTo(a, 42);
		move(a, 'up', 'down');
		const saved = throughSave(a.authority.snapshot());
		expect(saved).toMatchObject({ world: 42, home: 1 });
		expect(saved.worlds.map((w) => w.world)).toEqual([1]);
		const b = from(saved);
		expect(welcome(b)).toMatchObject({ world: 42, seed: worldSeed(42), pos: position(a) });
		// The same steps in World 42 meet the same animals: its seed and the step count key them.
		const script: Direction[] = [];
		for (let i = 0; i < 80; i++) script.push((['up', 'left', 'down', 'right'] as const)[i % 4]!);
		const fromA = a.events.length;
		const fromB = b.events.length;
		for (const dir of script) {
			for (const s of [a, b]) {
				s.authority.dispatch({ type: 'move', dir });
				if (lastIndexOf(s, 'battle-started') > lastIndexOf(s, 'battle-ended')) {
					s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
				}
			}
		}
		const kinds = (s: Session, from: number) =>
			s.events
				.slice(from)
				.map((e) =>
					e.type === 'battle-started' ? `${e.type}:${e.state.opponent.speciesId}` : e.type
				);
		expect(kinds(b, fromB)).toEqual(kinds(a, fromA));
		// And the game state agrees with the events, world and all.
		for (const e of b.events) game.apply(e);
		expect([game.world, game.home, game.seed]).toEqual([42, 1, worldSeed(42)]);
	});

	it("a clear in this world keeps every world's cleared tiles within the one budget, the worlds left behind trimmed first", () => {
		const tree = besideA('tree');
		// A world left behind holding the whole budget of clearings but a few characters:
		// whole chunks cleared bare, then one tile at a time.
		let far = WorldEdits.none;
		let c = 0;
		for (; far.textLength + 600 < EDITS_BUDGET; c++) {
			for (let i = 0; i < 256; i++) far = far.with({ x: c * 16 + (i % 16), y: 640 + (i >> 4) });
		}
		for (let i = 0; far.textLength < EDITS_BUDGET - 4; i++) {
			far = far.with({ x: c * 16 + (i % 16), y: 640 + (i >> 4) });
		}
		expect(far.textLength).toBeLessThanOrEqual(EDITS_BUDGET);
		const s = from({
			...gameBeside(tree, ['axe']),
			worlds: [{ world: 9, pos: { x: 0, y: 640 }, facing: 'up', edits: [...far.encode()] }]
		});
		s.authority.dispatch({ type: 'interact' });
		const after = s.authority.snapshot();
		const length = (e: readonly string[]) => (e.length ? JSON.stringify(e).length : 0);
		expect(length(after.edits) + length(after.worlds[0]!.edits)).toBeLessThanOrEqual(EDITS_BUDGET);
		expect(after.edits).toEqual(WorldEdits.none.with(tree.target).encode());
		expect(after.worlds[0]!.edits.length).toBeLessThan(far.encode().length);
		// About 0.45 s alone (a world's overlay grown a tile at a time to the budget, measured
		// after every chunk); 2.7 s at a load average of 54.
	}, 30_000);
});

describe('LocalAuthority: going to another player', () => {
	/** A friend far off, standing on ground with room round them. */
	const FRIEND = { x: 150, y: -40 };

	it('puts the player on the arrival spot beside them, facing them, without taking a step', () => {
		const s = session();
		const want = arrivalSpot(WORLD_SEED, FRIEND)!;
		expect(want).not.toBeNull();
		const steps = s.authority.snapshot().steps;
		const from = s.events.length;
		s.authority.dispatch({ type: 'go-to', near: FRIEND });
		expect(s.events.slice(from)).toEqual([
			{ type: 'player-placed', playerId: 'local', pos: want.pos, dir: want.facing }
		]);
		expect(s.authority.snapshot()).toMatchObject({ pos: want.pos, facing: want.facing, steps });
		// The next step goes on from there.
		move(s, want.facing === 'up' ? 'down' : 'up');
		const moved = s.events.at(-1)!;
		if (moved.type === 'player-moved') {
			expect(Math.abs(moved.pos.x - want.pos.x) + Math.abs(moved.pos.y - want.pos.y)).toBe(1);
		} else expect(moved.type === 'player-blocked' || moved.type === 'battle-started').toBe(true);
	});

	it('rolls no encounter: the walk after it meets what it would have met without it', () => {
		// The same steps from the same tile, with and without a go-to that came back to it.
		const plain = session();
		const round = session();
		const home = position(round);
		round.authority.dispatch({ type: 'go-to', near: FRIEND });
		round.authority.dispatch({ type: 'go-to', near: { x: home.x + 1, y: home.y } });
		// Wherever it landed, put both at the same start and walk them the same way.
		const back = round.authority.snapshot();
		const fresh = { ...plain.authority.snapshot(), pos: back.pos, facing: back.facing };
		plain.authority.start({ game: fresh });
		const a = reedWalkEvents(plain);
		const b = reedWalkEvents(round);
		expect(b).toEqual(a);
	});

	it('refuses where there is nowhere to stand, and anything that is no whole tile, leaving the player be', () => {
		const s = session();
		const here = position(s);
		// Far out at sea, without a boat.
		let sea: GridPos | null = null;
		const rng = new Rng(11);
		for (let i = 0; i < 20000 && !sea; i++) {
			const p = { x: rng.int(-3000, 3000), y: rng.int(-3000, 3000) };
			if (arrivalSpot(WORLD_SEED, p) === null) sea = p;
		}
		expect(sea).not.toBeNull();
		for (const near of [sea!, { x: 1.5, y: 0 }, { x: 2 ** 40, y: 0 }, { x: Number.NaN, y: 3 }]) {
			const from = s.events.length;
			s.authority.dispatch({ type: 'go-to', near });
			expect(s.events.slice(from)).toEqual([{ type: 'go-to-refused', reason: 'no-room' }]);
		}
		expect(s.authority.snapshot().pos).toEqual(here);
	});

	it('does nothing in a battle or at the doctor', () => {
		const s = session();
		walkIntoBattle(s);
		const at = s.authority.snapshot().pos;
		const from = s.events.length;
		s.authority.dispatch({ type: 'go-to', near: FRIEND });
		expect(s.events.slice(from)).toEqual([]);
		expect(s.authority.snapshot().pos).toEqual(at);
	});

	it('is where a game saved after it picks up', () => {
		const s = session();
		s.authority.dispatch({ type: 'go-to', near: FRIEND });
		const placed = position(s);
		const again = new LocalAuthority();
		const events: GameEvent[] = [];
		again.subscribe((e) => events.push(e));
		again.start({ game: s.authority.snapshot() });
		expect(events[0]).toMatchObject({ type: 'welcome', pos: placed, facing: facing(s) });
	});
});

/** The next few steps back and forth from where the player stands, as events: what they meet. */
function reedWalkEvents(s: Session): string[] {
	const out: string[] = [];
	for (let i = 0; i < 40; i++) {
		const from = s.events.length;
		s.authority.dispatch({ type: 'move', dir: i % 2 === 0 ? 'left' : 'right' });
		for (const e of s.events.slice(from)) {
			if (e.type === 'battle-started') {
				out.push(`battle:${e.state.opponent.speciesId}`);
				return out;
			}
			if (e.type === 'player-moved') out.push(`${e.pos.x},${e.pos.y}`);
		}
	}
	return out;
}
