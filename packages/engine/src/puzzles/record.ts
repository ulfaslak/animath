import type { BattleEvent } from '../battle/types.js';
import type { DoctorEvent } from '../doctor/types.js';
import type { MatchEvent, MatchSide } from '../match/types.js';
import { puzzleFace, type PuzzleFace } from './face.js';
import { SHAPE } from './generators/shape.js';
import {
	ALL_PUZZLE_TOPICS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY,
	type Puzzle,
	type PuzzleTopic
} from './types.js';

/**
 * The kid's puzzle record ([[PRODUCT]] §4 "Puzzles"): for every topic, how
 * many puzzles of it they were asked and got right, anywhere, and how their
 * last few in wild battles went. It is read from the `answer-judged`
 * events, as the count of puzzles solved is (`solved.ts`), so it follows
 * the judgement itself, never a screen. The kid sees the counts ("My
 * puzzles", in the pause menu); the last few set how hard a wild battle's
 * hit of that topic lands (`topicBonus`), which nothing on screen says.
 * Only a wild battle's answers go into them, its escape puzzles' too: a
 * miss there costs the turn,
 * where a miss at the druid's or in a friendly match costs nothing,
 * so a kid could miss there on purpose to make a topic look hard.
 * It also counts each topic's answers by difficulty (`byDifficulty`), for
 * the human tuning the puzzle ladders: nothing on screen reads them.
 */

/** How many of a topic's latest answers `recent` keeps: the window the bonus reads. */
export const RECENT_ANSWERS = 20;

/**
 * How many answers' worth the kid's own average weighs in a topic's
 * accuracy (`topicBonus`): a topic answered 3 times is mostly the average,
 * one answered 20 times mostly its own.
 */
const PRIOR_ANSWERS = 4;

/** The softest and the hardest a topic's hit may land, as a multiple of the attack's damage. */
export const MIN_TOPIC_BONUS = 0.7;
export const MAX_TOPIC_BONUS = 1.6;

/**
 * Which puzzle ladders this build asks: what every kind asks at every
 * difficulty. The record's counts by difficulty are this version's only, so
 * a step of a ladder never mixes the answers to two different puzzles: a
 * save's counts of any other version start over (`readRecord`). Goes up by
 * one whenever a kind's puzzles at some difficulty change; `record.test.ts`
 * pins every kind's ladder and says when.
 */
export const LADDER_VERSION = 1;

/** One difficulty's answers of a topic: how many were judged, and how many of those were right. */
export type DifficultyCount = readonly [tried: number, right: number];

/** One topic's answers. */
export interface TopicRecord {
	/** Puzzles of the topic judged, right or wrong. Only grows. */
	tried: number;
	/** Of those, the ones answered right. */
	right: number;
	/**
	 * The latest answers in wild battles, oldest first, at most
	 * `RECENT_ANSWERS`: `1` for a right one, `0` for a wrong one.
	 */
	recent: string;
	/**
	 * The same answers by the difficulty of their puzzle: difficulty `d`'s at
	 * index `d − 1`, `[0, 0]` where none was, up to the highest one answered.
	 * Only answers judged under this build's ladders (`LADDER_VERSION`) by a
	 * build that counts them, so they add up to no more than `tried` and
	 * `right`: an older build's answers, and every one from before, have no
	 * difficulty. Missing until there is one.
	 */
	byDifficulty?: readonly DifficultyCount[];
}

/** The record: a topic never asked has no entry. */
export type PuzzleRecord = Readonly<Partial<Record<PuzzleTopic, TopicRecord>>>;

/**
 * How hard a wild battle's hit lands per topic, a multiple of the attack's
 * damage: a topic missing here lands as it is (1).
 */
export type TopicBonus = Readonly<Partial<Record<PuzzleTopic, number>>>;

/**
 * The topic a puzzle is, as the kid sees it: its kind, except that a
 * missing number in a times table is `mul`, and a floor is `area` and a
 * fence `perimeter` (`faceTopic`, read off its prompt).
 */
export function puzzleTopic(puzzle: Pick<Puzzle, 'kind' | 'prompt'>): PuzzleTopic {
	if (puzzle.kind !== 'missing' && puzzle.kind !== 'shape') return puzzle.kind;
	return faceTopic(puzzleFace(puzzle) ?? { kind: puzzle.kind, numbers: [] });
}

/**
 * The topic of the puzzle a face shows: its kind, except that a missing
 * number in a times table (`times`) is `mul`, and a shape's fence or a
 * side from its fence (`SHAPE`) is `perimeter`, any other shape `area`.
 */
export function faceTopic(face: PuzzleFace): PuzzleTopic {
	if (face.kind === 'missing') return face.times ? 'mul' : 'missing';
	if (face.kind === 'shape') {
		const how = face.numbers[0];
		return how === SHAPE.fence || how === SHAPE.fenceSide ? 'perimeter' : 'area';
	}
	return face.kind;
}

