import { canFightIn, getAnimal } from '../animals/catalog.js';
import {
	ATTACK_LEVELS,
	REALMS,
	type AnimalInstance,
	type AttackLevel,
	type Realm
} from '../animals/types.js';
import { leadIndex } from '../party/reducer.js';
import { puzzleDifficulty } from '../puzzles/difficulty.js';
import { checkAnswer, generatePuzzle } from '../puzzles/registry.js';
import { Rng, hashInts } from '../rng.js';
import { catchProbability } from './catch.js';
import { attackDamage } from './damage.js';
import type {
	BattleEvent,
	BattleIntent,
	BattleOutcome,
	BattlePhase,
	BattleRejection,
	BattleState,
	BattleStep
} from './types.js';

/**
 * The battle reducer: pure rules for one wild battle.
 *
 *   startBattle(party, wild, options?)          → BattleState
 *   applyBattleIntent(state, intent, seed)      → { state, events }
 *
 * Both are pure. The input state is never mutated; every accepted intent
 * returns a fresh state and the list of events that explain it, in order.
 * Randomness for the n-th accepted intent comes from `hashInts(seed, n)`, so a
 * battle replays exactly from `(seed, party, wild, leashQuality, intents)`.
 *
 * The seed is the authority's secret and travels with each call, never inside
 * the state: the state goes to the client, and a client that knew the seed
 * could predict every leash roll and every wild attack.
 *
 * Turn order is fixed: the player acts, then the wild animal takes its turn in
 * the same call. A wrong answer, a leash that breaks free or a switch still
 * hands the turn to the wild animal; fleeing always works. The wild animal
 * picks one of its attacks at random and hits for that attack's level-1
 * damage — unless it faces an animal of its own tier or fiercer, when it
 * misses `WILD_MISS_CHANCE` of the time.
 *
 * When the animal in front is knocked out and someone else is standing, the
 * battle waits in `choose-animal` for the player to say who steps in. That
 * switch is free: the wild animal has just had its turn.
 *
 * A battle is fought on land or out on the water (`BattleState.realm`), and
 * only an animal that can go there fights in it (`canFightIn`): out on the
 * water, the ones that swim. The others sit it out in the boat, as if they
 * were not in the party: none of them starts, steps in or keeps the battle
 * going once every one that can fight there is tired.
 *
 * Nothing here is worded: events say what happened and a refusal is a code.
 * The client narrates the events in the player's language.
 */

/**
 * How often a wild animal misses an animal of its own tier or fiercer (11 in
 * 25). It never misses a smaller one. Tuned so a kid who always answers the
 * easiest puzzle right beats an animal of their own tier about 79% of the time
 * (45% when right 7 times in 10), while every turn against a smaller animal
 * plays exactly as it did before misses existed (#8's balance table).
 * [[PRODUCT]] §4 "Battle" states it in prose.
 */
export const WILD_MISS_CHANCE = 0.44;

export interface StartBattleOptions {
	/** Multiplier for leash throws; 1 is the starter leash. */
	leashQuality?: number;
	/** Where the battle is fought: land (the default), or the water, from the boat. */
	realm?: Realm;
}

export function startBattle(
	party: readonly AnimalInstance[],
	wild: AnimalInstance,
	options: StartBattleOptions = {}
): BattleState {
	if (party.length === 0) throw new Error('startBattle: the party is empty');
	for (const animal of party) validateInstance(animal, 'party');
	validateInstance(wild, 'wild');
	if (wild.hp === 0) throw new Error('startBattle: the wild animal is already knocked out');

	const ids = new Set<string>();
	for (const animal of [...party, wild]) {
		if (ids.has(animal.id)) throw new Error(`startBattle: two animals share the id ${animal.id}`);
		ids.add(animal.id);
	}

	const realm = options.realm ?? 'land';
	if (!REALMS.includes(realm)) throw new Error(`startBattle: no realm ${String(realm)}`);
	if (!canFightIn(wild.speciesId, realm)) {
		throw new Error(`startBattle: a wild ${wild.speciesId} can't fight on ${realm}`);
	}
	const active = leadIndex(party, realm);
	if (active < 0) {
		throw new Error(`startBattle: every animal in the party that fights on ${realm} is knocked out`);
	}

	const leashQuality = options.leashQuality ?? 1;
	if (!(leashQuality > 0)) throw new Error('startBattle: leashQuality must be positive');

	return {
		step: 0,
		turn: 1,
		party: party.map((a) => ({ ...a })),
		active,
		opponent: { ...wild },
		leashQuality,
		realm,
		phase: { kind: 'choose-action' }
	};
}

function validateInstance(animal: AnimalInstance, where: string): void {
	const spec = getAnimal(animal.speciesId);
	if (!Number.isInteger(animal.hp) || animal.hp < 0 || animal.hp > spec.maxHp) {
		throw new Error(
			`startBattle: ${where} ${animal.id} (${spec.id}) has hp ${animal.hp}, expected 0..${spec.maxHp}`
		);
	}
}

/** The party member currently in front. In `choose-animal` it is the tired one. */
export function activeAnimal(state: BattleState): AnimalInstance {
	return state.party[state.active]!;
}

