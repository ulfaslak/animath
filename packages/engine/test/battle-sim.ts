import { getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance, AttackLevel } from '../src/animals/types.js';
import { applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleEvent, BattleIntent, BattleState, BattleStep } from '../src/battle/types.js';
import { Rng, hashInts } from '../src/rng.js';

/**
 * A scripted player for driving whole battles in tests and simulations.
 * Not a test file itself — imported by battle-reducer.test.ts and balance.test.ts.
 */

/** Which attack and level the player picks each round. */
export type Policy = 'max' | 'min' | 'random';

export interface PlayerModel {
	/** Probability of answering a puzzle correctly. */
	accuracy: number;
	policy: Policy;
}

export interface PlayResult {
	state: BattleState;
	events: BattleEvent[];
	intents: BattleIntent[];
}

export function makeParty(speciesIds: readonly string[]): AnimalInstance[] {
	return speciesIds.map((speciesId, i) => ({
		id: `${speciesId}-${i}`,
		speciesId,
		hp: getAnimal(speciesId).maxHp
	}));
}

export function makeWild(speciesId: string, hp?: number): AnimalInstance {
	return { id: `wild-${speciesId}`, speciesId, hp: hp ?? getAnimal(speciesId).maxHp };
}

/** The intent a scripted player sends in `state`, or null when the battle is over. */
export function nextIntent(state: BattleState, model: PlayerModel, rng: Rng): BattleIntent | null {
	switch (state.phase.kind) {
		case 'ended':
			return null;
		case 'solving': {
			const answer = state.phase.puzzle.answer;
			const correct = rng.chance(model.accuracy);
			return { type: 'answer', input: String(correct ? answer : answer + 1) };
		}
		case 'choose-action': {
			const spec = getAnimal(state.party[state.active]!.speciesId);
			const n = spec.attacks.length;
			switch (model.policy) {
				case 'max':
					return { type: 'attack', attackIndex: n, level: 3 };
				case 'min':
					return { type: 'attack', attackIndex: 1, level: 1 };
				case 'random':
					return {
						type: 'attack',
						attackIndex: rng.int(1, n),
						level: rng.int(1, 3) as AttackLevel
					};
			}
		}
	}
}

/**
 * Play a battle to the end. `onStep` sees every accepted step (input state,
 * intent, result) so property tests can check invariants along the way.
 */
export function playBattle(
	seed: number,
	party: readonly AnimalInstance[],
	wild: AnimalInstance,
	model: PlayerModel,
	onStep?: (before: BattleState, intent: BattleIntent, step: BattleStep) => void,
	maxIntents = 2000
): PlayResult {
	const playerRng = new Rng(hashInts(seed, 0x9e3779b9));
	let state = startBattle(seed, party, wild);
	const events: BattleEvent[] = [];
	const intents: BattleIntent[] = [];
	for (let i = 0; i < maxIntents; i++) {
		const intent = nextIntent(state, model, playerRng);
		if (!intent) break;
		const step = applyBattleIntent(state, intent);
		onStep?.(state, intent, step);
		intents.push(intent);
		events.push(...step.events);
		state = step.state;
	}
	return { state, events, intents };
}
