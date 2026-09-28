import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import {
	ATTACK_LEVELS,
	type AnimalInstance,
	type AttackLevel,
	type Realm
} from '../src/animals/types.js';
import { catchProbability } from '../src/battle/catch.js';
import { attackDamage } from '../src/battle/damage.js';
import {
	WILD_MISS_CHANCE,
	activeAnimal,
	applyBattleIntent,
	canSwitchTo,
	startBattle
} from '../src/battle/reducer.js';
import type { BattleEvent, BattleIntent, BattleState, BattleStep } from '../src/battle/types.js';
import { landHit } from '../src/index.js';
import { puzzleDifficulty } from '../src/puzzles/difficulty.js';
import { checkAnswer, getGenerator } from '../src/puzzles/registry.js';
import { Rng, hashInts } from '../src/rng.js';
import { wordedStrings } from './words.js';
import {
	arena,
	makeParty,
	makeWild,
	nextIntent,
	others,
	playBattle,
	type PlayerModel
} from './battle-sim.js';

const SEEDS = 25;
/** About how many battles the catalog sweep plays for each species, over every animal it meets. */
const BATTLES_PER_SPECIES = 60;
const ids = ANIMALS.map((a) => a.id);
const PRINT = Boolean(process.env.SIM);
/** Every (player, wild) pair of the catalog that can meet, and where: a sea animal only out on the water. */
const MEETINGS = ids.flatMap((p) =>
	ids.flatMap((w) => {
		const realm = arena(p, w);
		return realm ? [{ p, w, realm }] : [];
	})
);

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
	}
	return value;
}

function outcome(state: BattleState): string | null {
	return state.phase.kind === 'ended' ? state.phase.outcome : null;
}

function maxHp(animal: AnimalInstance): number {
	return getAnimal(animal.speciesId).maxHp;
}

/** Drive a battle with a scripted player, calling `check` on every accepted step. */
function drive(
	seed: number,
	party: readonly AnimalInstance[],
	wild: AnimalInstance,
	script: (state: BattleState) => BattleIntent | null,
	check?: (before: BattleState, intent: BattleIntent, step: BattleStep) => void,
	realm: Realm = 'land'
): { state: BattleState; events: BattleEvent[] } {
	let state = startBattle(party, wild, { realm });
	const events: BattleEvent[] = [];
	for (let i = 0; i < 2000; i++) {
		const intent = script(state);
		if (!intent) break;
		deepFreeze(state);
		const step = applyBattleIntent(state, intent, seed);
		check?.(state, intent, step);
		events.push(...step.events);
		state = step.state;
	}
	return { state, events };
}

/** Pick an attack, then answer it (correctly unless told otherwise). Two intents. */
function attackAndAnswer(
	state: BattleState,
	seed: number,
	attackIndex: number,
	level: AttackLevel,
	correct = true
): BattleStep {
	const solving = applyBattleIntent(state, { type: 'attack', attackIndex, level }, seed).state;
	if (solving.phase.kind !== 'solving') throw new Error('attack was rejected');
	const answer = solving.phase.puzzle.answer;
	return applyBattleIntent(
		solving,
		{ type: 'answer', input: String(correct ? answer : 'x') },
		seed
	);
}

describe('startBattle', () => {
	it('puts the first conscious party member in front and copies its inputs', () => {
		const party = makeParty(['squirrel', 'rabbit', 'fox']);
		party[0]!.hp = 0;
		const wild = makeWild('deer', 30);
		const state = startBattle(party, wild);
		expect(state.active).toBe(1);
		expect(activeAnimal(state)).toEqual(party[1]);
		expect(state.phase).toEqual({ kind: 'choose-action' });
		expect(state.turn).toBe(1);
		expect(state.step).toBe(0);
		expect(state.leashQuality).toBe(1);
		expect(state.party).not.toBe(party);
		expect(state.opponent).not.toBe(wild);
		wild.hp = 1;
		party[1]!.hp = 1;
		expect(state.opponent.hp).toBe(30);
		expect(activeAnimal(state).hp).toBe(22);
	});

	it('carries no seed: nothing in the state lets a client predict a roll', () => {
		expect(Object.keys(startBattle(makeParty(['squirrel']), makeWild('fox')))).not.toContain(
			'seed'
		);
	});

	it('refuses a battle that cannot be fought', () => {
		expect(() => startBattle([], makeWild('fox'))).toThrow(/empty/);
		const tired = makeParty(['squirrel', 'rabbit']).map((a) => ({ ...a, hp: 0 }));
		expect(() => startBattle(tired, makeWild('fox'))).toThrow(/knocked out/);
		expect(() => startBattle(makeParty(['squirrel']), makeWild('fox', 0))).toThrow(/knocked out/);
		expect(() => startBattle(makeParty(['dragon']), makeWild('fox'))).toThrow(/Unknown animal/);
		expect(() => startBattle(makeParty(['squirrel']), makeWild('fox', 36))).toThrow(/hp 36/);
		expect(() => startBattle(makeParty(['squirrel']), makeWild('fox', -1))).toThrow(/hp -1/);
		expect(() => startBattle(makeParty(['squirrel']), makeWild('fox', 1.5))).toThrow(/hp 1.5/);
		expect(() =>
			startBattle(makeParty(['squirrel']), makeWild('fox'), { leashQuality: 0 })
		).toThrow(/leashQuality/);
	});

	it('refuses two animals with the same id, in the party or against it', () => {
		const sq = makeParty(['squirrel'])[0]!;
		expect(() => startBattle([sq, sq], makeWild('bear'))).toThrow(/share the id/);
		expect(() => startBattle([sq, { ...sq, hp: 5 }], makeWild('bear'))).toThrow(/share the id/);
		expect(() => startBattle([sq], { ...sq })).toThrow(/share the id/);
	});
});

describe('applyBattleIntent', () => {
	it('insists on a 32-bit unsigned integer seed', () => {
		const start = startBattle(makeParty(['squirrel']), makeWild('fox'));
		const flee: BattleIntent = { type: 'flee' };
		for (const seed of [-1, 1.5, NaN, 2 ** 32, Infinity]) {
			expect(() => applyBattleIntent(start, flee, seed), String(seed)).toThrow(/seed/);
		}
		for (const seed of [0, 1, 0xffffffff])
			expect(outcome(applyBattleIntent(start, flee, seed).state)).toBe('fled');
	});

	it('rejects a missing intent instead of throwing', () => {
		const start = deepFreeze(startBattle(makeParty(['squirrel']), makeWild('fox')));
		for (const bad of [undefined, null, 42, 'flee']) {
			const step = applyBattleIntent(start, bad as unknown as BattleIntent, 1);
			expect(step.state).toBe(start);
			expect(step.events).toEqual([{ type: 'rejected', reason: 'not-an-intent' }]);
		}
	});
});

