import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import { ATTACK_LEVELS, type AttackLevel } from '../src/animals/types.js';
import { hitSpan, landHit } from '../src/battle/attack.js';
import { attackDamage } from '../src/battle/damage.js';
import { applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleEvent } from '../src/battle/types.js';
import { applyMatchIntent, startMatch } from '../src/match/reducer.js';
import type { MatchEvent } from '../src/match/types.js';
import { puzzleDifficulty } from '../src/puzzles/difficulty.js';
import { puzzleFace } from '../src/puzzles/face.js';
import {
	MAX_TOPIC_BONUS,
	MIN_TOPIC_BONUS,
	RECENT_ANSWERS,
	faceTopic,
	puzzleTopic,
	recordAnswers,
	topicBonus,
	type PuzzleRecord
} from '../src/puzzles/record.js';
import { answerText, generatePuzzle, getGenerator, puzzleTopics } from '../src/puzzles/registry.js';
import {
	ALL_PUZZLE_KINDS,
	ALL_PUZZLE_TOPICS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY,
	type Puzzle,
	type PuzzleTopic
} from '../src/puzzles/types.js';
import { Rng, hashInts } from '../src/rng.js';
import { makeParty, makeWild } from './battle-sim.js';

/** Answers judged in a wild battle: they go into the latest answers too. */
const BATTLE = { where: 'battle' } as const;
import { party as matchParty, mover } from './match-sim.js';

/**
 * The puzzle record and the topic bonus ([[PRODUCT]] §4 "Puzzles"): every
 * judged answer counts under its topic, and a wild battle's hit of a topic
 * the kid finds hard lands harder, so that a right answer to any topic is
 * worth the kid's average one. The formula is written out again here from
 * the prose, not read from the code.
 */

/**
 * The prose's formula: o the kid's overall accuracy (every recent answer together); p̄ the
 * plain mean of the topics' accuracies, each pulled towards o, (right + 4o)/(n + 4); a
 * topic's p = (right + 4p̄)/(n + 4); its bonus p̄/p in [0.7, 1.6].
 */
function expectedBonus(recent: Partial<Record<PuzzleTopic, string>>): Map<PuzzleTopic, number> {
	const acc = Object.entries(recent)
		.filter(([, r]) => r.length > 0)
		.map(([t, r]) => [t, r.split('1').length - 1, r.length] as const);
	const out = new Map<PuzzleTopic, number>();
	if (acc.length === 0) return out;
	const o = acc.reduce((s, [, right]) => s + right, 0) / acc.reduce((s, [, , n]) => s + n, 0);
	const mean = acc.reduce((s, [, right, n]) => s + (right + 4 * o) / (n + 4), 0) / acc.length;
	if (mean === 0) return out;
	for (const [t, right, n] of acc) {
		const p = (right + 4 * mean) / (n + 4);
		out.set(t as PuzzleTopic, Math.min(1.6, Math.max(0.7, mean / p)));
	}
	return out;
}

/** A record whose topics answered as `recent` says, lifetime counts the same. */
function recordOf(recent: Partial<Record<PuzzleTopic, string>>): PuzzleRecord {
	const out: Partial<Record<PuzzleTopic, { tried: number; right: number; recent: string }>> = {};
	for (const [t, r] of Object.entries(recent)) {
		out[t as PuzzleTopic] = { tried: r.length, right: r.split('1').length - 1, recent: r };
	}
	return out;
}

function judged(topic: PuzzleTopic, correct: boolean): BattleEvent {
	return { type: 'answer-judged', input: '0', correct, answer: 0, topic };
}

describe('puzzleTopic and faceTopic', () => {
	it('is the topic the kid sees: a times-table missing number is times tables, a fence is perimeter', () => {
		const rng = new Rng(5);
		for (const kind of ALL_PUZZLE_KINDS) {
			const g = getGenerator(kind);
			for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
				for (let i = 0; i < 40; i++) {
					const puzzle = g.generate(rng, d);
					const topic = puzzleTopic(puzzle);
					// One of the topics the attack's words promise at this difficulty.
					expect(g.topics(d)).toContain(topic);
					// Read off the prompt itself, not the code under test.
					const want =
						kind === 'missing'
							? puzzle.prompt.includes('×')
								? 'mul'
								: 'missing'
							: kind === 'shape'
								? [1, 3].includes(Number(/\d+/.exec(puzzle.prompt)![0]))
									? 'perimeter'
									: 'area'
								: kind;
					expect(topic, puzzle.prompt).toBe(want);
					// And off its face, as a thought bubble or a match's wire carries it.
					expect(faceTopic(puzzleFace(puzzle)!), puzzle.prompt).toBe(want);
				}
			}
		}
	});
});