/** What any reducer's event holds that the record reads. */
interface Judged {
	readonly type: string;
	readonly correct?: boolean;
	readonly side?: string;
	readonly topic?: PuzzleTopic;
	readonly difficulty?: number;
}

/** Where the events were judged: a wild battle's go into `recent` too; a match's are only `side`'s. */
export type Judging =
	{ where: 'battle' } | { where: 'doctor' } | { where: 'match'; side: MatchSide };

/**
 * `record` after `events`, the events of one step of a wild battle, a
 * doctor visit or a friendly match (`where`): every answer they judged,
 * right or wrong, under its topic, and at its difficulty too when the event
 * says one a puzzle can have (a match's server from before difficulties
 * says none), in a match only `side`'s, the kid's own; a wild battle's in
 * `recent` too. The very same record when they judged none.
 */
export function recordAnswers(
	record: PuzzleRecord,
	events: readonly (BattleEvent | DoctorEvent | MatchEvent)[],
	judging: Judging
): PuzzleRecord {
	let out = record;
	for (const e of events as readonly Judged[]) {
		if (e.type !== 'answer-judged' || typeof e.correct !== 'boolean') continue;
		if (judging.where === 'match' && e.side !== judging.side) continue;
		// A match event from a server from before topics has none: it is not recorded.
		if (e.topic === undefined || !ALL_PUZZLE_TOPICS.includes(e.topic)) continue;
		const was = out[e.topic] ?? { tried: 0, right: 0, recent: '' };
		const recent =
			judging.where === 'battle'
				? (was.recent + (e.correct ? '1' : '0')).slice(-RECENT_ANSWERS)
				: was.recent;
		const byDifficulty = isDifficulty(e.difficulty)
			? countAt(was.byDifficulty ?? [], e.difficulty, e.correct)
			: was.byDifficulty;
		const next: TopicRecord = {
			// No further than a save can hold, as `countSolved`.
			tried: Math.min(was.tried + 1, Number.MAX_SAFE_INTEGER),
			right: Math.min(was.right + (e.correct ? 1 : 0), Number.MAX_SAFE_INTEGER),
			recent
		};
		if (byDifficulty) next.byDifficulty = byDifficulty;
		out = { ...out, [e.topic]: next };
	}
	return out;
}

/** A difficulty a puzzle can have: a whole number from `MIN_DIFFICULTY` to `MAX_DIFFICULTY`. */
function isDifficulty(v: unknown): v is number {
	return (
		Number.isSafeInteger(v) && (v as number) >= MIN_DIFFICULTY && (v as number) <= MAX_DIFFICULTY
	);
}

/** `counts` with one more answer at `difficulty`, right or not: a new list, as long as it needs. */
function countAt(
	counts: readonly DifficultyCount[],
	difficulty: number,
	correct: boolean
): DifficultyCount[] {
	const out = counts.map(([tried, right]): DifficultyCount => [tried, right]);
	while (out.length < difficulty) out.push([0, 0]);
	const [tried, right] = out[difficulty - 1]!;
	out[difficulty - 1] = [
		Math.min(tried + 1, Number.MAX_SAFE_INTEGER),
		Math.min(right + (correct ? 1 : 0), Number.MAX_SAFE_INTEGER)
	];
	return out;
}

/**
 * How hard each topic's hit lands in a wild battle ([[PRODUCT]] §4
 * "Puzzles"), from the record's latest answers in wild battles (`recent`),
 * over the topics met there. Every accuracy is pulled towards a wider one
 * by `PRIOR_ANSWERS` answers' worth, `(right + k·wider) / (answers + k)`, so
 * a few answers swing little: the kid's average `p̄` is the plain mean of
 * the topics' accuracies, each pulled towards the kid's overall accuracy
 * (every recent answer together), each topic counting once however often it
 * was asked; and a topic's own `p` is pulled towards `p̄`. The bonus is
 * `p̄ / p`, kept within `MIN_TOPIC_BONUS` and `MAX_TOPIC_BONUS`: a right
 * answer to a topic is worth what the kid's average answer is, `p · bonus =
 * p̄`, so a topic the kid finds hard is no worse a pick than one they always
 * get right. Every topic is 1 for a kid who answers every topic as well as
 * the others (an always-right kid included), and for a kid with no answers
 * yet.
 */
