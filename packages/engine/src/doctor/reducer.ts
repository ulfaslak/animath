import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';
import { ITEM_IDS, getItem, isItemId, itemsForSale, type ItemId } from '../items/catalog.js';
import { healingDifficulty } from '../puzzles/difficulty.js';
import { checkAnswer, generatePuzzle } from '../puzzles/registry.js';
import type { Puzzle, PuzzleKind } from '../puzzles/types.js';
import { Rng, hashInts } from '../rng.js';
import { canGoHome, needsHealing, validateParty } from './party.js';
import { homeTokens, tokenPuzzle } from './tokens.js';
import type {
	DoctorEvent,
	DoctorIntent,
	DoctorPhase,
	DoctorRejection,
	DoctorState,
	DoctorStep
} from './types.js';

/**
 * The doctor reducer: pure rules for one visit to a doctor's tent.
 *
 *   startDoctorVisit(party, options?)            → DoctorState
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
 * The rules ([[PRODUCT]] §4 "Knock-out and healing", "Tokens and the
 * doctor's shop"):
 * - Pick an animal below full HP; the doctor asks one puzzle at
 *   `healingDifficulty(tier)`, of a kind the animal's own attacks ask. A right
 *   answer heals every hurt animal of that species to full. A wrong answer
 *   costs nothing: the HP stays as it was and a different puzzle takes its
 *   place, as many times as it takes.
 * - Hand animals over (any of them, tired ones too, but never the last one
 *   standing): the doctor asks the tokens you will have, `tokens + reward`.
 *   Right, and they go home to the wild, made better, and the tokens are
 *   yours. Wrong, and the same sum is asked again.
 * - Buy an item the shop sells, not owned yet, with enough tokens: the doctor
 *   asks the tokens you will have left, `tokens − price`. Right, and it is
 *   yours. Wrong, and the same sum is asked again.
 * - Backing out of any puzzle, picking something else, or leaving is always
 *   allowed, and nothing happens that was not answered.
 *
 * The doctor says nothing here: the client chooses the doctor's words from
 * the events, in the player's language.
 */

/** How often a wrong answer's replacement is redrawn to avoid repeating the prompt just missed. */
const REDRAWS = 8;

export interface DoctorVisitOptions {
	/** The player's tokens as the visit starts: a whole number. Default 0. */
	tokens?: number;
	/** The ids of the items the player owns. Default none. */
	items?: readonly string[];
	/**
	 * What the shop sells in this visit. Default: every item the catalog has
	 * on sale (`itemsForSale`). An authority passes more only for a look at
	 * the shop in a game that is saved nowhere (the client's `?shop`).
	 */
	shop?: readonly ItemId[];
}