describe('replay', () => {
	it('the same seed, party, wild and intents always yield the same states and events', () => {
		const model: PlayerModel = { accuracy: 0.6, policy: 'random', leash: 0.1 };
		for (const { p, w, realm } of MEETINGS) {
			for (let seed = 0; seed < 5; seed++) {
				const play = () =>
					playBattle(seed, makeParty([p, 'squirrel']), makeWild(w), model, undefined, 2000, realm);
				const a = play();
				const b = play();
				expect(b.intents).toEqual(a.intents);
				expect(b.events).toEqual(a.events);
				expect(b.state).toEqual(a.state);
			}
		}
		// About 0.55 s alone (620 battles, each played twice); 2 s at a load average of 40.
	}, 30_000);

	it('a different seed changes the battle', () => {
		const model: PlayerModel = { accuracy: 1, policy: 'max' };
		const prompts = new Set<string>();
		for (let seed = 0; seed < SEEDS; seed++) {
			const { events } = playBattle(seed, makeParty(['fox']), makeWild('fox'), model);
			const shown = events.find((e) => e.type === 'puzzle-shown');
			if (shown?.type === 'puzzle-shown') prompts.add(shown.puzzle.prompt);
		}
		expect(prompts.size).toBeGreaterThan(1);
	});

	it('the leash quality is part of the replay, not of the seed', () => {
		// Same seed and roll; a better leash turns a miss into a catch for some seed.
		let diverged = false;
		for (let seed = 0; seed < 200 && !diverged; seed++) {
			const weak = startBattle(makeParty(['fox']), makeWild('bear', 10));
			const strong = startBattle(makeParty(['fox']), makeWild('bear', 10), { leashQuality: 3 });
			const a = outcome(applyBattleIntent(weak, { type: 'throw-leash' }, seed).state);
			const b = outcome(applyBattleIntent(strong, { type: 'throw-leash' }, seed).state);
			if (a !== b) {
				expect(a).toBeNull();
				expect(b).toBe('caught');
				diverged = true;
			}
		}
		expect(diverged).toBe(true);
	});

	it('golden: squirrel + rabbit vs a wild fox, seed 2024', () => {
		// Attack 2 at level 3 every round, wrong on every third answer, one leash
		// throw on round 3; the rabbit steps in when the squirrel is tired.
		let answers = 0;
		const steps: string[] = [];
		const { state, events } = drive(
			2024,
			makeParty(['squirrel', 'rabbit']),
			makeWild('fox'),
			(s) => {
				if (s.phase.kind === 'ended') return null;
				if (s.phase.kind === 'choose-animal') return { type: 'switch', partyIndex: 1 };
				if (s.phase.kind === 'solving') {
					const a = s.phase.puzzle.answer;
					return { type: 'answer', input: String(answers++ % 3 === 1 ? a + 1 : a) };
				}
				if (s.turn === 3) return { type: 'throw-leash' };
				return { type: 'attack', attackIndex: 2, level: 3 };
			},
			(_, intent, step) =>
				steps.push(`${intent.type} → ${step.state.phase.kind}: ${step.events.map((e) => e.type)}`)
		);

		// The squirrel's knock-out ends the round in choose-animal; the rabbit's
		// entrance is its own intent, and a free one: no wild reply follows it.
		expect(steps.slice(4, 6)).toEqual([
			'throw-leash → choose-animal: leash-thrown,hit,fainted',
			'switch → choose-action: switched'
		]);
		expect(events.map((e) => e.type)).toEqual([
			'puzzle-shown',
			'answer-judged',
			'hit',
			'hit',
			'puzzle-shown',
			'answer-judged',
			'missed',
			'hit',
			'leash-thrown',
			'hit',
			'fainted',
			'switched',
			'puzzle-shown',
			'answer-judged',
			'hit',
			'hit',
			'puzzle-shown',
			'answer-judged',
			'hit',
			'fainted',
			'ended'
		]);
		expect(events.filter((e) => e.type === 'hit' || e.type === 'leash-thrown')).toEqual([
			{ type: 'hit', attacker: 'player', attackIndex: 2, level: 3, damage: 14, targetHp: 21 },
			{ type: 'hit', attacker: 'opponent', attackIndex: 3, level: 1, damage: 12, targetHp: 8 },
			{ type: 'hit', attacker: 'opponent', attackIndex: 1, level: 1, damage: 6, targetHp: 2 },
			{ type: 'leash-thrown', chance: catchProbability(21 / 35, 0.6), success: false },
			{ type: 'hit', attacker: 'opponent', attackIndex: 1, level: 1, damage: 6, targetHp: 0 },
			{ type: 'hit', attacker: 'player', attackIndex: 2, level: 3, damage: 14, targetHp: 7 },
			{ type: 'hit', attacker: 'opponent', attackIndex: 2, level: 1, damage: 9, targetHp: 13 },
			{ type: 'hit', attacker: 'player', attackIndex: 2, level: 3, damage: 14, targetHp: 0 }
		]);
		expect(state).toEqual({
			step: 10,
			turn: 5,
			active: 1,
			leashQuality: 1,
			party: [
				{ id: 'squirrel-0', speciesId: 'squirrel', hp: 0 },
				{ id: 'rabbit-1', speciesId: 'rabbit', hp: 13 }
			],
			opponent: { id: 'wild-fox', speciesId: 'fox', hp: 0 },
			realm: 'land',
			phase: { kind: 'ended', outcome: 'won' }
		});
	});
});

