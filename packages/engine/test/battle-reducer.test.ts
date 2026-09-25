import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import { ATTACK_LEVELS, type AnimalInstance, type AttackLevel } from '../src/animals/types.js';
import { catchProbability } from '../src/battle/catch.js';
import { attackDamage } from '../src/battle/damage.js';
import { activeAnimal, applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleEvent, BattleIntent, BattleState, BattleStep } from '../src/battle/types.js';
import { puzzleDifficulty } from '../src/puzzles/difficulty.js';
import { checkAnswer, getGenerator } from '../src/puzzles/registry.js';
import { Rng, hashInts } from '../src/rng.js';
import { makeParty, makeWild, nextIntent, playBattle, type PlayerModel } from './battle-sim.js';

const SEEDS = 25;
const ids = ANIMALS.map((a) => a.id);
const PRINT = Boolean(process.env.SIM);

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
	check?: (before: BattleState, intent: BattleIntent, step: BattleStep) => void
): { state: BattleState; events: BattleEvent[] } {
	let state = startBattle(party, wild);
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
		expect(state.log).toEqual(['A wild Deer appears!', 'Go, Rabbit!']);
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

	it('uses the nickname when there is one', () => {
		const party = makeParty(['squirrel']);
		party[0]!.nickname = 'Pip';
		expect(startBattle(party, makeWild('fox')).log[1]).toBe('Go, Pip!');
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
			expect(step.events).toEqual([{ type: 'rejected', reason: 'That is not an intent.' }]);
		}
	});
});

describe('replay', () => {
	it('the same seed, party, wild and intents always yield the same states and events', () => {
		const model: PlayerModel = { accuracy: 0.6, policy: 'random', leash: 0.1 };
		for (const p of ids) {
			for (const w of ids) {
				for (let seed = 0; seed < 5; seed++) {
					const a = playBattle(seed, makeParty([p, 'squirrel']), makeWild(w), model);
					const b = playBattle(seed, makeParty([p, 'squirrel']), makeWild(w), model);
					expect(b.intents).toEqual(a.intents);
					expect(b.events).toEqual(a.events);
					expect(b.state).toEqual(a.state);
				}
			}
		}
	});

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
		// Attack 2 at level 3 every round, wrong on every third answer, one leash throw on round 3.
		let answers = 0;
		const { state, events } = drive(
			2024,
			makeParty(['squirrel', 'rabbit']),
			makeWild('fox'),
			(s) => {
				if (s.phase.kind === 'ended') return null;
				if (s.phase.kind === 'solving') {
					const a = s.phase.puzzle.answer;
					return { type: 'answer', input: String(answers++ % 3 === 1 ? a + 1 : a) };
				}
				if (s.turn === 3) return { type: 'throw-leash' };
				return { type: 'attack', attackIndex: 2, level: 3 };
			}
		);

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
			step: 9,
			turn: 5,
			active: 1,
			leashQuality: 1,
			party: [
				{ id: 'squirrel-0', speciesId: 'squirrel', hp: 0 },
				{ id: 'rabbit-1', speciesId: 'rabbit', hp: 13 }
			],
			opponent: { id: 'wild-fox', speciesId: 'fox', hp: 0 },
			phase: { kind: 'ended', outcome: 'won' },
			log: [
				'A wild Fox appears!',
				'Go, Squirrel!',
				'Squirrel used Scurry Kick! 14 damage.',
				'Wild Fox used Trick! 12 damage.',
				'Not quite! Scurry Kick missed.',
				'Wild Fox used Nip! 6 damage.',
				'You throw the leash…',
				'It broke free!',
				'Wild Fox used Nip! 6 damage.',
				'Squirrel is tired.',
				'Go, Rabbit!',
				'Rabbit used Thump! 14 damage.',
				'Wild Fox used Pounce! 9 damage.',
				'Rabbit used Thump! 14 damage.',
				'Wild Fox is tired. You win!'
			]
		});
	});
});

describe('every battle in the catalog', () => {
	// A shaky player who sometimes throws the leash and, rarely, runs — so every
	// branch of the reducer is walked for every species pair.
	const model: PlayerModel = { accuracy: 0.6, policy: 'random', leash: 0.15, flee: 0.02 };
	const seen = new Set<string>();

	for (const p of ids) {
		it(`${p} vs everything: terminates, keeps HP in bounds, never mutates its input, explains every change`, () => {
			for (const w of ids) {
				for (let seed = 0; seed < SEEDS; seed++) {
					const rng = new Rng(hashInts(seed, 0x9e3779b9));
					const { state } = drive(
						seed,
						makeParty([p, 'rabbit']),
						makeWild(w),
						(s) => nextIntent(s, model, rng),
						checkStep(seed)
					);
					expect(state.phase.kind, `${p} vs ${w} seed ${seed} never ended`).toBe('ended');
					seen.add(outcome(state)!);
				}
			}
		});
	}

	it('reached every outcome', () => {
		expect([...seen].sort()).toEqual(['caught', 'fled', 'lost', 'won']);
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
						}
						break;
					}
					case 'missed':
						expect(e.attacker).toBe('player');
						expect(oppHp).toBe(before.opponent.hp);
						break;
					case 'fainted':
						if (e.side === 'opponent') {
							expect(oppHp).toBe(0);
							expect(e.animal.hp).toBe(0);
							expect(next).toEqual({ type: 'ended', outcome: 'won' });
						} else {
							expect(playerHp).toBe(0);
							expect(e.animal).toEqual({ ...before.party[active], hp: 0 });
							expect(['switched', 'ended']).toContain(next?.type);
						}
						break;
					case 'switched':
						expect(events[i - 1]?.type).toBe('fainted');
						expect(e.partyIndex).not.toBe(active);
						expect(state.party[e.partyIndex]!.hp).toBeGreaterThan(0);
						expect(e.animal).toEqual(state.party[e.partyIndex]);
						active = e.partyIndex;
						playerHp = e.animal.hp;
						break;
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
							expect(next?.type).toBe('hit');
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
						if (e.outcome === 'lost') for (const a of state.party) expect(a.hp).toBe(0);
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

			// The round counter advances exactly when the wild animal's turn ended without ending the battle.
			const roundOver = state.phase.kind === 'choose-action' && intent.type !== 'attack';
			expect(state.turn).toBe(before.turn + (roundOver ? 1 : 0));

			// The log only ever grows.
			expect(state.log.slice(0, before.log.length)).toEqual(before.log);
		};
	}
});

