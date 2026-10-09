export { Rng, hashInts, hashString } from './rng.js';

export type {
	AnswerForm,
	PictureKind,
	Puzzle,
	PuzzleGenerator,
	PuzzleKind,
	PuzzleTopic
} from './puzzles/types.js';
export {
	ALL_PUZZLE_KINDS,
	ALL_PUZZLE_TOPICS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY,
	PICTURE_KINDS,
	isPictureKind
} from './puzzles/types.js';
export {
	answerForm,
	answerText,
	checkAnswer,
	clampDifficulty,
	generatePuzzle,
	getGenerator,
	puzzleTopics
} from './puzzles/registry.js';
export { healingDifficulty, puzzleDifficulty } from './puzzles/difficulty.js';
export { countSolved } from './puzzles/solved.js';
export {
	MAX_TOPIC_BONUS,
	MIN_TOPIC_BONUS,
	RECENT_ANSWERS,
	bonusOf,
	faceTopic,
	puzzleTopic,
	readRecord,
	recordAnswers,
	topicBonus,
	type PuzzleRecord,
	type TopicBonus,
	type TopicRecord
} from './puzzles/record.js';
export {
	FACE_NUMBERS,
	KRONER,
	MAX_BARS,
	MAX_BAR_LINES,
	MAX_FACE_NUMBER,
	THERMOMETER,
	facePrompt,
	puzzleFace,
	readPuzzleFace
} from './puzzles/face.js';
export type { PuzzleFace } from './puzzles/face.js';
export { BARCHART } from './puzzles/generators/barchart.js';
export { CLOCK } from './puzzles/generators/clock.js';
export { SHAPE } from './puzzles/generators/shape.js';

export type {
	AnimalInstance,
	AnimalSpec,
	AttackLevel,
	AttackSpec,
	Biome,
	Pole,
	Realm,
	Terrain,
	Tier
} from './animals/types.js';
export { ATTACK_LEVELS, BIOME_POLE, REALMS, TERRAINS } from './animals/types.js';
export { ANIMALS, canFightIn, canPull, canRide, getAnimal, skiesOf } from './animals/catalog.js';
export {
	bookOrder,
	EMPTY_BOOK,
	bookOf,
	catchSpecies,
	freeSpecies,
	hasCaught,
	hasFreed,
	hasSeen,
	recordBattle,
	recordParty,
	recordWentHome,
	seeSpecies
} from './animals/book.js';
export type { AnimalBook } from './animals/book.js';

export { attackDamage } from './battle/damage.js';
// Only `landHit` and `hitSpan` of `attack.ts`: a screen previews a hit with the very functions a reducer lands it with.
export { hitSpan, landHit } from './battle/attack.js';
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

export { MATCH_SIDES } from './match/types.js';
export { MATCH_TEAM_SIZE, matchTeam } from './match/team.js';
export { applyMatchIntent, canSendIn, otherSide, startMatch } from './match/reducer.js';
export { matchView, shownPuzzle } from './match/view.js';
export { CHALLENGE_REACH, challengeRefusal } from './match/challenge.js';
export type { ChallengeRefusal, ChallengeSpot } from './match/challenge.js';
export type {
	MatchEndReason,
	MatchEvent,
	MatchIntent,
	MatchPhase,
	MatchRejection,
	MatchSide,
	MatchState,
	MatchStep,
	MatchView,
	MatchViewPhase,
	ShownPuzzle,
	TeamPick,
	TeamRefusal
} from './match/types.js';