describe('every battle in the catalog', () => {
	// A shaky player who sometimes throws the leash, sometimes switches animals
	// (and picks a random one to replace a tired one) and, rarely, runs — so
	// every branch of the reducer is walked for every species pair.
	const model: PlayerModel = {
		accuracy: 0.6,
		policy: 'random',
		leash: 0.15,
		flee: 0.02,
		switch: 0.15
	};
	const seen = new Set<string>();
	let switches = 0;
	let replacements = 0;

	for (const p of ids) {
		it(`${p} vs everything it meets: terminates, keeps HP in bounds, never mutates its input, explains every change`, () => {
			const meetings = MEETINGS.filter((m) => m.p === p);
			// About `BATTLES_PER_SPECIES` battles for each species, spread over every animal it
			// meets (a few seeds each, never fewer than 3): the sweep grows with the catalog
			// instead of with its square. With the 14 animals before #89 this was 25 seeds a pair.
			const seeds = Math.max(3, Math.ceil(BATTLES_PER_SPECIES / meetings.length));
			for (const { w, realm } of meetings) {
				// On land two to step in; out on the water one that swims and one that can't.
				const team = realm === 'land' ? [p, 'rabbit', 'fox'] : [p, 'otter', 'squirrel'];
				for (let seed = 0; seed < seeds; seed++) {
					// The player's choices drawn afresh for every pair, not only every seed: with a
					// few seeds a pair, shared streams would walk the same few choices everywhere.
					const rng = new Rng(hashInts(seed, 0x9e3779b9, ids.indexOf(p), ids.indexOf(w)));
					const said: BattleEvent[] = [];
					const { state } = drive(
						seed,
						makeParty(team),
						makeWild(w),
						(s) => nextIntent(s, model, rng),
						(before, intent, step) => {
							checkStep(seed)(before, intent, step);
							said.push(...step.events);
							if (intent.type !== 'switch') return;
							if (before.phase.kind === 'choose-animal') replacements++;
							else switches++;
						},
						realm
					);
					expect(state.phase.kind, `${p} vs ${w} seed ${seed} never ended`).toBe('ended');
					seen.add(outcome(state)!);
					// Nothing the engine sends is worded: the client words it (DECISIONS § Copy and languages).
					expect(wordedStrings({ state, said }), `${p} vs ${w} seed ${seed}`).toEqual([]);
				}
			}
			// 0.3 to 1.5 s per species at a load average of 28 (about 80 battles each, every
			// step checked). At 25 seeds a pair, before #89, one took 1.2 to 3.4 s alone and the
			// frog's 40 s at a load average of 54: two minutes leaves that room.
		}, 120_000);
	}

	it('reached every outcome, and switched both ways', () => {
		expect([...seen].sort()).toEqual(['caught', 'fled', 'lost', 'won']);
		expect(switches).toBeGreaterThan(100);
		expect(replacements).toBeGreaterThan(100);
	});

	function checkStep(seed: number) {
		return (before: BattleState, intent: BattleIntent, step: BattleStep): void => {
			const { state, events } = step;
			const where = `${intent.type} at step ${before.step}`;

			// Accepted: a new state, one step on, and every event is a real one.
			expect(state, where).not.toBe(before);
			expect(state.step).toBe(before.step + 1);
			expect(events.length).toBeGreaterThan(0);
			expect(
				events.some((e) => e.type === 'rejected'),
				where
			).toBe(false);

			// HP stays a whole number in [0, maxHp] on both sides.
			for (const a of [...state.party, state.opponent]) {
				expect(Number.isInteger(a.hp), where).toBe(true);
				expect(a.hp, where).toBeGreaterThanOrEqual(0);
				expect(a.hp, where).toBeLessThanOrEqual(maxHp(a));
			}

			// Party membership never changes mid-battle; only HP does.
			expect(state.party.map((a) => a.id)).toEqual(before.party.map((a) => a.id));
			expect(state.opponent.id).toBe(before.opponent.id);

			// Replay each event against the states around it.
			let playerHp = activeAnimal(before).hp;
			let oppHp = before.opponent.hp;
			let active = before.active;
			/** Party members the wild animal hit in this step: nobody else's HP may change. */
			const struck = new Set<number>();
			for (let i = 0; i < events.length; i++) {
				const e = events[i]!;
				const next = events[i + 1];
				switch (e.type) {
					case 'puzzle-shown': {
						expect(intent.type).toBe('attack');
						const spec = getAnimal(activeAnimal(before).speciesId);
						const attack = spec.attacks[e.attackIndex - 1]!;
						expect(attack.kinds).toContain(e.puzzle.kind);
						const wanted = puzzleDifficulty(spec.tier, e.attackIndex, e.level);
						const supported = attack.kinds.some((k) => {
							const g = getGenerator(k);
							return wanted >= g.minDifficulty && wanted <= g.maxDifficulty;
						});
						if (supported) expect(e.puzzle.difficulty).toBe(wanted);
						expect(state.phase).toEqual({
							kind: 'solving',
							attackIndex: e.attackIndex,
							level: e.level,
							puzzle: e.puzzle
						});
						break;
					}
					case 'answer-judged': {
						expect(intent.type).toBe('answer');
						if (before.phase.kind !== 'solving' || intent.type !== 'answer') throw new Error(where);
						expect(e.answer).toBe(before.phase.puzzle.answer);
						expect(e.correct).toBe(checkAnswer(before.phase.puzzle, intent.input));
						expect(next?.type).toBe(e.correct ? 'hit' : 'missed');
						break;
					}
					case 'hit': {
						if (e.attacker === 'player') {
							if (before.phase.kind !== 'solving') throw new Error(where);
							const spec = getAnimal(activeAnimal(before).speciesId);
							expect(e.attackIndex).toBe(before.phase.attackIndex);
							expect(e.level).toBe(before.phase.level);
							expect(e.damage).toBe(attackDamage(spec, e.attackIndex, e.level, true));
							expect(e.damage).toBeGreaterThan(0);
							oppHp = Math.max(0, oppHp - e.damage);
							expect(e.targetHp).toBe(oppHp);
						} else {
							const spec = getAnimal(before.opponent.speciesId);
							expect(e.level).toBe(1);
							expect(e.attackIndex).toBeGreaterThanOrEqual(1);
							expect(e.attackIndex).toBeLessThanOrEqual(spec.attacks.length);
							expect(e.damage).toBe(spec.attacks[e.attackIndex - 1]!.power);
							playerHp = Math.max(0, playerHp - e.damage);
							expect(e.targetHp).toBe(playerHp);
							expect(state.party[active]!.hp).toBe(playerHp);
							struck.add(active);
						}
						break;
					}
					case 'missed':
						if (e.attacker === 'player') {
							expect(oppHp).toBe(before.opponent.hp);
						} else {
							// The wild animal only misses an animal of its own tier or fiercer.
							const spec = getAnimal(before.opponent.speciesId);
							const target = getAnimal(state.party[active]!.speciesId);
							expect(spec.tier).toBeLessThanOrEqual(target.tier);
							expect(e.level).toBe(1);
							expect(e.attackIndex).toBeGreaterThanOrEqual(1);
							expect(e.attackIndex).toBeLessThanOrEqual(spec.attacks.length);
							expect(state.party[active]!.hp).toBe(playerHp);
							expect(next).toBeUndefined();
						}
						break;
					case 'fainted':
						if (e.side === 'opponent') {
							expect(oppHp).toBe(0);
							expect(e.animal.hp).toBe(0);
							expect(next).toEqual({ type: 'ended', outcome: 'won' });
						} else {
							expect(playerHp).toBe(0);
							expect(e.animal).toEqual({ ...before.party[active], hp: 0 });
							// Nobody left: lost. Otherwise the player picks who steps in.
							if (next) {
								expect(next).toEqual({ type: 'ended', outcome: 'lost' });
							} else {
								expect(state.phase).toEqual({ kind: 'choose-animal' });
								expect(state.party.some((a) => a.hp > 0)).toBe(true);
							}
						}
						break;
					case 'switched': {
						// Only a switch intent switches, first thing in its step, to whom it named.
						if (intent.type !== 'switch') throw new Error(`${where}: switched`);
						expect(i).toBe(0);
						expect(e.partyIndex).toBe(intent.partyIndex);
						expect(e.partyIndex).not.toBe(before.active);
						expect(before.party[e.partyIndex]!.hp).toBeGreaterThan(0);
						expect(e.animal).toEqual(before.party[e.partyIndex]);
						active = e.partyIndex;
						playerHp = e.animal.hp;
						if (before.phase.kind === 'choose-animal') {
							// Replacing a tired animal is free: the player chooses next.
							expect(next).toBeUndefined();
							expect(state.phase).toEqual({ kind: 'choose-action' });
						} else {
							// Otherwise the switch is the turn: the wild animal replies.
							expect(before.phase).toEqual({ kind: 'choose-action' });
							expect(['hit', 'missed']).toContain(next?.type);
							expect(next).toMatchObject({ attacker: 'opponent' });
						}
						break;
					}
					case 'leash-thrown': {
						expect(intent.type).toBe('throw-leash');
						const spec = getAnimal(before.opponent.speciesId);
						expect(e.chance).toBe(
							catchProbability(before.opponent.hp / spec.maxHp, spec.catchRate, before.leashQuality)
						);
						expect(e.success).toBe(new Rng(hashInts(seed, before.step)).next() < e.chance);
						if (e.success) {
							expect(next).toEqual({ type: 'ended', outcome: 'caught', caught: before.opponent });
						} else {
							expect(['hit', 'missed']).toContain(next?.type);
							expect(next).toMatchObject({ attacker: 'opponent' });
						}
						break;
					}
					case 'fled':
						expect(intent.type).toBe('flee');
						expect(next).toEqual({ type: 'ended', outcome: 'fled' });
						expect(state.party).toEqual(before.party);
						expect(state.opponent).toEqual(before.opponent);
						break;
					case 'ended':
						expect(next).toBeUndefined();
						expect(state.phase).toEqual({ kind: 'ended', outcome: e.outcome });
						// Lost: everyone who could fight here is tired (out on the water, the ones that swim).
						if (e.outcome === 'lost')
							for (const a of state.party)
								if (canFightIn(a.speciesId, state.realm)) expect(a.hp).toBe(0);
						if (e.outcome === 'won') expect(state.opponent.hp).toBe(0);
						if (e.outcome === 'caught') {
							expect(e.caught?.hp).toBeGreaterThan(0);
							expect(e.caught).toEqual(state.opponent);
						}
						break;
					case 'rejected':
						throw new Error(`${where}: rejected`);
				}
			}
			expect(state.opponent.hp).toBe(oppHp);
			expect(state.active).toBe(active);
			expect(activeAnimal(state).hp).toBe(playerHp);
			// HP changes only where the events say: a switch, or anything else,
			// never touches a party member the wild animal did not hit.
			state.party.forEach((a, i) => {
				if (!struck.has(i)) expect(a.hp, `${where}: party ${i}`).toBe(before.party[i]!.hp);
			});

			// The round counter advances exactly when the wild animal's turn ended without ending the battle.
			const wildActed = events.some(
				(e) => (e.type === 'hit' || e.type === 'missed') && e.attacker === 'opponent'
			);
			expect(state.turn).toBe(before.turn + (wildActed && state.phase.kind !== 'ended' ? 1 : 0));
		};
	}
});

