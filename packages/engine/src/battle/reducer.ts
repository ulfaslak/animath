import { getAnimal } from '../animals/catalog.js';
import { ATTACK_LEVELS, type AnimalInstance, type AttackLevel } from '../animals/types.js';
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
 * the same call. A wrong answer or a leash that breaks free still hands the
 * turn to the wild animal; fleeing always works. The wild animal picks one of
 * its attacks at random and hits for that attack's level-1 damage — unless it
 * faces an animal of its own tier or fiercer, when it misses
 * `WILD_MISS_CHANCE` of the time.
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

	const active = party.findIndex((a) => a.hp > 0);
	if (active < 0) throw new Error('startBattle: every animal in the party is knocked out');

	const leashQuality = options.leashQuality ?? 1;
	if (!(leashQuality > 0)) throw new Error('startBattle: leashQuality must be positive');

	return {
		step: 0,
		turn: 1,
		party: party.map((a) => ({ ...a })),
		active,
		opponent: { ...wild },
		leashQuality,
		phase: { kind: 'choose-action' },
		log: [`A wild ${animalName(wild)} appears!`, `Go, ${animalName(party[active]!)}!`]
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

/** The party member currently in front. */
export function activeAnimal(state: BattleState): AnimalInstance {
	return state.party[state.active]!;
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
	if (!intent || typeof intent !== 'object') return reject(state, 'That is not an intent.');
	if (state.phase.kind === 'ended') return reject(state, 'The battle is over.');
	switch (intent.type) {
		case 'attack':
			return chooseAttack(state, seed, intent.attackIndex, intent.level);
		case 'answer':
			return answer(state, seed, intent.input);
		case 'throw-leash':
			return throwLeash(state, seed);
		case 'flee':
			return flee(state, seed);
		default:
			return reject(state, `Unknown intent ${String((intent as { type: unknown }).type)}.`);
	}
}

// --- intents ---------------------------------------------------------------

function chooseAttack(
	state: BattleState,
	seed: number,
	attackIndex: number,
	level: AttackLevel
): BattleStep {
	if (state.phase.kind !== 'choose-action') return reject(state, 'Not the time to attack.');
	const spec = getAnimal(activeAnimal(state).speciesId);
	const attack = spec.attacks[attackIndex - 1];
	if (!Number.isInteger(attackIndex) || !attack) {
		return reject(state, `${spec.name} has no attack ${attackIndex}.`);
	}
	if (!ATTACK_LEVELS.includes(level)) return reject(state, `There is no level ${level}.`);

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
	if (state.phase.kind !== 'solving') return reject(state, 'There is no puzzle to answer.');
	const { attackIndex, level, puzzle } = state.phase;
	const draft = Draft.from(state, seed);
	const attacker = draft.active();
	const spec = getAnimal(attacker.speciesId);
	const attackName = spec.attacks[attackIndex - 1]!.name;

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
		draft.say(`${animalName(attacker)} used ${attackName}! ${damage} damage.`);
		if (draft.opponent.hp === 0) {
			draft.events.push({ type: 'fainted', side: 'opponent', animal: draft.opponent });
			draft.say(`Wild ${animalName(draft.opponent)} is tired. You win!`);
			draft.end('won');
			return draft.finish();
		}
	} else {
		draft.events.push({ type: 'missed', attacker: 'player', attackIndex, level });
		draft.say(`Not quite! ${attackName} missed.`);
	}

	opponentTurn(draft);
	return draft.finish();
}

function throwLeash(state: BattleState, seed: number): BattleStep {
	if (state.phase.kind !== 'choose-action') return reject(state, 'Not the time for the leash.');
	const draft = Draft.from(state, seed);
	const spec = getAnimal(draft.opponent.speciesId);
	const chance = catchProbability(
		draft.opponent.hp / spec.maxHp,
		spec.catchRate,
		state.leashQuality
	);
	const success = draft.rng.chance(chance);
	draft.events.push({ type: 'leash-thrown', chance, success });
	draft.say('You throw the leash…');

	if (success) {
		draft.say(`You caught a ${animalName(draft.opponent)}!`);
		draft.end('caught', draft.opponent);
		return draft.finish();
	}

	draft.say('It broke free!');
	opponentTurn(draft);
	return draft.finish();
}

function flee(state: BattleState, seed: number): BattleStep {
	if (state.phase.kind !== 'choose-action') return reject(state, 'Not the time to run.');
	const draft = Draft.from(state, seed);
	draft.events.push({ type: 'fled' });
	draft.say('You got away!');
	draft.end('fled');
	return draft.finish();
}

// --- the wild animal's turn -------------------------------------------------

/**
 * The wild animal picks one of its attacks uniformly at random and hits for
 * that attack's level-1 damage; it never solves a puzzle. Against an animal of
 * its own tier or fiercer it misses `WILD_MISS_CHANCE` of the time; against a
 * smaller one it never misses. If the hit knocks the player's animal out, the
 * next conscious party member (in party order) steps in; if there is none, the
 * battle is lost. Otherwise the round ends and the player chooses again.
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
	const attackName = spec.attacks[attackIndex - 1]!.name;

	if (wary && missRoll < WILD_MISS_CHANCE) {
		draft.events.push({ type: 'missed', attacker: 'opponent', attackIndex, level });
		draft.say(`Wild ${animalName(draft.opponent)} used ${attackName}! It missed.`);
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
	draft.say(`Wild ${animalName(draft.opponent)} used ${attackName}! ${damage} damage.`);

	if (hp > 0) {
		draft.nextRound();
		return;
	}

	const fainted = draft.active();
	draft.events.push({ type: 'fainted', side: 'player', animal: fainted });
	draft.say(`${animalName(fainted)} is tired.`);

	const next = draft.party.findIndex((a) => a.hp > 0);
	if (next < 0) {
		draft.say('All your animals are tired.');
		draft.end('lost');
		return;
	}
	draft.activeIndex = next;
	const fresh = draft.active();
	draft.events.push({ type: 'switched', animal: fresh, partyIndex: next });
	draft.say(`Go, ${animalName(fresh)}!`);
	draft.nextRound();
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
	readonly log: string[];
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
		this.log = base.log.slice();
	}

	static from(state: BattleState, seed: number): Draft {
		return new Draft(state, seed);
	}

	active(): AnimalInstance {
		return this.party[this.activeIndex]!;
	}

	say(line: string): void {
		this.log.push(line);
	}

	end(outcome: BattleOutcome, caught?: AnimalInstance): void {
		this.phase = { kind: 'ended', outcome };
		this.events.push(caught ? { type: 'ended', outcome, caught } : { type: 'ended', outcome });
	}

	nextRound(): void {
		this.phase = { kind: 'choose-action' };
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
				phase: this.phase,
				log: this.log
			},
			events: this.events
		};
	}
}

function reject(state: BattleState, reason: string): BattleStep {
	return { state, events: [{ type: 'rejected', reason }] };
}

function animalName(animal: AnimalInstance): string {
	return animal.nickname ?? getAnimal(animal.speciesId).name;
}