export { applyDoctorIntent, buyRefusal, startDoctorVisit } from './doctor/reducer.js';
export type { BuyRefusal, DoctorVisitOptions } from './doctor/reducer.js';
export {
	canGoHome,
	keepsATeam,
	kindGoingHome,
	mustStay,
	needsDoctor,
	needsHealing
} from './doctor/party.js';
export { homeTokens, tokenPuzzle, tokensForTier } from './doctor/tokens.js';
export { careFor, doctorComes, knockOut } from './doctor/knockout.js';
export type { KnockOut, KnockOutOptions } from './doctor/knockout.js';
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
export {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	PASSWORD_REFUSALS,
	checkPassword,
	isPasswordRefusal
} from './password.js';
export type { PasswordCheck, PasswordRefusal } from './password.js';
export { applyPartyIntent, leadIndex, leadRefusal, speciesLeadRefusal } from './party/reducer.js';
export { STARTERS, STARTER_TIER, chooseStarter, isStarter } from './party/starters.js';
export type { NewGameRejection, Starter, StarterPick } from './party/starters.js';
export type {
	LeadRefusal,
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
	IceBlockGround,
	Tile,
	TileKind
} from './world/types.js';
export {
	CHUNK_SIZE,
	NO_GEAR,
	encounterRealm,
	isEncounterTile,
	isIce,
	isPassable,
	isPlainGround,
	isWalkable,
	isWater,
	step,
	tileRealm
} from './world/types.js';
export {
	ARCTIC_BAND,
	ICE_RUN,
	LEAD_FREE,
	TENT_CLEARING,
	poleAt
} from './world/arctic.js';
export { MAX_SLIDE, moveFrom } from './world/slide.js';
export type { Moved } from './world/slide.js';
export {
	DEEP_WATER_MARGIN,
	TENT_LATTICE,
	generateChunk,
	onTentLattice,
	tileAtWorld
} from './world/generate.js';
export { SPAWN_DOCTOR_STEPS, SPAWN_ROOM, spawnPoint } from './world/spawn.js';
export {
	FIRST_WORLD,
	LAST_WORLD,
	MAX_WORLDS_KEPT,
	WORLD_ONE_SEED,
	fitStays,
	fitWorlds,
	isWorldNumber,
	keepWorlds,
	parseWorldNumber,
	remember,
	travel,
	worldSeed
} from './world/worlds.js';
export type { TravelRejection, TravelStep, Whereabouts, WorldStay } from './world/worlds.js';
export { TENT_MAP_SPOTS, mappedTent, tentArrival } from './world/tent-map.js';
export type { TentArrival } from './world/tent-map.js';
export {
	FIRST_LAND,
	LAND_IDS,
	SEEDS_PER_LAND,
	isLandId,
	landOfSeed,
	landSeed
} from './lands/ids.js';
export type { LandId } from './lands/ids.js';
export {
	FARE_DIFFICULTY,
	LANDS,
	availableLands,
	farePuzzle,
	flyRefusal,
	surpriseLand,
	getLand,
	needsStarter,
	priceIn,
	shopFor,
	unlockLands,
	unlockProgress
} from './lands/lands.js';
export type { CurrencyId, FlyRefusal, LandSpec, TrainerLook } from './lands/lands.js';
export { fly } from './lands/fly.js';
export type { FlyRejection, FlyStep, LandPlace, LandStay } from './lands/fly.js';
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
export {
	clearLanding,
	clearTile,
	clearableAhead,
	clearingTool,
	isClearable
} from './world/clearing.js';
export {
	DEEP_CARRY,
	LEVEL_RUNS,
	SKIM_TILES,
	TOP,
	coast,
	runUpBack,
	skiLevel,
	skiMove,
	walksBack
} from './world/skis.js';
export type { Ski, SkiMoved } from './world/skis.js';
export { BITE_CHANCE, castLine, holeAhead, holeTable, rollCast } from './world/fishing.js';
export type { CastSite, Catch } from './world/fishing.js';
export type { ClearRejection, ClearStep, Clearable, Cleared, Clearer } from './world/clearing.js';
export {
	GLIDE_TILES,
	flightPos,
	flightTile,
	glideOn,
	isLandable,
	landFlight,
	landingDistance,
	takeOff
} from './world/flight.js';
export type {
	Flight,
	FlightGear,
	Flyer,
	Landing,
	TakeOff,
	TakeOffRejection
} from './world/flight.js';
export { TENT_SEARCH_STEPS, canTalkToDoctor, nearestTent } from './world/tents.js';
export type { TentSpot } from './world/tents.js';
export { ARRIVAL_RADIUS, ESCAPE_REACH, arrivalRings, arrivalSpot } from './world/arrival.js';
export type { Arrival } from './world/arrival.js';
export type { EncounterEntry, EncounterSite, WildAnimal } from './world/encounters.js';
export {
	ENCOUNTER_CHANCE,
	NEAR_ONE_UP,
	SAFE_RADIUS,
	SKY_CHANCE,
	TIER_SIGMA,
	UNCAUGHT_BOOST,
	VISITORS_WEIGHT,
	WILD_RADIUS,
	distanceFromSpawn,
	encounterTable,
	encounterTableAt,
	favourUncaught,
	rollEncounter,
	rollEncounterFor,
	rollSkyEncounter,
	skyTableAt
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
	MAX_NAME_LENGTH,
	MIN_NAME_LENGTH,
	NAME_REJECTIONS,
	checkName,
	isNameRejection,
	isRude,
	nameKey
} from './names.js';
export type { NameCheck, NameRejection } from './names.js';

