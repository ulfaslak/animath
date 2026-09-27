import type { AnimalInstance, AttackLevel } from '../animals/types.js';
import type { Puzzle, PuzzleKind } from '../puzzles/types.js';

/**
 * A friendly match between two players ([[PRODUCT]] §4 "Friendly matches").
 * `startMatch` builds the state from both parties, `applyMatchIntent`
 * (reducer.ts) advances it by one side's intent, and `matchView` (view.ts) is
 * what each player is sent. The state and the seed stay with the authority
 * that runs the match (the server): the state holds the open puzzle's answer.
 *
 * Sides are absolute, `a` and `b`, never "you" and "them": the authority
 * says which side sent an intent, and each view says which side it is for.
 */
export type MatchSide = 'a' | 'b';

/** Both sides, `a` first. */
export const MATCH_SIDES: readonly MatchSide[] = ['a', 'b'];

/**
 * Where a match stands. Every phase but the end names the side that acts:
 * only that side's intents are taken (and `leave` and `timeout` from either).
 *
 * - `choose-action`: the side picks an attack and its level, or switches.
 * - `solving`: the side is answering the puzzle its attack asked. The
 *   puzzle carries its answer, so this phase never leaves the authority:
 *   views carry a `ShownPuzzle` instead.
 * - `choose-animal`: the side's animal in front has just been knocked out
 *   (it is still `active`, tired) and the side picks who steps in, for
 *   free; then it takes its turn.
 * - `ended`: `winner` won; `reason` says how the other side lost.
 */
export type MatchPhase =
	| { kind: 'choose-action'; side: MatchSide }
	| { kind: 'solving'; side: MatchSide; attackIndex: number; level: AttackLevel; puzzle: Puzzle }
	| { kind: 'choose-animal'; side: MatchSide }
	| { kind: 'ended'; winner: MatchSide; reason: MatchEndReason };

/**
 * How a match ended, for the side that lost it: no animal left standing, the
 * player left, or the authority reported them gone (`timeout`).
 */
export type MatchEndReason = 'all-tired' | 'left' | 'timed-out';

export interface MatchState {
	/**
	 * Intents accepted so far. With the authority's seed (passed to
	 * `applyMatchIntent`, never stored here) this keys the Rng for the next
	 * intent.
	 */
	step: number;
	/**
	 * The turn being played, 1-based. It goes up by one each time the turn
	 * passes to the other side, so the side that started plays the odd turns.
	 */
	turn: number;
	/**
	 * Each side's team: copies of up to three animals from its party
	 * (`matchTeam`), at full HP, their ids prefixed with the side (`a:…`,
	 * `b:…`). The players' parties are never touched.
	 */
	teams: Readonly<Record<MatchSide, readonly AnimalInstance[]>>;
	/** Index into each side's team of the animal in front. */
	active: Readonly<Record<MatchSide, number>>;
	phase: MatchPhase;
}

/**
 * What a side can choose. Never an outcome: the reducer judges answers and
 * computes damage. The side is not in the intent: the authority knows who
 * sent it (`applyMatchIntent(state, side, intent, seed)`).
 */
export type MatchIntent =
	/** On the side's turn: use attack `attackIndex` (1-based) at `level` (1 easy, 2 medium, 3 hard). */
	| { type: 'attack'; attackIndex: number; level: AttackLevel }
	/** The answer to the side's open puzzle, as typed. */
	| { type: 'answer'; input: string }
	/** On the side's turn, instead of attacking: send in team member `teamIndex`. It is the turn. */
	| { type: 'switch'; teamIndex: number }
	/** After the side's animal was knocked out: who steps in. Free: the side then takes its turn. */
	| { type: 'pick-next'; teamIndex: number }
	/** The side leaves the match, at any time; the other side wins. */
	| { type: 'leave' }
	/**
	 * The authority reports the side gone (it dropped out and did not come
	 * back in time): the other side wins. The engine never reads the clock,
	 * so the authority's timer enters as this intent.
	 */
	| { type: 'timeout' };

