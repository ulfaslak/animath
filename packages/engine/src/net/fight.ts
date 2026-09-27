import { ANIMALS, getAnimal } from '../animals/catalog.js';
import {
	ATTACK_LEVELS,
	REALMS,
	type AnimalInstance,
	type AttackLevel,
	type Realm
} from '../animals/types.js';
import type { BattleEvent, BattleOutcome, BattleState } from '../battle/types.js';
import { MATCH_SIDES, type MatchEvent, type MatchSide, type MatchState } from '../match/types.js';
import { isRude } from '../names.js';
import { normalizeNickname } from '../party/names.js';
import { puzzleFace, readPuzzleFace, type PuzzleFace } from '../puzzles/face.js';

/**
 * A battle seen from outside ([[PRODUCT]] §4 "Playing together"): what the
 * players near someone in a battle see of it, drawn beside them in the world.
 * Two animals facing each other, whose turn it is and the puzzle they are
 * thinking about, and what just happened: a hit and its damage, a miss, a
 * leash thrown, a switch, a knock-out, the end.
 *
 * Side `a` is the player whose battle it is (in a friendly match, the
 * match's side `a`), side `b` the wild animal (the match's side `b`).
 *
 * Nothing in it is words: species by id, a nickname only as the nickname
 * rules keep it and without a rude word (else the animal goes by its kind),
 * numbers within bounds, and the puzzle as numbers (`PuzzleFace`), which the
 * watching page writes out with the engine's own formatter. So a page that
 * lies about its battle can show the others a made-up fight, but never put a
 * word in anyone's thought bubble: there is no chat. And never an answer:
 * the view holds the question, and an event only whether an answer was right.
 *
 * A wild battle is its fighter's page's to report (the browser decides it);
 * a friendly match is the server's, built from its own state.
 */

/** An animal in a fight, as a player near it sees it: its kind, the name its owner gave it, its HP. */
export interface FightAnimal {
	species: string;
	nickname?: string;
	hp: number;
}

/** How a fight stands. */
export interface FightView {
	/** Where it is fought: on land, or out on the water from the boat. */
	realm: Realm;
	/** Each side's animal in front. */
	a: FightAnimal;
	b: FightAnimal;
	/** The side whose turn it is (in a wild battle always `a`: the wild animal's reply is instant), or null once it is over. */
	turn: MatchSide | null;
	/** The puzzle that side is solving, as numbers, or null while they choose. */
	puzzle: PuzzleFace | null;
}

/**
 * How a fight ended: an animal was knocked out and none of its side is left
 * standing (`tired`), the wild animal was caught (`caught`), the player ran
 * off (`fled`), or a player left a friendly match or timed out (`left`).
 */
export const FIGHT_ENDS = ['tired', 'caught', 'fled', 'left'] as const;
export type FightEnd = (typeof FIGHT_ENDS)[number];

/** What happened, in order: the step's events, as the players near it see them. */
export type FightEvent =
	/** `side` has a new puzzle to solve. */
	| { type: 'puzzle'; side: MatchSide; puzzle: PuzzleFace }
	/** `side` answered: right or wrong. Never what they typed, never the answer. */
	| { type: 'judged'; side: MatchSide; correct: boolean }
	/** `attacker`'s animal hit the other's for `damage` at `level`, leaving it `hp`. */
	| { type: 'hit'; attacker: MatchSide; level: AttackLevel; damage: number; hp: number }
	| { type: 'missed'; attacker: MatchSide }
	/** Side `a` threw the leash at the wild animal: it held, or was shaken off. */
	| { type: 'leash'; caught: boolean }
	/** `side` sent `animal` in. */
	| { type: 'switched'; side: MatchSide; animal: FightAnimal }
	/** `side`'s animal in front is tired. */
	| { type: 'fainted'; side: MatchSide }
	/** It is over: `winner` won (null: nobody did, the player ran), and `how`. */
	| { type: 'ended'; winner: MatchSide | null; how: FightEnd };

/** The most events one fight message carries: one step causes at most eight. */
export const MAX_FIGHT_EVENTS = 16;

/**
 * An animal as the others see it: the nickname only when the nickname rules
 * keep it as it is (`normalizeNickname`, a fixed point) and it holds no rude
 * word (`isRude`); else none, and the animal goes by its kind.
 */
