export { Rng, hashInts, hashString } from './rng.js';

export type { Puzzle, PuzzleGenerator, PuzzleKind, PuzzleTopic } from './puzzles/types.js';
export {
	ALL_PUZZLE_KINDS,
	ALL_PUZZLE_TOPICS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY
} from './puzzles/types.js';
export {
	checkAnswer,
	clampDifficulty,
	generatePuzzle,
	getGenerator,
	puzzleTopics
} from './puzzles/registry.js';
export { healingDifficulty, puzzleDifficulty } from './puzzles/difficulty.js';

export type {
	AnimalInstance,
	AnimalSpec,
	AttackLevel,
	AttackSpec,
	Biome,
	Realm,
	Terrain,
	Tier
} from './animals/types.js';
export { ATTACK_LEVELS, REALMS, TERRAINS } from './animals/types.js';
export { ANIMALS, canFightIn, getAnimal } from './animals/catalog.js';

export { attackDamage } from './battle/damage.js';
export { catchProbability } from './battle/catch.js';
export { activeAnimal, applyBattleIntent, canSwitchTo, startBattle } from './battle/reducer.js';
export type { StartBattleOptions } from './battle/reducer.js';
export type {
	BattleEvent,
	BattleIntent,
	BattleOutcome,
	BattlePhase,
	BattleRejection,
	BattleSide,
	BattleState,
	BattleStep
} from './battle/types.js';

export { applyDoctorIntent, keepsATeam, startDoctorVisit } from './doctor/reducer.js';
export type { DoctorVisitOptions } from './doctor/reducer.js';
export { needsHealing } from './doctor/party.js';
export { homeTokens, tokenPuzzle, tokensForTier } from './doctor/tokens.js';
export { takeToDoctor } from './doctor/knockout.js';
export type { Rescue, RescueOptions } from './doctor/knockout.js';
export {
	ITEMS,
	ITEM_IDS,
	gearOf,
	getItem,
	hasItem,
	isItemId,
	itemsForSale
} from './items/catalog.js';
export type { ItemId, ItemSpec } from './items/catalog.js';
export type {
	DoctorEvent,
	DoctorIntent,
	DoctorPhase,
	DoctorRejection,
	DoctorState,
	DoctorStep
} from './doctor/types.js';

export { bundled, bundles, isBundled, joinParty } from './party/bundles.js';
export type { Bundle } from './party/bundles.js';
export { MAX_NICKNAME_LENGTH, normalizeNickname } from './party/names.js';
export { applyPartyIntent, leadIndex } from './party/reducer.js';
export { STARTERS, STARTER_TIER, chooseStarter, isStarter } from './party/starters.js';
export type { NewGameRejection, Starter, StarterPick } from './party/starters.js';
export type {
	PartyEvent,
	PartyIntent,
	PartyRejection,
	PartyStep,
	PlayerActivity
} from './party/types.js';

export type {
	Chunk,
	ClearableKind,
	Direction,
	Gear,
	GridPos,
	Tile,
	TileKind
} from './world/types.js';
export {
	CHUNK_SIZE,
	NO_GEAR,
	encounterRealm,
	isEncounterTile,
	isPassable,
	isWalkable,
	isWater,
	step,
	tileRealm
} from './world/types.js';
export { DEEP_WATER_MARGIN, generateChunk, spawnPoint, tileAtWorld } from './world/generate.js';
export {
	EDITS_BUDGET,
	MAX_ENTRY_LENGTH,
	WorldEdits,
	clearedTile,
	editedChunk,
	editedTileAt,
	isEditsText
} from './world/edits.js';
export type { ChunkRef } from './world/edits.js';
export { CLEARING_TOOL, clearTile, clearableAhead, isClearable } from './world/clearing.js';
export type { ClearRejection, ClearStep, Clearable, Cleared, Clearer } from './world/clearing.js';
export { TENT_SEARCH_STEPS, canTalkToDoctor, nearestTent } from './world/tents.js';
export type { TentSpot } from './world/tents.js';
export type { EncounterEntry, EncounterSite, WildAnimal } from './world/encounters.js';
export {
	ENCOUNTER_CHANCE,
	NEAR_TIER_RATIO,
	ONE_TIER_BELOW_WEIGHT,
	SAFE_RADIUS,
	WILD_RADIUS,
	distanceFromSpawn,
	encounterTable,
	encounterTableAt,
	rollEncounter
} from './world/encounters.js';
export type { Surroundings } from './world/habitat.js';
export {
	HABITAT_BOOST,
	HABITAT_FULL,
	HABITAT_RADIUS,
	HABITAT_TILES,
	habitatFactor,
	surroundings,
	terrainShares
} from './world/habitat.js';

export { LINES } from './lines.js';
export type { Line, LineKey, LineParam, LineParamKind, SpeciesRef } from './lines.js';

export type { Authority, GameEvent, Intent } from './protocol.js';

export {
	MAX_SAVED_NICKNAME_LENGTH,
	MAX_SAVE_ID_LENGTH,
	SAVE_VERSION,
	STARTER_SPECIES,
	canReplace,
	newGame,
	readBattle,
	readSave,
	replacesAnotherGame,
	restoreGame,
	sameProgress,
	saveDocument,
	saveExtras,
	saveLineage,
	saveSeq,
	validateSave,
	validateSaveWrite
} from './save.js';
export type { SaveCheck, SaveRead, SaveV1, SaveWrite, SavedGame } from './save.js';