describe('recordAnswers', () => {
	it('counts every judged answer under its topic, right or wrong, and keeps the latest 20', () => {
		let record: PuzzleRecord = {};
		const before = record;
		record = recordAnswers(record, [judged('div', false), judged('add', true)], BATTLE);
		expect(before).toEqual({});
		expect(record).toEqual({
			div: { tried: 1, right: 0, recent: '0' },
			add: { tried: 1, right: 1, recent: '1' }
		});
		for (let i = 0; i < 30; i++) {
			record = recordAnswers(record, [judged('div', i % 3 === 0)], BATTLE);
		}
		expect(record.div!.tried).toBe(31);
		expect(record.div!.right).toBe(10);
		expect(record.div!.recent).toHaveLength(RECENT_ANSWERS);
		// The last 20 of 0, then i = 0..29 right on every third: i = 10..29.
		expect(record.div!.recent).toBe(
			Array.from({ length: 20 }, (_, k) => ((k + 10) % 3 === 0 ? '1' : '0')).join('')
		);
	});

	it('hands back the very record when nothing was judged, and skips an answer with no topic', () => {
		const record = recordOf({ add: '11' });
		const miss: BattleEvent = { type: 'missed', attacker: 'player', attackIndex: 1, level: 1 };
		expect(recordAnswers(record, [miss], BATTLE)).toBe(record);
		const old: MatchEvent[] = [{ type: 'answer-judged', side: 'a', correct: true }];
		expect(recordAnswers(record, old, { where: 'match', side: 'a' })).toBe(record);
	});

	it("counts the druid's and a match's answers, but only a wild battle's go into the latest, which the bonus reads", () => {
		// A miss costs nothing at the doctor's or in a match: missing there on purpose must not
		// make a topic look hard (a kid could top up a bonus before every battle).
		let record = recordOf({ div: '1111' });
		const misses = Array.from({ length: 20 }, () => judged('div', false));
		record = recordAnswers(record, misses, { where: 'doctor' });
		expect(record.div).toEqual({ tried: 24, right: 4, recent: '1111' });
		const matchMisses: MatchEvent[] = misses.map(() => ({
			type: 'answer-judged',
			side: 'a',
			correct: false,
			topic: 'div'
		}));
		record = recordAnswers(record, matchMisses, { where: 'match', side: 'a' });
		expect(record.div).toEqual({ tried: 44, right: 4, recent: '1111' });
		const withAdd = recordAnswers(record, [judged('add', true)], { where: 'doctor' });
		// Met at the doctor's only: no recent answers, no bonus.
		expect(withAdd.add).toEqual({ tried: 1, right: 1, recent: '' });
		expect(topicBonus(withAdd)).toEqual({ div: 1 });
	});

	it("in a match, records only the kid's own side", () => {
		const events: MatchEvent[] = [
			{ type: 'answer-judged', side: 'a', correct: true, topic: 'add' },
			{ type: 'answer-judged', side: 'b', correct: false, topic: 'div' },
			{ type: 'answer-judged', side: 'a', correct: false, topic: 'div' }
		];
		expect(recordAnswers({}, events, { where: 'match', side: 'a' })).toEqual({
			add: { tried: 1, right: 1, recent: '' },
			div: { tried: 1, right: 0, recent: '' }
		});
		expect(recordAnswers({}, events, { where: 'match', side: 'b' })).toEqual({
			div: { tried: 1, right: 0, recent: '' }
		});
	});
});

