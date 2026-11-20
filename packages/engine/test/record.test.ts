import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import { ATTACK_LEVELS, type AttackLevel } from '../src/animals/types.js';
import { hitSpan, landHit } from '../src/battle/attack.js';
import { attackDamage } from '../src/battle/damage.js';
import { applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleEvent } from '../src/battle/types.js';
import { applyMatchIntent, startMatch } from '../src/match/reducer.js';
import type { MatchEvent, MatchSide } from '../src/match/types.js';
import { puzzleDifficulty } from '../src/puzzles/difficulty.js';
import { puzzleFace } from '../src/puzzles/face.js';
import { applyDoctorIntent, startDoctorVisit } from '../src/doctor/reducer.js';
import {
	LADDER_VERSION,
	MAX_TOPIC_BONUS,
	MIN_TOPIC_BONUS,
	RECENT_ANSWERS,
	faceTopic,
	puzzleTopic,
	readRecord,
	recordAnswers,
	savedByDifficulty,
	topicBonus,
	type Judging,
	type PuzzleRecord
} from '../src/puzzles/record.js';
import { answerText, generatePuzzle, getGenerator, puzzleTopics } from '../src/puzzles/registry.js';
import {
	ALL_PUZZLE_KINDS,
	ALL_PUZZLE_TOPICS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY,
	type Puzzle,
	type PuzzleKind,
	type PuzzleTopic
} from '../src/puzzles/types.js';
import { Rng, hashInts } from '../src/rng.js';
import { makeParty, makeWild } from './battle-sim.js';
import { deepFreeze } from './freeze.js';

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

/** The kind a topic's puzzles are when one kind asks it alone, or the kind given. */
function kindOf(topic: PuzzleTopic): PuzzleKind {
	if (topic === 'area' || topic === 'perimeter') return 'shape';
	return topic === 'half' ? 'double' : topic;
}

