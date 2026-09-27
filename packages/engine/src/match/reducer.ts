import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance, AttackLevel } from '../animals/types.js';
import { attackPuzzle, attackRefusal, landHit } from '../battle/attack.js';
import { leadIndex } from '../party/reducer.js';
import { checkAnswer } from '../puzzles/registry.js';
import { Rng, hashInts, hashString } from '../rng.js';
import { matchTeam } from './team.js';
import {
	MATCH_SIDES,
	type MatchEndReason,
	type MatchEvent,
	type MatchIntent,
	type MatchRejection,
	type MatchSide,
	type MatchState,
	type MatchStep,
	type MatchView
} from './types.js';
import { shownPuzzle, viewAnimal } from './view.js';

/**
 * The friendly-match reducer: pure rules for one match between two players
 * ([[PRODUCT]] §4 "Friendly matches").
 *
 *   matchTeam(party)                              → the team a party brings (team.ts)
 *   startMatch({ a, b }, seed)                    → MatchState
 *   applyMatchIntent(state, side, intent, seed)   → { state, events }
 *   matchView(state, side)                        → what that side is sent (view.ts)
 *
 * All pure. No input is mutated; every accepted intent returns a fresh state
 * and the events that explain it, in order, and a refused one returns the
 * same state with a single `rejected` event. The seed is the authority's
 * secret and travels with each call, never inside the state: a coin flip
 * keyed by it decides who starts, and the n-th accepted intent draws from
 * `hashInts(seed, n)`, so a match replays exactly from `(seed, parties,
 * (side, intent) log)`. Only an attack draws (its puzzle).
 *
 * Turns alternate. On its turn a side attacks (picks an attack and a level,
 * then answers the puzzle it asks) or switches, and either passes the turn.
 * An attack is asked and hits exactly as in a wild battle (`battle/attack.ts`):
 * a right answer hits for the attack's damage, a wrong one misses. There is no
 * wild animal here, so nobody misses on their own, and nothing is caught or
 * run from. A knocked-out animal's side picks who steps in, for free, and
 * then takes its turn; a side with nobody standing has lost. Either side may
 * leave at any time, and the authority reports a side that dropped out
 * (`timeout`); both end the match, won by the other side.
 *
 * The state holds the open puzzle's answer: it stays with the authority, and
 * each player is sent `matchView`. Nothing here is worded.
 */

/** Keys the coin flip's Rng apart from every intent's, `hashInts(seed, step)`. */
const COIN = hashString('coin');

const INTENT_TYPES: ReadonlySet<string> = new Set<MatchIntent['type']>([
	'attack',
	'answer',
	'switch',
	'pick-next',
	'leave',
	'timeout'
]);

/**
 * A new match between the parties of sides `a` and `b`, each brought as
 * `matchTeam` builds its team (a team works as well as a party: the helper is
 * idempotent), with every animal's id prefixed with its side (`a:starter`,
 * `b:starter`): old saves share the literal id `starter`. A coin flip keyed by
 * `seed` decides which side starts. Throws when a side brings no team: the
 * authority asks `matchTeam` first.
 */
export function startMatch(
	parties: Readonly<Record<MatchSide, unknown>>,
	seed: number
): MatchState {
	checkSeed('startMatch', seed);
	const team = (side: MatchSide): AnimalInstance[] => {
		const pick = matchTeam(parties[side]);
		if (!pick.ok) throw new Error(`startMatch: side ${side} brings no team (${pick.reason})`);
		return pick.team.map((animal) => ({ ...animal, id: `${side}:${animal.id}` }));
	};
	const first: MatchSide = new Rng(hashInts(seed, COIN)).chance(0.5) ? 'a' : 'b';
	return {
		step: 0,
		turn: 1,
		teams: { a: team('a'), b: team('b') },
		active: { a: 0, b: 0 },
		phase: { kind: 'choose-action', side: first }
	};
}

/**
 * Apply one intent from `side`, which the authority knows from the
 * connection it came in on (for `timeout`, the side it reports gone). `seed`
 * is the match's seed, held by the authority; the same seed goes with every
 * intent of one match.
 */