/**
 * Whether a `switch` to party member `partyIndex` would be accepted now: the
 * player is choosing (an action, or who replaces a tired animal), and the
 * animal is in the party, can fight where the battle is fought, is standing
 * and is not already in front. The reducer decides by this, and the client
 * greys out whoever it rules out.
 */
export function canSwitchTo(state: BattleState, partyIndex: number): boolean {
	return switchRefusal(state, partyIndex) === null;
}

/** Why a switch to `partyIndex` would be rejected, or null when it would not. */
function switchRefusal(state: BattleState, partyIndex: number): BattleRejection | null {
	const { kind } = state.phase;
	if (kind !== 'choose-action' && kind !== 'choose-animal') return 'not-choosing';
	const animal = Number.isInteger(partyIndex) ? state.party[partyIndex] : undefined;
	if (!animal) return 'no-such-animal';
	if (partyIndex === state.active) return 'already-in-front';
	if (!canFightIn(animal.speciesId, state.realm)) return 'cannot-fight-here';
	if (animal.hp === 0) return 'tired';
	return null;
}

/**
 * Apply one intent. `seed` is the battle's seed, held by the authority; the
 * same seed must be passed for every intent of one battle.
 */
export function applyBattleIntent(
	state: BattleState,
	intent: BattleIntent,
	seed: number
): BattleStep {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new Error(`applyBattleIntent: seed must be a 32-bit unsigned integer, got ${seed}`);
	}
	if (!intent || typeof intent !== 'object') return reject(state, 'not-an-intent');
	if (state.phase.kind === 'ended') return reject(state, 'battle-over');
	switch (intent.type) {
		case 'attack':
			return chooseAttack(state, seed, intent.attackIndex, intent.level);
		case 'answer':
			return answer(state, seed, intent.input);
		case 'throw-leash':
			return throwLeash(state, seed);
		case 'flee':
			return flee(state, seed);
		case 'switch':
			return switchAnimal(state, seed, intent.partyIndex);
		default:
			return reject(state, 'not-an-intent');
	}
}

// --- intents ---------------------------------------------------------------

function chooseAttack(
	state: BattleState,
	seed: number,
	attackIndex: number,
	level: AttackLevel
): BattleStep {
	if (state.phase.kind !== 'choose-action') return reject(state, 'not-choosing-an-action');
	const spec = getAnimal(activeAnimal(state).speciesId);
	const attack = spec.attacks[attackIndex - 1];
	if (!Number.isInteger(attackIndex) || !attack) return reject(state, 'no-such-attack');
	if (!ATTACK_LEVELS.includes(level)) return reject(state, 'no-such-level');

	const draft = Draft.from(state, seed);
	const puzzle = generatePuzzle(
		draft.rng,
		puzzleDifficulty(spec.tier, attackIndex, level),
		attack.kinds
	);
	draft.phase = { kind: 'solving', attackIndex, level, puzzle };
	draft.events.push({ type: 'puzzle-shown', attackIndex, level, puzzle });
	return draft.finish();
}

function answer(state: BattleState, seed: number, input: string): BattleStep {
	if (state.phase.kind !== 'solving') return reject(state, 'no-puzzle');
	const { attackIndex, level, puzzle } = state.phase;
	const draft = Draft.from(state, seed);
	const spec = getAnimal(draft.active().speciesId);

	const correct = checkAnswer(puzzle, input);
	draft.events.push({ type: 'answer-judged', input, correct, answer: puzzle.answer });

	if (correct) {
		const damage = attackDamage(spec, attackIndex, level, true);
		draft.opponent = { ...draft.opponent, hp: Math.max(0, draft.opponent.hp - damage) };
		draft.events.push({
			type: 'hit',
			attacker: 'player',
			attackIndex,
			level,
			damage,
			targetHp: draft.opponent.hp
		});
		if (draft.opponent.hp === 0) {
			draft.events.push({ type: 'fainted', side: 'opponent', animal: draft.opponent });
			draft.end('won');
			return draft.finish();
		}
	} else {
		draft.events.push({ type: 'missed', attacker: 'player', attackIndex, level });
	}

	opponentTurn(draft);
	return draft.finish();
}

function throwLeash(state: BattleState, seed: number): BattleStep {
	if (state.phase.kind !== 'choose-action') return reject(state, 'not-choosing-an-action');
	const draft = Draft.from(state, seed);
	const spec = getAnimal(draft.opponent.speciesId);
	const chance = catchProbability(
		draft.opponent.hp / spec.maxHp,
		spec.catchRate,
		state.leashQuality
	);
	const success = draft.rng.chance(chance);
	draft.events.push({ type: 'leash-thrown', chance, success });

	if (success) {
		draft.end('caught', draft.opponent);
		return draft.finish();
	}

	opponentTurn(draft);
	return draft.finish();
}

function flee(state: BattleState, seed: number): BattleStep {
	if (state.phase.kind !== 'choose-action') return reject(state, 'not-choosing-an-action');
	const draft = Draft.from(state, seed);
	draft.events.push({ type: 'fled' });
	draft.end('fled');
	return draft.finish();
}