export function topicBonus(record: PuzzleRecord): TopicBonus {
	const met: [PuzzleTopic, number, number][] = [];
	for (const topic of ALL_PUZZLE_TOPICS) {
		const recent = record[topic]?.recent ?? '';
		if (recent.length === 0) continue;
		const right = [...recent].filter((c) => c === '1').length;
		met.push([topic, right, recent.length]);
	}
	if (met.length === 0) return {};
	const pull = (right: number, n: number, towards: number) =>
		(right + PRIOR_ANSWERS * towards) / (n + PRIOR_ANSWERS);
	const overall =
		met.reduce((sum, [, right]) => sum + right, 0) / met.reduce((sum, [, , n]) => sum + n, 0);
	const mean = met.reduce((sum, [, right, n]) => sum + pull(right, n, overall), 0) / met.length;
	// Every answer wrong: no topic is harder than another.
	if (mean === 0) return {};
	const bonus: Partial<Record<PuzzleTopic, number>> = {};
	for (const [topic, right, n] of met) {
		const p = pull(right, n, mean);
		bonus[topic] = Math.min(MAX_TOPIC_BONUS, Math.max(MIN_TOPIC_BONUS, mean / p));
	}
	return bonus;
}

/** `topic`'s bonus in `bonus`: 1 when it has none, or when it is not a bonus a battle could hold. */
export function bonusOf(bonus: TopicBonus | undefined, topic: PuzzleTopic): number {
	const b = bonus?.[topic];
	return isTopicBonus(b) ? b : 1;
}

/** A number a topic's bonus can be: within `MIN_TOPIC_BONUS` and `MAX_TOPIC_BONUS`. */
function isTopicBonus(v: unknown): v is number {
	return typeof v === 'number' && v >= MIN_TOPIC_BONUS && v <= MAX_TOPIC_BONUS;
}

/**
 * A bonus read from a saved battle: an object of topics this build knows,
 * each a number `isTopicBonus` takes. A new object of those alone, or null.
 */
export function readTopicBonus(value: unknown): TopicBonus | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const out: Partial<Record<PuzzleTopic, number>> = {};
	for (const [key, b] of Object.entries(value)) {
		if (!(ALL_PUZZLE_TOPICS as readonly string[]).includes(key) || !isTopicBonus(b)) return null;
		out[key as PuzzleTopic] = b;
	}
	return out;
}

/**
 * Why `value` is not a record a save can hold, or null when it is: an object
 * of topics, each of this build's topics with whole `tried` and `right`
 * counts, `right` no more than `tried`, and a `recent` of at most
 * `RECENT_ANSWERS` ones and zeros, no more ones than `right` nor zeros than
 * the wrong ones (`tried − right`). A topic this build does not have is
 * named as a content id is (lower-case words joined by hyphens) and holds
 * anything: the save keeps it as it was (`readRecord`), and nothing here
 * reads it. A later build that changes what this build's topics hold (a
 * longer `recent`, another field) bumps `SAVE_VERSION`.
 */
export function recordError(value: unknown): string | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return 'puzzles must be an object';
	}
	for (const [topic, entry] of Object.entries(value)) {
		const where = `puzzles.${topic}`;
		// Named as an id is, so no key ever reaches an object's prototype (`__proto__`).
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic)) return `${where} is not a topic`;
		if (!(ALL_PUZZLE_TOPICS as readonly string[]).includes(topic)) continue;
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			return `${where} must be an object`;
		}
		const { tried, right, recent } = entry as Record<string, unknown>;
		if (!Number.isSafeInteger(tried) || (tried as number) < 0) {
			return `${where}.tried must be a whole number`;
		}
		if (
			!Number.isSafeInteger(right) ||
			(right as number) < 0 ||
			(right as number) > (tried as number)
		) {
			return `${where}.right must be a whole number no bigger than tried`;
		}
		if (typeof recent !== 'string' || !/^[01]*$/.test(recent) || recent.length > RECENT_ANSWERS) {
			return `${where}.recent must be up to ${RECENT_ANSWERS} ones and zeros`;
		}
		const ones = recent.replace(/0/g, '').length;
		if (ones > (right as number) || recent.length - ones > (tried as number) - (right as number)) {
			return `${where}.recent holds more right or wrong answers than the counts`;
		}
	}
	return null;
}

/**
 * The record's counts by difficulty as a save holds them: a field of their
 * own beside `puzzles`, which keeps the shape every older build reads, so an
 * older build carrying on with the save keeps them as they were (a field it
 * does not know), where it would drop a field inside a topic.
 */
export interface SavedByDifficulty {
	/** The ladders they were counted under (`LADDER_VERSION`). */
	ladder: number;
	/** By topic, each as `TopicRecord.byDifficulty`. */
	topics: Record<string, DifficultyCount[]>;
}