export function applyMatchIntent(
	state: MatchState,
	side: MatchSide,
	intent: MatchIntent,
	seed: number
): MatchStep {
	checkSeed('applyMatchIntent', seed);
	if (!MATCH_SIDES.includes(side)) throw new Error(`applyMatchIntent: no side ${String(side)}`);
	if (!isIntent(intent)) return reject(state, 'not-an-intent');
	const { phase } = state;
	if (phase.kind === 'ended') return reject(state, 'match-over');
	if (intent.type === 'leave') return end(state, otherSide(side), 'left');
	if (intent.type === 'timeout') return end(state, otherSide(side), 'timed-out');
	if (phase.side !== side) return reject(state, 'not-your-turn');
	switch (intent.type) {
		case 'attack':
			return attack(state, side, seed, intent.attackIndex, intent.level);
		case 'answer':
			return answer(state, side, intent.input);
		case 'switch':
			return switchAnimal(state, side, intent.teamIndex);
		case 'pick-next':
			return pickNext(state, side, intent.teamIndex);
	}
}

/**
 * Whether `side` may send team member `teamIndex` in now: it is that side's
 * choice (a `switch` in `choose-action`, a `pick-next` in `choose-animal`),
 * and the animal is in the team, standing and not already in front. The
 * reducer decides by the same rule, and a client greys out whoever it rules
 * out; it takes a view as well as a state.
 */
export function canSendIn(
	match: MatchState | MatchView,
	side: MatchSide,
	teamIndex: number
): boolean {
	const { phase } = match;
	if (phase.kind !== 'choose-action' && phase.kind !== 'choose-animal') return false;
	return phase.side === side && sendInRefusal(match, side, teamIndex) === null;
}

/** The other side. */
export function otherSide(side: MatchSide): MatchSide {
	return side === 'a' ? 'b' : 'a';
}

// --- intents ---------------------------------------------------------------

function attack(
	state: MatchState,
	side: MatchSide,
	seed: number,
	attackIndex: number,
	level: AttackLevel
): MatchStep {
	if (state.phase.kind !== 'choose-action') return reject(state, 'not-choosing-an-action');
	const spec = getAnimal(inFront(state, side).speciesId);
	const refusal = attackRefusal(spec, attackIndex, level);
	if (refusal !== null) return reject(state, refusal);
	const puzzle = attackPuzzle(new Rng(hashInts(seed, state.step)), spec, attackIndex, level);
	return accept(state, { phase: { kind: 'solving', side, attackIndex, level, puzzle } }, [
		{ type: 'puzzle-shown', side, attackIndex, level, puzzle: shownPuzzle(puzzle) }
	]);
}

/**
 * Judge the answer (`checkAnswer`). Right: the hit lands on the other side's
 * animal in front; if that knocks it out, its side picks who steps in, or has
 * lost with nobody standing. Wrong: the attack misses. Either way the turn
 * passes, unless the match is over.
 */
function answer(state: MatchState, side: MatchSide, input: string): MatchStep {
	const { phase } = state;
	if (phase.kind !== 'solving') return reject(state, 'no-puzzle');
	const { attackIndex, level, puzzle } = phase;
	const foe = otherSide(side);
	const correct = checkAnswer(puzzle, input);
	const events: MatchEvent[] = [{ type: 'answer-judged', side, correct }];

	if (!correct) {
		events.push({ type: 'missed', attacker: side, attackIndex, level });
		return accept(state, passTurn(state, foe), events);
	}

	const spec = getAnimal(inFront(state, side).speciesId);
	const hit = landHit(spec, attackIndex, level, inFront(state, foe));
	const teams = withAnimal(state.teams, foe, state.active[foe], hit.target);
	events.push({
		type: 'hit',
		attacker: side,
		attackIndex,
		level,
		damage: hit.damage,
		targetHp: hit.target.hp
	});
	if (hit.target.hp > 0) return accept(state, { teams, ...passTurn(state, foe) }, events);

	events.push({ type: 'fainted', side: foe, animal: viewAnimal(hit.target) });
	if (leadIndex(teams[foe], 'land') < 0) {
		events.push({ type: 'ended', winner: side, reason: 'all-tired' });
		return accept(
			state,
			{ teams, phase: { kind: 'ended', winner: side, reason: 'all-tired' } },
			events
		);
	}
	return accept(
		state,
		{ teams, turn: state.turn + 1, phase: { kind: 'choose-animal', side: foe } },
		events
	);
}