function judged(
	topic: PuzzleTopic,
	correct: boolean,
	difficulty = 1,
	kind: PuzzleKind = kindOf(topic)
): BattleEvent {
	return { type: 'answer-judged', input: '0', correct, answer: 0, topic, kind, difficulty };
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
								: kind === 'double'
									? puzzle.prompt.startsWith('double(1,')
										? 'half'
										: 'double'
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
			div: { tried: 1, right: 0, recent: '0', byDifficulty: { div: [[1, 0]] } },
			add: { tried: 1, right: 1, recent: '1', byDifficulty: { add: [[1, 1]] } }
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
		const byDifficulty = { div: [[20, 0]] };
		expect(record.div).toEqual({ tried: 24, right: 4, recent: '1111', byDifficulty });
		const matchMisses: MatchEvent[] = misses.map(() => ({
			type: 'answer-judged',
			side: 'a',
			correct: false,
			topic: 'div'
		}));
		record = recordAnswers(record, matchMisses, { where: 'match', side: 'a' });
		// A match's answers from a server that says no difficulty count under the topic alone.
		expect(record.div).toEqual({ tried: 44, right: 4, recent: '1111', byDifficulty });
		const withAdd = recordAnswers(record, [judged('add', true)], { where: 'doctor' });
		// Met at the doctor's only: no recent answers, no bonus.
		expect(withAdd.add).toEqual({
			tried: 1,
			right: 1,
			recent: '',
			byDifficulty: { add: [[1, 1]] }
		});
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

describe('the record by difficulty', () => {
	const WHERE: readonly Judging[] = [BATTLE, { where: 'doctor' }, { where: 'match', side: 'a' }];

	it("counts every judged answer by its puzzle's kind and difficulty too, wherever it was asked, a match's the kid's own", () => {
		const bad: string[] = [];
		for (let s = 0; s < 300; s++) {
			const rng = new Rng(hashInts(79, s));
			let record: PuzzleRecord = {};
			// Counted by hand: per topic and kind, [tried, right] at index difficulty − 1.
			const want = new Map<string, [number, number][]>();
			for (let step = 0; step < 25; step++) {
				const judging = rng.pick(WHERE);
				const events: (BattleEvent | MatchEvent)[] = [];
				const n = rng.int(0, 3);
				for (let k = 0; k < n; k++) {
					const topic = rng.pick(ALL_PUZZLE_TOPICS);
					// A times table is asked by two kinds, each its own ladder.
					const kind = topic === 'mul' && rng.chance(0.5) ? 'missing' : kindOf(topic);
					const difficulty = rng.int(MIN_DIFFICULTY, MAX_DIFFICULTY);
					const correct = rng.chance(0.6);
					const side: MatchSide = judging.where === 'match' && rng.chance(0.5) ? 'b' : 'a';
					events.push(
						judging.where === 'match'
							? { type: 'answer-judged', side, correct, topic, kind, difficulty }
							: judged(topic, correct, difficulty, kind)
					);
					if (side === 'b') continue;
					const counts = want.get(`${topic} ${kind}`) ?? [];
					while (counts.length < difficulty) counts.push([0, 0]);
					counts[difficulty - 1]![0] += 1;
					if (correct) counts[difficulty - 1]![1] += 1;
					want.set(`${topic} ${kind}`, counts);
				}
				record = recordAnswers(record, events, judging);
			}
			for (const topic of ALL_PUZZLE_TOPICS) {
				const got = record[topic];
				let tried = 0;
				let right = 0;
				for (const kind of ALL_PUZZLE_KINDS) {
					const counts = want.get(`${topic} ${kind}`);
					const has = got?.byDifficulty?.[kind];
					if (JSON.stringify(has) !== JSON.stringify(counts)) {
						bad.push(
							`seed ${s}, ${topic} ${kind}: ${JSON.stringify(has)}, not ${JSON.stringify(counts)}`
						);
					}
					tried += (counts ?? []).reduce((sum, [t]) => sum + t, 0);
					right += (counts ?? []).reduce((sum, [, r]) => sum + r, 0);
				}
				// Every answer said its kind and difficulty: the counts add up to the topic's.
				if ((got?.tried ?? 0) !== tried || (got?.right ?? 0) !== right) {
					bad.push(`seed ${s}, ${topic}: ${got?.right}/${got?.tried} beside ${right}/${tried}`);
				}
				// A topic none counted has no counts at all, not an empty object.
				if (got && tried === 0 && 'byDifficulty' in got)
					bad.push(`seed ${s}, ${topic}: empty counts`);
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('counts an answer with no kind or difficulty, or one no puzzle has, under its topic alone', () => {
		const before = deepFreeze(recordAnswers({}, [judged('add', true, 4)], BATTLE));
		expect(before.add).toStrictEqual({
			tried: 1,
			right: 1,
			recent: '1',
			byDifficulty: {
				add: [
					[0, 0],
					[0, 0],
					[0, 0],
					[1, 1]
				]
			}
		});
		const side = { where: 'match', side: 'a' } as const;
		const odd = [undefined, 0, 11, 2.5, -3, Number.NaN, Infinity, '3', null];
		const cases = [
			...odd.map((difficulty) => ({ kind: 'add', difficulty })),
			...[undefined, 'adding', 'Add', 7, null, 'constructor'].map((kind) => ({
				kind,
				difficulty: 2
			}))
		];
		for (const { kind, difficulty } of cases) {
			const what = `${String(kind)} at ${String(difficulty)}`;
			const event = {
				type: 'answer-judged',
				side: 'a',
				correct: false,
				topic: 'add',
				kind,
				difficulty
			} as unknown as MatchEvent;
			const after = recordAnswers(before, [event], side);
			expect(after.add, what).toStrictEqual({
				...before.add,
				tried: 2,
				byDifficulty: before.add!.byDifficulty
			});
			// A topic first met so has no counts by difficulty at all, not an empty object.
			const div = recordAnswers({}, [{ ...event, topic: 'div' } as MatchEvent], side);
			expect(div.div, what).toStrictEqual({ tried: 1, right: 0, recent: '' });
		}
	});

	it('counts by difficulty only the answers the totals count, so a save always reads them back, and never writes to the record it is given', () => {
		const most = Number.MAX_SAFE_INTEGER;
		const record = deepFreeze({
			add: {
				tried: most - 1,
				right: most - 1,
				recent: '',
				byDifficulty: { add: [[most - 1, most - 1]] }
			}
		} as PuzzleRecord);
		const after = recordAnswers(
			record,
			[judged('add', true, 2), judged('add', true, 3), judged('add', false, 3)],
			{ where: 'doctor' }
		);
		// The first fills the totals; the next two go past what a save holds, and count nowhere new.
		expect(after.add).toStrictEqual({
			tried: most,
			right: most,
			recent: '',
			byDifficulty: {
				add: [
					[most - 1, most - 1],
					[1, 1]
				]
			}
		});
		// As a save writes the record, and reads it back.
		const saved = readRecord(after);
		expect(readRecord(saved, savedByDifficulty(after))).toStrictEqual(after);
	});

	it("says each judged puzzle's own kind and difficulty, on the way out of a battle and at the druid's", () => {
		let checked = 0;
		for (let seed = 0; seed < 40; seed++) {
			// The escape puzzle: the wild animal's own, and after a miss the kid's animal's.
			let state = startBattle(makeParty(['squirrel']), makeWild(seed % 2 ? 'bear' : 'moose'));
			for (let tries = 0; tries < 2; tries++) {
				const run = applyBattleIntent(state, { type: 'flee' }, seed + tries);
				if (run.state.phase.kind !== 'escaping') throw new Error('not escaping');
				const puzzle = run.state.phase.puzzle;
				const wrong = applyBattleIntent(run.state, { type: 'answer', input: 'x' }, seed);
				expect(wrong.events[0]).toMatchObject({
					type: 'answer-judged',
					correct: false,
					topic: puzzleTopic(puzzle),
					kind: puzzle.kind,
					difficulty: puzzle.difficulty
				});
				checked++;
				if (wrong.state.phase.kind !== 'choose-action') break;
				state = wrong.state;
			}
			// The druid's heal.
			const tired = [{ ...makeParty(['wolf'])[0]!, hp: 1 }];
			const visit = applyDoctorIntent(
				startDoctorVisit(tired),
				{ type: 'pick-patient', partyIndex: 0 },
				seed
			);
			if (visit.state.phase.kind !== 'solving') throw new Error('not solving');
			const puzzle = visit.state.phase.puzzle;
			const healed = applyDoctorIntent(
				visit.state,
				{ type: 'answer', input: answerText(puzzle) },
				seed
			);
			expect(healed.events[0]).toMatchObject({
				type: 'answer-judged',
				correct: true,
				kind: puzzle.kind,
				difficulty: puzzle.difficulty
			});
			checked++;
		}
		expect(checked).toBeGreaterThan(80);
	});
});

/**
 * What a kind asks at every difficulty it has, as a short hash: 25 puzzles
 * a difficulty, each from a seed of its own. Any change to what some
 * difficulty asks (a band, a pattern, a picture's numbers) changes it.
 */
function ladderPrint(kind: PuzzleKind): string {
	const g = getGenerator(kind);
	const lines = [`${g.minDifficulty}..${g.maxDifficulty}`];
	for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
		for (let i = 0; i < 25; i++) {
			const puzzle = g.generate(new Rng(hashInts(4242, d, i)), d);
			lines.push(`${d} ${puzzle.prompt} = ${puzzle.answer}`);
		}
	}
	let h = 0x811c9dc5;
	for (const c of lines.join('\n')) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * What every kind asks (`ladderPrint`) at each `LADDER_VERSION`, oldest first:
 * the last is what the kinds ask now. The record's counts by difficulty are
 * those of `LADDER_VERSION`'s ladders, so when what any kind asks at some
 * difficulty changes, every kind's prints go in a new version at the end, and
 * `LADDER_VERSION` goes up by one to it, however many kinds changed together:
 * every kid's counts start over, and no step of a ladder mixes the answers to
 * two different puzzles. A new kind joins the last version, and no bump: the
 * record counts each kind apart, so no step of another kind's ladder meets it.
 */
const LADDERS: readonly Partial<Record<PuzzleKind, string>>[] = [
	// 1: the school-year ladders of #242 and #243, the first any build counted.
	{
		add: 'fdb0f914',
		sub: '50ac249a',
		mul: 'ab7c922c',
		div: 'aae252ce',
		missing: 'b4ab71a3',
		sequence: 'f7de6062',
		sqrt: 'bafc803c',
		double: '7419f2a1',
		thermometer: 'ea63120f',
		kroner: 'baf2c1ba',
		fraction: 'd82fdde6',
		shape: 'd1d08cba',
		barchart: '20383366',
		clock: '32d98dae',
		balance: 'e7d15a69'
	}
];

describe('the ladders the record counts by difficulty', () => {
	it('LADDER_VERSION goes up by one with every change to what the kinds ask', () => {
		const now = Object.fromEntries(ALL_PUZZLE_KINDS.map((kind) => [kind, ladderPrint(kind)]));
		const last = LADDERS[LADDERS.length - 1]!;
		const told: string[] = [];
		const changed = ALL_PUZZLE_KINDS.filter((k) => last[k] !== undefined && last[k] !== now[k]);
		if (changed.length > 0) {
			told.push(
				`${changed.join(', ')} ask something else now: add ${JSON.stringify(now)} at the end ` +
					`of LADDERS, and set LADDER_VERSION (puzzles/record.ts) to ${LADDERS.length + 1}`
			);
		} else {
			for (const kind of ALL_PUZZLE_KINDS.filter((k) => last[k] === undefined)) {
				told.push(`${kind} is new: add ${kind}: '${now[kind]}' to the last of LADDERS, no bump`);
			}
		}
		expect(told).toEqual([]);
		// Each version asks something the one before did not: no bump without a change.
		for (let v = 1; v < LADDERS.length; v++) {
			const [before, after] = [LADDERS[v - 1]!, LADDERS[v]!];
			const differs = ALL_PUZZLE_KINDS.some(
				(k) => before[k] !== undefined && after[k] !== before[k]
			);
			expect(differs, `LADDERS' version ${v + 1} asks what ${v} did`).toBe(true);
		}
		expect(LADDER_VERSION, 'the versions LADDERS lists').toBe(LADDERS.length);
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
				expect(step.events[0]).toMatchObject({
					type: 'answer-judged',
					correct: true,
					topic,
					kind: puzzle.kind,
					difficulty: puzzle.difficulty
				});
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
			topic: puzzleTopic(state.phase.puzzle),
			kind: state.phase.puzzle.kind,
			difficulty: state.phase.puzzle.difficulty
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
