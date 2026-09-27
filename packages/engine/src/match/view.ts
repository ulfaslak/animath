import type { AnimalInstance } from '../animals/types.js';
import type { Puzzle } from '../puzzles/types.js';
import {
	MATCH_SIDES,
	type MatchPhase,
	type MatchSide,
	type MatchState,
	type MatchView,
	type MatchViewPhase,
	type ShownPuzzle
} from './types.js';

/**
 * What side `side` is sent of a match: everything in the state but the open
 * puzzle's answer, and which side the view is for. Built field by field,
 * never by spreading the state, so nothing added to the state later reaches
 * a player unless it is added here. The waiting side sees the acting side's
 * puzzle as it is shown (`shownPuzzle`), never its answer.
 */
export function matchView(state: MatchState, side: MatchSide): MatchView {
	if (!MATCH_SIDES.includes(side)) throw new Error(`matchView: no side ${String(side)}`);
	return {
		you: side,
		step: state.step,
		turn: state.turn,
		teams: { a: state.teams.a.map(viewAnimal), b: state.teams.b.map(viewAnimal) },
		active: { a: state.active.a, b: state.active.b },
		phase: viewPhase(state.phase)
	};
}

/** A puzzle as the players see it: its kind, difficulty and prompt, never its answer. */
export function shownPuzzle(puzzle: Puzzle): ShownPuzzle {
	return { kind: puzzle.kind, difficulty: puzzle.difficulty, prompt: puzzle.prompt };
}

function viewPhase(phase: MatchPhase): MatchViewPhase {
	switch (phase.kind) {
		case 'choose-action':
		case 'choose-animal':
			return { kind: phase.kind, side: phase.side };
		case 'solving':
			return {
				kind: 'solving',
				side: phase.side,
				attackIndex: phase.attackIndex,
				level: phase.level,
				puzzle: shownPuzzle(phase.puzzle)
			};
		case 'ended':
			return { kind: 'ended', winner: phase.winner, reason: phase.reason };
	}
}

/** A team member as a view shows it: a fresh copy of its fields. */
export function viewAnimal(animal: AnimalInstance): AnimalInstance {
	const { id, speciesId, nickname, hp } = animal;
	return nickname === undefined ? { id, speciesId, hp } : { id, speciesId, nickname, hp };
}