describe('answers', () => {
	it('a wrong answer never damages the opponent, whatever the input', () => {
		for (const { p, w, realm } of MEETINGS) {
			for (let seed = 0; seed < 5; seed++) {
				const rng = new Rng(seed);
				const n = rng.int(1, getAnimal(p).attacks.length);
				const level = rng.int(1, 3) as AttackLevel;
				const start = startBattle(makeParty([p]), makeWild(w), { realm });
				const solving = applyBattleIntent(
					start,
					{ type: 'attack', attackIndex: n, level },
					seed
				).state;
				if (solving.phase.kind !== 'solving') throw new Error('not solving');
				const answer = solving.phase.puzzle.answer;
				for (const input of [
					'',
					'nope',
					String(answer + 1),
					String(answer - 1),
					'1.5',
					`${answer} ${answer}`
				]) {
					const { state, events } = applyBattleIntent(
						deepFreeze(solving),
						{ type: 'answer', input },
						seed
					);
					expect(state.opponent.hp).toBe(solving.opponent.hp);
					expect(events[0]).toEqual({ type: 'answer-judged', input, correct: false, answer });
					expect(events[1]).toEqual({
						type: 'missed',
						attacker: 'player',
						attackIndex: n,
						level
					});
					expect(events.some((e) => e.type === 'hit' && e.attacker === 'player')).toBe(false);
					// The wild animal still takes its turn: it hits, or misses a wary match.
					expect(events[2]).toMatchObject({ attacker: 'opponent' });
				}
			}
		}
		// About 0.5 s alone (3,720 wrong answers); 1.4 s at a load average of 40.
	}, 30_000);

	it('a correct answer always deals exactly the formula damage, for every attack and level', () => {
		for (const p of ids) {
			const spec = getAnimal(p);
			for (let n = 1; n <= spec.attacks.length; n++) {
				for (const level of ATTACK_LEVELS) {
					for (let seed = 0; seed < 5; seed++) {
						// A 100-HP opponent it can meet: the bear, or out on the water the whale.
						const big = arena(p, 'bear') ? 'bear' : 'whale';
						const start = startBattle(makeParty([p]), makeWild(big), { realm: arena(p, big)! });
						const solving = applyBattleIntent(
							start,
							{ type: 'attack', attackIndex: n, level },
							seed
						).state;
						if (solving.phase.kind !== 'solving') throw new Error('not solving');
						const answer = solving.phase.puzzle.answer;
						const damage = attackDamage(spec, n, level, true);
						for (const input of [String(answer), ` ${answer} `, `+${answer}`]) {
							const { state, events } = applyBattleIntent(
								deepFreeze(solving),
								{ type: 'answer', input },
								seed
							);
							expect(events[0]).toEqual({ type: 'answer-judged', input, correct: true, answer });
							expect(events[1]).toEqual({
								type: 'hit',
								attacker: 'player',
								attackIndex: n,
								level,
								damage,
								targetHp: 100 - damage
							});
							expect(state.opponent.hp).toBe(100 - damage);
							expect(state.opponent.hp).toBeLessThan(solving.opponent.hp);
						}
					}
				}
			}
		}
	});

	it('landHit, as a screen previews a hit, is exactly the hit a right answer lands, a knock-out included', () => {
		// The battle panel shows the damage, the HP bar's lighter segment and "That
		// would tire it out!" from the public `landHit` on the state on screen,
		// before a pick; the reducer must land exactly that, for every attack at
		// every level, against a wild animal at full HP and at every HP round the hit.
		const bad: string[] = [];
		for (const p of ids) {
			const spec = getAnimal(p);
			const big = arena(p, 'bear') ? 'bear' : 'whale';
			for (let n = 1; n <= spec.attacks.length; n++) {
				for (const level of ATTACK_LEVELS) {
					const damage = attackDamage(spec, n, level, true);
					const hps = [100, damage + 1, damage, damage - 1, 1].filter((hp) => hp > 0 && hp <= 100);
					for (const hp of hps) {
						const start = startBattle(makeParty([p]), makeWild(big, hp), { realm: arena(p, big)! });
						const preview = landHit(spec, n, level, start.opponent);
						const { state, events } = attackAndAnswer(start, 7, n, level);
						const hit = events.find((e) => e.type === 'hit' && e.attacker === 'player');
						const tired = events.some((e) => e.type === 'fainted' && e.side === 'opponent');
						const got = hit?.type === 'hit' ? `${hit.damage} to ${hit.targetHp}` : 'no hit';
						const want = `${preview.damage} to ${preview.target.hp}`;
						if (got !== want)
							bad.push(`${p} ${n}/${level} at ${hp}: landed ${got}, previewed ${want}`);
						if (tired !== (preview.target.hp === 0) || (outcome(state) === 'won') !== tired) {
							bad.push(
								`${p} ${n}/${level} at ${hp}: tired ${tired}, previewed ${preview.target.hp}`
							);
						}
					}
				}
			}
		}
		expect(bad).toEqual([]);
	});
});

