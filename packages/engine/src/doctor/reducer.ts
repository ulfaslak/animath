import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';
import { healingDifficulty } from '../puzzles/difficulty.js';
import { checkAnswer, generatePuzzle } from '../puzzles/registry.js';
import type { Puzzle, PuzzleKind } from '../puzzles/types.js';
import { animalName } from '../party/names.js';
import { Rng, hashInts } from '../rng.js';
import { needsHealing, validateParty } from './party.js';
import type { DoctorEvent, DoctorIntent, DoctorPhase, DoctorState, DoctorStep } from './types.js';

/**
 * The doctor reducer: pure rules for one visit to a doctor's tent.
 *
 *   startDoctorVisit(party)                      → DoctorState
 *   applyDoctorIntent(state, intent, seed)       → { state, events }
 *
 * Built like the battle reducer. The input state is never mutated; every
 * accepted intent returns a fresh state and the events that explain it, and a
 * rejected one returns the same state with a single `rejected` event.
 * Randomness for the n-th accepted intent comes from `hashInts(seed, n)`. The
 * seed is the authority's, passed with every call and never stored in the
 * state, and it should be fresh for every visit: the same seed asks the same
 * puzzles again.
 *
 * The rules: pick an animal below full HP; the doctor asks one puzzle at
 * `healingDifficulty(tier)`, of a kind the animal's own attacks ask. A right
 * answer heals that one animal to full. A wrong answer costs nothing: the HP
 * stays as it was and a different puzzle takes its place, as many times as it
 * takes. Leaving is always allowed.
 */

/** How often a wrong answer's replacement is redrawn to avoid repeating the prompt just missed. */
const REDRAWS = 8;

export function startDoctorVisit(party: readonly AnimalInstance[]): DoctorState {
	validateParty(party, 'startDoctorVisit');
	const copy = party.map((a) => ({ ...a }));
	return {
		step: 0,
		party: copy,
		phase: { kind: 'choose-patient' },
		log: [
			copy.some(needsHealing)
				? 'Hello! Who needs help today?'
				: 'Hello! Your animals are all fit and happy.'
		]
	};
}

/**
 * Apply one intent. `seed` is the visit's seed, held by the authority; the same
 * seed must be passed for every intent of one visit.
 */
export function applyDoctorIntent(
	state: DoctorState,
	intent: DoctorIntent,
	seed: number
): DoctorStep {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new Error(`applyDoctorIntent: seed must be a 32-bit unsigned integer, got ${seed}`);
	}
	if (!intent || typeof intent !== 'object') return reject(state, 'That is not an intent.');
	if (state.phase.kind === 'ended') return reject(state, 'The visit is over.');
	switch (intent.type) {
		case 'pick-patient':
			return pickPatient(state, seed, intent.partyIndex);
		case 'answer':
			return answer(state, seed, intent.input);
		case 'leave':
			return accept(state, { kind: 'ended' }, [{ type: 'ended' }], ['Bye! Come back any time.']);
		default:
			return reject(state, `Unknown intent ${String((intent as { type: unknown }).type)}.`);
	}
}

// --- intents ---------------------------------------------------------------

function pickPatient(state: DoctorState, seed: number, partyIndex: number): DoctorStep {
	const animal = Number.isInteger(partyIndex) ? state.party[partyIndex] : undefined;
	if (!animal) return reject(state, 'There is no animal there.');
	if (!needsHealing(animal))
		return reject(state, `${animalName(animal)} is already fit and happy.`);

	const puzzle = healingPuzzle(rngFor(seed, state), animal);
	return accept(
		state,
		{ kind: 'solving', partyIndex, puzzle },
		[{ type: 'puzzle-shown', partyIndex, puzzle }],
		[`Let's help ${animalName(animal)}! Can you solve this?`]
	);
}

function answer(state: DoctorState, seed: number, input: string): DoctorStep {
	if (state.phase.kind !== 'solving') return reject(state, 'There is no puzzle to answer.');
	const { partyIndex, puzzle } = state.phase;
	const animal = state.party[partyIndex]!;
	const correct = checkAnswer(puzzle, input);
	const judged: DoctorEvent = { type: 'answer-judged', input, correct, answer: puzzle.answer };

	if (!correct) {
		const next = healingPuzzle(rngFor(seed, state), animal, puzzle.prompt);
		return accept(
			state,
			{ kind: 'solving', partyIndex, puzzle: next },
			[judged, { type: 'puzzle-shown', partyIndex, puzzle: next }],
			["Not quite! Let's try another one."]
		);
	}

	const healed = { ...animal, hp: getAnimal(animal.speciesId).maxHp };
	const party = state.party.slice();
	party[partyIndex] = healed;
	return accept(
		state,
		{ kind: 'choose-patient' },
		[judged, { type: 'healed', partyIndex, animal: healed }],
		[
			`Well done! ${animalName(healed)} feels all better!`,
			party.some(needsHealing) ? 'Who is next?' : 'Everyone is fit and happy!'
		],
		party
	);
}

// --- helpers ---------------------------------------------------------------

/**
 * A puzzle at the animal's healing difficulty, of a kind its own attacks ask,
 * so a kid meets the kind of sum they already know from battle. When `avoid`
 * is given (the prompt just missed), a few redraws keep the next one different.
 */
function healingPuzzle(rng: Rng, animal: AnimalInstance, avoid?: string): Puzzle {
	const spec = getAnimal(animal.speciesId);
	const kinds = [...new Set<PuzzleKind>(spec.attacks.flatMap((a) => a.kinds))];
	const difficulty = healingDifficulty(spec.tier);
	let puzzle = generatePuzzle(rng, difficulty, kinds);
	for (let i = 0; i < REDRAWS && puzzle.prompt === avoid; i++) {
		puzzle = generatePuzzle(rng, difficulty, kinds);
	}
	return puzzle;
}

function rngFor(seed: number, state: DoctorState): Rng {
	return new Rng(hashInts(seed, state.step));
}

function accept(
	state: DoctorState,
	phase: DoctorPhase,
	events: DoctorEvent[],
	lines: readonly string[],
	party: readonly AnimalInstance[] = state.party
): DoctorStep {
	return {
		state: { ...state, step: state.step + 1, party, phase, log: [...state.log, ...lines] },
		events
	};
}

function reject(state: DoctorState, reason: string): DoctorStep {
	return { state, events: [{ type: 'rejected', reason }] };
}
