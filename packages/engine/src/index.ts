export { Rng, hashInts, hashString } from './rng.js';

export type { Puzzle, PuzzleGenerator, PuzzleKind } from './puzzles/types.js';
export { ALL_PUZZLE_KINDS, MAX_DIFFICULTY, MIN_DIFFICULTY } from './puzzles/types.js';
export { checkAnswer, clampDifficulty, generatePuzzle, getGenerator } from './puzzles/registry.js';
export { healingDifficulty, puzzleDifficulty } from './puzzles/difficulty.js';

export type {
	AnimalInstance,
	AnimalSpec,
	AttackLevel,
	AttackSpec,
	Biome,
	Tier
} from './animals/types.js';
export { ATTACK_LEVELS } from './animals/types.js';
export { ANIMALS, getAnimal } from './animals/catalog.js';

export { attackDamage } from './battle/damage.js';
export { catchProbability } from './battle/catch.js';
export type { BattleIntent, BattlePhase, BattleState } from './battle/types.js';

export type { Chunk, Direction, GridPos, Tile, TileKind } from './world/types.js';
export { CHUNK_SIZE, isEncounterTile, isWalkable, step } from './world/types.js';
export { generateChunk, spawnPoint, tileAtWorld } from './world/generate.js';
export type { EncounterEntry, EncounterSite, WildAnimal } from './world/encounters.js';
export {
	ENCOUNTER_CHANCE,
	NEAR_TIER_RATIO,
	SAFE_RADIUS,
	WILD_RADIUS,
	distanceFromSpawn,
	encounterTable,
	rollEncounter
} from './world/encounters.js';

export type { Authority, GameEvent, Intent } from './protocol.js';