describe('the wild animal', () => {
	/** The wild animal's one action after a wrong answer: a hit or a miss. */
	function wildTurn(p: string, w: string, seed: number) {
		const start = startBattle(makeParty([p]), makeWild(w), { realm: arena(p, w)! });
		const { state, events } = attackAndAnswer(start, seed, 1, 1, false);
		const turn = events.filter(
			(e) => (e.type === 'hit' || e.type === 'missed') && e.attacker === 'opponent'
		);
		expect(turn, `${p} vs ${w}, seed ${seed}`).toHaveLength(1);
		const e = turn[0]!;
		if (e.type !== 'hit' && e.type !== 'missed') throw new Error('not a turn');
		return { e, start, state };
	}

	it('picks each of its attacks equally often and hits for its level-1 power', () => {
		const spec = getAnimal('bear');
		const picks = new Array(spec.attacks.length).fill(0);
		const runs = 2000;
		for (let seed = 0; seed < runs; seed++) {
			const { e } = wildTurn('bear', 'bear', seed);
			if (e.type === 'hit') expect(e.damage).toBe(spec.attacks[e.attackIndex - 1]!.power);
			expect(e.level).toBe(1);
			picks[e.attackIndex - 1]++;
		}
		for (const count of picks) expect(count / runs).toBeCloseTo(1 / spec.attacks.length, 1);
	});

	it('misses an animal of its own tier or fiercer exactly when its roll says so, never a smaller one', () => {
		// Recomputed from the seed: the attack pick, then the miss roll, are the
		// wild turn's two draws from the answer intent's Rng (step 1). Every pair that can
		// meet, 40 seeds each: the findings are collected and checked once, since an
		// `expect` per turn costs more than the turn (58,000 turns with #89's 41 animals).
		const bad: string[] = [];
		let misses = 0;
		for (const { p, w, realm } of MEETINGS) {
			const wary = getAnimal(w).tier <= getAnimal(p).tier;
			for (let seed = 0; seed < 40; seed++) {
				const start = startBattle(makeParty([p]), makeWild(w), { realm });
				const { state, events } = attackAndAnswer(start, seed, 1, 1, false);
				const turn = events.filter(
					(e) => (e.type === 'hit' || e.type === 'missed') && e.attacker === 'opponent'
				);
				const where = `${p} vs ${w}, seed ${seed}`;
				const e = turn[0];
				if (turn.length !== 1 || !e || (e.type !== 'hit' && e.type !== 'missed')) {
					bad.push(`${where}: ${turn.length} wild turns`);
					continue;
				}
				const rng = new Rng(hashInts(seed, 1));
				if (e.attackIndex !== rng.int(1, getAnimal(w).attacks.length))
					bad.push(`${where}: attack ${e.attackIndex}`);
				const miss = wary && rng.next() < WILD_MISS_CHANCE;
				if (e.type !== (miss ? 'missed' : 'hit')) bad.push(`${where}: ${e.type}`);
				if (miss && state.party[0]!.hp !== start.party[0]!.hp) bad.push(`${where}: HP moved`);
				if (e.type === 'missed') misses++;
			}
		}
		expect(bad).toEqual([]);
		// The misses the rolls call for do happen, so the checks above saw both kinds of turn.
		expect(misses).toBeGreaterThan(0);
		// 0.4 s alone at a load average of 24 (58,000 turns, #89's 41 animals); asserting every
		// turn instead took over 30 s at a load average of 40.
	}, 30_000);

	it('misses a wary match about as often as WILD_MISS_CHANCE says', () => {
		let misses = 0;
		const runs = 2000;
		for (let seed = 0; seed < runs; seed++) {
			if (wildTurn('squirrel', 'rabbit', seed).e.type === 'missed') misses++;
		}
		expect(misses / runs).toBeCloseTo(WILD_MISS_CHANCE, 1);
	});

	it('judges wariness against the animal in front, turn by turn', () => {
		// A fox never misses the squirrel in front, but can miss the bear that
		// steps in once the squirrel is tired.
		let bearTurns = 0;
		let bearMisses = 0;
		for (let seed = 0; seed < 100; seed++) {
			const party = makeParty(['squirrel', 'bear']);
			party[0]!.hp = 1;
			const first = attackAndAnswer(startBattle(party, makeWild('fox')), seed, 1, 1, false);
			expect(first.events.map((e) => e.type)).toEqual([
				'answer-judged',
				'missed',
				'hit',
				'fainted'
			]);
			const bearIn = applyBattleIntent(first.state, { type: 'switch', partyIndex: 1 }, seed);
			expect(bearIn.events.map((e) => e.type)).toEqual(['switched']);
			let state = bearIn.state;
			for (let turn = 0; turn < 5; turn++) {
				expect(activeAnimal(state).speciesId).toBe('bear');
				const step = attackAndAnswer(state, seed, 1, 1, false);
				const wild = step.events.find((e) => e.type !== 'answer-judged' && e.type !== 'missed');
				const missed = step.events.filter((e) => e.type === 'missed' && e.attacker === 'opponent');
				bearTurns++;
				bearMisses += missed.length;
				if (missed.length === 0) expect(wild).toMatchObject({ type: 'hit', attacker: 'opponent' });
				state = step.state;
			}
		}
		expect(bearMisses / bearTurns).toBeCloseTo(WILD_MISS_CHANCE, 1);
	});
});

