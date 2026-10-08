import {
	ATTACK_LEVELS,
	answerText,
	EDITS_BUDGET,
	ITEM_IDS,
	MAX_MATCH_EVENTS,
	Rng,
	WorldEdits,
	applyMatchIntent,
	arrivalSpot,
	attackDamage,
	canSendIn,
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
	knockOut,
	nearestTent,
	needsDoctor,
	newGame,
	step as stepFrom,
	readSave,
	restoreGame,
	STARTERS,
	saveDocument,
	spawnPoint,
	startBattle,
	startMatch,
	tileAtWorld,
	type AnimalInstance,
	type BattleState,
	type Direction,
	type DoctorIntent,
	type DoctorState,
	type GameEvent,
	type GridPos,
	type Intent,
	type MatchEvent,
	type MatchIntent,
	type MatchSide,
	type SavedGame,
	getLand,
	landSeed,
	worldSeed
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority, WORLD_SEED, type LocalAuthorityOptions } from '../src/authority/local';
import { parseParty } from '../src/flags';
import { game } from '../src/state/game.svelte';
import { besideA, gameBeside } from './clearing';
import { mint, testStarter } from './minted';

/**
 * The single-player authority's own rules — the ones around the engine, not
 * in it: one encounter roll per completed step, keyed so a walk replays; the
 * battle's result written back into the world; the facing it keeps so that
 * Enter talks to a doctor only at a tent; the doctor visit and its seed; a
 * lost battle leaving the team tired where it stood; what it tells the
 * engine the player is doing when the party is edited. The battle, the
 * visit and the party rules themselves are the engine's (its
 * `battle-reducer.test.ts`, `doctor.test.ts` and `party.test.ts`).
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
		if (e.type === 'party-changed' || e.type === 'party-edited' || e.type === 'welcome') {
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
			e.type === 'travelled' ||
			e.type === 'welcome' ||
			e.type === 'glided' ||
			e.type === 'landed'
		) {
			return e.pos;
		}
		if (e.type === 'took-off') return e.from;
	}
	throw new Error('no position');
}

/** Which way the player faces, from the events, as the client turns the figure. */
function facing(s: Session): Direction {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (e.type === 'player-moved' || e.type === 'player-blocked') return e.dir;
		if (e.type === 'player-placed') return e.dir;
		if (e.type === 'took-off' || e.type === 'landed') return e.dir;
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
		// As a kid types it: a clock's time as hours and minutes (a fare to The Arctic can be one).
		input: correct ? answerText(phase.puzzle) : String(phase.puzzle.answer + 1)
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
			// The same animals, as HP goes: each game's starter has an id of its own.
			const unnamed = (s: Session) => party(s).map(({ id: _, ...rest }) => rest);
			expect(unnamed(b)).toEqual(unnamed(a));
		}
		expect(party(b)[0]!.id).not.toBe(party(a)[0]!.id);
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
	it('with the starter in front, the reed meets a Brown rat on step 11, a Frog on step 15, the first Toad on step 71 and the first Otter on step 117', () => {
		const met = reedWalk(session(), 200);
		expect(met[0]).toEqual({ step: 11, wild: 'brown-rat', lead: 'squirrel' });
		expect(met[1]).toEqual({ step: 15, wild: 'frog', lead: 'squirrel' });
		expect(met.find((m) => m.wild === 'common-toad')?.step).toBe(71);
		expect(met.find((m) => m.wild === 'otter')?.step).toBe(117);
		// Only what a tier-1 lead meets in the reeds: the river's own small and tier-2 animals,
		// and the small ones that come down to the water.
		const river = encounterTable('river', 0, 1).map((e) => e.species.id);
		expect(met.every((m) => river.includes(m.wild))).toBe(true);
		expect(met.map((m) => m.wild)).toContain('wood-mouse');
	});

	it('the first animal that is not tired leads: with a fox in front the reed has tier-2 animals, now and then a small one and a mute swan, on the same steps', () => {
		const starter = reedWalk(session(), 200);
		for (const party of [
			[animal('fox'), animal('squirrel')],
			[animal('squirrel', 0), animal('fox')]
		]) {
			const s = session();
			giveParty(s, party);
			const met = reedWalk(s, 200);
			expect(met.map((m) => m.step)).toEqual(starter.map((m) => m.step));
			// The river's small animals are one tier below a fox: e^−1/2 of the four bells of its
			// tier there, the river's own four animals and, since bigger animals live at the river
			// (#89), the eight that come down to the water (the buzzard, #91, the eighth). 13% of
			// the reed's battles.
			const small = ['frog', 'brown-rat', 'common-toad'];
			expect(met.filter((m) => small.includes(m.wild)).map((m) => m.step)).toEqual([
				15, 53, 107, 117
			]);
			// The rest are its own size, but for one mute swan, a tier up (1/9 of a bell near home).
			// Of its size, the river's own four come out four times as often each as one of the
			// eight that come down to the water: no visitor weighs more than a resident (#136), so
			// the twelve share the tier's four bells, and by the water the ground favours the river's.
			const others = met.filter((m) => !small.includes(m.wild));
			expect(others.filter((m) => getAnimal(m.wild).tier !== 2)).toEqual([
				{ step: 97, wild: 'mute-swan', lead: 'fox' }
			]);
			expect(new Set(others.map((m) => m.wild))).toEqual(
				new Set([
					'adder',
					'otter',
					'raccoon',
					'mute-swan',
					'roe-deer',
					'fox',
					'grey-heron',
					'stoat'
				])
			);
			const residents = ['otter', 'grey-heron', 'raccoon', 'beaver'];
			expect(others.filter((m) => residents.includes(m.wild)).map((m) => m.step)).toEqual([
				69, 71, 131, 163
			]);
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
		expect(new Set(met.map((m) => m.wild))).toEqual(new Set(['adder', 'brown-rat', 'common-toad']));
		expect(new Set(met.map((m) => m.lead))).toEqual(new Set(['fox']));
	});

	it("with a bear in front, the reed meets the river's moose, its sea eagles and now and then a mute swan, on the same steps", () => {
		const starter = reedWalk(session(), 400);
		for (const party of [[animal('bear')], [animal('squirrel', 0), animal('bear')]]) {
			const s = session();
			giveParty(s, party);
			const met = reedWalk(s, 400);
			expect(met.map((m) => m.step)).toEqual(starter.map((m) => m.step));
			// The moose is a bear's size at the river (#89), 57% of the reed's battles; the sea
			// eagle a tier below weighs e^−1/2 (35%), the mute swan two below e^−2 (8%), and the
			// tier-2 and small animals, three and four tiers down, 1 battle in 150 between them.
			expect(met.filter((m) => m.wild === 'mute-swan').map((m) => m.step)).toEqual([147, 345, 395]);
			expect(new Set(met.map((m) => m.wild))).toEqual(
				new Set(['moose', 'white-tailed-eagle', 'mute-swan'])
			);
			expect(new Set(met.map((m) => m.lead))).toEqual(new Set(['bear']));
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
		// The winning answer was a right one: the count goes up before the battle ends.
		expect(closingEvents(s).map((e) => e.type)).toEqual([
			'battle-updated',
			'solved-changed',
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

	it('lost: nobody is healed and nobody moves, and the grass stays quiet until a doctor has helped', () => {
		const s = session();
		const { seed } = welcome(s);
		walkIntoBattle(s);
		const lostOn = position(s);
		const facingThen = facing(s);
		lose(s);
		const end = latestBattle(s);
		expect(end.phase).toEqual({ kind: 'ended', outcome: 'lost' });
		expect(closingEvents(s).map((e) => e.type)).toEqual([
			'battle-updated',
			'battle-ended',
			'party-changed',
			'message'
		]);
		expect(lastMessage(s)).toBe('battle.closing.lost');
		// The engine's knock-out rule: the party as the battle left it, the tent near.
		expect(knockOut(seed, lostOn, end.party)).toEqual({ party: end.party, doctorCame: false });
		expect(party(s)).toEqual(end.party);
		expect(party(s).every((a) => a.hp === 0)).toBe(true);
		// Back where the battle was, facing the way the kid last stepped, and saved so.
		expect(position(s)).toEqual(lostOn);
		expect(facing(s)).toBe(facingThen);
		expect(s.authority.snapshot()).toMatchObject({
			pos: lostOn,
			facing: facingThen,
			party: end.party
		});

		// The reed meets nothing while nobody can fight: 400 steps on it, not one battle.
		move(s, 'right');
		expect(position(s)).toEqual(spawnPoint(seed));
		expect(reedWalk(s, 400)).toEqual([]);

		// Walked to the tent at (5, 7), the doctor heals the squirrel as ever: one puzzle.
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.at(-1)?.type).toBe('doctor-visit-started');
		doctorIntent(s, { type: 'pick-patient', partyIndex: 0 });
		answerDoctor(s, true);
		doctorIntent(s, { type: 'leave' });
		for (const a of party(s)) expect(a.hp).toBe(getAnimal(a.speciesId).maxHp);

		// And the grass is the grass again.
		move(s, ...Array<Direction>(7).fill('left'));
		expect(position(s)).toEqual(spawnPoint(seed));
		expect(reedWalk(s, 60).length).toBeGreaterThan(0);
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

describe('LocalAuthority: a tired team walks to the doctor', () => {
	/** A game that has just lost at the reed by the start: every animal tired, on the reed. */
	function tired(): { s: Session; at: GridPos; team: AnimalInstance[] } {
		const s = session();
		walkIntoBattle(s);
		lose(s);
		expect(lastMessage(s)).toBe('battle.closing.lost');
		const team = party(s);
		expect(needsDoctor(team)).toBe(true);
		return { s, at: position(s), team };
	}

	/** A save round trip, as a reload does it: JSON through storage, restored, started again. */
	function reloaded(s: Session): Session {
		const doc = saveDocument(s.authority.snapshot(), { lineage: 't', seq: 1 });
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({ game: restoreGame(read.save, mint) });
		return { authority, events };
	}

	it('a reload is no heal: the team is as tired as it was, where it was, and the reed stays quiet', () => {
		const { s, at, team } = tired();
		const r = reloaded(s);
		expect(welcome(r)).toMatchObject({ pos: at, party: team });
		move(r, 'right');
		expect(reedWalk(r, 200)).toEqual([]);
	});

	it('travels while tired, still tired: a first visit is at the spawn, a doctor at most 12 steps away', () => {
		const { s, team } = tired();
		const from = s.events.length;
		s.authority.dispatch({ type: 'travel', world: 42 });
		const trip = s.events.slice(from);
		expect(trip.map((e) => e.type)).toEqual(['travelled']);
		const arrived = trip[0]!;
		if (arrived.type !== 'travelled') throw new Error('no trip');
		expect(arrived.firstVisit).toBe(true);
		expect(arrived.pos).toEqual(spawnPoint(worldSeed(42)));
		expect(nearestTent(worldSeed(42), arrived.pos)!.steps).toBeLessThanOrEqual(12);
		expect(s.authority.snapshot().party).toEqual(team);
	});

	it('goes to a friend while tired, still tired, and nothing jumps out on the way', () => {
		const { s, team } = tired();
		const near = { x: 150, y: -40 };
		const want = arrivalSpot(WORLD_SEED, near)!;
		s.authority.dispatch({ type: 'go-to', near });
		expect(s.events.at(-1)).toEqual({
			type: 'player-placed',
			playerId: 'local',
			pos: want.pos,
			dir: want.facing
		});
		expect(s.authority.snapshot().party).toEqual(team);
	});

	/** A game of World 1 (or `world`) under way at `pos`, facing `facing`, with this team and these items. */
	function startedAt(
		pos: GridPos,
		facing: Direction,
		team: AnimalInstance[],
		extra: Partial<SavedGame> = {}
	): Session {
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({ game: { ...newGame(1, testStarter()), pos, facing, party: team, ...extra } });
		return { authority, events };
	}

	/** (-2, 32) in World 1: a grass tile walled in, no tent a walk away; a glide down from (-2, 12) lands there. */
	const POCKET = { x: -2, y: 32 };

	it('a tired team that glides somewhere no tent can be walked to from stays tired there, and so does its save', () => {
		// The adversarial review of #116: a restore that asked for a doctor again healed this
		// team, while the live game, which asks only after a lost battle, a go-to or a trip,
		// left it tired: a reload, or Quit to title and Continue, was a free heal.
		const team = [animal('squirrel', 0)];
		const s = startedAt({ x: -2, y: 12 }, 'down', team, { items: ['glider'] });
		expect(nearestTent(WORLD_SEED, { x: -2, y: 12 })).not.toBeNull();
		s.authority.dispatch({ type: 'take-off' });
		for (let i = 0; i < 40 && !s.events.some((e) => e.type === 'landed'); i++) {
			s.authority.dispatch({ type: 'glide' });
		}
		expect(s.authority.snapshot().pos).toEqual(POCKET);
		expect(nearestTent(WORLD_SEED, POCKET)).toBeNull();
		expect(s.events.some((e) => e.type === 'party-changed')).toBe(false);
		expect(s.authority.snapshot().party).toEqual(team);
		// Picked up from its save, as a reload or Continue does: as tired, where it was.
		expect(welcome(reloaded(s))).toMatchObject({ pos: POCKET, party: team });
	});

	it('a kid with the glider flies out: trips out of a pocket and back heal nobody', () => {
		// The adversarial review of #116, a second time: glided tired into the pocket, a trip to
		// World 42 and back put the kid there again, a doctor came, and it healed the team for
		// free, as often as the kid liked.
		const team = [animal('squirrel', 0)];
		const s = startedAt({ x: -2, y: 12 }, 'down', team, { items: ['glider'] });
		s.authority.dispatch({ type: 'take-off' });
		for (let i = 0; i < 40 && !s.events.some((e) => e.type === 'landed'); i++) {
			s.authority.dispatch({ type: 'glide' });
		}
		expect(s.authority.snapshot().pos).toEqual(POCKET);
		for (let round = 0; round < 2; round++) {
			s.authority.dispatch({ type: 'travel', world: 42 });
			const from = s.events.length;
			s.authority.dispatch({ type: 'travel', world: 1 });
			expect(s.events.slice(from).map((e) => e.type)).toEqual(['travelled']);
			expect(s.authority.snapshot().pos).toEqual(POCKET);
			expect(party(s)).toEqual(team);
		}
		// Parked there fit, it is the same: tired from anywhere, a trip back heals nobody.
		const fit = startedAt(spawnPoint(worldSeed(42)), 'down', team, {
			home: 42,
			world: 42,
			items: ['glider'],
			worlds: [{ world: 1, pos: POCKET, facing: 'down', edits: [] }]
		});
		fit.authority.dispatch({ type: 'travel', world: 1 });
		expect(party(fit)).toEqual(team);
		expect(fit.events.some((e) => e.type === 'message')).toBe(false);
	});

	it('a trip back to a spot no tent can be walked to from, the team tired and no glider: a doctor comes there', () => {
		const team = [animal('squirrel', 0)];
		const s = startedAt(spawnPoint(worldSeed(42)), 'down', team, {
			home: 42,
			world: 42,
			worlds: [{ world: 1, pos: POCKET, facing: 'down', edits: [] }]
		});
		const from = s.events.length;
		s.authority.dispatch({ type: 'travel', world: 1 });
		expect(s.events.slice(from).map((e) => e.type)).toEqual([
			'travelled',
			'party-changed',
			'message'
		]);
		expect(s.authority.snapshot().pos).toEqual(POCKET);
		expect(party(s)).toEqual([{ ...team[0]!, hp: getAnimal('squirrel').maxHp }]);
		expect(lastMessage(s)).toBe('doctor.came');
		// And back to World 42's spawn, a tent a walk away: nobody comes to a fit team, nor would
		// to a tired one there.
		s.authority.dispatch({ type: 'travel', world: 42 });
		expect(s.events.at(-1)?.type).toBe('travelled');
	});

	it('a game an older build saved at the tent, after its free heal, carries on there, fit', () => {
		// The old rule put the kid beside the tent at (5, 7), from its left, every animal at full HP.
		const old = {
			...newGame(1, testStarter()),
			pos: { x: 4, y: 7 },
			facing: 'right' as const,
			steps: 11
		};
		const doc = JSON.parse(JSON.stringify(saveDocument(old, { lineage: 'old', seq: 9 })));
		const read = readSave(doc);
		if (!read.ok) throw new Error(read.error);
		const game = restoreGame(read.save, mint);
		expect(game).toMatchObject({ pos: { x: 4, y: 7 }, facing: 'right', party: old.party });
		expect(needsDoctor(game.party)).toBe(false);
	});

	it('a battle an older build saved on its last turn is lost by the new rule: tired, where it was fought', () => {
		// Saved at the battle menu, the squirrel at 1 HP against a bear, as a build before realms
		// saved a battle: no `realm` (fought on land). The bear's reply to a wrong answer ends it.
		const team = [animal('squirrel', 1)];
		const battle = startBattle(team, {
			id: 'wild-bear',
			speciesId: 'bear',
			hp: getAnimal('bear').maxHp
		});
		const pos = { x: -3, y: 6 };
		const doc = JSON.parse(
			JSON.stringify(
				saveDocument(
					{ ...newGame(1, testStarter()), pos, party: team, battle },
					{ lineage: 'old', seq: 3 }
				)
			)
		);
		delete doc.battle.realm;
		const read = readSave(doc);
		if (!read.ok) throw new Error(read.error);
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({ game: restoreGame(read.save, mint) });
		const s = { authority, events };
		expect(latestBattle(s).realm).toBe('land');
		lose(s);
		expect(lastMessage(s)).toBe('battle.closing.lost');
		expect(party(s)).toEqual([{ ...team[0]!, hp: 0 }]);
		expect(s.authority.snapshot().pos).toEqual(pos);
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
		return restoreGame(read.save, mint);
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
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(s.authority.snapshot().battle).toBeNull();
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
		const restored = restoreGame(read.save, mint);
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
		expect(visit(s)).toMatchObject({
			tokens: 20,
			items: [],
			shop: ['axe', 'pickaxe', 'boat', 'glider', 'harness']
		});

		doctorIntent(s, { type: 'hand-over', ids: ['a'] });
		expect(visit(s).phase).toMatchObject({ kind: 'handing-over', reward: 2 });
		let from = s.events.length;
		answerDoctor(s, false);
		expect(s.events.slice(from).map((e) => e.type)).toEqual(['doctor-visit-updated']);
		from = s.events.length;
		answerDoctor(s, true);
		expect(s.events.slice(from)).toMatchObject([
			{ type: 'doctor-visit-updated' },
			{ type: 'solved-changed', solved: 1 },
			{ type: 'party-changed', party: [hurtParty()[1], hurtParty()[2]] },
			{ type: 'book-changed', freed: ['squirrel'] },
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
			{ type: 'solved-changed', solved: 2 },
			{ type: 'belongings-changed', tokens: 14, items: ['axe'] }
		]);
		doctorIntent(s, { type: 'leave' });

		// The game holds it all, through a save and a reload; the next visit starts from it.
		const game = s.authority.snapshot();
		expect(game).toMatchObject({ tokens: 14, items: ['axe'], solved: 2 });
		expect(game.party.map((a) => a.id)).toEqual(['b', 'c']);
		const t: Session = { authority: new LocalAuthority({ shop: ITEM_IDS }), events: [] };
		t.authority.subscribe((e) => t.events.push(e));
		const doc = saveDocument(game, { lineage: 'test', seq: 1 });
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		t.authority.start({ game: restoreGame(read.save, mint) });
		expect(t.events[0]).toMatchObject({ type: 'welcome', tokens: 14, items: ['axe'], solved: 2 });
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
		// Every tool does its job now (the axe and the pickaxe clear, the boat sails, the
		// glider flies); anything not on sale can't be bought.
		expect(visit(s).shop).toEqual(['axe', 'pickaxe', 'boat', 'glider', 'harness']);
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
		authority.start({ game: { ...newGame(1, testStarter()), party: team, items } });
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
		// About one step in ten, and every one a sea animal (near home, mostly the otter's size:
		// turtles, lion's manes and lobsters).
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

	it('the sea recipe: a game at (-2, 2) with the otter in front meets a Moon jellyfish on step 11, Left and Right in turn', () => {
		// [[CHEATSHEET]] § The sea animals and [[DEVELOPMENT]] § Looking at the game say so: change them
		// with it. A game saved on the deep water with no steps walked yet: the steps are what the roll reads.
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({
			game: {
				...newGame(1, testStarter()),
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
		// A tier below the otter since #89's third wave, one of the four small sea animals.
		expect(met).toEqual([{ step: 11, wild: 'moon-jellyfish' }]);
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

	/** A game out on the deep water at (-2, 2), in the boat, mid-battle with a wild otter. */
	function lostAtSea(team: AnimalInstance[]): Session {
		const battle = startBattle(
			team,
			{ id: 'wild', speciesId: 'otter', hp: 32 },
			{ realm: 'water' }
		);
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({
			game: {
				...newGame(1, testStarter()),
				pos: { x: -2, y: 2 },
				party: team,
				items: ['boat'],
				battle
			}
		});
		const s = { authority, events };
		expect(latestBattle(s).realm).toBe('water');
		while (latestBattle(s).phase.kind !== 'ended') attack(s, 1, 1, false);
		expect(latestBattle(s).phase).toEqual({ kind: 'ended', outcome: 'lost' });
		return s;
	}

	it('a battle lost on the water, the squirrel still in the boat: still out there, nobody healed, and the land is the squirrel’s', () => {
		const team = [animal('squirrel'), animal('otter', 3)];
		const s = lostAtSea(team);
		const end = latestBattle(s);
		expect(end.party.map((a) => a.hp)).toEqual([20, 0]);
		expect(party(s)).toEqual(end.party);
		expect(lastMessage(s)).toBe('battle.closing.lost');
		expect(s.authority.snapshot()).toMatchObject({ pos: { x: -2, y: 2 }, party: end.party });
		// Nobody who swims is standing, so the deep water is quiet...
		for (let i = 0; i < 300; i++) move(s, i % 2 === 0 ? 'left' : 'right');
		expect(isWater(tileAtWorld(WORLD_SEED, position(s).x, position(s).y).kind)).toBe(true);
		expect(s.events.filter((e) => e.type === 'battle-started')).toHaveLength(1);
		// ...but the squirrel can fight on land: no doctor needed to battle there.
		expect(needsDoctor(party(s), 'water')).toBe(false);
	});

	it('a battle lost on the water with nobody left standing: out there still, tired, a tent in reach over the water', () => {
		const s = lostAtSea([animal('otter', 3)]);
		const end = latestBattle(s);
		expect(party(s)).toEqual([{ ...end.party[0]!, hp: 0 }]);
		expect(lastMessage(s)).toBe('battle.closing.lost');
		expect(needsDoctor(party(s), 'water')).toBe(true);
		const at = { x: -2, y: 2 };
		expect(s.authority.snapshot().pos).toEqual(at);
		expect(
			nearestTent(WORLD_SEED, at, TENT_SEARCH_STEPS, WorldEdits.none, { boat: true })
		).not.toBeNull();
		for (let i = 0; i < 300; i++) move(s, i % 2 === 0 ? 'left' : 'right');
		expect(s.events.filter((e) => e.type === 'battle-started')).toHaveLength(1);
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
		return restoreGame(read.save, mint);
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

	it('a battle lost in a spot walled in by trees: the path the kid cut is the way out, and without it a doctor comes', () => {
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
		const team = [animal('squirrel', 1)];
		const battle = startBattle(team, { id: 'wild-bear', speciesId: 'bear', hp: 50 });
		const inBattle = { ...gameBeside(tree, ['axe']), pos, party: team, battle };

		// The path they cut leads to a tent: they walk out along it, tired, from where they stood.
		const cut = from({ ...inBattle, edits: [...edits.encode()] });
		lose(cut);
		expect(lastMessage(cut)).toBe('battle.closing.lost');
		expect(party(cut)).toEqual([{ ...team[0]!, hp: 0 }]);
		expect(cut.authority.snapshot().pos).toEqual(pos);

		// The seeded world alone has the spot walled in: no tent in reach, so a doctor comes.
		expect(nearestTent(WORLD_SEED, pos)).toBeNull();
		const walled = from({ ...inBattle, edits: [] });
		lose(walled);
		expect(closingEvents(walled).map((e) => e.type)).toEqual([
			'battle-updated',
			'battle-ended',
			'party-changed',
			'message'
		]);
		expect(lastMessage(walled)).toBe('doctor.came');
		expect(party(walled)).toEqual([{ ...team[0]!, hp: getAnimal('squirrel').maxHp }]);
		expect(walled.authority.snapshot().pos).toEqual(pos);
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
		return restoreGame(read.save, mint);
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

	it('travel goes to another world while exploring: its spawn on a first visit; party, tokens, items, puzzles solved, name and counts go along', () => {
		const s = from({
			...newGame(1, testStarter(), 'Nini'),
			tokens: 7,
			items: ['axe'],
			solved: 312
		});
		move(s, 'right', 'right', 'down');
		const left = { pos: position(s), facing: facing(s) };
		const before = s.authority.snapshot();
		const events = travelTo(s, 42);
		expect(events).toEqual([
			{
				type: 'travelled',
				playerId: 'local',
				world: 42,
				land: 'nordland',
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
				land: 'nordland',
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

describe('LocalAuthority: puzzles solved', () => {
	/** The right answers the engine judged in these events, as the battle and the doctor report them. */
	function judgedRight(events: readonly GameEvent[]): number {
		let n = 0;
		for (const e of events) {
			if (e.type !== 'battle-updated' && e.type !== 'doctor-visit-updated') continue;
			for (const j of e.events) if (j.type === 'answer-judged' && j.correct) n++;
		}
		return n;
	}

	/** Every count the authority said, in order. */
	function counts(s: Session): number[] {
		return s.events.flatMap((e) => (e.type === 'solved-changed' ? [e.solved] : []));
	}

	it('a right answer in a battle adds one, said right after the turn that judged it; a wrong one adds none', () => {
		const s = session(withParty('fox'));
		expect(welcome(s).solved).toBe(0);
		walkIntoBattle(s);
		let from = s.events.length;
		attack(s, 1, 1, false);
		expect(s.events.slice(from).map((e) => e.type)).not.toContain('solved-changed');
		expect(s.authority.snapshot().solved).toBe(0);
		from = s.events.length;
		attack(s, 1, 1, true);
		const fresh = s.events.slice(from);
		const at = fresh.findIndex((e) => e.type === 'solved-changed');
		expect(fresh[at]).toEqual({ type: 'solved-changed', solved: 1 });
		expect(judgedRight([fresh[at - 1]!])).toBe(1);
		expect(fresh.filter((e) => e.type === 'solved-changed')).toHaveLength(1);
		expect(s.authority.snapshot().solved).toBe(1);
	});

	it('over many battles and a long doctor visit, the count is exactly the right answers, one at a time, and the screen agrees', () => {
		const rng = new Rng(2026);
		const s = session({ ...withParty('fox,fox'), tokens: 30, shop: ITEM_IDS });
		for (let n = 0; n < 12; n++) {
			walkIntoBattle(s);
			while (latestBattle(s).phase.kind !== 'ended') {
				stepIn(s);
				if (latestBattle(s).phase.kind === 'ended') break;
				if (rng.chance(0.1)) s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
				else attack(s, 1, rng.pick([1, 2] as const), rng.chance(0.6));
			}
			// A lost battle leaves the team tired, and the reed quiet: enough battles.
			if (lastMessage(s) === 'battle.closing.lost') break;
		}
		const inBattles = judgedRight(s.events);
		expect(inBattles).toBeGreaterThan(10);

		// A long visit: heals, hand-overs and purchases, right and wrong, backing out now and then.
		const t = session({
			party: [...hurtParty(), ...parseParty('rabbit:1*4,frog:0*3,deer:9')!],
			tokens: 30,
			shop: ITEM_IDS
		});
		walkToTent(t);
		t.authority.dispatch({ type: 'interact' });
		for (let i = 0; i < 300; i++) {
			const state = visit(t);
			const phase = state.phase;
			if (phase.kind === 'solving' || phase.kind === 'handing-over' || phase.kind === 'buying') {
				if (rng.chance(0.1)) doctorIntent(t, { type: 'back' });
				else answerDoctor(t, rng.chance(0.5));
			} else {
				const roll = rng.next();
				const hurt = state.party.flatMap((a, j) =>
					a.hp < getAnimal(a.speciesId).maxHp ? [j] : []
				);
				if (roll < 0.3 && hurt.length > 0) {
					doctorIntent(t, { type: 'pick-patient', partyIndex: rng.pick(hurt) });
				} else if (roll < 0.55) {
					doctorIntent(t, { type: 'hand-over', ids: [rng.pick(state.party).id] });
				} else if (roll < 0.8) {
					doctorIntent(t, { type: 'buy', itemId: rng.pick(ITEM_IDS) });
				} else {
					// An answer with no sum open: refused, and nothing counts.
					doctorIntent(t, { type: 'answer', input: '1' });
				}
			}
		}
		doctorIntent(t, { type: 'leave' });
		expect(visit(t).phase.kind).toBe('ended');
		const atTheDoctor = judgedRight(t.events);
		expect(atTheDoctor).toBeGreaterThan(8);

		for (const [who, right] of [
			[s, inBattles],
			[t, atTheDoctor]
		] as const) {
			expect(who.authority.snapshot().solved).toBe(right);
			// One at a time, never down, never twice for one answer.
			expect(counts(who)).toEqual(Array.from({ length: right }, (_, i) => i + 1));
			// What the HUD reads follows the events.
			for (const e of who.events) game.apply(e);
			expect(game.solved).toBe(right);
		}
	});

	it('is saved with the game, mid-battle too, and a reload carries on counting; a new game starts at 0', () => {
		const s = session(withParty('fox'));
		walkIntoBattle(s);
		attack(s, 1, 1, true);
		expect(s.authority.snapshot().solved).toBe(1);
		const doc = saveDocument(s.authority.snapshot(), { lineage: 'test', seq: 1 });
		expect(doc.solved).toBe(1);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		const t: Session = { authority: new LocalAuthority(), events: [] };
		t.authority.subscribe((e) => t.events.push(e));
		t.authority.start({ game: restoreGame(read.save, mint) });
		expect(welcome(t).solved).toBe(1);
		// The battle picked up goes on counting from there.
		if (latestBattle(t).phase.kind === 'ended') throw new Error('the battle ended at once');
		stepIn(t);
		attack(t, 1, 1, true);
		expect(t.authority.snapshot().solved).toBe(2);
		t.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		while (latestBattle(t).phase.kind !== 'ended') {
			stepIn(t);
			t.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		}

		// Back on the title and a new game: a count of its own, from 0.
		t.authority.dispatch({ type: 'leave-game' });
		expect(t.events.at(-1)).toEqual({ type: 'game-left' });
		const from = t.events.length;
		t.authority.dispatch({ type: 'new-game', speciesId: STARTERS[0]! });
		expect(t.events[from]).toMatchObject({ type: 'welcome', newGame: true, solved: 0 });
		expect(t.authority.snapshot().solved).toBe(0);
	});

	it("a friendly match's right answers count for this player's own side only, and nothing else changes", () => {
		const s = session(withParty('fox,rabbit'));
		// A game already under way, some puzzles solved.
		walkIntoBattle(s);
		attack(s, 1, 1, true);
		while (latestBattle(s).phase.kind !== 'ended') {
			stepIn(s);
			s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		}
		const before = s.authority.snapshot();
		expect(before.solved).toBe(1);

		// A real match's steps, as its authority sends them to both players.
		const { steps, right } = playedMatch(before.party);
		expect(right.a).toBeGreaterThan(0);
		expect(right.b).toBeGreaterThan(0);

		const from = s.events.length;
		for (const step of steps) s.authority.dispatch(answers(step, 'a'));
		expect(s.events.slice(from).filter((e) => e.type !== 'solved-changed')).toEqual([]);
		expect(s.events.at(-1)).toEqual({ type: 'solved-changed', solved: 1 + right.a });
		// One `solved-changed` for each step with a right answer of the player's, never one for nothing.
		const counting = steps.filter((st) =>
			st.events.some((e) => e.type === 'answer-judged' && e.correct && e.side === 'a')
		);
		expect(s.events.length - from).toBe(counting.length);
		// Nothing else about the game changed: a match changes nothing but the count.
		expect(s.authority.snapshot()).toEqual({ ...before, solved: 1 + right.a });
		// The other player's right answers, and the wrong ones, are nobody's here (in a match of its own).
		const theirs = steps.map((st) => ({
			...st,
			events: st.events.filter((e) => e.type !== 'answer-judged' || e.side === 'b' || !e.correct)
		}));
		for (const step of theirs) s.authority.dispatch(answers(step, 'a', 'another-match'));
		expect(s.events.length).toBe(from + counting.length);
		// Played from the other side, the same steps count the other side's answers.
		const other = session();
		for (const step of steps) other.authority.dispatch(answers(step, 'b'));
		expect(other.authority.snapshot().solved).toBe(right.b);
		// Before a game is under way there is nothing to count into.
		const title = new LocalAuthority();
		const said: GameEvent[] = [];
		title.subscribe((e) => said.push(e));
		for (const step of steps) title.dispatch(answers(step, 'a'));
		expect(said).toEqual([]);
	});

	it("counts a match's step once: a step passed again, or one before a step counted, adds nothing", () => {
		const s = session(withParty('fox,rabbit'));
		const { steps } = playedMatch(s.authority.snapshot().party);
		const scoring = steps.filter((st) =>
			st.events.some((e) => e.type === 'answer-judged' && e.correct && e.side === 'a')
		);
		expect(scoring.length).toBeGreaterThan(2);
		const [first, second] = scoring as [MatchStep, MatchStep];

		s.authority.dispatch(answers(first, 'a'));
		const once = s.authority.snapshot().solved;
		expect(once).toBe(1);
		// The same step again: a batch passed twice.
		s.authority.dispatch(answers(first, 'a'));
		expect(s.authority.snapshot().solved).toBe(once);
		s.authority.dispatch(answers(second, 'a'));
		const twice = s.authority.snapshot().solved;
		expect(twice).toBe(2);
		// A step before the last one counted, late: refused as well.
		s.authority.dispatch(answers(first, 'a'));
		expect(s.authority.snapshot().solved).toBe(twice);
		// Another match's steps are its own, numbered from 1 again (a rematch).
		s.authority.dispatch(answers(first, 'a', 'rematch-1'));
		expect(s.authority.snapshot().solved).toBe(twice + 1);
	});

	it('counts a step of a match in any mode while a game is under way, a wild battle too', () => {
		const s = session(withParty('fox,rabbit'));
		walkIntoBattle(s);
		const { steps, right } = playedMatch(s.authority.snapshot().party);
		for (const step of steps) s.authority.dispatch(answers(step, 'a'));
		expect(s.authority.snapshot().solved).toBe(right.a);
		expect(latestBattle(s).phase.kind).not.toBe('ended');
	});

	it('takes no batch that is not one: a side, a step, a match id or events of the wrong kind', () => {
		const s = session(withParty('fox,rabbit'));
		const { steps } = playedMatch(s.authority.snapshot().party);
		const step = steps.find((st) =>
			st.events.some((e) => e.type === 'answer-judged' && e.correct && e.side === 'a')
		)!;
		const good = answers(step, 'a');
		const bad: unknown[] = [
			{ ...good, side: 'c' },
			{ ...good, side: undefined },
			{ ...good, step: 0 },
			{ ...good, step: -1 },
			{ ...good, step: 1.5 },
			{ ...good, step: Number.NaN },
			{ ...good, step: Number.POSITIVE_INFINITY },
			{ ...good, step: String(good.step) },
			{ ...good, match: '' },
			{ ...good, match: 'no spaces!' },
			{ ...good, match: 42 },
			{ ...good, events: null },
			{ ...good, events: 'answer-judged' },
			{ ...good, events: { 0: good.events[0], length: 1 } },
			{ ...good, events: [...good.events, null] },
			{ ...good, events: [...good.events, 'answer-judged'] },
			{ ...good, events: [...good.events, { side: 'a', correct: true }] },
			// A list with holes, which `every` would skip.
			{ ...good, events: new Array(2) },
			{ ...good, events: [...good.events, , { type: 'missed', attacker: 'b' }] },
			// More than one intent's worth: past the wire's limit, or a second answer judged.
			{ ...good, events: [...good.events, ...Array(MAX_MATCH_EVENTS).fill({ type: 'missed' })] },
			{ ...good, events: [...good.events, { type: 'answer-judged', side: 'a', correct: true }] },
			// An answer judged without a side, or neither right nor wrong.
			{ ...good, events: [{ type: 'answer-judged', side: 'c', correct: true }] },
			{ ...good, events: [{ type: 'answer-judged', side: 'a', correct: 'yes' }] }
		];
		const from = s.events.length;
		for (const intent of bad) s.authority.dispatch(intent as Intent);
		expect(s.events.slice(from)).toEqual([]);
		expect(s.authority.snapshot().solved).toBe(0);
		// None of them used the step up: the batch itself still counts.
		s.authority.dispatch(good);
		expect(s.authority.snapshot().solved).toBeGreaterThan(0);
	});
});

/** One step of a match as the server sends it: its number (the view's `step`) and its events. */
interface MatchStep {
	step: number;
	events: MatchEvent[];
}

/**
 * A whole match played in the real reducer, party `a` against a wolf and a
 * deer, as the server plays it: every step's events, with the step number its
 * view carries, and how many answers each side got right. Every third answer
 * is wrong.
 */
function playedMatch(party: readonly AnimalInstance[]): {
	steps: MatchStep[];
	right: Record<MatchSide, number>;
} {
	const seed = 99;
	let state = startMatch({ a: party, b: parseParty('wolf,deer')! }, seed);
	const steps: MatchStep[] = [];
	const right = { a: 0, b: 0 };
	for (let i = 0; i < 600; i++) {
		const phase = state.phase;
		if (phase.kind === 'ended') break;
		const side = phase.side;
		let intent: MatchIntent;
		if (phase.kind === 'solving') {
			const correct = i % 3 !== 0;
			const answer = phase.puzzle.answer;
			intent = { type: 'answer', input: String(correct ? answer : answer + 1) };
			if (correct) right[side]++;
		} else if (phase.kind === 'choose-animal') {
			const next = state.teams[side].findIndex((_, j) => canSendIn(state, side, j));
			intent = { type: 'pick-next', teamIndex: next };
		} else {
			intent = { type: 'attack', attackIndex: 1, level: 1 };
		}
		const step = applyMatchIntent(state, side, intent, seed);
		state = step.state;
		steps.push({ step: state.step, events: [...step.events] });
	}
	expect(state.phase.kind).toBe('ended');
	return { steps, right };
}

/** `match-answers` for one step of match `match`, played from `side`. */
function answers(
	step: MatchStep,
	side: MatchSide,
	match = 'match-1'
): Intent & { type: 'match-answers' } {
	return { type: 'match-answers', match, step: step.step, side, events: step.events };
}

describe('LocalAuthority: the animal book', () => {
	/** Every book the authority said, in order. */
	function books(s: Session): { seen: string[]; caught: string[] }[] {
		return s.events.flatMap((e) =>
			e.type === 'book-changed' ? [{ seen: e.seen, caught: e.caught }] : []
		);
	}

	/** The kinds set free each `book-changed` said, in order. */
	function freedSaid(s: Session): string[][] {
		return s.events.flatMap((e) => (e.type === 'book-changed' ? [e.freed] : []));
	}

	function resumed(game: SavedGame): Session {
		const s: Session = { authority: new LocalAuthority(), events: [] };
		s.authority.subscribe((e) => s.events.push(e));
		s.authority.start({ game });
		return s;
	}

	function throughSave(game: SavedGame): SavedGame {
		const read = readSave(JSON.parse(JSON.stringify(saveDocument(game, { lineage: 'b', seq: 1 }))));
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save, mint);
	}

	it("a new game's book holds its starter alone, caught; a ?party= game's, its party's kinds", () => {
		expect(welcome(session())).toMatchObject({ seen: ['squirrel'], caught: ['squirrel'] });
		const s = session(withParty('fox,bear*2,fox,crab'));
		expect(welcome(s)).toMatchObject({
			seen: ['fox', 'bear', 'crab'],
			caught: ['fox', 'bear', 'crab']
		});
		expect(s.authority.snapshot()).toMatchObject({
			seen: ['fox', 'bear', 'crab'],
			caught: ['fox', 'bear', 'crab']
		});
		// A starter picked on the title, too: a starter counts as caught.
		const title = new LocalAuthority({ homeWorld: () => 7 });
		const said: GameEvent[] = [];
		title.subscribe((e) => said.push(e));
		title.dispatch({ type: 'new-game', speciesId: 'frog' });
		expect(said[0]).toMatchObject({ type: 'welcome', seen: ['frog'], caught: ['frog'] });
	});

	it('a wild animal is met the moment its battle starts, said once for each new kind, and stays met after running away', () => {
		const s = session();
		const met = reedWalk(s, 80);
		const kinds: string[] = ['squirrel'];
		for (const { wild } of met) if (!kinds.includes(wild)) kinds.push(wild);
		expect(kinds.length).toBeGreaterThan(2);
		// Every battle was run from: every kind met, none caught but the starter.
		expect(s.authority.snapshot()).toMatchObject({ seen: kinds, caught: ['squirrel'] });
		// Said once for each new kind, right after its battle started, and never for one met before.
		const said = s.events.flatMap((e, i) => (e.type === 'book-changed' ? [i] : []));
		expect(said).toHaveLength(kinds.length - 1);
		for (const i of said) expect(s.events[i - 1]!.type).toBe('battle-started');
		expect(books(s).map((b) => b.seen.at(-1))).toEqual(kinds.slice(1));
		expect(books(s).at(-1)).toEqual({ seen: kinds, caught: ['squirrel'] });
	});

	it('a leash throw that lands catches it, said right after the throw, before the battle ends', () => {
		// A saved battle against a shrew with 1 HP left, a bear in front: the save proves the shrew met.
		const bear = animal('bear');
		const s = resumed({
			...newGame(1, bear),
			battle: startBattle([bear], { id: 'w', speciesId: 'shrew', hp: 1 })
		});
		expect(welcome(s)).toMatchObject({ seen: ['bear', 'shrew'], caught: ['bear'] });
		let throws = 0;
		while (latestBattle(s).phase.kind !== 'ended' && throws < 20) {
			const from = s.events.length;
			s.authority.dispatch({ type: 'battle', intent: { type: 'throw-leash' } });
			throws++;
			const fresh = s.events.slice(from);
			const update = fresh[0]!;
			if (update.type !== 'battle-updated') throw new Error(`a throw said ${update.type}`);
			const landed = update.events.some((e) => e.type === 'leash-thrown' && e.success);
			const book = fresh.findIndex((e) => e.type === 'book-changed');
			if (!landed) {
				expect(book).toBe(-1);
				continue;
			}
			// Right after the throw, before the battle ends and the shrew joins the team.
			expect(fresh.map((e) => e.type).slice(0, 3)).toEqual([
				'battle-updated',
				'book-changed',
				'battle-ended'
			]);
			expect(fresh[book]).toEqual({
				type: 'book-changed',
				seen: ['bear', 'shrew'],
				caught: ['bear', 'shrew'],
				freed: []
			});
		}
		expect(latestBattle(s).phase).toEqual({ kind: 'ended', outcome: 'caught' });
		expect(s.authority.snapshot()).toMatchObject({
			seen: ['bear', 'shrew'],
			caught: ['bear', 'shrew']
		});
	});

	it('an animal helped home by the doctor stays caught and is set free, in every world and through a save', () => {
		const s = session({ party: hurtParty(), tokens: 20 });
		expect(welcome(s)).toMatchObject({ caught: ['squirrel', 'rabbit', 'fox'], freed: [] });
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		// A wrong answer sets nobody free.
		doctorIntent(s, { type: 'hand-over', ids: ['a'] });
		answerDoctor(s, false);
		expect(books(s)).toEqual([]);
		// The squirrel goes home, the last of its kind: set free, said once, right after it left.
		answerDoctor(s, true);
		doctorIntent(s, { type: 'leave' });
		expect(party(s).map((a) => a.speciesId)).toEqual(['rabbit', 'fox']);
		expect(books(s)).toEqual([
			{ seen: ['squirrel', 'rabbit', 'fox'], caught: ['squirrel', 'rabbit', 'fox'] }
		]);
		expect(freedSaid(s)).toEqual([['squirrel']]);
		const game = s.authority.snapshot();
		expect(game).toMatchObject({
			seen: ['squirrel', 'rabbit', 'fox'],
			caught: ['squirrel', 'rabbit', 'fox'],
			freed: ['squirrel']
		});
		// Another world, and a reload: the book goes along, as it was.
		s.authority.dispatch({ type: 'travel', world: 42 });
		expect(s.authority.snapshot()).toMatchObject({
			world: 42,
			caught: game.caught,
			freed: game.freed
		});
		const again = resumed(throughSave(s.authority.snapshot()));
		expect(welcome(again)).toMatchObject({
			seen: game.seen,
			caught: game.caught,
			freed: game.freed
		});
	});

	it('sets a kind free when one of several goes home, and says nothing when a kind already free goes again', () => {
		const s = session({
			party: [
				{ id: 'a', speciesId: 'fox', hp: 30 },
				{ id: 'b', speciesId: 'fox', hp: 30 },
				{ id: 'c', speciesId: 'fox', hp: 30 },
				{ id: 'd', speciesId: 'rabbit', hp: 22 }
			],
			tokens: 0
		});
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		doctorIntent(s, { type: 'hand-over', ids: ['a'] });
		answerDoctor(s, true);
		// A fox is still on the team, and the fox is set free all the same.
		expect(party(s).map((a) => a.id)).toEqual(['b', 'c', 'd']);
		expect(freedSaid(s)).toEqual([['fox']]);
		doctorIntent(s, { type: 'hand-over', ids: ['b'] });
		answerDoctor(s, true);
		expect(party(s).map((a) => a.id)).toEqual(['c', 'd']);
		expect(books(s)).toHaveLength(1);
		expect(s.authority.snapshot().freed).toEqual(['fox']);
	});
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

describe('LocalAuthority: the glider', () => {
	const SPAWN = { x: -2, y: 6 };

	/** A game in World 1 at `pos`, facing `facing`, owning the glider and `items`. */
	function flyer(
		pos: GridPos,
		facing: Direction,
		items: string[] = [],
		team?: AnimalInstance[]
	): Session {
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		const game = newGame(1, testStarter());
		authority.start({
			game: { ...game, pos, facing, items: ['glider', ...items], party: team ?? game.party }
		});
		return { authority, events };
	}

	function dispatchAll(s: Session, intents: readonly Intent[]): void {
		for (const intent of intents) s.authority.dispatch(intent);
	}

	const glides = (n: number): Intent[] => Array<Intent>(n).fill({ type: 'glide' });

	/** The last `landed` event, or null. */
	function landedAt(s: Session): Extract<GameEvent, { type: 'landed' }> | null {
		const i = lastIndexOf(s, 'landed');
		const e = i < 0 ? null : s.events[i]!;
		return e?.type === 'landed' ? e : null;
	}

	/** A save round trip, as the autosave and a reload do it. */
	function throughSave(saved: SavedGame): SavedGame {
		const read = readSave(
			JSON.parse(JSON.stringify(saveDocument(saved, { lineage: 'L', seq: 1 })))
		);
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save, mint);
	}

	it('takes off the way the player faces, and crosses the lake north of the start a tile at a time, each a step', () => {
		const s = flyer(SPAWN, 'up');
		const steps = s.authority.snapshot().steps;
		let from = s.events.length;
		s.authority.dispatch({ type: 'take-off' });
		const [up] = s.events.slice(from);
		expect(up).toMatchObject({ type: 'took-off', playerId: 'local', from: SPAWN, dir: 'up' });
		expect(up?.type === 'took-off' && up.reach).toBeGreaterThanOrEqual(14);
		// Saved now, the game is the one letting go would leave: on the far shore, 14 steps on.
		expect(s.authority.snapshot()).toMatchObject({ pos: { x: -2, y: -8 }, steps: steps + 14 });
		from = s.events.length;
		dispatchAll(s, glides(3));
		expect(s.events.slice(from)).toEqual([
			{ type: 'glided', playerId: 'local', pos: { x: -2, y: 5 }, flown: 1 },
			{ type: 'glided', playerId: 'local', pos: { x: -2, y: 4 }, flown: 2 },
			{ type: 'glided', playerId: 'local', pos: { x: -2, y: 3 }, flown: 3 }
		]);
		// Let go over the water: on to the sand of the far shore, every tile a step.
		from = s.events.length;
		s.authority.dispatch({ type: 'land' });
		expect(s.events.slice(from)).toEqual([
			{ type: 'landed', playerId: 'local', pos: { x: -2, y: -8 }, dir: 'up', flown: 14 }
		]);
		expect(s.authority.snapshot()).toMatchObject({
			pos: { x: -2, y: -8 },
			facing: 'up',
			steps: steps + 14
		});
		// Down again, it walks as ever: a glide or a landing now does nothing.
		from = s.events.length;
		dispatchAll(s, [{ type: 'glide' }, { type: 'land' }]);
		expect(s.events.slice(from)).toEqual([]);
		move(s, 'up');
		expect(position(s)).toEqual({ x: -2, y: -9 });
	});

	it('holding on comes down at the reach by itself, and a glide past it is no further', () => {
		// Three tiles of ground, then water, trees and rocks past the 20th: the reach is 3.
		const s = flyer({ x: 110, y: -154 }, 'right');
		s.authority.dispatch({ type: 'take-off' });
		expect(s.events.at(-1)).toMatchObject({ type: 'took-off', reach: 3 });
		const from = s.events.length;
		dispatchAll(s, glides(5));
		expect(s.events.slice(from).map((e) => e.type)).toEqual([
			'glided',
			'glided',
			'glided',
			'landed'
		]);
		expect(landedAt(s)).toMatchObject({ pos: { x: 113, y: -154 }, flown: 3 });
		expect(s.authority.snapshot().pos).toEqual({ x: 113, y: -154 });
	});

	it('with nowhere to land, or without the glider, never takes off, and nothing changes', () => {
		// Twenty tiles of water, then ground on the 21st: nowhere to land without the boat.
		const s = flyer({ x: 144, y: -152 }, 'down');
		const before = s.authority.snapshot();
		const from = s.events.length;
		s.authority.dispatch({ type: 'take-off' });
		expect(s.events.slice(from)).toEqual([
			{ type: 'take-off-refused', playerId: 'local', reason: 'nowhere-to-land' }
		]);
		expect(s.authority.snapshot()).toEqual(before);
		// And it walks on as ever.
		move(s, 'left');
		expect(s.events.at(-1)?.type).toMatch(/player-(moved|blocked)/);

		const plain = session();
		plain.authority.dispatch({ type: 'take-off' });
		expect(plain.events.at(-1)).toEqual({
			type: 'take-off-refused',
			playerId: 'local',
			reason: 'no-glider'
		});
	});

	it('in the air nothing else is taken: a step, Enter, a trip, going to someone, leaving, another take-off; a party edit is refused', () => {
		const s = flyer(SPAWN, 'up', [], [animal('squirrel'), animal('frog')]);
		dispatchAll(s, [{ type: 'take-off' }, ...glides(2)]);
		const before = s.authority.snapshot();
		const from = s.events.length;
		dispatchAll(s, [
			{ type: 'move', dir: 'left' },
			{ type: 'interact' },
			{ type: 'travel', world: 2 },
			{ type: 'go-to', near: { x: -5, y: 6 } },
			{ type: 'leave-game' },
			{ type: 'take-off' },
			{ type: 'battle', intent: { type: 'flee' } },
			{ type: 'doctor', intent: { type: 'leave' } }
		]);
		expect(s.events.slice(from)).toEqual([]);
		s.authority.dispatch({ type: 'party', intent: { type: 'select-lead', animalId: 'frog-19' } });
		expect(s.events.at(-1)).toMatchObject({
			type: 'party-edited',
			events: [{ type: 'rejected', reason: 'not-exploring' }]
		});
		expect(s.authority.snapshot()).toEqual(before);
		// Letting go still lands, where it would have.
		s.authority.dispatch({ type: 'land' });
		expect(landedAt(s)?.pos).toEqual({ x: -2, y: -8 });
		// Down on the ground, the trip is taken again.
		s.authority.dispatch({ type: 'travel', world: 2 });
		expect(s.events.at(-1)?.type).toBe('travelled');
	});

	it('no flight starts a battle: not over the deep water with a swimmer in front, nor down on the reed', () => {
		// Across the lake and back, twenty times, in the boat's reach, an otter in front: 160
		// deep-water tiles that a sail would roll 1 in 10 on.
		const sea = flyer(SPAWN, 'up', ['boat'], [animal('otter')]);
		for (let i = 0; i < 20; i++) {
			const dir: Direction = i % 2 === 0 ? 'up' : 'down';
			sea.authority.dispatch({ type: 'move', dir });
			// The bump turned the trainer (or a step onto the water sailed): take off from there,
			// and hold on: twenty tiles, and a glide past the reach comes down on it.
			dispatchAll(sea, [{ type: 'take-off' }, ...glides(21)]);
			expect(landedAt(sea)?.flown).toBe(20);
		}
		expect(sea.events.some((e) => e.type === 'battle-started')).toBe(false);
		// Down onto the reed beside the start, at every step count from 0 to 80: a step onto it
		// from the start meets an animal on some of them, a landing on none.
		let walkedIn = 0;
		for (let steps = 0; steps <= 80; steps++) {
			const fly = flyer(SPAWN, 'left');
			const walk = flyer(SPAWN, 'left');
			for (const s of [fly, walk]) {
				(s.authority as unknown as { steps: number }).steps = steps;
			}
			dispatchAll(fly, [{ type: 'take-off' }, { type: 'land' }]);
			expect(landedAt(fly)).toMatchObject({ pos: { x: -3, y: 6 }, flown: 1 });
			expect(fly.events.some((e) => e.type === 'battle-started')).toBe(false);
			move(walk, 'left');
			if (walk.events.some((e) => e.type === 'battle-started')) walkedIn++;
		}
		expect(isEncounterTile(tileAtWorld(WORLD_SEED, -3, 6).kind)).toBe(true);
		expect(walkedIn).toBeGreaterThan(3);
	});

	it('every tile flown is a step: the walk after a flight meets what the walk after as many steps would', () => {
		// Onto the reed by glider and back to the start on foot, then the reed walk; against
		// the same two steps walked.
		const flown = flyer(SPAWN, 'left');
		dispatchAll(flown, [{ type: 'take-off' }, { type: 'land' }]);
		move(flown, 'right');
		expect(flown.authority.snapshot()).toMatchObject({ pos: SPAWN, steps: 2 });
		const walked = flyer(SPAWN, 'left');
		move(walked, 'left', 'right');
		expect(walked.authority.snapshot()).toMatchObject({ pos: SPAWN, steps: 2 });
		const met = reedWalk(flown, 60);
		expect(met).toEqual(reedWalk(walked, 60));
		expect(met.length).toBeGreaterThan(0);
	});

	it('comes down in the boat on the water, and takes off from the boat', () => {
		const s = flyer(SPAWN, 'up', ['boat']);
		dispatchAll(s, [{ type: 'take-off' }, ...glides(7), { type: 'land' }]);
		expect(landedAt(s)).toMatchObject({ pos: { x: -2, y: -1 }, flown: 7 });
		expect(isWater(tileAtWorld(WORLD_SEED, -2, -1).kind)).toBe(true);
		// Sailing on from there, and up again out of the boat, to the far shore's sand and on.
		move(s, 'up');
		expect(position(s)).toEqual({ x: -2, y: -2 });
		dispatchAll(s, [{ type: 'take-off' }, ...glides(6), { type: 'land' }]);
		expect(landedAt(s)?.pos).toEqual({ x: -2, y: -8 });
		// A game saved out on the water, in the boat, picks up there.
		const out = flyer(SPAWN, 'up', ['boat']);
		dispatchAll(out, [{ type: 'take-off' }, ...glides(4)]);
		expect(throughSave(out.authority.snapshot()).pos).toEqual({ x: -2, y: 2 });
		// Without the boat, a lake wider than the reach is not flown at all.
		const wide = flyer({ x: 112, y: -151 }, 'right', ['axe', 'pickaxe']);
		wide.authority.dispatch({ type: 'take-off' });
		expect(wide.events.at(-1)).toMatchObject({
			type: 'take-off-refused',
			reason: 'nowhere-to-land'
		});
	});

	it('coming down on a tree with the axe chops it as they land: ground from then on, in the save too; without it, on to the ground after the trees', () => {
		const from = { x: 96, y: -102 };
		const s = flyer(from, 'down', ['axe']);
		dispatchAll(s, [{ type: 'take-off' }, ...glides(3)]);
		const at = s.events.length;
		s.authority.dispatch({ type: 'land' });
		expect(s.events.slice(at).map((e) => e.type)).toEqual(['landed', 'tile-cleared']);
		expect(s.events.at(-1)).toMatchObject({
			type: 'tile-cleared',
			pos: { x: 96, y: -99 },
			was: 'tree',
			tool: 'axe',
			regrown: []
		});
		const saved = throughSave(s.authority.snapshot());
		expect(saved.pos).toEqual({ x: 96, y: -99 });
		expect(WorldEdits.decode(saved.edits).has(96, -99)).toBe(true);
		// Without the axe the trees are only flown over: down on the ground after them.
		const bare = flyer(from, 'down');
		dispatchAll(bare, [{ type: 'take-off' }, ...glides(3), { type: 'land' }]);
		expect(landedAt(bare)).toMatchObject({ pos: { x: 96, y: -91 }, flown: 11 });
		expect(bare.events.some((e) => e.type === 'tile-cleared')).toBe(false);
	});

	it('a game saved in the air is on the ground where letting go would land it, never on the water or in the trees, never at the spawn', () => {
		// Over the trees without the axe, and over the lake without the boat: each tile of each flight.
		for (const [from, dir, items] of [
			[{ x: 96, y: -102 }, 'down', []],
			[SPAWN, 'up', []],
			[{ x: 96, y: -102 }, 'down', ['axe']]
		] as const) {
			const s = flyer(from, dir, [...items]);
			s.authority.dispatch({ type: 'take-off' });
			for (let flown = 0; landedAt(s) === null; flown++) {
				const saved = throughSave(s.authority.snapshot());
				const copy = flyer(from, dir, [...items]);
				dispatchAll(copy, [{ type: 'take-off' }, ...glides(flown), { type: 'land' }]);
				const landing = copy.authority.snapshot();
				expect(saved.pos, `${dir} at ${flown}`).toEqual(landing.pos);
				expect(saved.steps).toBe(landing.steps);
				expect(saved.edits).toEqual(landing.edits);
				expect(saved.pos).not.toEqual(spawnPoint(WORLD_SEED));
				const under = WorldEdits.decode(saved.edits).has(saved.pos.x, saved.pos.y)
					? 'grass'
					: tileAtWorld(WORLD_SEED, saved.pos.x, saved.pos.y).kind;
				expect(isWalkable(under)).toBe(true);
				s.authority.dispatch({ type: 'glide' });
			}
		}
	});

	it('a game picked up from a save made in the air plays on exactly as the original does after letting go there', () => {
		const flights: Intent[] = [
			// Bump the lake to face it, cross it, bump back, and fly home over it.
			{ type: 'move', dir: 'up' },
			{ type: 'take-off' },
			...glides(6),
			{ type: 'land' },
			{ type: 'move', dir: 'down' },
			{ type: 'take-off' },
			...glides(2),
			{ type: 'land' }
		];
		/** After the flights: walk the reed and fight, as `nextIntent` does. */
		function next(s: Session, i: number): Intent {
			const battling = lastIndexOf(s, 'battle-started') > lastIndexOf(s, 'battle-ended');
			if (!battling) return { type: 'move', dir: i % 2 === 0 ? 'left' : 'right' };
			const state = latestBattle(s);
			if (state.phase.kind === 'choose-animal') {
				return {
					type: 'battle',
					intent: { type: 'switch', partyIndex: state.party.findIndex((a) => a.hp > 0) }
				};
			}
			if (state.phase.kind === 'solving') {
				const { answer } = state.phase.puzzle;
				return {
					type: 'battle',
					intent: { type: 'answer', input: String(i % 3 === 0 ? answer + 1 : answer) }
				};
			}
			return { type: 'battle', intent: { type: 'attack', attackIndex: 1, level: 1 } };
		}
		const strip = (e: GameEvent) =>
			e.type === 'battle-started' || e.type === 'battle-updated' || e.type === 'battle-ended'
				? [e.type, e.state.opponent.speciesId, e.state.opponent.hp, e.state.phase]
				: e.type === 'party-changed'
					? [e.type, e.party.map((a) => a.hp)]
					: e;
		let cuts = 0;
		for (let cut = 2; cut < flights.length; cut++) {
			const a = flyer(SPAWN, 'down');
			dispatchAll(a, flights.slice(0, cut));
			const up = lastIndexOf(a, 'took-off') > lastIndexOf(a, 'landed');
			if (!up) continue;
			cuts++;
			const saved = throughSave(a.authority.snapshot());
			// The reload lets go: the original lets go too, and the two are the same game.
			a.authority.dispatch({ type: 'land' });
			const b: Session = { authority: new LocalAuthority(), events: [] };
			b.authority.subscribe((e) => b.events.push(e));
			b.authority.start({ game: saved });
			expect(b.authority.snapshot()).toEqual(a.authority.snapshot());
			// Both go on from the intent after that flight's own landing.
			let i = cut;
			while (flights[i - 1]?.type !== 'land') i++;
			const fromA = a.events.length;
			const fromB = b.events.length;
			for (const s of [a, b]) dispatchAll(s, flights.slice(i));
			for (let j = 0; j < 80; j++) {
				a.authority.dispatch(next(a, j));
				b.authority.dispatch(next(b, j));
			}
			expect(b.events.slice(fromB).map(strip)).toEqual(a.events.slice(fromA).map(strip));
			expect(a.events.slice(fromA).some((e) => e.type === 'battle-started')).toBe(true);
		}
		// Cuts over the take-off tile and every tile of both flights.
		expect(cuts).toBe(10);
	});
});

describe('LocalAuthority: birds in the air (#91)', () => {
	const SPAWN = { x: -2, y: 6 };
	/** From the start of World 1, straight up over the lake: its far shore 14 tiles up, the reach 17. */
	const REACH = 17;

	/** A game in World 1 at the start, facing up over the lake, with the glider, `team` and `steps` taken. */
	function flyer(team: AnimalInstance[], steps = 0, items: string[] = []): Session {
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({
			game: {
				...newGame(1, testStarter()),
				pos: SPAWN,
				facing: 'up',
				steps,
				items: ['glider', ...items],
				party: team
			}
		});
		return { authority, events };
	}

	const glides = (n: number): Intent[] => Array<Intent>(n).fill({ type: 'glide' });
	const dispatchAll = (s: Session, intents: readonly Intent[]) => {
		for (const intent of intents) s.authority.dispatch(intent);
	};
	const typesOf = (events: readonly GameEvent[]) => events.map((e) => e.type);
	const follows = (s: Session) =>
		s.events.filter(
			(e): e is Extract<GameEvent, { type: 'bird-follows' }> => e.type === 'bird-follows'
		);

	/** A save round trip, as the autosave and a reload do it. */
	function throughSave(saved: SavedGame): SavedGame {
		const read = readSave(
			JSON.parse(JSON.stringify(saveDocument(saved, { lineage: 'L', seq: 1 })))
		);
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save, mint);
	}

	/** The robin in front in the air, the squirrel on the ground. */
	const team = () => [animal('squirrel'), animal('robin')];

	it('a bird in the team: a bird notices the glider about once in twenty tiles, at most one a flight, and its battle in the air starts as the kid lands', () => {
		let flights = 0;
		let noticed = 0;
		// Flights on steps 17 apart, so no two roll the same step (a step rolls the same whoever
		// flies it: flights a step apart share sixteen of their rolls).
		for (let steps = 0; steps < 160 * REACH; steps += REACH) {
			const s = flyer(team(), steps);
			// Held to the reach: seventeen tiles, and a glide past it comes down there.
			dispatchAll(s, [{ type: 'take-off' }, ...glides(REACH + 1)]);
			flights++;
			const birds = follows(s);
			expect(birds.length, `step ${steps}`).toBeLessThanOrEqual(1);
			const bird = birds[0];
			if (!bird) {
				expect(s.events.some((e) => e.type === 'battle-started')).toBe(false);
				continue;
			}
			noticed++;
			// Over the tile just glided onto, then down at the reach, then the battle in the air.
			const at = s.events.indexOf(bird);
			expect(s.events[at - 1]).toMatchObject({ type: 'glided', pos: bird.pos, flown: bird.flown });
			expect(getAnimal(bird.speciesId).realms).toContain('air');
			const tail = s.events.slice(lastIndexOf(s, 'landed'));
			expect(typesOf(tail).slice(0, 2)).toEqual(['landed', 'battle-started']);
			const state = latestBattle(s);
			expect(state.realm).toBe('air');
			expect(state.opponent).toMatchObject({
				speciesId: bird.speciesId,
				hp: getAnimal(bird.speciesId).maxHp
			});
			expect(state.party[state.active]!.speciesId).toBe('robin');
			// Where the flight came down: on the sand of the far shore, the reach.
			expect(position(s)).toEqual({ x: -2, y: SPAWN.y - REACH });
		}
		// 1 − 0.95^17 = 58% of seventeen-tile flights meet a bird.
		expect(noticed / flights).toBeGreaterThan(0.45);
		expect(noticed / flights).toBeLessThan(0.7);
	});

	it('with no bird standing nothing in the air ever notices the kid, and flying is peaceful', () => {
		const teams = [
			[animal('squirrel')],
			[animal('otter'), animal('frog')],
			[animal('robin', 0), animal('squirrel')],
			[animal('mute-swan', 0), animal('bear')]
		];
		for (const t of teams) {
			for (let steps = 0; steps < 120; steps++) {
				const s = flyer(t, steps);
				dispatchAll(s, [{ type: 'take-off' }, ...glides(REACH + 1)]);
				expect(follows(s), `${t.map((a) => a.speciesId)} at ${steps}`).toEqual([]);
				expect(s.events.some((e) => e.type === 'battle-started')).toBe(false);
			}
		}
	});

	it('meets the same bird on the same tile however the flight is flown down: glide by glide, or a land sent early', () => {
		let compared = 0;
		for (let steps = 0; steps < 200 && compared < 12; steps++) {
			// Let go over the fourth tile of the lake: the landing is the far shore, ten tiles on.
			const paced = flyer(team(), steps);
			dispatchAll(paced, [{ type: 'take-off' }, ...glides(4), ...glides(10), { type: 'land' }]);
			const early = flyer(team(), steps);
			dispatchAll(early, [{ type: 'take-off' }, ...glides(4), { type: 'land' }]);
			const [a] = follows(paced);
			const [b] = follows(early);
			expect(b?.speciesId, `step ${steps}`).toBe(a?.speciesId);
			expect(b?.pos).toEqual(a?.pos);
			if (!a || a.flown <= 4) continue;
			compared++;
			// The early one heard of the bird on its way down, before it landed.
			expect(typesOf(early.events.slice(early.events.indexOf(b!))).slice(0, 3)).toEqual([
				'bird-follows',
				'landed',
				'battle-started'
			]);
			const [x, y] = [latestBattle(paced), latestBattle(early)];
			expect({ ...y, opponent: { ...y.opponent, id: '' } }).toEqual({
				...x,
				opponent: { ...x.opponent, id: '' }
			});
			expect(early.authority.snapshot().steps).toBe(paced.authority.snapshot().steps);
		}
		expect(compared).toBe(12);
	});

	it('two games flown the same way meet the same birds on the same tiles', () => {
		const flights: Intent[] = [
			{ type: 'take-off' },
			...glides(REACH + 1),
			{ type: 'move', dir: 'down' },
			{ type: 'take-off' },
			...glides(REACH + 1)
		];
		for (const steps of [0, 7, 31, 90]) {
			const [a, b] = [flyer(team(), steps), flyer(team(), steps)];
			for (const s of [a, b]) dispatchAll(s, flights);
			expect(follows(b)).toEqual(follows(a));
		}
	});

	it('a bird met again in a game started again on the same page is another animal: its id is new', () => {
		// A flight a bird follows, then the same game picked up again by the same authority
		// (Continue after leaving, as the title does it) and flown the same way.
		let steps = 0;
		while (follows(flyerFlown(steps)).length === 0) steps++;
		const game = {
			...newGame(1, testStarter()),
			pos: SPAWN,
			facing: 'up' as const,
			steps,
			items: ['glider'],
			party: team()
		};
		const s: Session = { authority: new LocalAuthority(), events: [] };
		s.authority.subscribe((e) => s.events.push(e));
		const ids: string[] = [];
		for (let run = 0; run < 2; run++) {
			s.authority.start({ game });
			dispatchAll(s, [{ type: 'take-off' }, ...glides(REACH + 1)]);
			const state = latestBattle(s);
			expect(state.realm).toBe('air');
			ids.push(state.opponent.id);
		}
		expect(follows(s).map((e) => e.speciesId)).toEqual([
			follows(s)[0]!.speciesId,
			follows(s)[0]!.speciesId
		]);
		expect(ids[1]).not.toBe(ids[0]);
	});

	/** A flyer at `steps` with the robin in the air, held to the reach. */
	function flyerFlown(steps: number): Session {
		const s = flyer(team(), steps);
		dispatchAll(s, [{ type: 'take-off' }, ...glides(REACH + 1)]);
		return s;
	}

	it('a game saved in the air with a bird following is down where letting go would land it, the same bird’s battle under way: a reload is no escape', () => {
		let cuts = 0;
		let birds = 0;
		// Birds that notice the glider early, in the middle and over its last tiles (steps
		// 0, 4 and, past a stretch of none, 23).
		for (const steps of [0, 4, 23]) {
			const probe = flyer(team(), steps);
			dispatchAll(probe, [{ type: 'take-off' }, ...glides(REACH + 1)]);
			const [bird] = follows(probe);
			expect(bird, `a bird on step ${steps}`).toBeDefined();
			birds++;
			// Saved over the take-off tile, just before the bird noticed, as it did, and after.
			const at = [0, bird!.flown - 1, bird!.flown, bird!.flown + 1];
			for (const flown of new Set(at.filter((n) => n >= 0 && n < REACH))) {
				const a = flyer(team(), steps);
				dispatchAll(a, [{ type: 'take-off' }, ...glides(flown)]);
				const saved = throughSave(a.authority.snapshot());
				// The reload lets go: the original lets go too, and the two are the same game.
				a.authority.dispatch({ type: 'land' });
				const landedWithBird = a.events.some((e) => e.type === 'battle-started');
				expect(saved.battle !== null, `step ${steps}, cut at ${flown}`).toBe(landedWithBird);
				const b: Session = { authority: new LocalAuthority(), events: [] };
				b.authority.subscribe((e) => b.events.push(e));
				b.authority.start({ game: saved });
				expect(b.authority.snapshot()).toEqual(a.authority.snapshot());
				if (landedWithBird) {
					expect(saved.battle?.realm).toBe('air');
					expect(b.events.map((e) => e.type)).toEqual(['welcome', 'battle-started']);
					cuts++;
					// Both fight on the same: the same puzzles, hits and throws.
					for (let i = 0; i < 20; i++) {
						for (const s of [a, b]) {
							const state = latestBattle(s);
							if (state.phase.kind === 'ended') continue;
							const intent =
								state.phase.kind === 'solving'
									? { type: 'answer' as const, input: String(state.phase.puzzle.answer + (i % 2)) }
									: state.phase.kind === 'choose-animal'
										? {
												type: 'switch' as const,
												partyIndex: state.party.findIndex(
													(x) => x.hp > 0 && getAnimal(x.speciesId).realms.includes('air')
												)
											}
										: { type: 'attack' as const, attackIndex: 1, level: 1 as const };
							s.authority.dispatch({ type: 'battle', intent });
						}
					}
					expect(b.authority.snapshot()).toEqual(a.authority.snapshot());
				}
			}
		}
		expect(birds).toBe(3);
		expect(cuts).toBeGreaterThanOrEqual(8);
	});

	it('the lead in the air is the first bird standing, whoever leads on the ground; the squirrel sits it out', () => {
		for (let steps = 0; steps < 200; steps++) {
			const s = flyer([animal('squirrel'), animal('robin', 0), animal('tawny-owl')], steps);
			dispatchAll(s, [{ type: 'take-off' }, ...glides(REACH + 1)]);
			if (!follows(s).length) continue;
			const state = latestBattle(s);
			expect(state.party[state.active]!.speciesId).toBe('tawny-owl');
			return;
		}
		throw new Error('no bird in 200 flights');
	});

	it('after the battle the kid is where they came down, whoever won; a loss heals nobody, and the closing lines are the sky’s', () => {
		const outcomes = new Set<string>();
		for (let steps = 0; steps < 400 && outcomes.size < 3; steps++) {
			const s = flyer([animal('squirrel'), animal('robin', 1)], steps);
			dispatchAll(s, [{ type: 'take-off' }, ...glides(REACH + 1)]);
			if (!follows(s).length) continue;
			const down = position(s);
			const plan = ['fled', 'won', 'lost'].find((o) => !outcomes.has(o))!;
			for (let i = 0; i < 40 && latestBattle(s).phase.kind !== 'ended'; i++) {
				const state = latestBattle(s);
				const intent =
					plan === 'fled'
						? { type: 'flee' as const }
						: state.phase.kind === 'solving'
							? {
									type: 'answer' as const,
									input: String(state.phase.puzzle.answer + (plan === 'lost' ? 1 : 0))
								}
							: { type: 'attack' as const, attackIndex: 3, level: 3 as const };
				s.authority.dispatch({ type: 'battle', intent });
			}
			const state = latestBattle(s);
			if (state.phase.kind !== 'ended' || state.phase.outcome !== plan) continue;
			outcomes.add(plan);
			const message = s.events[lastIndexOf(s, 'message')];
			expect(position(s)).toEqual(down);
			if (plan === 'lost') {
				// The robin is tired, the squirrel stands: nobody healed, and on the ground the
				// squirrel can fight, so the team needs no doctor there.
				expect(message).toMatchObject({ line: { key: 'battle.closing.lost' } });
				expect(party(s)).toEqual(state.party);
				expect(party(s).map((a) => a.hp)).toEqual([getAnimal('squirrel').maxHp, 0]);
				expect(needsDoctor(party(s), 'land')).toBe(false);
			} else {
				expect(message).toMatchObject({
					line: { key: plan === 'won' ? 'battle.closing.wonAir' : 'battle.closing.fledAir' }
				});
			}
		}
		expect([...outcomes].sort()).toEqual(['fled', 'lost', 'won']);
	});

	it('birds alone, lost in the air: tired where they came down, nobody healed, the sky and the grass quiet until a doctor helps; a save made during that battle ends the same after a reload', () => {
		for (let steps = 0; steps < 400; steps++) {
			const a = flyer([animal('robin', 1)], steps);
			dispatchAll(a, [{ type: 'take-off' }, ...glides(REACH + 1)]);
			if (!follows(a).length) continue;
			const down = position(a);
			expect(latestBattle(a).realm).toBe('air');
			// Saved during the battle in the air, and picked up again in another page.
			const b: Session = { authority: new LocalAuthority(), events: [] };
			b.authority.subscribe((e) => b.events.push(e));
			b.authority.start({ game: throughSave(a.authority.snapshot()) });
			expect(latestBattle(b).realm).toBe('air');
			// Both answer wrong until the robin is tired: the same loss, the same end.
			for (const s of [a, b]) {
				for (let i = 0; i < 60 && latestBattle(s).phase.kind !== 'ended'; i++) {
					const state = latestBattle(s);
					const intent =
						state.phase.kind === 'solving'
							? { type: 'answer' as const, input: String(state.phase.puzzle.answer + 1) }
							: { type: 'attack' as const, attackIndex: 1, level: 1 as const };
					s.authority.dispatch({ type: 'battle', intent });
				}
				expect(latestBattle(s).phase).toEqual({ kind: 'ended', outcome: 'lost' });
				expect(position(s)).toEqual(down);
				expect(lastMessage(s)).toBe('battle.closing.lost');
				expect(party(s).map((x) => x.hp)).toEqual([0]);
				expect(needsDoctor(party(s), 'land')).toBe(true);
			}
			expect(b.authority.snapshot()).toEqual(a.authority.snapshot());
			// Glided back over the lake with the robin tired: no bird notices, and the reed by the
			// start meets nothing.
			a.authority.dispatch({ type: 'move', dir: 'down' });
			const from = a.events.length;
			const back = SPAWN.y - position(a).y;
			dispatchAll(a, [{ type: 'take-off' }, ...glides(back), { type: 'land' }]);
			expect(a.events.slice(from).some((e) => e.type === 'bird-follows')).toBe(false);
			expect(a.events.slice(from).some((e) => e.type === 'battle-started')).toBe(false);
			expect(position(a)).toEqual(SPAWN);
			expect(reedWalk(a, 200)).toEqual([]);
			expect(party(a).map((x) => x.hp)).toEqual([0]);
			return;
		}
		throw new Error('no bird in 400 flights');
	});

	it('in the air, the party is not the kid’s to change', () => {
		const s = flyer(team());
		dispatchAll(s, [{ type: 'take-off' }, ...glides(2)]);
		s.authority.dispatch({ type: 'party', intent: { type: 'select-lead', animalId: 'robin-19' } });
		expect(s.events.at(-1)).toMatchObject({
			type: 'party-edited',
			events: [{ type: 'rejected', reason: 'not-exploring' }]
		});
	});
});

describe('LocalAuthority: lands (#191)', () => {
	/** A save round trip, as a reload does it, the authority started with `options`. */
	function reload(s: Session, options?: LocalAuthorityOptions): Session {
		const doc = saveDocument(s.authority.snapshot(), { lineage: 't', seq: 1 });
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		const authority = new LocalAuthority(options);
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({ game: restoreGame(read.save, mint) });
		return { authority, events };
	}

	/** At the witch doctor of World 1's spawn, asking to fly to `land` and answering the fare. */
	function flyTo(s: Session, land: string, right = true): void {
		s.authority.dispatch({ type: 'interact' });
		expect(visit(s).phase.kind).toBe('choose-patient');
		doctorIntent(s, { type: 'fly', land });
		if (visit(s).phase.kind !== 'paying-fare') return;
		answerDoctor(s, right);
	}

	function travelled(s: Session): Extract<GameEvent, { type: 'travelled' }> {
		const e = s.events.at(lastIndexOf(s, 'travelled'));
		if (e?.type !== 'travelled') throw new Error('no trip');
		return e;
	}

	it('flies nowhere the build has not built: The Arctic is closed, and nothing changes', () => {
		const s = session();
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		const before = s.authority.snapshot();
		doctorIntent(s, { type: 'fly', land: 'arctic' });
		expect(visit(s).phase.kind).toBe('choose-patient');
		const last = s.events.at(-1);
		expect(last?.type === 'doctor-visit-updated' && last.events).toEqual([
			{ type: 'rejected', reason: 'land-unavailable' }
		]);
		expect(s.authority.snapshot()).toEqual(before);
		expect(welcome(s)).toMatchObject({ land: 'nordland', unlocked: ['nordland'] });
	});

	it('with `?lands`, the fare paid flies the kid to Arktis 1, its own world, with nothing of it yet', () => {
		const s = session({ lands: true, tokens: 30, items: ['axe'] });
		walkToTent(s);
		const solved = s.authority.snapshot().solved;
		const nordlandParty = party(s);
		flyTo(s, 'arctic', false);
		// A wrong fare flies nowhere.
		expect(lastIndexOf(s, 'travelled')).toBe(-1);
		expect(visit(s).phase.kind).toBe('paying-fare');
		answerDoctor(s, true);
		const trip = travelled(s);
		expect(trip).toMatchObject({
			land: 'arctic',
			world: 1,
			seed: landSeed('arctic', 1),
			firstVisit: true,
			edits: []
		});
		// The visit ended first, then the trip, then the land's own party and things: none yet.
		const at = lastIndexOf(s, 'travelled');
		expect(s.events[at - 1]?.type).toBe('doctor-visit-ended');
		expect(s.events.slice(at + 1).map((e) => e.type)).toEqual([
			'party-changed',
			'belongings-changed'
		]);
		expect(party(s)).toEqual([]);
		expect(s.events.at(-1)).toEqual({ type: 'belongings-changed', tokens: 0, items: [] });
		// Beside a witch doctor of The Arctic, facing it: the fare was a puzzle solved.
		expect(canTalkToDoctor(landSeed('arctic', 1), trip.pos, trip.facing)).toBe(true);
		expect(s.authority.snapshot()).toMatchObject({
			land: 'arctic',
			world: 1,
			solved: solved + 1,
			lands: [{ land: 'nordland', tokens: 30, items: ['axe'] }]
		});
		expect(s.authority.snapshot().lands[0]!.party).toEqual(nordlandParty);
	});

	it('in a land with nothing built (no starters), asks no starter; the witch doctor flies the kid home', () => {
		const s = session({ lands: true, tokens: 12 });
		walkToTent(s);
		flyTo(s, 'arctic');
		const there = travelled(s);
		expect(s.events.some((e) => e.type === 'starter-wanted')).toBe(false);
		// Home: the witch doctor they came down at flies them back to Nordland, as they left it.
		flyTo(s, 'nordland');
		const home = travelled(s);
		expect(home).toMatchObject({ land: 'nordland', world: 1, seed: WORLD_SEED, firstVisit: false });
		expect(canTalkToDoctor(WORLD_SEED, home.pos, home.facing)).toBe(true);
		// Back at the tent they left when The Arctic has one on its spot (The Arctic of step 4 has
		// one on every spot); else at Nordland's nearest.
		if (stepFrom(there.pos, there.facing).x === 5 && stepFrom(there.pos, there.facing).y === 7) {
			expect(stepFrom(home.pos, home.facing)).toEqual({ x: 5, y: 7 });
		}
		expect(s.authority.snapshot()).toMatchObject({ land: 'nordland', tokens: 12 });
		expect(party(s).length).toBeGreaterThan(0);
		// And walking works again.
		s.authority.dispatch({ type: 'move', dir: 'right' });
		expect(
			lastIndexOf(s, 'player-moved') > lastIndexOf(s, 'travelled') ||
				lastIndexOf(s, 'player-blocked') > lastIndexOf(s, 'travelled')
		).toBe(true);
	});

	it('a game saved in The Arctic picks up there, the lands as they were, and plays on the same', () => {
		const s = session({ lands: true, tokens: 5 });
		walkToTent(s);
		flyTo(s, 'arctic');
		const r = reload(s, { lands: true });
		expect(welcome(r)).toMatchObject({ land: 'arctic', world: 1, seed: landSeed('arctic', 1) });
		expect(r.authority.snapshot()).toEqual(s.authority.snapshot());
		// The same intents give the same events after the reload as without it.
		const intents: Intent[] = [
			{ type: 'interact' },
			{ type: 'doctor', intent: { type: 'fly', land: 'nordland' } }
		];
		const after = (x: Session) => {
			const from = x.events.length;
			for (const i of intents) x.authority.dispatch(i);
			return x.events.slice(from);
		};
		expect(after(r)).toEqual(after(s));
	});

	it('travels to another world number in The Arctic: the land stays, Nordland waits as it was left', () => {
		const s = session({ lands: true, tokens: 5 });
		walkToTent(s);
		flyTo(s, 'arctic');
		// A party of the land, as a starter pick would give (The Arctic has no starters yet).
		giveParty(s, [animal('rabbit')]);
		s.authority.dispatch({ type: 'travel', world: 5 });
		const trip = travelled(s);
		expect(trip).toMatchObject({
			land: 'arctic',
			world: 5,
			seed: landSeed('arctic', 5),
			firstVisit: true
		});
		expect(trip.pos).toEqual(spawnPoint(landSeed('arctic', 5)));
		const game = s.authority.snapshot();
		expect(game.party.map((a) => a.speciesId)).toEqual(['rabbit']);
		expect(game.lands).toMatchObject([{ land: 'nordland', tokens: 5 }]);
	});

	it('asks for a starter in a land with none of the kid’s animals, and takes only one of its starters', () => {
		// Nordland with an empty team stands in for a land just flown to: the rule is the same.
		const s = session();
		s.authority.dispatch({ type: 'pick-starter', speciesId: 'rabbit' });
		expect(s.events.at(-1)).toEqual({ type: 'starter-refused', reason: 'not-wanted' });
		giveParty(s, []);
		// While one is waited for, nothing walks, flies, travels or goes to anyone.
		const count = s.events.length;
		for (const intent of [
			{ type: 'move', dir: 'left' },
			{ type: 'move', dir: 'up' },
			{ type: 'travel', world: 5 },
			{ type: 'take-off' },
			{ type: 'go-to', near: { x: 0, y: 0 } },
			{ type: 'interact' }
		] as Intent[]) {
			s.authority.dispatch(intent);
		}
		expect(s.events.length).toBe(count);
		for (const [choice, reason] of [
			[{ speciesId: 'bear' }, 'not-a-starter'],
			[{ speciesId: 7 }, 'not-a-starter'],
			[{ speciesId: 'rabbit', nickname: 3 }, 'not-text']
		] as const) {
			s.authority.dispatch({ type: 'pick-starter', ...(choice as { speciesId: string }) });
			expect(s.events.at(-1)).toEqual({ type: 'starter-refused', reason });
		}
		s.authority.dispatch({ type: 'pick-starter', speciesId: 'rabbit', nickname: '  Hop ' });
		const picked = party(s);
		expect(picked).toHaveLength(1);
		expect(picked[0]).toMatchObject({
			speciesId: 'rabbit',
			nickname: 'Hop',
			hp: getAnimal('rabbit').maxHp
		});
		expect(STARTERS).toContain('rabbit');
		// One pick: the next is refused, and the kid walks on.
		s.authority.dispatch({ type: 'pick-starter', speciesId: 'frog' });
		expect(s.events.at(-1)).toEqual({ type: 'starter-refused', reason: 'not-wanted' });
		s.authority.dispatch({ type: 'move', dir: 'right' });
		expect(s.events.at(-1)?.type).toMatch(/player-(moved|blocked)/);
	});

	it('says a land is unlocked at the hand-over that sets free the last kind it asked for, once', () => {
		const all = getLand('nordland').species;
		const s = session({ party: [animal('squirrel'), animal('fox')] });
		const game = s.authority.snapshot();
		s.authority.start({
			game: { ...game, seen: [...all], caught: [...all], freed: all.filter((id) => id !== 'fox') }
		});
		expect(welcome(s).unlocked).toEqual(['nordland']);
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		const fox = party(s).find((a) => a.speciesId === 'fox')!;
		doctorIntent(s, { type: 'hand-over', ids: [fox.id] });
		answerDoctor(s, true);
		const unlocked = s.events.filter((e) => e.type === 'unlocked-changed');
		expect(unlocked).toEqual([{ type: 'unlocked-changed', unlocked: ['nordland', 'arctic'] }]);
		// Right after the book that set the fox free.
		const at = lastIndexOf(s, 'unlocked-changed');
		expect(s.events[at - 1]?.type).toBe('book-changed');
		expect(s.authority.snapshot().unlocked).toEqual(['nordland', 'arctic']);
		// The witch doctor knows: The Arctic is not locked any more, only not built.
		doctorIntent(s, { type: 'fly', land: 'arctic' });
		const last = s.events.at(-1);
		expect(last?.type === 'doctor-visit-updated' && last.events).toEqual([
			{ type: 'rejected', reason: 'land-unavailable' }
		]);
	});
});

describe('LocalAuthority: lands, from the adversarial review of #196', () => {
	const length = (e: readonly string[]) => (e.length === 0 ? 0 : JSON.stringify(e).length);

	it("a tile cleared in one land keeps every land's cleared tiles within the one budget, and a reload changes nothing", () => {
		// Nordland 1 left behind holds nearly the whole budget; then a tree is chopped in Arktis 1.
		let big = WorldEdits.none;
		outer: for (let y = 0; y < 2000; y++) {
			for (let x = 0; x < 2000; x++) {
				const next = big.with({ x, y });
				if (length(next.encode()) > EDITS_BUDGET - 5) break outer;
				big = next;
			}
		}
		const seed = landSeed('arctic', 1);
		let at: GridPos | null = null;
		for (let y = -50; y < 50 && !at; y++) {
			for (let x = -50; x < 50 && !at; x++) {
				if (
					tileAtWorld(seed, x, y).kind === 'tree' &&
					isWalkable(tileAtWorld(seed, x - 1, y).kind)
				) {
					at = { x: x - 1, y };
				}
			}
		}
		const base = newGame(1, { ...testStarter(), id: 'n1' });
		const game: SavedGame = {
			...base,
			land: 'arctic',
			pos: at!,
			facing: 'right',
			items: ['axe'],
			party: [{ ...testStarter(), id: 'a1' }],
			lands: [
				{
					land: 'nordland',
					party: [{ ...testStarter(), id: 'n1' }],
					tokens: 0,
					items: [],
					worlds: [{ world: 1, pos: { x: 0, y: 0 }, facing: 'down', edits: [...big.encode()] }]
				}
			],
			unlocked: ['nordland', 'arctic']
		};
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.start({ game });
		authority.dispatch({ type: 'interact' });
		expect(events.at(-1)?.type).toBe('tile-cleared');
		const snap = authority.snapshot();
		const total =
			length(snap.edits) +
			snap.worlds.reduce((n, w) => n + length(w.edits), 0) +
			snap.lands.reduce((n, l) => n + l.worlds.reduce((m, w) => m + length(w.edits), 0), 0);
		expect(total).toBeLessThanOrEqual(EDITS_BUDGET);
		// A reload holds exactly the game as it stands: nothing more grows back.
		const read = readSave(JSON.parse(JSON.stringify(saveDocument(snap, { lineage: 'l', seq: 1 }))));
		if (!read.ok) throw new Error(read.error);
		expect(restoreGame(read.save, mint)).toEqual(snap);
	});

	it('a land unlocked at the witch doctor is open to fly to in the same visit', () => {
		const all = getLand('nordland').species;
		// Every land built (`?lands`), so only the unlock stands in the way.
		const s = session({ party: [animal('squirrel'), animal('fox')], lands: true });
		const game = s.authority.snapshot();
		s.authority.start({
			game: {
				...game,
				seen: [...all],
				caught: [...all],
				freed: all.filter((id) => id !== 'fox'),
				unlocked: ['nordland']
			}
		});
		walkToTent(s);
		s.authority.dispatch({ type: 'interact' });
		doctorIntent(s, { type: 'fly', land: 'arctic' });
		const locked = s.events.at(-1);
		expect(locked?.type === 'doctor-visit-updated' && locked.events).toEqual([
			{ type: 'rejected', reason: 'land-locked' }
		]);
		const fox = party(s).find((a) => a.speciesId === 'fox')!;
		doctorIntent(s, { type: 'hand-over', ids: [fox.id] });
		answerDoctor(s, true);
		expect(s.authority.snapshot().unlocked).toEqual(['nordland', 'arctic']);
		// Asked before the hand-over, it was locked; now the fare is asked.
		doctorIntent(s, { type: 'fly', land: 'arctic' });
		expect(visit(s).phase.kind).toBe('paying-fare');
		expect(visit(s).unlocked).toEqual(['nordland', 'arctic']);
	});
});