describe('topicBonus', () => {
	it('is the formula of the prose, over random records', () => {
		for (let s = 0; s < 2000; s++) {
			const rng = new Rng(hashInts(77, s));
			const recent: Partial<Record<PuzzleTopic, string>> = {};
			for (const topic of ALL_PUZZLE_TOPICS) {
				if (!rng.chance(0.4)) continue;
				const p = rng.next();
				recent[topic] = Array.from({ length: rng.int(0, 20) }, () =>
					rng.chance(p) ? '1' : '0'
				).join('');
			}
			const want = expectedBonus(recent);
			const got = topicBonus(recordOf(recent));
			expect(Object.keys(got).sort()).toEqual([...want.keys()].sort());
			for (const [t, b] of want) expect(got[t]).toBeCloseTo(b, 12);
		}
	});

	it('leaves every hit as it is for a kid with no answers, every answer wrong, or every topic alike', () => {
		expect(topicBonus({})).toEqual({});
		expect(topicBonus(recordOf({ add: '000', div: '0' }))).toEqual({});
		const right = topicBonus(recordOf({ add: '1'.repeat(20), div: '1', clock: '11' }));
		for (const b of Object.values(right)) expect(b).toBeCloseTo(1, 12);
		const half = topicBonus(recordOf({ add: '10'.repeat(10), div: '01'.repeat(10) }));
		for (const b of Object.values(half)) expect(b).toBeCloseTo(1, 12);
	});

	it('pays a hard topic more and an easy one less, within the bounds, and evens out what a right answer is worth', () => {
		// A kid 19 in 20 on adding and 4 in 10 on dividing (the case that started it).
		const record = recordOf({ add: '1111111110' + '1111111111', div: '0101100010' });
		const bonus = topicBonus(record);
		expect(bonus.add!).toBeLessThan(1);
		expect(bonus.div!).toBeGreaterThan(1);
		const o = 23 / 30;
		const mean = ((19 + 4 * o) / 24 + (4 + 4 * o) / 14) / 2;
		const p = (right: number, n: number) => (right + 4 * mean) / (n + 4);
		// Unclamped, a right answer to either is worth the average one: p · bonus = p̄.
		expect(p(19, 20) * bonus.add!).toBeCloseTo(mean, 12);
		expect(p(4, 10) * bonus.div!).toBeCloseTo(mean, 12);
		// A topic never right, beside one always right: the bounds hold.
		const far = topicBonus(recordOf({ add: '1'.repeat(20), div: '0'.repeat(20) }));
		expect(far.div).toBe(MAX_TOPIC_BONUS);
		for (const b of Object.values(far)) {
			expect(b).toBeGreaterThanOrEqual(MIN_TOPIC_BONUS);
			expect(b).toBeLessThanOrEqual(MAX_TOPIC_BONUS);
		}
	});

	it('lets a topic met once barely move the topics a kid has mastered', () => {
		// A first flight's fare asks a topic of the new land, and a kid gets it wrong: their
		// mastered topics must not lose a third of every hit for it.
		const mastered = { add: '1'.repeat(20), sub: '1'.repeat(20) };
		const once = topicBonus(recordOf({ ...mastered, thermometer: '0' }));
		expect(once.add!).toBeGreaterThan(0.9);
		expect(once.sub!).toBeGreaterThan(0.9);
		expect(once.thermometer!).toBeGreaterThan(1);
	});

	it('never pays a topic the kid gets right less often a smaller bonus', () => {
		for (let s = 0; s < 500; s++) {
			const rng = new Rng(hashInts(78, s));
			const n = rng.int(1, 20);
			const a = rng.int(0, n);
			const b = rng.int(0, n);
			const bonus = topicBonus(
				recordOf({ add: '1'.repeat(a) + '0'.repeat(n - a), div: '1'.repeat(b) + '0'.repeat(n - b) })
			);
			if (Object.keys(bonus).length === 0) continue;
			if (a > b) expect(bonus.add!).toBeLessThanOrEqual(bonus.div!);
			if (a < b) expect(bonus.add!).toBeGreaterThanOrEqual(bonus.div!);
		}
	});
});

describe('a hit with a topic bonus', () => {
	const bonuses = [MIN_TOPIC_BONUS, 0.85, 1, 1.25, MAX_TOPIC_BONUS];

	it('is the attack’s damage times the bonus, rounded once, and with no bonus exactly the old hit', () => {
		const MULT = [1, 1.6, 2.4];
		for (const spec of ANIMALS) {
			spec.attacks.forEach((attack, i) => {
				for (const level of ATTACK_LEVELS) {
					expect(attackDamage(spec, i + 1, level, true)).toBe(
						Math.round(attack.power * MULT[level - 1]!)
					);
					for (const b of bonuses) {
						expect(attackDamage(spec, i + 1, level, true, b)).toBe(
							Math.round(attack.power * MULT[level - 1]! * b)
						);
						expect(attackDamage(spec, i + 1, level, false, b)).toBe(0);
					}
				}
			});
		}
	});

	it('still grows strictly with the level at any one bonus', () => {
		for (const spec of ANIMALS) {
			for (let n = 1; n <= spec.attacks.length; n++) {
				for (const b of bonuses) {
					for (const level of [2, 3] as const) {
						expect(attackDamage(spec, n, level, true, b)).toBeGreaterThan(
							attackDamage(spec, n, (level - 1) as AttackLevel, true, b)
						);
					}
				}
			}
		}
	});

	it('hitSpan is the softest and hardest hit over the topics the attack can ask, one number with no bonus', () => {
		const rng = new Rng(3);
		for (const spec of ANIMALS) {
			for (let n = 1; n <= spec.attacks.length; n++) {
				for (const level of ATTACK_LEVELS) {
					const topics = puzzleTopics(
						spec.attacks[n - 1]!.kinds,
						puzzleDifficulty(spec.tier, n, level)
					);
					const bonus: Partial<Record<PuzzleTopic, number>> = {};
					for (const t of topics) bonus[t] = rng.pick(bonuses);
					const hits = topics.map((t) => attackDamage(spec, n, level, true, bonus[t]));
					expect(hitSpan(spec, n, level, bonus)).toEqual({
						low: Math.min(...hits),
						high: Math.max(...hits)
					});
					const plain = attackDamage(spec, n, level, true);
					expect(hitSpan(spec, n, level)).toEqual({ low: plain, high: plain });
				}
			}
		}
	});
});