describe('the leash', () => {
	it('catches exactly when the roll beats catchProbability, and ends the battle with the animal', () => {
		for (const w of ids) {
			const spec = getAnimal(w);
			for (const hp of [1, Math.ceil(spec.maxHp * 0.1), Math.ceil(spec.maxHp * 0.5), spec.maxHp]) {
				for (let seed = 0; seed < SEEDS; seed++) {
					// A fox on land; out on the water, where the sea animals are, an otter.
					const p = arena('fox', w) ? 'fox' : 'otter';
					const realm = arena(p, w)!;
					const start = deepFreeze(startBattle(makeParty([p]), makeWild(w, hp), { realm }));
					const { state, events } = applyBattleIntent(start, { type: 'throw-leash' }, seed);
					const chance = catchProbability(hp / spec.maxHp, spec.catchRate, 1);
					const success = new Rng(hashInts(seed, 0)).next() < chance;
					expect(events[0]).toEqual({ type: 'leash-thrown', chance, success });
					expect(state.opponent).toEqual(start.opponent);
					if (success) {
						expect(events[1]).toEqual({ type: 'ended', outcome: 'caught', caught: start.opponent });
						expect(events).toHaveLength(2);
						expect(outcome(state)).toBe('caught');
						expect(state.party).toEqual(start.party);
					} else {
						// A failed throw hands the turn to the wild animal.
						expect(['hit', 'missed']).toContain(events[1]?.type);
						expect(events[1]).toMatchObject({ attacker: 'opponent' });
						expect(outcome(state)).toBeNull();
					}
				}
			}
		}
		// About 0.25 s alone (1,400 throws); 0.35 s at a load average of 40.
	}, 30_000);

	it('a better leash raises the chance', () => {
		const start = startBattle(makeParty(['fox']), makeWild('bear', 10), { leashQuality: 2 });
		const { events } = applyBattleIntent(start, { type: 'throw-leash' }, 3);
		expect(events[0]).toMatchObject({
			type: 'leash-thrown',
			chance: catchProbability(0.1, 0.2, 2)
		});
	});

	it('lands about as often as the formula says', () => {
		const runs = 2000;
		let caught = 0;
		for (let seed = 0; seed < runs; seed++) {
			const start = startBattle(makeParty(['fox']), makeWild('squirrel', 2));
			if (outcome(applyBattleIntent(start, { type: 'throw-leash' }, seed).state) === 'caught')
				caught++;
		}
		expect(caught / runs).toBeCloseTo(catchProbability(0.1, 0.9), 1);
	});
});

describe('fleeing', () => {
	it('always works and costs nothing', () => {
		for (const w of ids) {
			for (let seed = 0; seed < 5; seed++) {
				const p = arena('squirrel', w) ? 'squirrel' : 'frog';
				const realm = arena(p, w)!;
				const start = deepFreeze(startBattle(makeParty([p]), makeWild(w), { realm }));
				const { state, events } = applyBattleIntent(start, { type: 'flee' }, seed);
				expect(events).toEqual([{ type: 'fled' }, { type: 'ended', outcome: 'fled' }]);
				expect(outcome(state)).toBe('fled');
				expect(state.party).toEqual(start.party);
				expect(state.opponent).toEqual(start.opponent);
			}
		}
	});
});

describe('knock-outs', () => {
	it('the player picks who steps in, for free, and then chooses an action', () => {
		const party = makeParty(['squirrel', 'rabbit', 'fox', 'otter']);
		party[0]!.hp = 1;
		party[1]!.hp = 0;
		const { state, events } = attackAndAnswer(startBattle(party, makeWild('bear')), 1, 1, 1, false);
		expect(events.map((e) => e.type)).toEqual(['answer-judged', 'missed', 'hit', 'fainted']);
		// The round is over; the tired squirrel stays in front until the player picks.
		expect(state.phase).toEqual({ kind: 'choose-animal' });
		expect(state.active).toBe(0);
		expect(state.turn).toBe(2);
		expect(state.party.map((a) => a.hp)).toEqual([0, 0, 35, 32]);
		expect(events.at(-1)).toEqual({ type: 'fainted', side: 'player', animal: state.party[0] });

		// Not the first standing one in party order: the otter, because the player says so.
		const picked = applyBattleIntent(deepFreeze(state), { type: 'switch', partyIndex: 3 }, 1);
		expect(picked.events).toEqual([{ type: 'switched', animal: party[3], partyIndex: 3 }]);
		expect(picked.state.active).toBe(3);
		expect(picked.state.phase).toEqual({ kind: 'choose-action' });
		expect(picked.state.turn).toBe(2);
		expect(picked.state.party).toEqual(state.party);
		expect(picked.state.opponent).toEqual(state.opponent);

		// While the player picks, only a switch to someone standing fits.
		for (const intent of [
			{ type: 'attack', attackIndex: 1, level: 1 },
			{ type: 'answer', input: '4' },
			{ type: 'throw-leash' },
			{ type: 'flee' },
			{ type: 'switch', partyIndex: 0 },
			{ type: 'switch', partyIndex: 1 },
			{ type: 'switch', partyIndex: 4 }
		] as BattleIntent[]) {
			const step = applyBattleIntent(state, intent, 1);
			expect(step.state, JSON.stringify(intent)).toBe(state);
			expect(step.events).toEqual([expect.objectContaining({ type: 'rejected' })]);
		}
	});

	it('the battle is lost when the last one is knocked out', () => {
		const party = makeParty(['rabbit', 'squirrel']);
		party[0]!.hp = 0;
		party[1]!.hp = 1;
		const { state, events } = attackAndAnswer(startBattle(party, makeWild('bear')), 1, 1, 1, false);
		expect(events.map((e) => e.type)).toEqual([
			'answer-judged',
			'missed',
			'hit',
			'fainted',
			'ended'
		]);
		expect(events[3]).toEqual({ type: 'fainted', side: 'player', animal: state.party[1] });
		expect(events[4]).toEqual({ type: 'ended', outcome: 'lost' });
		expect(state.party.map((a) => a.hp)).toEqual([0, 0]);
	});

	it('the opponent faints on the hit that empties its HP and the battle is won on the spot', () => {
		const start = startBattle(makeParty(['bear']), makeWild('squirrel', 3));
		const { state, events } = attackAndAnswer(start, 5, 1, 1);
		expect(events.map((e) => e.type)).toEqual(['answer-judged', 'hit', 'fainted', 'ended']);
		expect(events[1]).toMatchObject({ damage: 12, targetHp: 0 });
		expect(outcome(state)).toBe('won');
		expect(activeAnimal(state).hp).toBe(100);
		expect(state.turn).toBe(1);
	});
});