export function startDoctorVisit(
	party: readonly AnimalInstance[],
	options: DoctorVisitOptions = {}
): DoctorState {
	validateParty(party, 'startDoctorVisit');
	const tokens = options.tokens ?? 0;
	if (!Number.isSafeInteger(tokens) || tokens < 0) {
		throw new Error(`startDoctorVisit: tokens must be a whole number, got ${tokens}`);
	}
	const items = options.items ?? [];
	if (!Array.isArray(items) || items.some((i) => typeof i !== 'string')) {
		throw new Error('startDoctorVisit: items must be a list of ids');
	}
	const shop = options.shop ?? itemsForSale();
	if (!Array.isArray(shop) || !shop.every(isItemId)) {
		throw new Error('startDoctorVisit: the shop must list items of the catalog');
	}
	return {
		step: 0,
		party: party.map((a) => ({ ...a })),
		tokens,
		items: [...items],
		shop: ITEM_IDS.filter((id) => shop.includes(id)),
		phase: { kind: 'choose-patient' }
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
	if (!intent || typeof intent !== 'object') return reject(state, 'not-an-intent');
	if (state.phase.kind === 'ended') return reject(state, 'visit-over');
	switch (intent.type) {
		case 'pick-patient':
			return pickPatient(state, seed, intent.partyIndex);
		case 'hand-over':
			return handOver(state, intent.ids);
		case 'buy':
			return buy(state, intent.itemId);
		case 'answer':
			return answer(state, seed, intent.input);
		case 'back':
			if (state.phase.kind === 'choose-patient') return reject(state, 'no-puzzle');
			return accept(state, { kind: 'choose-patient' }, [{ type: 'closed' }]);
		case 'leave':
			return accept(state, { kind: 'ended' }, [{ type: 'ended' }]);
		default:
			return reject(state, 'not-an-intent');
	}
}

// --- intents ---------------------------------------------------------------

function pickPatient(state: DoctorState, seed: number, partyIndex: number): DoctorStep {
	const animal = Number.isInteger(partyIndex) ? state.party[partyIndex] : undefined;
	if (!animal) return reject(state, 'no-such-animal');
	if (!needsHealing(animal)) return reject(state, 'not-hurt');

	const puzzle = healingPuzzle(rngFor(seed, state), animal);
	return accept(state, { kind: 'solving', partyIndex, puzzle }, [
		{ type: 'puzzle-shown', partyIndex, puzzle }
	]);
}

/**
 * Animals by id, each once, all in the party, and never so many that nobody
 * standing stays: the kid keeps at least one animal that isn't tired, so the
 * team can still battle when it walks away (and a reload, which rests a team
 * with nobody standing, is never a free heal). Tired animals may go too: the
 * doctor makes them better before they leave.
 */
function handOver(state: DoctorState, ids: readonly string[]): DoctorStep {
	if (!Array.isArray(ids) || ids.length === 0) return reject(state, 'no-such-animal');
	const picked = new Set<string>();
	for (const id of ids) {
		if (typeof id !== 'string' || picked.has(id)) return reject(state, 'no-such-animal');
		if (!state.party.some((a) => a.id === id)) return reject(state, 'no-such-animal');
		picked.add(id);
	}
	if (!canGoHome(state.party, picked)) return reject(state, 'keep-one');

	const leaving = state.party.filter((a) => picked.has(a.id));
	const reward = homeTokens(leaving);
	const puzzle = tokenPuzzle(state.tokens, reward);
	const inOrder = leaving.map((a) => a.id);
	return accept(state, { kind: 'handing-over', ids: inOrder, reward, puzzle }, [
		{ type: 'hand-over-shown', ids: inOrder, reward, puzzle }
	]);
}

function buy(state: DoctorState, itemId: string): DoctorStep {
	if (!isItemId(itemId) || !state.shop.includes(itemId)) return reject(state, 'not-for-sale');
	if (state.items.includes(itemId)) return reject(state, 'already-owned');
	const { price } = getItem(itemId);
	if (state.tokens < price) return reject(state, 'not-enough-tokens');

	const puzzle = tokenPuzzle(state.tokens, -price);
	return accept(state, { kind: 'buying', itemId, price, puzzle }, [
		{ type: 'purchase-shown', itemId, price, puzzle }
	]);
}

function answer(state: DoctorState, seed: number, input: string): DoctorStep {
	const phase = state.phase;
	if (phase.kind !== 'solving' && phase.kind !== 'handing-over' && phase.kind !== 'buying') {
		return reject(state, 'no-puzzle');
	}
	const correct = checkAnswer(phase.puzzle, input);
	const judged: DoctorEvent = {
		type: 'answer-judged',
		input,
		correct,
		answer: phase.puzzle.answer
	};
	switch (phase.kind) {
		case 'solving':
			return correct
				? heal(state, phase.partyIndex, judged)
				: retryHealing(state, seed, phase, judged);
		case 'handing-over':
			return correct
				? goHome(state, phase.ids, phase.reward, judged)
				: accept(state, phase, [judged]);
		case 'buying':
			return correct
				? sell(state, phase.itemId, phase.price, judged)
				: accept(state, phase, [judged]);
	}
}

// --- outcomes ------------------------------------------------------------------

/** A wrong healing answer: nothing changes but the puzzle, which is a different one. */
function retryHealing(
	state: DoctorState,
	seed: number,
	phase: Extract<DoctorPhase, { kind: 'solving' }>,
	judged: DoctorEvent
): DoctorStep {
	const { partyIndex } = phase;
	const next = healingPuzzle(rngFor(seed, state), state.party[partyIndex]!, phase.puzzle.prompt);
	return accept(state, { kind: 'solving', partyIndex, puzzle: next }, [
		judged,
		{ type: 'puzzle-shown', partyIndex, puzzle: next }
	]);
}

/** Every hurt animal of the patient's species, back to full HP, in party order. */
function heal(state: DoctorState, partyIndex: number, judged: DoctorEvent): DoctorStep {
	const species = state.party[partyIndex]!.speciesId;
	const events: DoctorEvent[] = [judged];
	const party = state.party.map((animal, i) => {
		if (animal.speciesId !== species || !needsHealing(animal)) return animal;
		const healed = { ...animal, hp: getAnimal(species).maxHp };
		events.push({ type: 'healed', partyIndex: i, animal: healed });
		return healed;
	});
	return accept(state, { kind: 'choose-patient' }, events, { party });
}

/** The animals leave for the wild, better, and the doctor gives their tokens. */
function goHome(
	state: DoctorState,
	ids: readonly string[],
	reward: number,
	judged: DoctorEvent
): DoctorStep {
	const leaving = state.party
		.filter((a) => ids.includes(a.id))
		.map((a) => ({ ...a, hp: getAnimal(a.speciesId).maxHp }));
	const party = state.party.filter((a) => !ids.includes(a.id));
	const tokens = state.tokens + reward;
	return accept(
		state,
		{ kind: 'choose-patient' },
		[
			judged,
			{ type: 'went-home', animals: leaving },
			{ type: 'tokens-given', amount: reward, tokens }
		],
		{ party, tokens }
	);
}

/** The item is the player's, and its price comes off their tokens. */
function sell(state: DoctorState, itemId: ItemId, price: number, judged: DoctorEvent): DoctorStep {
	const tokens = state.tokens - price;
	return accept(
		state,
		{ kind: 'choose-patient' },
		[judged, { type: 'bought', itemId, price, tokens }],
		{ tokens, items: [...state.items, itemId] }
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
	changes: Partial<Pick<DoctorState, 'party' | 'tokens' | 'items'>> = {}
): DoctorStep {
	return { state: { ...state, ...changes, step: state.step + 1, phase }, events };
}

function reject(state: DoctorState, reason: DoctorRejection): DoctorStep {
	return { state, events: [{ type: 'rejected', reason }] };
}