export function fightAnimal(
	animal: Pick<AnimalInstance, 'speciesId' | 'nickname' | 'hp'>
): FightAnimal {
	const nickname = cleanNickname(animal.nickname);
	return nickname === undefined
		? { species: animal.speciesId, hp: animal.hp }
		: { species: animal.speciesId, nickname, hp: animal.hp };
}

/** A nickname another player may read: one the rules keep as it is, with no rude word in it. */
function cleanNickname(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const clean = normalizeNickname(raw);
	return clean !== undefined && clean === raw && !isRude(clean) ? clean : undefined;
}

// --- a wild battle, from its fighter's page ------------------------------------------

/** How a wild battle stands, as the players near its fighter see it. */
export function wildFight(state: BattleState): FightView {
	const phase = state.phase;
	return {
		realm: state.realm,
		a: fightAnimal(state.party[state.active]!),
		b: fightAnimal(state.opponent),
		turn: phase.kind === 'ended' ? null : 'a',
		puzzle: phase.kind === 'solving' ? puzzleFace(phase.puzzle) : null
	};
}

const WILD_SIDE = { player: 'a', opponent: 'b' } as const;

const WILD_END: Record<BattleOutcome, { winner: MatchSide | null; how: FightEnd }> = {
	won: { winner: 'a', how: 'tired' },
	lost: { winner: 'b', how: 'tired' },
	caught: { winner: 'a', how: 'caught' },
	fled: { winner: null, how: 'fled' }
};

/** A wild battle step's events, as the players near its fighter see them. */
export function wildFightEvents(events: readonly BattleEvent[]): FightEvent[] {
	const seen: FightEvent[] = [];
	for (const event of events) {
		switch (event.type) {
			case 'puzzle-shown': {
				const puzzle = puzzleFace(event.puzzle);
				if (puzzle) seen.push({ type: 'puzzle', side: 'a', puzzle });
				break;
			}
			case 'answer-judged':
				seen.push({ type: 'judged', side: 'a', correct: event.correct });
				break;
			case 'hit':
				seen.push({
					type: 'hit',
					attacker: WILD_SIDE[event.attacker],
					level: event.level,
					damage: event.damage,
					hp: event.targetHp
				});
				break;
			case 'missed':
				seen.push({ type: 'missed', attacker: WILD_SIDE[event.attacker] });
				break;
			case 'leash-thrown':
				seen.push({ type: 'leash', caught: event.success });
				break;
			case 'switched':
				seen.push({ type: 'switched', side: 'a', animal: fightAnimal(event.animal) });
				break;
			case 'fainted':
				seen.push({ type: 'fainted', side: WILD_SIDE[event.side] });
				break;
			case 'ended':
				seen.push({ type: 'ended', ...WILD_END[event.outcome] });
				break;
			case 'fled':
			case 'rejected':
				// Running is its `ended`; a refusal changed nothing.
				break;
		}
	}
	return seen.slice(-MAX_FIGHT_EVENTS);
}

// --- a friendly match, from the server's own state -----------------------------------

/** How a friendly match stands, as the players near its two players see it. */
export function matchFight(state: MatchState): FightView {
	const phase = state.phase;
	return {
		realm: 'land',
		a: fightAnimal(state.teams.a[state.active.a]!),
		b: fightAnimal(state.teams.b[state.active.b]!),
		turn: phase.kind === 'ended' ? null : phase.side,
		puzzle: phase.kind === 'solving' ? puzzleFace(phase.puzzle) : null
	};
}

/** A match step's events, as the players near its two players see them. */
export function matchFightEvents(events: readonly MatchEvent[]): FightEvent[] {
	const seen: FightEvent[] = [];
	for (const event of events) {
		switch (event.type) {
			case 'puzzle-shown': {
				const puzzle = puzzleFace(event.puzzle);
				if (puzzle) seen.push({ type: 'puzzle', side: event.side, puzzle });
				break;
			}
			case 'answer-judged':
				seen.push({ type: 'judged', side: event.side, correct: event.correct });
				break;
			case 'hit':
				seen.push({
					type: 'hit',
					attacker: event.attacker,
					level: event.level,
					damage: event.damage,
					hp: event.targetHp
				});
				break;
			case 'missed':
				seen.push({ type: 'missed', attacker: event.attacker });
				break;
			case 'switched':
				seen.push({ type: 'switched', side: event.side, animal: fightAnimal(event.animal) });
				break;
			case 'fainted':
				seen.push({ type: 'fainted', side: event.side });
				break;
			case 'ended':
				seen.push({
					type: 'ended',
					winner: event.winner,
					how: event.reason === 'all-tired' ? 'tired' : 'left'
				});
				break;
			case 'rejected':
				break;
		}
	}
	return seen.slice(-MAX_FIGHT_EVENTS);
}

