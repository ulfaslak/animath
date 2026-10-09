import type { BattleEvent } from '../battle/types.js';
import type { DoctorEvent } from '../doctor/types.js';
import type { MatchEvent, MatchSide } from '../match/types.js';
import { puzzleFace } from './face.js';
import { SHAPE } from './generators/shape.js';
import { ALL_PUZZLE_TOPICS, type Puzzle, type PuzzleTopic } from './types.js';

/**
 * The kid's puzzle record ([[PRODUCT]] §4 "Puzzles"): for every topic, how
 * many puzzles of it they were asked and got right, and how the last few
 * went. It is read from the `answer-judged` events, as the count of puzzles
 * solved is (`solved.ts`), so it follows the judgement itself, never a
 * screen. The kid sees the counts ("My puzzles", in the pause menu); the
 * last few set how hard a wild battle's hit of that topic lands
 * (`topicBonus`), which nothing on screen says.
 */

/** How many of a topic's latest answers `recent` keeps: the window the bonus reads. */
export const RECENT_ANSWERS = 20;

/**
 * How many answers' worth the kid's own average weighs in a topic's
 * accuracy (`topicBonus`): a topic answered 3 times is mostly the average,
 * one answered 20 times mostly its own.
 */
export const PRIOR_ANSWERS = 4;

/** The softest and the hardest a topic's hit may land, as a multiple of the attack's damage. */
export const MIN_TOPIC_BONUS = 0.7;
export const MAX_TOPIC_BONUS = 1.6;

/** One topic's answers. */
export interface TopicRecord {
	/** Puzzles of the topic judged, right or wrong. Only grows. */
	tried: number;
	/** Of those, the ones answered right. */
	right: number;
	/**
	 * The latest answers, oldest first, at most `RECENT_ANSWERS`: `1` for a
	 * right one, `0` for a wrong one.
	 */
	recent: string;
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
 * fence `perimeter`.
 */
export function puzzleTopic(puzzle: Pick<Puzzle, 'kind' | 'prompt'>): PuzzleTopic {
	if (puzzle.kind === 'missing') return puzzleFace(puzzle)?.times ? 'mul' : 'missing';
	if (puzzle.kind === 'shape') {
		const how = puzzleFace(puzzle)?.numbers[0];
		return how === SHAPE.fence || how === SHAPE.fenceSide ? 'perimeter' : 'area';
	}
	return puzzle.kind;
}

/** What any reducer's event holds that the record reads. */
interface Judged {
	readonly type: string;
	readonly correct?: boolean;
	readonly side?: string;
	readonly topic?: PuzzleTopic;
}

/**
 * `record` after `events`, the events of one step of a wild battle or a
 * doctor visit: every answer they judged, right or wrong, under its topic.
 * The very same record when they judged none.
 */
export function recordAnswers(
	record: PuzzleRecord,
	events: readonly (BattleEvent | DoctorEvent)[]
): PuzzleRecord;
/**
 * `record` after `events`, a friendly match's: only `side`'s answers, the
 * kid's own, never the other player's.
 */
export function recordAnswers(
	record: PuzzleRecord,
	events: readonly MatchEvent[],
	side: MatchSide
): PuzzleRecord;
export function recordAnswers(
	record: PuzzleRecord,
	events: readonly Judged[],
	side?: MatchSide
): PuzzleRecord {
	let out = record;
	for (const e of events) {
		if (e.type !== 'answer-judged' || typeof e.correct !== 'boolean') continue;
		if (side !== undefined && e.side !== side) continue;
		// A match event from a server from before topics has none: it is not recorded.
		if (e.topic === undefined || !ALL_PUZZLE_TOPICS.includes(e.topic)) continue;
		const was = out[e.topic] ?? { tried: 0, right: 0, recent: '' };
		const recent = (was.recent + (e.correct ? '1' : '0')).slice(-RECENT_ANSWERS);
		out = {
			...out,
			[e.topic]: {
				// No further than a save can hold, as `countSolved`.
				tried: Math.min(was.tried + 1, Number.MAX_SAFE_INTEGER),
				right: Math.min(was.right + (e.correct ? 1 : 0), Number.MAX_SAFE_INTEGER),
				recent
			}
		};
	}
	return out;
}

/**
 * How hard each topic's hit lands in a wild battle ([[PRODUCT]] §4
 * "Puzzles"), from the record's latest answers. A topic's accuracy is its
 * recent answers with `PRIOR_ANSWERS` answers at the kid's average mixed in,
 * `p = (right + k·p̄) / (answers + k)`, where the average `p̄` is the plain
 * mean of the topics met's own accuracies, each topic counting once however
 * often it was asked. The bonus is `p̄ / p`, kept within `MIN_TOPIC_BONUS`
 * and `MAX_TOPIC_BONUS`: a right answer to a topic is worth what the kid's
 * average answer is, `p · bonus = p̄`, so a topic the kid finds hard is no
 * worse a pick than one they always get right. Every topic is 1 for a kid
 * who answers every topic as well as the others (an always-right kid
 * included), and for a kid with no answers yet.
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
	const mean = met.reduce((sum, [, right, n]) => sum + right / n, 0) / met.length;
	// Every answer wrong: no topic is harder than another.
	if (mean === 0) return {};
	const bonus: Partial<Record<PuzzleTopic, number>> = {};
	for (const [topic, right, n] of met) {
		const p = (right + PRIOR_ANSWERS * mean) / (n + PRIOR_ANSWERS);
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
export function isTopicBonus(v: unknown): v is number {
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
 * of topics, each with whole `tried` and `right` counts, `right` no more
 * than `tried`, and a `recent` of at most `RECENT_ANSWERS` ones and zeros,
 * no more of them than `tried` nor ones than `right`. A topic this build
 * does not know, with entries of that shape, is no error: the save keeps it
 * (`readRecord`), and nothing here reads it.
 */
export function recordError(value: unknown): string | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return 'puzzles must be an object';
	}
	for (const [topic, entry] of Object.entries(value)) {
		const where = `puzzles.${topic}`;
		// A topic's name as a topic is named, so no key ever reaches an object's prototype.
		if (!/^[a-z]+$/.test(topic)) return `${where} is not a topic`;
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			return `${where} must be an object`;
		}
		const { tried, right, recent } = entry as Record<string, unknown>;
		if (!Number.isSafeInteger(tried) || (tried as number) < 0) {
			return `${where}.tried must be a whole number`;
		}
		if (!Number.isSafeInteger(right) || (right as number) < 0 || (right as number) > (tried as number)) {
			return `${where}.right must be a whole number no bigger than tried`;
		}
		if (typeof recent !== 'string' || !/^[01]*$/.test(recent) || recent.length > RECENT_ANSWERS) {
			return `${where}.recent must be up to ${RECENT_ANSWERS} ones and zeros`;
		}
		if (recent.length > (tried as number) || recent.replace(/0/g, '').length > (right as number)) {
			return `${where}.recent holds more answers than tried and right`;
		}
	}
	return null;
}

/**
 * The record a save holds, each topic a copy: a topic this build does not
 * know too, so a newer build's topic is written back as it was. Empty when
 * there is none, or it is not a record (`recordError`).
 */
export function readRecord(value: unknown): PuzzleRecord {
	if (value === undefined || recordError(value) !== null) return {};
	const out: Record<string, TopicRecord> = {};
	for (const [topic, entry] of Object.entries(value as Record<string, TopicRecord>)) {
		out[topic] = { tried: entry.tried, right: entry.right, recent: entry.recent };
	}
	return out as PuzzleRecord;
}
