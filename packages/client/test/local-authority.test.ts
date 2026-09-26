import {
	ATTACK_LEVELS,
	ITEM_IDS,
	attackDamage,
	canTalkToDoctor,
	getAnimal,
	isEncounterTile,
	leadIndex,
	nearestTent,
	readSave,
	restoreGame,
	STARTERS,
	saveDocument,
	spawnPoint,
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
	type SavedGame
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority, type LocalAuthorityOptions } from '../src/authority/local';
import { parseParty } from '../src/flags';

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
 * straight to its left, so walking left and right from it meets animals
 * (with the starter squirrel in front: the frogs that live there, the
 * squirrels and rabbits that come down to the water near home, now and then
 * an otter). Seven steps right, all on grass, is (5, 6), just above
 * the tent at (5, 7).
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
		if (e.type === 'welcome') return e.facing;
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
	it('with the starter in front, the reed meets a Rabbit on step 11, a Squirrel on step 15, the first Frog on step 71 and the first Otter on step 97', () => {
		const met = reedWalk(session(), 97);
		expect(met[0]).toEqual({ step: 11, wild: 'rabbit', lead: 'squirrel' });
		expect(met[1]).toEqual({ step: 15, wild: 'squirrel', lead: 'squirrel' });
		expect(met.find((m) => m.wild === 'frog')?.step).toBe(71);
		expect(met.find((m) => m.wild === 'otter')?.step).toBe(97);
		expect(met.every((m) => ['squirrel', 'rabbit', 'frog', 'otter'].includes(m.wild))).toBe(true);
	});

	it('the first animal that is not tired leads: with a fox in front the reed has otters and now and then a frog, on the same steps', () => {
		const starter = reedWalk(session(), 200);
		for (const party of [
			[animal('fox'), animal('squirrel')],
			[animal('squirrel', 0), animal('fox')]
		]) {
			const s = session();
			giveParty(s, party);
			const met = reedWalk(s, 200);
			expect(met.map((m) => m.step)).toEqual(starter.map((m) => m.step));
			// A frog is one tier below a fox: 1 challenger in 11 at the river.
			expect(met.filter((m) => m.wild === 'frog').map((m) => m.step)).toEqual([147]);
			expect(met.filter((m) => m.wild !== 'frog').every((m) => m.wild === 'otter')).toBe(true);
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
		expect(new Set(met.map((m) => m.wild))).toEqual(new Set(['otter']));
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
				expect(lastMessage(s)).toBe('battle.closing.joined');
			} else {
				expect(party(s)).toHaveLength(6);
				expect(party(s).map((a) => a.id)).not.toContain(animal!.id);
				expect(lastMessage(s)).toBe('battle.closing.teamFull');
				return;
			}
		}
		throw new Error(`the party never filled up (${caught} caught)`);
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

	it('catches up with another tab: counts only rise, and never mid-battle', () => {
		const s = session();
		move(s, 'right', 'left');
		expect(s.authority.snapshot().steps).toBe(2);
		s.authority.catchUp({ steps: 40, visits: 3 });
		expect(s.authority.snapshot()).toMatchObject({ steps: 40, visits: 3 });
		s.authority.catchUp({ steps: 10, visits: 1 });
		expect(s.authority.snapshot()).toMatchObject({ steps: 40, visits: 3 });
		const b = session();
		walkIntoBattle(b);
		const steps = b.authority.snapshot().steps;
		b.authority.catchUp({ steps: steps + 50, visits: 9 });
		expect(b.authority.snapshot()).toMatchObject({ steps, visits: 0 });
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
	it('heals one animal per solved puzzle; a miss costs nothing; walking waits', () => {
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
		expect(visit(s).shop).toEqual([]);
		doctorIntent(s, { type: 'buy', itemId: 'boat' });
		expect(s.events.at(-1)).toMatchObject({
			events: [{ type: 'rejected', reason: 'not-for-sale' }]
		});
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

describe('LocalAuthority: the title', () => {
	/** An authority at the title: nothing started yet. */
	function atTitle(): Session {
		const authority = new LocalAuthority();
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
			const s = atTitle();
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
			pos: spawnPoint(s.authority.snapshot().seed),
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