// --- reading ---------------------------------------------------------------------

const SPECIES: ReadonlySet<string> = new Set(ANIMALS.map((a) => a.id));
/** The most HP any animal has: damage and HP on the wire are whole numbers up to it. */
const MAX_FIGHT_HP = Math.max(...ANIMALS.map((a) => a.maxHp));
/** The most UTF-16 units a nickname takes on the wire, before the rules read it. */
const MAX_WIRE_NICKNAME = 64;

type Fields = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Fields {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWhole(value: unknown, min: number, max: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isSide(value: unknown): value is MatchSide {
	return MATCH_SIDES.includes(value as MatchSide);
}

/**
 * An animal off the wire: a species this build knows, HP within its own,
 * and a nickname only when the rules keep it as it is and it holds no rude
 * word; a nickname that is not one of those is dropped, not the animal.
 */
function readFightAnimal(value: unknown): FightAnimal | null {
	if (!isRecord(value)) return null;
	const { species, nickname, hp } = value;
	if (typeof species !== 'string' || !SPECIES.has(species)) return null;
	if (!isWhole(hp, 0, getAnimal(species).maxHp)) return null;
	if (nickname === undefined) return { species, hp };
	if (typeof nickname !== 'string' || nickname.length > MAX_WIRE_NICKNAME) return null;
	return fightAnimal({ speciesId: species, nickname, hp });
}

/** A fight's view off the wire, or null: a new object of its known fields. */
export function readFightView(value: unknown): FightView | null {
	if (!isRecord(value)) return null;
	const a = readFightAnimal(value.a);
	const b = readFightAnimal(value.b);
	if (!a || !b || !REALMS.includes(value.realm as Realm)) return null;
	const turn = value.turn === null ? null : isSide(value.turn) ? value.turn : undefined;
	const puzzle = value.puzzle === null ? null : readPuzzleFace(value.puzzle);
	if (turn === undefined || (value.puzzle !== null && puzzle === null)) return null;
	return { realm: value.realm as Realm, a, b, turn, puzzle };
}

function readFightEvent(value: unknown): FightEvent | null {
	if (!isRecord(value)) return null;
	const { type } = value;
	switch (type) {
		case 'puzzle': {
			const puzzle = readPuzzleFace(value.puzzle);
			return puzzle && isSide(value.side) ? { type, side: value.side, puzzle } : null;
		}
		case 'judged':
			return isSide(value.side) && typeof value.correct === 'boolean'
				? { type, side: value.side, correct: value.correct }
				: null;
		case 'hit': {
			const { attacker, level, damage, hp } = value;
			if (!isSide(attacker) || !ATTACK_LEVELS.includes(level as AttackLevel)) return null;
			if (!isWhole(damage, 0, MAX_FIGHT_HP) || !isWhole(hp, 0, MAX_FIGHT_HP)) return null;
			return { type, attacker, level: level as AttackLevel, damage, hp };
		}
		case 'missed':
			return isSide(value.attacker) ? { type, attacker: value.attacker } : null;
		case 'leash':
			return typeof value.caught === 'boolean' ? { type, caught: value.caught } : null;
		case 'switched': {
			const animal = readFightAnimal(value.animal);
			return animal && isSide(value.side) ? { type, side: value.side, animal } : null;
		}
		case 'fainted':
			return isSide(value.side) ? { type, side: value.side } : null;
		case 'ended': {
			const winner = value.winner === null ? null : isSide(value.winner) ? value.winner : undefined;
			return winner !== undefined && FIGHT_ENDS.includes(value.how as FightEnd)
				? { type, winner, how: value.how as FightEnd }
				: null;
		}
		default:
			return null;
	}
}

/** A fight's events off the wire, at most `MAX_FIGHT_EVENTS`, or null when any is not one. */
export function readFightEvents(value: unknown): FightEvent[] | null {
	if (!Array.isArray(value) || value.length > MAX_FIGHT_EVENTS) return null;
	const events: FightEvent[] = [];
	for (const entry of value) {
		const event = readFightEvent(entry);
		if (!event) return null;
		events.push(event);
	}
	return events;
}
