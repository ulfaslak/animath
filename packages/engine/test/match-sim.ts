import { getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance, AttackLevel } from '../src/animals/types.js';
import { applyMatchIntent, canSendIn, startMatch } from '../src/match/reducer.js';
import type {
	MatchEvent,
	MatchIntent,
	MatchSide,
	MatchState,
	MatchStep
} from '../src/match/types.js';
import { matchView } from '../src/match/view.js';
import { Rng, hashInts } from '../src/rng.js';
import { typed } from './typed.js';

/**
 * Scripted players for driving whole friendly matches in tests and
 * simulations. Not a test file itself: match.test.ts imports it.
 *
 * A player decides from its own view (`matchView`), as a client would, and
 * reads the answer from the state only to answer right: that is the kid
 * solving the puzzle.
 */

export interface MatchPlayer {
	/** Probability of answering a puzzle right. */
	accuracy: number;
	/** Weakest attack ('min'), strongest ('max') or a uniformly random one. */
	policy: 'max' | 'min' | 'random';
	/** The level every attack is used at. Default: 1 for 'min', 3 for 'max', random for 'random'. */
	level?: AttackLevel;
	/** Probability of switching instead of attacking, when someone else is standing. Default 0. */
	switch?: number;
	/** Probability of leaving instead of choosing, at each of its choices. Default 0. */
	leave?: number;
}

export interface MatchPlay {
	state: MatchState;
	events: MatchEvent[];
	/** Every intent sent, in order, with the side that sent it. */
	log: { side: MatchSide; intent: MatchIntent }[];
}

/** A party of fresh animals at full HP, ids `<species>-<i>`. */
export function party(speciesIds: readonly string[]): AnimalInstance[] {
	return speciesIds.map((speciesId, i) => ({
		id: `${speciesId}-${i}`,
		speciesId,
		hp: getAnimal(speciesId).maxHp
	}));
}

/** The side whose move it is, or null once the match is over. */
export function mover(state: MatchState): MatchSide | null {
	return state.phase.kind === 'ended' ? null : state.phase.side;
}

/** Team indices `side` could send in now (standing, not in front). */
export function standingOthers(state: MatchState, side: MatchSide): number[] {
	return state.teams[side].flatMap((_, i) => (canSendIn(state, side, i) ? [i] : []));
}

/** The intent the side to move sends, by `player`'s habits. Null once the match is over. */
export function nextMatchIntent(
	state: MatchState,
	player: MatchPlayer,
	rng: Rng
): { side: MatchSide; intent: MatchIntent } | null {
	const side = mover(state);
	if (side === null) return null;
	const view = matchView(state, side);
	if (rng.chance(player.leave ?? 0)) return { side, intent: { type: 'leave' } };
	switch (view.phase.kind) {
		case 'ended':
			return null;
		case 'solving': {
			if (state.phase.kind !== 'solving') throw new Error('the view and the state disagree');
			const right = rng.chance(player.accuracy);
			return { side, intent: { type: 'answer', input: typed(state.phase.puzzle, right) } };
		}
		case 'choose-animal': {
			const standing = standingOthers(state, side);
			const pick = player.switch ? rng.pick(standing) : standing[0];
			if (pick === undefined) throw new Error('choose-animal with nobody standing');
			return { side, intent: { type: 'pick-next', teamIndex: pick } };
		}
		case 'choose-action': {
			if (player.switch && rng.chance(player.switch)) {
				const standing = standingOthers(state, side);
				if (standing.length > 0) {
					return { side, intent: { type: 'switch', teamIndex: rng.pick(standing) } };
				}
			}
			const me = view.teams[side][view.active[side]]!;
			const n = getAnimal(me.speciesId).attacks.length;
			switch (player.policy) {
				case 'max':
					return { side, intent: { type: 'attack', attackIndex: n, level: player.level ?? 3 } };
				case 'min':
					return { side, intent: { type: 'attack', attackIndex: 1, level: player.level ?? 1 } };
				case 'random':
					return {
						side,
						intent: {
							type: 'attack',
							attackIndex: rng.int(1, n),
							level: player.level ?? (rng.int(1, 3) as AttackLevel)
						}
					};
			}
		}
	}
}

/**
 * Play a match to its end, or for `maxIntents`. `onStep` sees every step:
 * the state before, who sent what, and the result. The players' own
 * randomness is seeded from `seed` too, so a run replays from
 * `(seed, parties, players)`.
 */
export function playMatch(
	seed: number,
	parties: Readonly<Record<MatchSide, readonly AnimalInstance[]>>,
	players: Readonly<Record<MatchSide, MatchPlayer>>,
	onStep?: (before: MatchState, side: MatchSide, intent: MatchIntent, step: MatchStep) => void,
	maxIntents = 5000
): MatchPlay {
	const rng = new Rng(hashInts(seed, 0x9e3779b9));
	let state = startMatch(parties, seed);
	const events: MatchEvent[] = [];
	const log: { side: MatchSide; intent: MatchIntent }[] = [];
	for (let i = 0; i < maxIntents; i++) {
		const side = mover(state);
		if (side === null) break;
		const next = nextMatchIntent(state, players[side], rng);
		if (!next) break;
		const step = applyMatchIntent(state, next.side, next.intent, seed);
		onStep?.(state, next.side, next.intent, step);
		log.push(next);
		events.push(...step.events);
		state = step.state;
	}
	return { state, events, log };
}