describe('on the water', () => {
	// Out on the water, from the boat, only the animals that swim fight: the
	// frog and the otter in the prototype catalog ("you can't fight on water
	// unless you have an amphibious animal"). The others sit it out in the boat.
	const swims = (a: AnimalInstance) => canFightIn(a.speciesId, 'water');

	it('sends out the first standing animal that swims, whoever is first in the party', () => {
		const party = makeParty(['squirrel', 'bear', 'frog', 'otter']);
		const state = startBattle(party, makeWild('otter'), { realm: 'water' });
		expect(state.realm).toBe('water');
		expect(state.active).toBe(2);
		party[2]!.hp = 0;
		expect(startBattle(party, makeWild('otter'), { realm: 'water' }).active).toBe(3);
		// On land, as ever, the first standing animal.
		expect(startBattle(party, makeWild('otter')).active).toBe(0);
		expect(startBattle(party, makeWild('otter')).realm).toBe('land');
	});

	it('is never started without a standing swimmer, or against an animal that cannot swim', () => {
		expect(() =>
			startBattle(makeParty(['squirrel', 'bear']), makeWild('otter'), { realm: 'water' })
		).toThrow(/knocked out/);
		const tiredFrog = makeParty(['squirrel', 'frog']);
		tiredFrog[1]!.hp = 0;
		expect(() => startBattle(tiredFrog, makeWild('otter'), { realm: 'water' })).toThrow(
			/knocked out/
		);
		expect(() =>
			startBattle(makeParty(['otter']), makeWild('squirrel'), { realm: 'water' })
		).toThrow(/can't fight on water/);
		expect(() =>
			startBattle(makeParty(['otter']), makeWild('otter'), { realm: 'lava' as 'water' })
		).toThrow(/realm/);
	});

	it('lets only a standing swimmer step in, and says why the others cannot', () => {
		const party = makeParty(['frog', 'squirrel', 'otter', 'deer']);
		const state = startBattle(party, makeWild('otter'), { realm: 'water' });
		expect(party.map((_, i) => canSwitchTo(state, i))).toEqual([false, false, true, false]);
		for (const partyIndex of [1, 3]) {
			const step = applyBattleIntent(deepFreeze(state), { type: 'switch', partyIndex }, 3);
			expect(step.state).toBe(state);
			expect(step.events).toEqual([{ type: 'rejected', reason: 'cannot-fight-here' }]);
		}
		// On land, the same party can send in anyone standing.
		const onLand = startBattle(party, makeWild('otter'));
		expect(party.map((_, i) => canSwitchTo(onLand, i))).toEqual([false, true, true, true]);
	});

	it('is lost when the last swimmer is tired, whoever is still standing in the boat', () => {
		const party = makeParty(['squirrel', 'frog', 'bear']);
		party[1]!.hp = 1;
		const start = startBattle(party, makeWild('otter'), { realm: 'water' });
		expect(start.active).toBe(1);
		// A wrong answer, and the otter's reply knocks the frog out (the frog is
		// smaller, so the otter never misses it).
		const { state, events } = attackAndAnswer(start, 1, 1, 1, false);
		expect(events.map((e) => e.type)).toEqual([
			'answer-judged',
			'missed',
			'hit',
			'fainted',
			'ended'
		]);
		expect(outcome(state)).toBe('lost');
		expect(state.party.map((a) => a.hp)).toEqual([20, 0, 100]);
	});

	it('over random battles against every water animal, only swimmers ever fight, and it always ends', () => {
		const model: PlayerModel = {
			accuracy: 0.6,
			policy: 'random',
			leash: 0.15,
			flee: 0.02,
			switch: 0.3
		};
		const wilds = ANIMALS.filter((a) => a.realms.includes('water')).map((a) => a.id);
		const bad: string[] = [];
		const outcomes = new Set<string>();
		for (const wild of wilds) {
			for (let seed = 0; seed < SEEDS; seed++) {
				const rng = new Rng(hashInts(seed, 77));
				// Two to five animals, at least one of them a swimmer, some already tired.
				const species = Array.from({ length: rng.int(2, 5) }, () => rng.pick(ids));
				species[rng.int(0, species.length - 1)] = rng.pick(wilds);
				const party = makeParty(species).map((a) => ({
					...a,
					hp: rng.chance(0.2) && !swims(a) ? 0 : a.hp
				}));
				const { state } = playBattle(
					seed,
					party,
					makeWild(wild),
					model,
					(before, _intent, step) => {
						const front = step.state.party[step.state.active]!;
						const waiting = step.state.phase.kind === 'choose-animal';
						if (!swims(front)) bad.push(`${wild} ${seed}: ${front.speciesId} fights on water`);
						if (!waiting && step.state.phase.kind !== 'ended' && front.hp === 0)
							bad.push(`${wild} ${seed}: a tired animal in front`);
						if (step.state.realm !== 'water') bad.push(`${wild} ${seed}: the realm moved`);
						for (const [i, a] of step.state.party.entries())
							if (!swims(a) && a.hp !== before.party[i]!.hp)
								bad.push(`${wild} ${seed}: ${a.speciesId} in the boat lost HP`);
					},
					2000,
					'water'
				);
				const end = outcome(state);
				if (end === null) bad.push(`${wild} ${seed}: never ended`);
				else outcomes.add(end);
				if (end === 'lost' && state.party.some((a) => swims(a) && a.hp > 0))
					bad.push(`${wild} ${seed}: lost with a swimmer standing`);
			}
		}
		expect(bad).toEqual([]);
		expect([...outcomes].sort()).toEqual(['caught', 'fled', 'lost', 'won']);
	});
});

describe('rejected intents', () => {
	function expectRejected(state: BattleState, intent: BattleIntent): void {
		const step = applyBattleIntent(deepFreeze(state), intent, 9);
		expect(step.state).toBe(state);
		expect(step.events).toHaveLength(1);
		expect(step.events[0]).toMatchObject({ type: 'rejected' });
	}

	it('leave the state untouched', () => {
		const start = startBattle(makeParty(['rabbit']), makeWild('otter'));
		expectRejected(start, { type: 'answer', input: '4' });
		expectRejected(start, { type: 'attack', attackIndex: 0, level: 1 });
		expectRejected(start, { type: 'attack', attackIndex: 4, level: 1 });
		expectRejected(start, { type: 'attack', attackIndex: 1.5, level: 1 });
		expectRejected(start, { type: 'attack', attackIndex: NaN, level: 1 });
		expectRejected(start, { type: 'attack', attackIndex: 1, level: 0 as AttackLevel });
		expectRejected(start, { type: 'attack', attackIndex: 1, level: 4 as AttackLevel });
		expectRejected(start, { type: 'attack', attackIndex: 1, level: '2' as unknown as AttackLevel });
		expectRejected(start, { type: 'nonsense' } as unknown as BattleIntent);

		const solving = applyBattleIntent(start, { type: 'attack', attackIndex: 1, level: 1 }, 9).state;
		expectRejected(solving, { type: 'attack', attackIndex: 1, level: 1 });
		expectRejected(solving, { type: 'throw-leash' });
		expectRejected(solving, { type: 'flee' });

		const ended = applyBattleIntent(start, { type: 'flee' }, 9).state;
		expectRejected(ended, { type: 'attack', attackIndex: 1, level: 1 });
		expectRejected(ended, { type: 'answer', input: '4' });
		expectRejected(ended, { type: 'throw-leash' });
		expectRejected(ended, { type: 'flee' });
	});

	it('a switch to the animal in front, a tired one or one that is not there, or mid-puzzle', () => {
		const party = makeParty(['squirrel', 'rabbit', 'fox']);
		party[1]!.hp = 0;
		const start = startBattle(party, makeWild('otter'));
		const to = (partyIndex: unknown) => ({ type: 'switch', partyIndex }) as BattleIntent;
		for (const bad of [0, 1, -1, 3, 1.5, NaN, Infinity, '2', null, undefined]) {
			expectRejected(start, to(bad));
		}
		expectRejected(start, { type: 'switch' } as unknown as BattleIntent);
		expect(applyBattleIntent(start, to(2), 9).events[0]).toMatchObject({ type: 'switched' });

		const solving = applyBattleIntent(start, { type: 'attack', attackIndex: 1, level: 1 }, 9).state;
		expectRejected(solving, to(2));
		const ended = applyBattleIntent(start, { type: 'flee' }, 9).state;
		expectRejected(ended, to(2));

		// A party of one has nobody to switch to.
		const alone = startBattle(makeParty(['squirrel']), makeWild('otter'));
		for (const bad of [0, 1, -1]) expectRejected(alone, to(bad));
	});
});

describe('switching', () => {
	it('takes the turn: the wild animal replies against the newcomer, and only its hit costs HP', () => {
		let checked = 0;
		for (const b of ids) {
			for (const w of ids) {
				// Every newcomer against every wild animal it can meet. Who leaves never changes
				// the reply, so each pair has one animal leaving, taken in turn from those that
				// can fight there too (a sea animal's trio only out on the water): every trio
				// would be the catalog's cube, 32,000 since #89, a minute on a busy machine.
				const leavers = ids.filter((x) => arena(x, b, w) !== null);
				if (leavers.length === 0) continue;
				const a = leavers[checked % leavers.length]!;
				const realm = arena(a, b, w)!;
				checked++;
				for (let seed = 0; seed < 5; seed++) {
					const party = makeParty([a, b]);
					const start = deepFreeze(startBattle(party, makeWild(w), { realm }));
					const { state, events } = applyBattleIntent(
						start,
						{ type: 'switch', partyIndex: 1 },
						seed
					);
					const where = `${a} → ${b} vs ${w}, seed ${seed}`;
					expect(events[0], where).toEqual({ type: 'switched', animal: party[1], partyIndex: 1 });
					expect(state.active).toBe(1);

					// The wild turn's two draws, recomputed: against the newcomer, not the one who left.
					const spec = getAnimal(w);
					const rng = new Rng(hashInts(seed, 0));
					const attackIndex = rng.int(1, spec.attacks.length);
					const miss = spec.tier <= getAnimal(b).tier && rng.next() < WILD_MISS_CHANCE;
					const power = spec.attacks[attackIndex - 1]!.power;
					const hp = miss ? maxHp(party[1]!) : Math.max(0, maxHp(party[1]!) - power);
					expect(events[1], where).toMatchObject({
						type: miss ? 'missed' : 'hit',
						attacker: 'opponent',
						attackIndex
					});
					expect(state.party[1]!.hp, where).toBe(hp);
					expect(state.party[0]).toEqual(start.party[0]);
					expect(state.opponent).toEqual(start.opponent);
					expect(state.turn).toBe(2);
					// A newcomer knocked out at once hands the choice back: the first one still stands.
					expect(state.phase).toEqual({ kind: hp === 0 ? 'choose-animal' : 'choose-action' });
				}
			}
		}
		// Every pair that can meet was a newcomer against a wild animal.
		expect(checked).toBe(MEETINGS.length);
		// Five seeds a pair: 1.4 s at a load average of about 100, where every trio took 67 s
		// with the 32 animals of #89.
	}, 30_000);

	it('never stalls: a player who switches whenever they can loses every battle, the wild animal untouched', () => {
		// Switch while anyone else is standing; with nobody left to switch to, answer wrong.
		const onlySwitch = (s: BattleState): BattleIntent | null => {
			if (s.phase.kind === 'ended') return null;
			if (s.phase.kind === 'solving') return { type: 'answer', input: 'x' };
			const standing = others(s);
			if (standing.length === 0) return { type: 'attack', attackIndex: 1, level: 1 };
			return { type: 'switch', partyIndex: standing[s.turn % standing.length]! };
		};
		for (const w of ids) {
			// A big one and two small ones: on land a bear, a squirrel and a rabbit; out on the
			// water, where the sea animals are, a whale, a frog and a crab.
			const realm = arena('bear', w) ? 'land' : 'water';
			const team = realm === 'land' ? ['bear', 'squirrel', 'rabbit'] : ['whale', 'frog', 'crab'];
			for (let seed = 0; seed < SEEDS; seed++) {
				const party = makeParty(team);
				const { state } = drive(seed, party, makeWild(w), onlySwitch, undefined, realm);
				const where = `vs ${w}, seed ${seed}`;
				expect(outcome(state), where).toBe('lost');
				expect(state.opponent.hp).toBe(maxHp(state.opponent));
				// Every switch but the two replacements gave the wild animal a turn.
				// Every round costs the party HP or is a miss, which can't go on for long.
				const hp = party.reduce((sum, x) => sum + x.hp, 0);
				expect(state.turn, where).toBeLessThanOrEqual(hp);
			}
		}
	});

	it('canSwitchTo says exactly which switches the reducer takes', () => {
		const model: PlayerModel = { accuracy: 0.6, policy: 'random', leash: 0.1, switch: 0.2 };
		let checked = 0;
		for (const w of ids) {
			// Out on the water, where the sea animals are, a squirrel in the boat that can't step in.
			const realm = arena('fox', w) ? 'land' : 'water';
			const team = realm === 'land' ? ['squirrel', 'fox', 'bear'] : ['frog', 'squirrel', 'whale'];
			for (let seed = 0; seed < 5; seed++) {
				const party = makeParty(team);
				party[2]!.hp = seed % 2 === 0 ? 0 : 50;
				const check = (before: BattleState) => {
					for (const i of [-1, 0, 1, 2, 3, 0.5]) {
						const step = applyBattleIntent(before, { type: 'switch', partyIndex: i }, seed);
						expect(canSwitchTo(before, i)).toBe(step.events[0]!.type === 'switched');
						checked++;
					}
				};
				playBattle(seed, party, makeWild(w), model, check, 2000, realm);
			}
		}
		expect(checked).toBeGreaterThan(1000);
	});
});

describe('transcripts', () => {
	it.runIf(PRINT)('prints two full battles as event lists', () => {
		const show = (title: string, r: { events: BattleEvent[]; state: BattleState }) => {
			const lines = r.events.map((e) => `  ${JSON.stringify(e)}`);
			console.log(`\n### ${title}\n\n${lines.join('\n')}\n\n  end: ${JSON.stringify(r.state)}\n`);
		};
		show(
			'Squirrel vs wild Squirrel, always right, Scurry Kick at level 3',
			playBattle(11, makeParty(['squirrel']), makeWild('squirrel'), { accuracy: 1, policy: 'max' })
		);
		show(
			'Squirrel + Rabbit vs wild Fox, 70% right, leash when the fox is weak',
			drive(
				12,
				makeParty(['squirrel', 'rabbit']),
				makeWild('fox'),
				(() => {
					const rng = new Rng(12);
					return (s: BattleState): BattleIntent | null => {
						if (s.phase.kind === 'ended') return null;
						if (s.phase.kind === 'choose-animal') return { type: 'switch', partyIndex: 1 };
						if (s.phase.kind === 'solving') {
							const a = s.phase.puzzle.answer;
							return { type: 'answer', input: String(rng.chance(0.7) ? a : a + 2) };
						}
						if (s.opponent.hp <= 10) return { type: 'throw-leash' };
						return { type: 'attack', attackIndex: 2, level: 2 };
					};
				})()
			)
		);
	});
});