/**
 * Why `value` is not the counts by difficulty a save can hold beside
 * `puzzles` (a record `recordError` takes), or null when it is: an object
 * of a whole `ladder` from 1 and `topics`, an object of topics named as
 * ids. Of this build's ladders (`LADDER_VERSION`), each of this build's
 * topics holds at most `MAX_DIFFICULTY` pairs of whole numbers, `[tried,
 * right]` with `right` no more than `tried`, adding up to no more answers,
 * right ones or wrong ones than the topic's counts in `puzzles`; a topic
 * this build does not have holds anything. Of other ladders, `topics`
 * holds anything: `readRecord` starts them over. A later build that changes
 * what this build's ladders' topics hold bumps `SAVE_VERSION`.
 */
export function byDifficultyError(value: unknown, puzzles: unknown): string | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return 'byDifficulty must be an object';
	}
	const { ladder, topics } = value as Record<string, unknown>;
	if (!Number.isSafeInteger(ladder) || (ladder as number) < 1) {
		return 'byDifficulty.ladder must be a whole number of 1 or more';
	}
	if (typeof topics !== 'object' || topics === null || Array.isArray(topics)) {
		return 'byDifficulty.topics must be an object';
	}
	for (const [topic, counts] of Object.entries(topics)) {
		const where = `byDifficulty.topics.${topic}`;
		// Named as an id is, so no key ever reaches an object's prototype (`__proto__`).
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic)) return `${where} is not a topic`;
		if (ladder !== LADDER_VERSION) continue;
		if (!(ALL_PUZZLE_TOPICS as readonly string[]).includes(topic)) continue;
		if (!Array.isArray(counts) || counts.length > MAX_DIFFICULTY) {
			return `${where} must be a list of up to ${MAX_DIFFICULTY} counts`;
		}
		let tried = 0;
		let right = 0;
		for (let i = 0; i < counts.length; i++) {
			const pair: unknown = counts[i];
			if (
				!Array.isArray(pair) ||
				pair.length !== 2 ||
				!Number.isSafeInteger(pair[0]) ||
				!Number.isSafeInteger(pair[1]) ||
				pair[1] < 0 ||
				pair[1] > pair[0]
			) {
				return `${where}[${i}] must be [tried, right]: whole numbers, right no bigger than tried`;
			}
			tried += pair[0] as number;
			right += pair[1] as number;
		}
		const entry = (puzzles as Partial<Record<string, TopicRecord>> | undefined)?.[topic];
		const was = { tried: entry?.tried ?? 0, right: entry?.right ?? 0 };
		if (tried > was.tried || right > was.right || tried - right > was.tried - was.right) {
			return `${where} holds more answers, right or wrong, than puzzles.${topic}`;
		}
	}
	return null;
}

/**
 * The record a save holds, each topic a copy: a topic this build does not
 * have too, as it was, so a newer build's topic is written back unchanged.
 * Empty when there is none, or it is not a record (`recordError`). Each of
 * this build's topics takes its counts by difficulty from `byDifficulty`,
 * the save's field beside it, when they are of this build's ladders
 * (`LADDER_VERSION`) and the field is one `byDifficultyError` takes; any
 * other ladders' start over, with none, as do a topic's this build does
 * not have.
 */
export function readRecord(value: unknown, byDifficulty?: unknown): PuzzleRecord {
	if (value === undefined || recordError(value) !== null) return {};
	const counted =
		byDifficulty !== undefined &&
		byDifficultyError(byDifficulty, value) === null &&
		(byDifficulty as SavedByDifficulty).ladder === LADDER_VERSION
			? (byDifficulty as SavedByDifficulty).topics
			: {};
	const out: Record<string, unknown> = {};
	for (const [topic, entry] of Object.entries(value as Record<string, TopicRecord>)) {
		if (!(ALL_PUZZLE_TOPICS as readonly string[]).includes(topic)) {
			out[topic] = JSON.parse(JSON.stringify(entry ?? null)) as unknown;
			continue;
		}
		const copy: TopicRecord = { tried: entry.tried, right: entry.right, recent: entry.recent };
		const counts = Object.prototype.hasOwnProperty.call(counted, topic)
			? counted[topic]
			: undefined;
		if (counts && counts.length > 0) {
			copy.byDifficulty = counts.map(([tried, right]): DifficultyCount => [tried, right]);
		}
		out[topic] = copy;
	}
	return out as PuzzleRecord;
}

/**
 * The counts by difficulty a save holds beside the record (`readRecord`
 * reads them back), of this build's ladders: every topic of this build's
 * that has some, each a copy. Undefined when none has.
 */
export function savedByDifficulty(record: PuzzleRecord): SavedByDifficulty | undefined {
	const topics: Record<string, DifficultyCount[]> = {};
	for (const topic of ALL_PUZZLE_TOPICS) {
		const counts = record[topic]?.byDifficulty;
		if (counts && counts.length > 0) {
			topics[topic] = counts.map(([tried, right]): DifficultyCount => [tried, right]);
		}
	}
	return Object.keys(topics).length > 0 ? { ladder: LADDER_VERSION, topics } : undefined;
}