describe('a wild battle with a topic bonus', () => {
	it('never hits past what a battle seen from outside carries: the most HP any animal has', () => {
		// A hit's damage crosses the wire to the players watching (`net/fight.ts`), checked
		// against the biggest HP there is; the hardest hit at the biggest bonus must fit.
		const most = Math.max(...ANIMALS.map((a) => a.maxHp));
		const hardest = Math.max(
			...ANIMALS.map((a) => attackDamage(a, a.attacks.length, 3, true, MAX_TOPIC_BONUS))
		);
		expect(hardest).toBeLessThanOrEqual(most);
	});

	it("lands the drawn puzzle's topic's bonus, says its topic, and keeps the bonus for the whole battle", () => {
		const bonus = { add: 0.7, sub: 1.6, mul: 1.3, missing: 0.9, div: 1.45, sqrt: 1.1 };
		let checked = 0;
		for (const id of ['fox', 'wolf', 'bear', 'squirrel']) {
			const spec = getAnimal(id);
			for (let seed = 0; seed < 40; seed++) {
				const start = startBattle(makeParty([id]), makeWild('moose'), { bonus });
				expect(start.bonus).toEqual(bonus);
				const n = 1 + (seed % spec.attacks.length);
				const level = (1 + (seed % 3)) as AttackLevel;
				const solving = applyBattleIntent(start, { type: 'attack', attackIndex: n, level }, seed);
				if (solving.state.phase.kind !== 'solving') throw new Error('not solving');
				const puzzle: Puzzle = solving.state.phase.puzzle;
				const step = applyBattleIntent(
					solving.state,
					{ type: 'answer', input: answerText(puzzle) },
					seed
				);
				const topic = puzzleTopic(puzzle);
				expect(step.events[0]).toMatchObject({ type: 'answer-judged', correct: true, topic });
				const b = (bonus as Partial<Record<PuzzleTopic, number>>)[topic] ?? 1;
				expect(step.events[1]).toMatchObject({
					type: 'hit',
					attacker: 'player',
					damage: Math.round(spec.attacks[n - 1]!.power * [1, 1.6, 2.4][level - 1]! * b)
				});
				expect(step.state.bonus).toEqual(bonus);
				checked++;
			}
		}
		expect(checked).toBe(160);
	});

	it('a friendly match has no bonus: it hits for the attack’s damage, as a battle with none does', () => {
		// The match reducer takes no bonus at all; its hits are `landHit`'s with none.
		const fox = getAnimal('fox');
		const target = makeWild('moose');
		expect(landHit(fox, 1, 1, target).damage).toBe(attackDamage(fox, 1, 1, true));
		let state = startMatch({ a: matchParty(['fox']), b: matchParty(['fox']) }, 1);
		const side = mover(state)!;
		const shown = applyMatchIntent(state, side, { type: 'attack', attackIndex: 1, level: 1 }, 1);
		state = shown.state;
		if (state.phase.kind !== 'solving') throw new Error('not solving');
		const right = applyMatchIntent(
			state,
			side,
			{ type: 'answer', input: answerText(state.phase.puzzle) },
			1
		);
		expect(right.events[0]).toMatchObject({
			type: 'answer-judged',
			side,
			correct: true,
			topic: puzzleTopic(state.phase.puzzle)
		});
		expect(right.events[1]).toMatchObject({ type: 'hit', damage: attackDamage(fox, 1, 1, true) });
	});
});

describe('generatePuzzle', () => {
	it('every topic is the topic of some puzzle', () => {
		const rng = new Rng(9);
		const seen = new Set<PuzzleTopic>();
		for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d++) {
			for (let i = 0; i < 400; i++) seen.add(puzzleTopic(generatePuzzle(rng, d)));
		}
		expect([...seen].sort()).toEqual([...ALL_PUZZLE_TOPICS].sort());
	});
});