describe('answers', () => {
	it('a wrong answer never damages the opponent, whatever the input', () => {
		for (const p of ids) {
			for (const w of ids) {
				for (let seed = 0; seed < 5; seed++) {
					const rng = new Rng(seed);
					const n = rng.int(1, getAnimal(p).attacks.length);
					const level = rng.int(1, 3) as AttackLevel;
					const start = startBattle(makeParty([p]), makeWild(w));
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
						expect(events.some((e) => e.type === 'hit' && e.attacker === 'opponent')).toBe(true);
					}
				}
			}
		}
	});

	it('a correct answer always deals exactly the formula damage, for every attack and level', () => {
		for (const p of ids) {
			const spec = getAnimal(p);
			for (let n = 1; n <= spec.attacks.length; n++) {
				for (const level of ATTACK_LEVELS) {
					for (let seed = 0; seed < 5; seed++) {
						const start = startBattle(makeParty([p]), makeWild('bear'));
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
});

describe('the wild animal', () => {
	it('picks each of its attacks equally often and hits for its level-1 power', () => {
		const spec = getAnimal('bear');
		const picks = new Array(spec.attacks.length).fill(0);
		const runs = 2000;
		for (let seed = 0; seed < runs; seed++) {
			const start = startBattle(makeParty(['bear']), makeWild('bear'));
			const { events } = attackAndAnswer(start, seed, 1, 1, false);
			const hit = events.find((e) => e.type === 'hit');
			if (hit?.type !== 'hit') throw new Error('no hit');
			expect(hit.attacker).toBe('opponent');
			expect(hit.damage).toBe(spec.attacks[hit.attackIndex - 1]!.power);
			picks[hit.attackIndex - 1]++;
		}
		for (const count of picks) expect(count / runs).toBeCloseTo(1 / spec.attacks.length, 1);
	});
});

describe('the leash', () => {
	it('catches exactly when the roll beats catchProbability, and ends the battle with the animal', () => {
		for (const w of ids) {
			const spec = getAnimal(w);
			for (const hp of [1, Math.ceil(spec.maxHp * 0.1), Math.ceil(spec.maxHp * 0.5), spec.maxHp]) {
				for (let seed = 0; seed < SEEDS; seed++) {
					const start = deepFreeze(startBattle(makeParty(['fox']), makeWild(w, hp)));
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
						expect(events[1]?.type).toBe('hit');
						expect(outcome(state)).toBeNull();
					}
				}
			}
		}
	});

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
				const start = deepFreeze(startBattle(makeParty(['squirrel']), makeWild(w)));
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
	it('the next conscious party member steps in, in party order', () => {
		const party = makeParty(['squirrel', 'rabbit', 'fox']);
		party[0]!.hp = 1;
		party[1]!.hp = 0;
		const { state, events } = attackAndAnswer(startBattle(party, makeWild('bear')), 1, 1, 1, false);
		expect(events.map((e) => e.type)).toEqual([
			'answer-judged',
			'missed',
			'hit',
			'fainted',
			'switched'
		]);
		expect(events[4]).toEqual({ type: 'switched', animal: { ...party[2], hp: 35 }, partyIndex: 2 });
		expect(state.active).toBe(2);
		expect(state.party.map((a) => a.hp)).toEqual([0, 0, 35]);
		expect(state.phase).toEqual({ kind: 'choose-action' });
		expect(state.turn).toBe(2);
		expect(state.log.slice(-2)).toEqual(['Squirrel is tired.', 'Go, Fox!']);
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
		expect(events[4]).toEqual({ type: 'ended', outcome: 'lost' });
		expect(state.party.map((a) => a.hp)).toEqual([0, 0]);
		expect(state.log.slice(-2)).toEqual(['Squirrel is tired.', 'All your animals are tired.']);
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
});

describe('transcripts', () => {
	it.runIf(PRINT)('prints two full battles as event lists', () => {
		const show = (title: string, r: { events: BattleEvent[]; state: BattleState }) => {
			const lines = r.events.map((e) => `  ${JSON.stringify(e)}`);
			console.log(
				`\n### ${title}\n\n${lines.join('\n')}\n\n  log: ${JSON.stringify(r.state.log, null, 2)}\n`
			);
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
					return (s: BattleState) => {
						if (s.phase.kind === 'ended') return null;
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