/**
 * Why an intent was refused. A code, never words: the client greys out what
 * would be refused, and logs the code for developers.
 */
export type MatchRejection =
	/** Not an object with a known `type`, or an answer whose `input` is not text. */
	| 'not-an-intent'
	| 'match-over'
	/** An attack, an answer, a switch or a pick from the side that is not acting now. */
	| 'not-your-turn'
	/** An attack or a switch outside `choose-action`. */
	| 'not-choosing-an-action'
	/** An answer with no puzzle open. */
	| 'no-puzzle'
	| 'no-such-attack'
	| 'no-such-level'
	/** A pick outside `choose-animal`. */
	| 'not-picking'
	| 'no-such-animal'
	| 'already-in-front'
	| 'tired';

/**
 * A puzzle as the players see it: everything but its answer. Views and
 * events carry this, never a `Puzzle`.
 */
export interface ShownPuzzle {
	kind: PuzzleKind;
	difficulty: number;
	prompt: string;
}

/**
 * What happened, in order, as a result of one intent. Nothing in an event is
 * a secret: no event carries a puzzle's answer, before or after it is
 * judged, so the authority sends the same events to both sides.
 */
export type MatchEvent =
	| {
			type: 'puzzle-shown';
			side: MatchSide;
			attackIndex: number;
			level: AttackLevel;
			puzzle: ShownPuzzle;
	  }
	| { type: 'answer-judged'; side: MatchSide; correct: boolean }
	| {
			type: 'hit';
			attacker: MatchSide;
			attackIndex: number;
			level: AttackLevel;
			damage: number;
			/** The HP of the other side's animal in front, after the hit. */
			targetHp: number;
	  }
	| { type: 'missed'; attacker: MatchSide; attackIndex: number; level: AttackLevel }
	| { type: 'fainted'; side: MatchSide; animal: AnimalInstance }
	/** A `switch` or a `pick-next` was accepted: `animal` (team member `teamIndex`) is in front now. */
	| { type: 'switched'; side: MatchSide; animal: AnimalInstance; teamIndex: number }
	| { type: 'ended'; winner: MatchSide; reason: MatchEndReason }
	/** The intent did not fit. The state is unchanged; the authority tells only the side that sent it. */
	| { type: 'rejected'; reason: MatchRejection };

export interface MatchStep {
	state: MatchState;
	events: readonly MatchEvent[];
}

/** `MatchPhase` as a view shows it: the open puzzle without its answer. */
export type MatchViewPhase =
	| { kind: 'choose-action'; side: MatchSide }
	| {
			kind: 'solving';
			side: MatchSide;
			attackIndex: number;
			level: AttackLevel;
			puzzle: ShownPuzzle;
	  }
	| { kind: 'choose-animal'; side: MatchSide }
	| { kind: 'ended'; winner: MatchSide; reason: MatchEndReason };

/**
 * What one side is sent (`matchView`): the whole match as it stands, with no
 * answer anywhere. Both teams are in it, HP and all; the waiting side sees
 * the acting side's puzzle, without its answer.
 */
export interface MatchView {
	/** The side this view is for. */
	you: MatchSide;
	step: number;
	turn: number;
	teams: Readonly<Record<MatchSide, readonly AnimalInstance[]>>;
	active: Readonly<Record<MatchSide, number>>;
	phase: MatchViewPhase;
}

/** Why a party brings no team to a match (`matchTeam`). */
export type TeamRefusal =
	/**
	 * Not a list of animals: an entry looked at is not an animal with an id of
	 * 1–64 characters and a known species, or repeats an earlier id. A party
	 * from a readable save never is.
	 */
	| 'not-a-party'
	/** No animal in it can fight on land. */
	| 'no-team';

export type TeamPick = { ok: true; team: AnimalInstance[] } | { ok: false; reason: TeamRefusal };
