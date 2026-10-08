import { canFightIn, getAnimal } from '../src/animals/catalog.js';
import { REALMS, type AnimalInstance, type AttackLevel, type Realm } from '../src/animals/types.js';
import { applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleEvent, BattleIntent, BattleState, BattleStep } from '../src/battle/types.js';
import { Rng, hashInts } from '../src/rng.js';
import { typed } from './typed.js';

/**
 * A scripted player for driving whole battles in tests and simulations.
 * Not a test file itself — imported by battle-reducer.test.ts and balance.test.ts.
 */

/** Which attack and level the player picks each round. */
export type Policy = 'max' | 'min' | 'random';

export interface PlayerModel {
	/** Probability of answering a puzzle correctly. */
	accuracy: number;
	/** Weakest attack ('min'), strongest ('max') or a uniformly random one. */
	policy: Policy;
	/** The level every attack is used at. Default: 1 for 'min', 3 for 'max', random for 'random'. */
	level?: AttackLevel;
	/** Probability of throwing the leash instead of attacking, per choose-action. Default 0. */
	leash?: number;
	/** Probability of running away instead of attacking, per choose-action. Default 0. */
	flee?: number;
	/**
	 * Probability of switching to another standing animal instead of attacking,
	 * per choose-action; with it set, a tired animal's replacement is picked at
	 * random too. Default 0: never switch, and send in the first standing animal
	 * in party order (drawing nothing, so older models replay as they did).
	 */
	switch?: number;
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

/**
 * Where two species meet in a battle: on land when both can fight there, else
 * out on the water; null when they never meet (a squirrel and a crab).
 */
export function arena(...speciesIds: readonly string[]): Realm | null {
	return REALMS.find((r) => speciesIds.every((id) => canFightIn(id, r))) ?? null;
}

export function makeWild(speciesId: string, hp?: number): AnimalInstance {
	return { id: `wild-${speciesId}`, speciesId, hp: hp ?? getAnimal(speciesId).maxHp };
}

/** Party indices that could step in: standing, able to fight where the battle is, and not the animal in front. */
export function others(state: BattleState): number[] {
	return state.party.flatMap((a, i) =>
		i !== state.active && a.hp > 0 && canFightIn(a.speciesId, state.realm) ? [i] : []
	);
}

/** The intent a scripted player sends in `state`, or null when the battle is over. */
export function nextIntent(state: BattleState, model: PlayerModel, rng: Rng): BattleIntent | null {
	switch (state.phase.kind) {
		case 'ended':
			return null;
		case 'solving': {
			const correct = rng.chance(model.accuracy);
			return { type: 'answer', input: typed(state.phase.puzzle, correct) };
		}
		case 'choose-animal': {
			const standing = others(state);
			const pick = model.switch ? rng.pick(standing) : standing[0];
			if (pick === undefined) throw new Error('choose-animal with nobody standing');
			return { type: 'switch', partyIndex: pick };
		}
		case 'choose-action': {
			if (rng.chance(model.leash ?? 0)) return { type: 'throw-leash' };
			if (rng.chance(model.flee ?? 0)) return { type: 'flee' };
			if (model.switch && rng.chance(model.switch)) {
				const standing = others(state);
				if (standing.length > 0) return { type: 'switch', partyIndex: rng.pick(standing) };
			}
			const spec = getAnimal(state.party[state.active]!.speciesId);
			const n = spec.attacks.length;
			switch (model.policy) {
				case 'max':
					return { type: 'attack', attackIndex: n, level: model.level ?? 3 };
				case 'min':
					return { type: 'attack', attackIndex: 1, level: model.level ?? 1 };
				case 'random':
					return {
						type: 'attack',
						attackIndex: rng.int(1, n),
						level: model.level ?? (rng.int(1, 3) as AttackLevel)
					};
			}
		}
	}
}

/**
 * Play a battle to the end. `onStep` sees every accepted step (input state,
 * intent, result) so property tests can check invariants along the way.
 * The player's own randomness is seeded from `seed` too, so a run is
 * reproducible from `(seed, party, wild, model)`.
 */
export function playBattle(
	seed: number,
	party: readonly AnimalInstance[],
	wild: AnimalInstance,
	model: PlayerModel,
	onStep?: (before: BattleState, intent: BattleIntent, step: BattleStep) => void,
	maxIntents = 2000,
	realm: Realm = 'land'
): PlayResult {
	const playerRng = new Rng(hashInts(seed, 0x9e3779b9));
	let state = startBattle(party, wild, { realm });
	const events: BattleEvent[] = [];
	const intents: BattleIntent[] = [];
	for (let i = 0; i < maxIntents; i++) {
		const intent = nextIntent(state, model, playerRng);
		if (!intent) break;
		const step = applyBattleIntent(state, intent, seed);
		onStep?.(state, intent, step);
		intents.push(intent);
		events.push(...step.events);
		state = step.state;
	}
	return { state, events, intents };
}