/** Send in another animal instead of attacking: it is the turn. */
function switchAnimal(state: MatchState, side: MatchSide, teamIndex: number): MatchStep {
	if (state.phase.kind !== 'choose-action') return reject(state, 'not-choosing-an-action');
	const refusal = sendInRefusal(state, side, teamIndex);
	if (refusal !== null) return reject(state, refusal);
	return accept(
		state,
		{ active: withActive(state.active, side, teamIndex), ...passTurn(state, otherSide(side)) },
		[switched(state, side, teamIndex)]
	);
}

/** Who steps in for a knocked-out animal: free, and then the side takes its turn. */
function pickNext(state: MatchState, side: MatchSide, teamIndex: number): MatchStep {
	if (state.phase.kind !== 'choose-animal') return reject(state, 'not-picking');
	const refusal = sendInRefusal(state, side, teamIndex);
	if (refusal !== null) return reject(state, refusal);
	return accept(
		state,
		{ active: withActive(state.active, side, teamIndex), phase: { kind: 'choose-action', side } },
		[switched(state, side, teamIndex)]
	);
}

function end(state: MatchState, winner: MatchSide, reason: MatchEndReason): MatchStep {
	return accept(state, { phase: { kind: 'ended', winner, reason } }, [
		{ type: 'ended', winner, reason }
	]);
}

// --- helpers ---------------------------------------------------------------

function checkSeed(where: string, seed: number): void {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new Error(`${where}: seed must be a 32-bit unsigned integer, got ${seed}`);
	}
}

function isIntent(value: unknown): value is MatchIntent {
	if (typeof value !== 'object' || value === null) return false;
	const { type, input } = value as { type?: unknown; input?: unknown };
	if (typeof type !== 'string' || !INTENT_TYPES.has(type)) return false;
	return type !== 'answer' || typeof input === 'string';
}

/** Why `side` can't send team member `teamIndex` in, whatever the phase, or null. */
function sendInRefusal(
	match: Pick<MatchState, 'teams' | 'active'>,
	side: MatchSide,
	teamIndex: number
): 'no-such-animal' | 'already-in-front' | 'tired' | null {
	const animal = Number.isInteger(teamIndex) ? match.teams[side][teamIndex] : undefined;
	if (!animal) return 'no-such-animal';
	if (teamIndex === match.active[side]) return 'already-in-front';
	if (animal.hp === 0) return 'tired';
	return null;
}

function inFront(state: MatchState, side: MatchSide): AnimalInstance {
	return state.teams[side][state.active[side]]!;
}

/** The turn goes to `next`, who chooses an action. */
function passTurn(state: MatchState, next: MatchSide): Pick<MatchState, 'turn' | 'phase'> {
	return { turn: state.turn + 1, phase: { kind: 'choose-action', side: next } };
}

function switched(state: MatchState, side: MatchSide, teamIndex: number): MatchEvent {
	return { type: 'switched', side, animal: viewAnimal(state.teams[side][teamIndex]!), teamIndex };
}

function withAnimal(
	teams: MatchState['teams'],
	side: MatchSide,
	index: number,
	animal: AnimalInstance
): MatchState['teams'] {
	const team = teams[side].slice();
	team[index] = animal;
	return side === 'a' ? { a: team, b: teams.b } : { a: teams.a, b: team };
}

function withActive(
	active: MatchState['active'],
	side: MatchSide,
	index: number
): MatchState['active'] {
	return side === 'a' ? { a: index, b: active.b } : { a: active.a, b: index };
}

function accept(
	state: MatchState,
	change: Partial<Omit<MatchState, 'step'>>,
	events: MatchEvent[]
): MatchStep {
	return { state: { ...state, ...change, step: state.step + 1 }, events };
}

function reject(state: MatchState, reason: MatchRejection): MatchStep {
	return { state, events: [{ type: 'rejected', reason }] };
}