/**
 * Send in another party member. On the player's turn this is the turn: the
 * wild animal replies at once, against the newcomer. After a knock-out
 * (`choose-animal`) it is how the player picks who steps in, and it is free —
 * the wild animal has just had its turn — so the player chooses an action
 * next. Either way the switch itself changes no HP.
 */
function switchAnimal(state: BattleState, seed: number, partyIndex: number): BattleStep {
	const refusal = switchRefusal(state, partyIndex);
	if (refusal !== null) return reject(state, refusal);
	const draft = Draft.from(state, seed);
	draft.activeIndex = partyIndex;
	draft.events.push({ type: 'switched', animal: draft.active(), partyIndex });
	if (state.phase.kind === 'choose-animal') {
		draft.phase = { kind: 'choose-action' };
		return draft.finish();
	}
	opponentTurn(draft);
	return draft.finish();
}

// --- the wild animal's turn -------------------------------------------------

/**
 * The wild animal picks one of its attacks uniformly at random and hits for
 * that attack's level-1 damage; it never solves a puzzle. Against an animal of
 * its own tier or fiercer it misses `WILD_MISS_CHANCE` of the time; against a
 * smaller one it never misses. If the hit knocks the player's animal out and
 * nobody else is standing, the battle is lost; if someone is, the round ends
 * in `choose-animal` and the player picks who steps in. Otherwise the round
 * ends and the player chooses again.
 *
 * Wariness is judged turn by turn against the animal in front: a fox never
 * misses a squirrel, but can miss the bear that steps in after it. The miss
 * roll is drawn on every turn and after the attack pick, so a turn against a
 * smaller animal draws and hits exactly as it did before misses existed, and a
 * battle in which every animal that fights is smaller than the wild one
 * replays exactly as before.
 */
function opponentTurn(draft: Draft): void {
	const spec = getAnimal(draft.opponent.speciesId);
	const attackIndex = draft.rng.int(1, spec.attacks.length);
	const level: AttackLevel = 1;
	const target = draft.active();
	const wary = spec.tier <= getAnimal(target.speciesId).tier;
	const missRoll = draft.rng.next();

	if (wary && missRoll < WILD_MISS_CHANCE) {
		draft.events.push({ type: 'missed', attacker: 'opponent', attackIndex, level });
		draft.nextRound();
		return;
	}

	const damage = attackDamage(spec, attackIndex, level, true);
	const hp = Math.max(0, target.hp - damage);
	draft.party[draft.activeIndex] = { ...target, hp };
	draft.events.push({
		type: 'hit',
		attacker: 'opponent',
		attackIndex,
		level,
		damage,
		targetHp: hp
	});

	if (hp > 0) {
		draft.nextRound();
		return;
	}

	draft.events.push({ type: 'fainted', side: 'player', animal: draft.active() });

	// Nobody left who can fight here: out on the water, animals that can't swim
	// may still be standing, and it is lost all the same.
	if (leadIndex(draft.party, draft.realm) < 0) {
		draft.end('lost');
		return;
	}

	// Someone is still standing: the player picks who steps in (a free `switch`).
	draft.nextRound('choose-animal');
}

// --- helpers ---------------------------------------------------------------

/**
 * A working copy of one intent's changes. Built from the input state without
 * touching it, mutated freely while the intent resolves, then sealed into a
 * new state by `finish()`.
 */
class Draft {
	readonly rng: Rng;
	readonly party: AnimalInstance[];
	activeIndex: number;
	opponent: AnimalInstance;
	phase: BattlePhase;
	turn: number;
	readonly events: BattleEvent[] = [];

	private constructor(
		private readonly base: BattleState,
		seed: number
	) {
		this.rng = new Rng(hashInts(seed, base.step));
		this.party = base.party.slice();
		this.activeIndex = base.active;
		this.opponent = base.opponent;
		this.phase = base.phase;
		this.turn = base.turn;
	}

	static from(state: BattleState, seed: number): Draft {
		return new Draft(state, seed);
	}

	active(): AnimalInstance {
		return this.party[this.activeIndex]!;
	}

	/** Where the battle is fought; it never changes. */
	get realm(): Realm {
		return this.base.realm;
	}


	end(outcome: BattleOutcome, caught?: AnimalInstance): void {
		this.phase = { kind: 'ended', outcome };
		this.events.push(caught ? { type: 'ended', outcome, caught } : { type: 'ended', outcome });
	}

	/** The wild animal's turn is over: the player chooses an action, or who steps in. */
	nextRound(kind: 'choose-action' | 'choose-animal' = 'choose-action'): void {
		this.phase = { kind };
		this.turn += 1;
	}

	finish(): BattleStep {
		return {
			state: {
				...this.base,
				step: this.base.step + 1,
				turn: this.turn,
				party: this.party,
				active: this.activeIndex,
				opponent: this.opponent,
				phase: this.phase
			},
			events: this.events
		};
	}
}

function reject(state: BattleState, reason: BattleRejection): BattleStep {
	return { state, events: [{ type: 'rejected', reason }] };
}