export {
	BEARINGS,
	BUSY_STATES,
	BYE_CLOSE_CODE,
	BYE_REASONS,
	INVITE_ENDS,
	MATCH_TIMEOUTS,
	MAX_MATCH_EVENTS,
	MAX_MESSAGE_BYTES,
	MAX_ROSTER,
	MAX_SERVER_MESSAGE_BYTES,
	MAX_WIRE_COORD,
	MAX_WIRE_NAME,
	PROTOCOL_VERSION,
	REFRESH_CLOSE_CODE,
	byeCloseCode,
	byeReasonOf,
	helloVersion,
	isBootId,
	isGuestId,
	isMatchId,
	isWireCoord,
	parseClientMessage,
	parseServerMessage,
	readWire
} from './net/protocol.js';
export type {
	AcceptMessage,
	AskingMessage,
	BattleMessage,
	Busy,
	ByeMessage,
	ByeReason,
	ChallengeMessage,
	ClientMessage,
	DeclineMessage,
	DoneMessage,
	FightMessage,
	FindMessage,
	FoundMessage,
	GoneMessage,
	HelloMessage,
	HereMessage,
	HiMessage,
	InviteEnd,
	InviteMessage,
	LostMessage,
	MatchMessage,
	MatchTimeout,
	NudgeMessage,
	PeerMessage,
	PlayIntent,
	PlayMessage,
	RefreshMessage,
	RejectedMessage,
	RematchMessage,
	RematchWishMessage,
	RosterEntry,
	RosterMessage,
	ServerMessage,
	UninviteMessage,
	WhereMessage,
	WireAnimal,
	WireMatchEvent,
	WithdrawMessage
} from './net/protocol.js';
export {
	FIGHT_ENDS,
	MAX_FIGHT_EVENTS,
	fightAnimal,
	matchFight,
	matchFightEvents,
	readFightEvents,
	readFightView,
	wildFight,
	wildFightEvents
} from './net/fight.js';
export type { FightAnimal, FightEnd, FightEvent, FightView } from './net/fight.js';
export {
	VIEW_KEEP,
	VIEW_RADIUS,
	bearingTo,
	bearingVector,
	inView,
	roughSteps,
	tilesApart
} from './net/nearby.js';

export {
	MAX_SAVED_NAME_LENGTH,
	MAX_SAVED_NICKNAME_LENGTH,
	MAX_SAVE_DEPTH,
	MAX_SAVE_ID_LENGTH,
	SAVE_UPGRADES,
	SAVE_VERSION,
	STARTER_SPECIES,
	V1_KEPT,
	V2_KEPT,
	V3_KEPT,
	canReplace,
	defaultStarter,
	isNewerSave,
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
	saveVersion,
	validateSave,
	validateSaveWrite
} from './save.js';
export type {
	SaveCheck,
	SaveProblem,
	SaveRead,
	SaveV1,
	SaveV5,
	SavedLandStay,
	SaveWrite,
	SaveWriteCheck,
	SavedGame,
	SavedWorldStay
} from './save.js';
