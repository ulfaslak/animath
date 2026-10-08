import {
	EMPTY_BOOK,
	FIRST_LAND,
	FIRST_WORLD,
	LAND_IDS,
	LAST_WORLD,
	MATCH_SIDES,
	MAX_MATCH_EVENTS,
	Rng,
	WORLD_ONE_SEED,
	WorldEdits,
	applyBattleIntent,
	applyDoctorIntent,
	applyPartyIntent,
	arrivalSpot,
	bookOf,
	bundled,
	canTalkToDoctor,
	careFor,
	castLine,
	checkName,
	chooseStarter,
	clearTile,
	countSolved,
	defaultStarter,
	editedTileAt,
	fitStays,
	flightPos,
	flightTile,
	gearOf,
	getAnimal,
	glideOn,
	hasItem,
	hashInts,
	holeAhead,
	hashString,
	isEncounterTile,
	isMatchId,
	availableLands,
	fly,
	landSeed,
	needsStarter,
	getLand,
	shopFor,
	unlockLands,
	isWireCoord,
	joinParty,
	knockOut,
	landFlight,
	leadIndex,
	moveFrom,
	newGame,
	normalizeNickname,
	recordBattle,
	recordParty,
	recordWentHome,
	rollEncounterFor,
	rollSkyEncounter,
	spawnPoint,
	startBattle,
	startDoctorVisit,
	step,
	surroundings,
	takeOff,
	tileAtWorld,
	tileRealm,
	travel,
	type AnimalBook,
	type LandId,
	type LandStay,
	type AnimalInstance,
	type Authority,
	type BattleEvent,
	type BattleIntent,
	type BattleState,
	type Direction,
	type DoctorIntent,
	type DoctorState,
	type Flight,
	type SpeciesRef,
	type GameEvent,
	type GridPos,
	type Intent,
	type ItemId,
	type KnockOutOptions,
	type Landing,
	type Line,
	type LineKey,
	type MatchSide,
	type PartyIntent,
	type PlayerActivity,
	type Realm,
	type SavedGame,
	type WorldStay
} from '@mathgame/engine';

/**
 * World 1's seed: the world every game was played in before worlds had
 * numbers, where a throwaway game (`?new`, `?party=`, …) is played, and the
 * title's backdrop with no saved game.
 */
export const WORLD_SEED = WORLD_ONE_SEED;

/**
 * Salts keep the per-step encounter roll, the bird's roll over each tile
 * flown, a cast's roll at a fishing hole, the battle seed and the doctor's
 * seed apart from each other and from
 * world generation, which also hashes the world seed. The sky has a salt of
 * its own, so a flight's tiles never draw from a walk's stream.
 */
const ENCOUNTER_SALT = hashString('encounter');
const SKY_SALT = hashString('sky');
const BATTLE_SALT = hashString('battle');
const DOCTOR_SALT = hashString('doctor');
const FISHING_SALT = hashString('fishing');

/** The closing line of a battle won, and of one run from, by where it was fought. */
const CLOSING_WON = {
	land: 'battle.closing.won',
	water: 'battle.closing.wonSea',
	air: 'battle.closing.wonAir'
} as const satisfies Record<Realm, LineKey>;
const CLOSING_FLED = {
	land: 'battle.closing.fled',
	water: 'battle.closing.fledSea',
	air: 'battle.closing.fledAir'
} as const satisfies Record<Realm, LineKey>;

export interface LocalAuthorityOptions {
	/**
	 * Start with this party instead of the one squirrel: the `?party=` URL
	 * switch, for looking at screens that need a bigger or hurt party. Every
	 * animal must be valid (a catalog species, HP in `0..maxHp`, unique ids),
	 * as many as it likes. The game starts with it in species bundles
	 * (`bundled`), and nicknames are cleaned on the way in, like a rename.
	 */
	party?: readonly AnimalInstance[];
	/**
	 * Start with this many tokens instead of none: the `?tokens=` URL switch,
	 * for looking at the doctor's shop. A whole number.
	 */
	tokens?: number;
	/**
	 * What the doctor's shop sells, instead of the catalog's items on sale:
	 * the `?shop` URL switch (every item), for looking at the shop before an
	 * item is on sale. Only in a game that is saved nowhere.
	 */
	shop?: readonly ItemId[];
	/**
	 * Start owning these items: the `?items=` URL switch, for looking at what
	 * an item does without buying it. Only in a game that is saved nowhere.
	 */
	items?: readonly ItemId[];
	/**
	 * Every land open and unlocked: the `?lands` URL switch, for flying to a
	 * land not built yet (#191's steps), in a game that is saved nowhere.
	 */
	lands?: boolean;
	/**
	 * Start in this land instead of Nordland: the `?land=arctic` URL switch,
	 * which opens every land as `lands` does, for looking at a land's animals
	 * at home there (`?party=` is then that land's party), in a game that is
	 * saved nowhere. Nordland, never visited, has no party of the kid's.
	 */
	land?: LandId;
	/**
	 * The world a new game from the title starts in, its home: by default one
	 * picked at random from 2 to 9999, so strangers don't all start in one
	 * world ([[PRODUCT]] §4 "Starting out"). Tests pin it.
	 */
	homeWorld?: () => number;
}

/** How a session begins: a saved game to pick up, or a new game when absent. */
export interface StartOptions {
	game?: SavedGame;
}

/**
 * The single-player authority: applies the rules in-process and emits events.
 *
 * Every single-player rule runs here, in the browser, for every player,
 * guests and account holders alike: walking, encounters, wild battles,
 * catching, the doctor, the shop, tools, the boat, travelling between worlds
 * ([[DECISIONS]] § Multiplayer). The server decides only what two players
 * share (who is where, friendly matches), never through this class. So: keep
 * game rules in the engine, keep this class thin, and never let the renderer
 * or UI reach past it.
 *
 * Everything random here is seeded from the world seed and the number of
 * completed steps, so a session replays from `(seed, intents)`. The
 * exceptions are the id an animal gets when it is caught, which must be
 * unique across sessions and is therefore minted, not derived, and the home
 * world a new game is given, picked at random so strangers spread out.
 *
 * The whole game fits in a `SavedGame`: `snapshot()` takes one at any moment,
 * a battle included, and `start({ game })` picks it up again, so a save
 * continues the same step count, and a battle the same intents, as if the
 * page had never reloaded.
 *
 * Until a game is under way (the title), it takes one intent, `new-game`,
 * and ignores the rest; `leave-game` goes back there. So nothing walks,
 * rolls an encounter or changes behind the title.
 */
export class LocalAuthority implements Authority {
	private listeners = new Set<(e: GameEvent) => void>();
	private readonly playerId = 'local';
	/** The player's name (`checkName`'s), or null until they have chosen one. Saved with the game. */
	private name: string | null = null;
	/** The world the game began in. Saved with the game. */
	private home = FIRST_WORLD;
	/** The world the player is in; `seed` is its generator seed, and `pos`, `facing` and `edits` are its. */
	private world = FIRST_WORLD;
	/**
	 * The land the player is in ([[PRODUCT]] §4 "Lands"): the seed is
	 * `landSeed(land, world)`, and the party, tokens, items, position, facing,
	 * cleared tiles and worlds left behind are this land's. Saved with the game.
	 */
	private land: LandId = FIRST_LAND;
	/** The lands left behind, as they were left (`fly`). Saved with the game. */
	private lands: readonly LandStay[] = [];
	/** The lands unlocked (`unlockLands`). Saved with the game. */
	private unlocked: readonly string[] = [FIRST_LAND];
	private seed = WORLD_SEED;
	private spawn: GridPos = { x: 0, y: 0 };
	private pos: GridPos = { x: 0, y: 0 };
	/**
	 * The way the player faces, as the client shows it: `down` in a new game
	 * (the saved facing in a restored one), then the direction of every
	 * move, walked or blocked, and of every place the player is put.
	 * `interact` talks to a doctor only when this faces a tent.
	 */
	private facing: Direction = 'down';
	private party: AnimalInstance[] = [];
	/** The tokens the doctor gave, less what the shop took. Saved with the game. */
	private tokens = 0;
	/** The ids of the items the player owns (`hasItem`). Saved with the game. */
	private items: string[] = [];
	/**
	 * Puzzles the player has solved: one more for every right answer, in a
	 * battle, at the doctor or in a friendly match (`countSolved`). Saved with
	 * the game, and it goes along to every world.
	 */
	private solved = 0;
	/**
	 * The animal book: every species seen, caught and set free in this game,
	 * in every world (`animals/book.ts`). Grows at the event that shows an
	 * animal: a wild battle's start, a leash throw that lands, and a
	 * hand-over at the witch doctor's answered right. Saved with the game.
	 */
	private book: AnimalBook = EMPTY_BOOK;
	/**
	 * The tiles the player has cleared with a tool in this world: the world is
	 * the seed's, as they left it (`editedTileAt`). Saved with the game.
	 */
	private edits = WorldEdits.none;
	/**
	 * The worlds the player has been to and left, the one left most recently
	 * first: where they stood and what they cleared in each (`travel`). Saved
	 * with the game.
	 */
	private worlds: readonly WorldStay[] = [];
	/**
	 * Completed steps in this game, in every world, saved with it. Keys the
	 * encounter roll and the battle and doctor seeds, with the world's seed.
	 */
	private steps = 0;
	/** The completed steps of this game, in every world: what the account card counts. */
	get stepsTaken(): number {
		return this.steps;
	}
	/** Doctor visits opened in this game, saved with it, so a later visit at the same step asks new puzzles. */
	private visits = 0;
	/** The battle in progress, with the seed every intent of it is applied with. */
	private battle: { state: BattleState; seed: number } | null = null;
	/**
	 * The flight in progress (the glider), from `take-off` to landing. While it
	 * lasts, `pos` is the tile the glider is over, and nothing but `glide` and
	 * `land` is taken. Never saved: `snapshot` lands it (`landFlight`), which is
	 * where a reload finds the kid.
	 */
	private flight: Flight | null = null;
	/**
	 * The wild bird following the flight down (`bird-follows`), whose battle in
	 * the air starts as the kid lands; at most one a flight. Never saved as
	 * such: `snapshot` lands the flight and starts its battle.
	 */
	private chaser: AnimalInstance | null = null;
	/**
	 * The id minted for a bird noticing the glider on a step: a save made in
	 * the air, which lands the flight ahead of time, and the landing itself
	 * meet the same bird on the same step, and give it the same id. Kept for
	 * one game only: a game started again counts its steps again, and a bird
	 * it meets is another animal.
	 */
	private minted: { steps: number; id: string } | null = null;
	/**
	 * A game is under way: from `start` or an accepted `new-game` until
	 * `leave-game`. Without one there is nothing to act on but `new-game`.
	 */
	private started = false;
	/**
	 * The doctor visit in progress: its number (every event of it carries
	 * that) and its seed, which like the battle's never leaves here. Not
	 * saved: a reload closes the visit, and what it healed is in the party.
	 */
	private doctor: { visit: number; state: DoctorState; seed: number } | null = null;
	/**
	 * The last step of each friendly match counted (`match-answers`), by the
	 * match's id, so no step counts twice. Not saved: after a reload the
	 * server sends a match picked up without the steps already sent.
	 */
	private readonly matchSteps = new Map<string, number>();

	constructor(private readonly options: LocalAuthorityOptions = {}) {}

	/**
	 * Begin a game: a new one, or `options.game` from a save. Emits `welcome`,
	 * then `battle-started` if the save was taken mid-battle.
	 */
	start(options: StartOptions = {}): void {
		this.run(options.game ?? this.newGame(), options.game === undefined);
	}

	/** Run `game` from where it stands; `isNew` when it begins here rather than from a save. */
	private run(game: SavedGame, isNew: boolean): void {
		this.name = game.name;
		this.home = game.home;
		this.world = game.world;
		this.land = game.land;
		this.lands = game.lands.map(copyLand);
		this.seed = landSeed(game.land, game.world);
		this.spawn = spawnPoint(this.seed);
		this.pos = { x: game.pos.x, y: game.pos.y };
		this.facing = game.facing;
		this.steps = game.steps;
		this.visits = game.visits;
		// A party from outside (`?party=`, a save) enters through the engine's
		// name cleaning, like a rename: the party only ever holds cleaned
		// nicknames, so every screen can show one as stored.
		this.party = game.party.map(withCleanNickname);
		this.tokens = game.tokens;
		this.items = [...game.items];
		this.solved = game.solved;
		// Every animal the kid has was caught (a starter counts), and a battle in progress was
		// met: whatever the game handed in says (a `restoreGame`'s says so already).
		this.book = recordParty(bookOf(game.seen, game.caught, game.freed), this.party);
		if (game.battle) this.book = recordBattle(this.book, game.battle);
		this.edits = WorldEdits.decode(game.edits);
		this.worlds = game.worlds.map(copyStay);
		this.unlocked = unlockLands(game.unlocked, this.book.freed);
		this.battle = null;
		this.doctor = null;
		this.flight = null;
		this.chaser = null;
		this.minted = null;
		this.started = true;
		this.emit({
			type: 'welcome',
			playerId: this.playerId,
			name: this.name,
			world: this.world,
			land: this.land,
			unlocked: [...this.unlocked],
			home: this.home,
			seed: this.seed,
			pos: { ...this.pos },
			facing: this.facing,
			party: this.partyCopy(),
			tokens: this.tokens,
			items: [...this.items],
			solved: this.solved,
			seen: [...this.book.seen],
			caught: [...this.book.caught],
			freed: [...this.book.freed],
			newGame: isNew,
			edits: [...this.edits.encode()]
		});
		if (game.battle) {
			// The battle's seed is the one it started with: the steps have not moved since
			// (or `catchUp` moved it with them).
			this.battle = { state: game.battle, seed: this.battleSeed() };
			this.emit({ type: 'battle-started', state: game.battle });
		}
		this.askStarter();
	}

	/**
	 * The game as it stands, for a save. Mid-battle the party is the battle's,
	 * HP as it is now, and the battle comes too (its state, never its seed).
	 * A doctor visit is not saved; what it healed already is in the party.
	 *
	 * In the air it is the game as it will be once the kid comes down if they
	 * let go now (`landFlight`: on the landing tile, every tile to it a step,
	 * a tree or a rock there cleared), exactly what `land` would leave: with a
	 * bird following, or one noticing the glider on the way down, its battle
	 * in the air under way. So a save never holds a flight: a reload lands the
	 * kid by the landing rule (and a reload is no escape from a bird). A page
	 * on an older build, which knows no flying, finds them on ground they can
	 * stand on; with a bird's battle in the save it knows no battle in the air
	 * either, so it reads the save as a newer build's and leaves it be.
	 */
	snapshot(): SavedGame {
		const flight = this.flight;
		const down = flight ? this.comingDown(flight) : null;
		const landing = down?.landing ?? null;
		// A bird following the flight down: its battle starts as the kid lands.
		const bird = down?.bird ?? null;
		const air = bird ? startBattle(this.party, bird, { realm: 'air' }) : null;
		const battle = this.battle ? this.battle.state : air;
		const party = battle ? battle.party : this.party;
		const book = air ? recordBattle(this.book, air) : this.book;
		const edits = landing?.cleared ? landing.edits : this.edits;
		const fitted = landing?.cleared
			? this.fitted(edits)
			: { worlds: this.worlds, lands: this.lands };
		return {
			name: this.name,
			home: this.home,
			world: this.world,
			pos: landing ? { ...landing.pos } : { ...this.pos },
			facing: this.facing,
			steps: landing && flight ? this.steps + landing.flown - flight.flown : this.steps,
			visits: this.visits,
			party: party.map((a) => ({ ...a })),
			tokens: this.tokens,
			items: [...this.items],
			solved: this.solved,
			seen: [...book.seen],
			caught: [...book.caught],
			freed: [...book.freed],
			battle,
			edits: [...edits.encode()],
			worlds: fitted.worlds.map(copyStay),
			land: this.land,
			lands: fitted.lands.map(copyLand),
			unlocked: [...this.unlocked]
		};
	}

	/**
	 * Another tab of this game walked further, and the save this page carries
	 * on from has its counts: raise this page's to them, so its next
	 * encounters and doctor puzzles follow on instead of repeating, and the
	 * next save keeps them. Never lowers a count.
	 *
	 * A doctor visit in progress keeps its number and seed, fixed when it
	 * opened. A battle in progress is keyed on the step count from here on,
	 * as a reload would key it from the save. (In practice a battle only gets
	 * here in the save right after it started, before its seed was used: only
	 * then can another tab's save hold the same progress with more steps.)
	 */
	catchUp(counts: { steps: number; visits: number }): void {
		this.visits = Math.max(this.visits, counts.visits);
		if (counts.steps <= this.steps) return;
		this.steps = counts.steps;
		if (this.battle) this.battle.seed = this.battleSeed();
	}

	/**
	 * A throwaway game in World 1, with the `?party=` party, in bundles, when
	 * there is one, the `?tokens=` tokens and the `?items=` items. Its animal
	 * book holds its party.
	 */
	private newGame(): SavedGame {
		const land = this.options.land ?? FIRST_LAND;
		const started = newGame(FIRST_WORLD, { ...defaultStarter(land), id: mintId() });
		const game = {
			...started,
			// A throwaway game in another land (`?land=`) starts at that land's spawn.
			land,
			pos: land === FIRST_LAND ? started.pos : spawnPoint(landSeed(land, FIRST_WORLD)),
			tokens: this.options.tokens ?? 0,
			items: [...(this.options.items ?? [])],
			unlocked: this.options.lands || land !== FIRST_LAND ? [...LAND_IDS] : [FIRST_LAND]
		};
		// A `?party=` brings only the animals of the land the game starts in, as every land's
		// party is its own; with none of them (or an empty one), the land's starter, as without.
		const own = new Set(getLand(land).species);
		const animals = (this.options.party ?? []).filter((a) => own.has(a.speciesId));
		if (!animals.length) return game;
		const party = bundled(animals).map((a) => ({ ...a }));
		const book = recordParty(EMPTY_BOOK, party);
		return {
			...game,
			party,
			seen: [...book.seen],
			caught: [...book.caught],
			freed: [...book.freed]
		};
	}

	dispatch(intent: Intent): void {
		if (intent.type === 'new-game') {
			this.startNewGame(intent);
			return;
		}
		if (!this.started) return;
		if (intent.type === 'leave-game') {
			// Only while exploring, as the pause menu is: a battle, a doctor visit or a
			// flight is finished first, so no way out of one opens through the title.
			if (!this.battle && !this.doctor && !this.flight) this.leave();
			return;
		}
		if (intent.type === 'party') {
			// In any mode: the engine is told what the player is doing and refuses
			// an edit outside explore itself.
			this.editParty(intent.intent);
			return;
		}
		if (intent.type === 'choose-name') {
			// In any mode: a game saved mid-battle asks for the name before it goes on.
			this.chooseName(intent.name);
			return;
		}
		if (intent.type === 'match-answers') {
			// In any mode: a right answer in a match is the kid's to keep, whatever else is up.
			this.countMatch(intent);
			return;
		}
		if (this.battle) {
			// Mid-battle there is no walking and no talking; only battle intents count.
			if (intent.type === 'battle') this.applyBattle(intent.intent);
			return;
		}
		if (this.doctor) {
			// At the doctor, walking waits until the visit ends; only doctor intents count.
			if (intent.type === 'doctor') this.applyDoctor(intent.intent);
			return;
		}
		if (this.flight) {
			// In the air only the flight goes on: no walking, talking, clearing, travelling
			// or going to anyone until the kid is down.
			if (intent.type === 'glide') this.glide(this.flight);
			else if (intent.type === 'land') this.comeDown(this.flight);
			return;
		}
		if (intent.type === 'pick-starter') {
			this.pickStarter(intent);
			return;
		}
		if (this.waiting()) {
			// Just flown in, with no animal of this land yet: the kid stays by the witch doctor
			// they came down at until they pick one, and the witch doctor still talks.
			if (intent.type === 'interact' && canTalkToDoctor(this.seed, this.pos, this.facing)) {
				this.visitDoctor();
			}
			return;
		}
		switch (intent.type) {
			case 'move':
				this.move(intent.dir);
				break;
			case 'interact':
				this.interact();
				break;
			case 'go-to':
				this.goTo(intent.near);
				break;
			case 'travel':
				this.travel(intent.world);
				break;
			case 'take-off':
				this.takeOff();
				break;
			case 'battle':
			case 'doctor':
			case 'glide':
			case 'land':
				// Nothing to act in; the client is showing a result card, or a landing, or is stale.
				break;
		}
	}

	subscribe(listener: (e: GameEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// --- the title -----------------------------------------------------------

	/**
	 * `new-game`: the title's choice. Only from the title, only a starter (the
	 * engine's `chooseStarter`, which also cleans its name), and a player's
	 * name that `checkName` takes, when there is one. The new game starts in
	 * its home world, picked for it (`homeWorld`), and its starter gets a
	 * fresh id like a caught animal.
	 */
	private startNewGame(choice: Intent & { type: 'new-game' }): void {
		if (this.started) {
			this.emit({ type: 'new-game-refused', reason: 'game-in-progress' });
			return;
		}
		const pick = chooseStarter(choice);
		if (!pick.ok) {
			this.emit({ type: 'new-game-refused', reason: pick.reason });
			return;
		}
		const named = choice.name === undefined ? null : checkName(choice.name);
		if (named && !named.ok) {
			this.emit({ type: 'new-game-refused', reason: 'not-a-name' });
			return;
		}
		const home = this.options.homeWorld?.() ?? randomHome();
		const starter = { ...pick.starter, id: mintId() };
		this.run(newGame(home, starter, named ? named.name : null), true);
	}

	/**
	 * `choose-name`: the player's name, as typed, for a game that asks for one
	 * (a save from before names). `checkName` keeps it tidy or says why not.
	 */
	private chooseName(raw: unknown): void {
		const named = checkName(raw);
		if (!named.ok) {
			this.emit({ type: 'name-refused', reason: named.reason });
			return;
		}
		this.name = named.name;
		this.emit({ type: 'name-chosen', playerId: this.playerId, name: named.name });
	}

	/**
	 * `leave-game`, while exploring: back to the title. The game stays as it
	 * stood, so `snapshot()` still holds it and `start` can pick it up again.
	 * Nothing is accepted after this but `new-game`.
	 */
	private leave(): void {
		this.started = false;
		this.emit({ type: 'game-left' });
	}

	// --- explore -----------------------------------------------------------

	private move(dir: Direction): void {
		// Walked, slid or blocked, the player turns to face the way they tried to go.
		this.facing = dir;
		// The world as the player left it: a tree they chopped down is ground to walk
		// on; and with the boat the water is theirs too. On the ice the step slides on
		// until something stops it (`moveFrom`): one move, every tile of it a step, so
		// no save is ever taken halfway through a slide.
		const moved = moveFrom(this.seed, this.edits, this.pos, dir, gearOf({ items: this.items }));
		if (!moved) {
			this.emit({ type: 'player-blocked', playerId: this.playerId, dir });
			return;
		}
		const { path, tile } = moved;
		const next = path[path.length - 1]!;
		this.pos = next;
		this.steps += path.length;
		const tiles = path.length > 1 ? { tiles: path.length } : {};
		this.emit({ type: 'player-moved', playerId: this.playerId, pos: next, dir, ...tiles });

		// Only an encounter tile can start a battle, and the engine draws nothing
		// on any other: the ground around one is read only there. A slide is
		// rolled once, on the tile it ends on (the ice it crosses starts nothing).
		if (!isEncounterTile(tile.kind)) return;
		// One roll per completed step, keyed by the step count so a replayed walk
		// meets the same animals. The engine sizes it to the lead where the player
		// now stands (`leadIndex`: the first animal standing that can fight there,
		// out on the water one that swims), the one `startBattle` sends out first,
		// so choosing a lead changes what the grass holds; and with nobody standing
		// who can fight here nothing challenges the player (`rollEncounterFor`): a
		// team that needs the doctor walks to one in peace, and a boat with no
		// swimmer standing sails in peace.
		const rng = new Rng(hashInts(this.seed, ENCOUNTER_SALT, this.steps));
		const site = {
			land: this.land,
			tile,
			pos: next,
			spawn: this.spawn,
			around: surroundings(this.seed, next)
		};
		const wild = rollEncounterFor(rng, site, this.party);
		if (wild) this.beginBattle({ ...wild, id: mintId() }, tileRealm(tile.kind));
	}

	/**
	 * `go-to`, while exploring: beside another player, who the presence server
	 * says stands at `near`, on the engine's `arrivalSpot` in this world as the
	 * player left it, facing them. Not a step: the step count stays, so no
	 * encounter is rolled and the walk after it meets what it would have met.
	 * A spot that is no whole tile on the wire is no spot.
	 */
	private goTo(near: GridPos): void {
		const arrival =
			near && isWireCoord(near.x) && isWireCoord(near.y)
				? arrivalSpot(this.seed, near, this.edits, gearOf({ items: this.items }))
				: null;
		if (!arrival) {
			this.emit({ type: 'go-to-refused', reason: 'no-room' });
			return;
		}
		this.pos = { ...arrival.pos };
		this.facing = arrival.facing;
		this.emit({
			type: 'player-placed',
			playerId: this.playerId,
			pos: { ...arrival.pos },
			dir: arrival.facing
		});
		this.careForTeam();
	}

	/**
	 * The player was put somewhere without walking or flying there (beside a
	 * friend, in another world): a team that needs the doctor with no tent
	 * within reach of it, and no glider to fly out on, gets one, as after a
	 * battle lost there (the engine's `careFor`), and the client says so from
	 * `doctor.came`. Every other team stays as it is. A walk never leaves the
	 * ground a tent is reached over, and a glide can always be flown back, so
	 * only these ask, and never of a kid with the glider: a spot no tent is
	 * walked to from is reached by gliding in, and a doctor there would make
	 * a trip out and back a free heal (the adversarial review of #116). A
	 * loaded save never asks (`restoreGame`), so a reload is never a heal.
	 */
	private careForTeam(): void {
		const care = careFor(this.seed, this.pos, this.party, this.edits, this.rescue(this.realm()));
		if (!care.doctorCame) return;
		this.party = care.party;
		this.emit({ type: 'party-changed', party: this.partyCopy() });
		this.emit({ type: 'message', line: { key: 'doctor.came', params: {} } });
	}

	/**
	 * `travel`, while exploring: to world `to` (the engine's `travel`). The
	 * world left is remembered as the player leaves it; the world reached is
	 * picked up where they left it, or at its spawn on a first visit. The
	 * party, tokens, items, name and counts go along unchanged, and so does
	 * the land: lands and world numbers are two ways of going.
	 */
	private travel(to: unknown): void {
		const trip = travel(
			{
				world: this.world,
				pos: this.pos,
				facing: this.facing,
				edits: this.edits,
				worlds: this.worlds
			},
			to,
			{ home: this.home, items: this.items, land: this.land }
		);
		if (!trip.ok) {
			this.emit({ type: 'travel-refused', reason: trip.reason });
			return;
		}
		const here = trip.whereabouts;
		this.world = here.world;
		this.seed = landSeed(this.land, here.world);
		this.spawn = spawnPoint(this.seed);
		this.pos = { x: here.pos.x, y: here.pos.y };
		this.facing = here.facing;
		this.edits = here.edits;
		this.worlds = here.worlds.map(copyStay);
		this.emit({
			type: 'travelled',
			playerId: this.playerId,
			world: this.world,
			land: this.land,
			seed: this.seed,
			pos: { ...this.pos },
			facing: this.facing,
			edits: [...this.edits.encode()],
			firstVisit: trip.firstVisit
		});
		this.careForTeam();
	}

	/** Where the player is: up in the air with the glider, out on the water in the boat, or on land. */
	private realm(): Realm {
		if (this.flight) return 'air';
		return tileRealm(editedTileAt(this.seed, this.edits, this.pos.x, this.pos.y).kind);
	}

	/**
	 * What the knock-out rule needs to know of the kid, `realm` where the battle
	 * was or where they stand: the boat for the way to a tent, and the glider,
	 * which flies them out of anywhere, so no doctor comes to them.
	 */
	private rescue(realm: Realm): KnockOutOptions {
		const owner = { items: this.items };
		return { gear: gearOf(owner), realm, glider: hasItem(owner, 'glider') };
	}

	// --- the glider ----------------------------------------------------------

	/**
	 * `take-off`, while exploring: up in the air the way the player faces, with
	 * the engine's `takeOff` (the glider owned, and somewhere to land in the
	 * `GLIDE_TILES` ahead). From land or from the boat. Not a step.
	 */
	private takeOff(): void {
		const player = { pos: this.pos, facing: this.facing, items: this.items };
		const result = takeOff(this.seed, this.edits, player);
		if (!result.ok) {
			this.emit({ type: 'take-off-refused', playerId: this.playerId, reason: result.reason });
			return;
		}
		this.flight = result.flight;
		this.chaser = null;
		const { from, dir, reach } = result.flight;
		this.emit({ type: 'took-off', playerId: this.playerId, from: { ...from }, dir, reach });
	}

	/**
	 * `glide`: one tile on, a step like any (the step count keys what comes
	 * after a flight, as after a walk). Nothing on the ground notices a kid up
	 * in the air, but a bird may notice the glider over the tile it enters
	 * (`skyRoll`) and follow it down. At the reach it goes no further: a glide
	 * past it is a landing there. The glide onto the reach does not land by
	 * itself, so the tile is flown over (and said to be, to the others) before
	 * it is landed on.
	 */
	private glide(flight: Flight): void {
		const next = glideOn(flight);
		if (next === flight) {
			this.comeDown(flight);
			return;
		}
		this.flight = next;
		this.pos = flightPos(next);
		this.steps += 1;
		this.emit({ type: 'glided', playerId: this.playerId, pos: { ...this.pos }, flown: next.flown });
		if (this.chaser) return;
		const bird = this.skyRoll(this.pos, this.steps);
		if (bird) this.follows(bird, this.pos, next.flown);
	}

	/**
	 * `land`, or the reach: down on the first tile from the one the glider is
	 * over that the player can stand on (`landFlight`), every tile flown on to
	 * it a step, and a tile a bird may notice the glider over, as a glide's
	 * (`comingDown`). A tree or a rock there is cleared with its tool as they
	 * touch down, and every world's cleared tiles share one budget, as after a
	 * chop. Then, with a bird following, its battle in the air: the landing
	 * always comes first.
	 */
	private comeDown(flight: Flight): void {
		const { landing, bird, noticed } = this.comingDown(flight);
		this.flight = null;
		this.steps += landing.flown - flight.flown;
		this.pos = { ...landing.pos };
		this.facing = flight.dir;
		const cleared = landing.cleared;
		if (cleared) {
			this.edits = landing.edits;
			this.fitAround(this.edits);
		}
		// Noticed on the way down to the landing tile (a `land` sent early carries the flight on).
		if (bird && noticed) this.follows(bird, noticed.pos, noticed.flown);
		this.chaser = null;
		this.emit({
			type: 'landed',
			playerId: this.playerId,
			pos: { ...landing.pos },
			dir: flight.dir,
			flown: landing.flown
		});
		if (cleared) {
			const { pos, was, tool, regrown } = cleared;
			this.emit({ type: 'tile-cleared', playerId: this.playerId, pos, was, tool, regrown });
		}
		if (bird) this.beginBattle(bird, 'air');
	}

	/** Where `flight` comes down if the kid lets go now, in this world as they left it. */
	private landing(flight: Flight): Landing {
		return landFlight(this.seed, this.edits, flight, { items: this.items });
	}

	/**
	 * Letting go now: where `flight` comes down (`landing`), and the bird that
	 * follows it down, the one already following or one that notices the
	 * glider over a tile the flight enters on its way to the landing tile (each
	 * a step, each rolled as a glide's tile is, until one comes out), with
	 * where it noticed it. What `land` does and what a save in the air holds.
	 */
	private comingDown(flight: Flight): {
		landing: Landing;
		bird: AnimalInstance | null;
		noticed: { pos: GridPos; flown: number } | null;
	} {
		const landing = this.landing(flight);
		let bird = this.chaser;
		let noticed: { pos: GridPos; flown: number } | null = null;
		for (let flown = flight.flown + 1; bird === null && flown <= landing.flown; flown++) {
			const pos = flightTile(flight.from, flight.dir, flown);
			bird = this.skyRoll(pos, this.steps + flown - flight.flown);
			if (bird) noticed = { pos, flown };
		}
		return { landing, bird, noticed };
	}

	/**
	 * The bird that notices the glider over `pos`, entered on step `steps`, or
	 * null: only while a bird stands in the team (the lead in the air: the
	 * engine's `leadIndex` in the air realm), from the table of the sky over
	 * that tile (`rollSkyEncounter`: one in twenty, whatever the lead and the
	 * ground), on the step's own stream, so a flight replays from its steps.
	 */
	private skyRoll(pos: GridPos, steps: number): AnimalInstance | null {
		const lead = this.party[leadIndex(this.party, 'air')];
		if (!lead) return null;
		const rng = new Rng(hashInts(this.seed, SKY_SALT, steps));
		const tile = tileAtWorld(this.seed, pos.x, pos.y);
		const site = {
			land: this.land,
			tile,
			pos,
			spawn: this.spawn,
			around: surroundings(this.seed, pos)
		};
		const bird = rollSkyEncounter(rng, site, getAnimal(lead.speciesId).tier);
		if (!bird) return null;
		// One id per step a bird notices on, however often a save lands the flight ahead of time.
		if (this.minted?.steps !== steps) this.minted = { steps, id: mintId() };
		return { ...bird, id: this.minted.id };
	}

	/** A bird follows the glider down, from over `pos`, `flown` tiles out: say so. */
	private follows(bird: AnimalInstance, pos: GridPos, flown: number): void {
		this.chaser = bird;
		this.emit({
			type: 'bird-follows',
			playerId: this.playerId,
			speciesId: bird.speciesId,
			pos: { ...pos },
			flown
		});
	}

	// --- battle ------------------------------------------------------------

	private beginBattle(wild: AnimalInstance, realm: Realm): void {
		const state = startBattle(this.party, wild, { realm });
		this.battle = { state, seed: this.battleSeed() };
		this.emit({ type: 'battle-started', state });
		// Met, from the moment the battle starts, however it ends.
		this.note(recordBattle(this.book, state));
	}

	/** The seed of a battle that starts on the current step. */
	private battleSeed(): number {
		return hashInts(this.seed, BATTLE_SALT, this.steps);
	}

	private applyBattle(intent: BattleIntent): void {
		const battle = this.battle!;
		const { state, events } = applyBattleIntent(battle.state, intent, battle.seed);
		battle.state = state;
		this.emit({ type: 'battle-updated', state, events });
		this.count(countSolved(this.solved, events));
		// Caught, at the leash throw that lands.
		this.note(recordBattle(this.book, state, events));
		if (state.phase.kind !== 'ended') return;
		this.battle = null;
		this.endBattle(state, events);
	}

	/**
	 * Write the battle's result back into the world: HP lost stays lost, a
	 * caught animal joins the party (the engine's `joinParty`: at the end of
	 * its species' bundle, and there is no cap), and a lost battle leaves the
	 * player where they stood with the team as tired as it is, to walk to a
	 * doctor (the engine's knock-out rule, `knockOut`: only with no tent
	 * within reach does a doctor come and look after everyone here). The
	 * closing line is a copy key, with the wild animal, never words.
	 */
	private endBattle(state: BattleState, events: readonly BattleEvent[]): void {
		if (state.phase.kind !== 'ended') return;
		this.party = state.party.map((a) => ({ ...a }));
		const animal: SpeciesRef = { speciesId: state.opponent.speciesId };
		let line: Line;
		// Out on the water the wild animal swims home, or stays in the water, not the grass; up
		// in the air the bird flies home, or stays up in the sky.
		switch (state.phase.outcome) {
			case 'won':
				line = { key: CLOSING_WON[state.realm], params: { animal } };
				break;
			case 'fled':
				line = { key: CLOSING_FLED[state.realm], params: { animal } };
				break;
			case 'caught': {
				// The reducer always reports the caught animal on `ended`.
				const ended = events.find((e) => e.type === 'ended');
				const caught = ended?.type === 'ended' ? ended.caught : undefined;
				if (caught) this.party = joinParty(this.party, caught);
				line = { key: 'battle.closing.joined', params: { animal } };
				break;
			}
			case 'lost': {
				// Every animal that could fight here is tired, and stays so: the kid walks
				// to a doctor, by the paths they cleared, and over the water too with the
				// boat. With no tent within reach, and no glider to fly out on, a doctor comes
				// here instead. A battle in the air is lost where the glider came down, and
				// looked at from there.
				const out = knockOut(this.seed, this.pos, this.party, this.edits, this.rescue(state.realm));
				this.party = out.party;
				line = out.doctorCame
					? { key: 'doctor.came', params: {} }
					: { key: 'battle.closing.lost', params: {} };
				break;
			}
		}
		this.emit({ type: 'battle-ended', state });
		this.emit({ type: 'party-changed', party: this.partyCopy() });
		this.emit({ type: 'message', line });
	}

	// --- interact: a tent, a tree, a rock ---------------------------------

	/**
	 * Enter/Space: whatever the player faces. A tent: talk to the doctor. A
	 * fishing hole: fish (`fish`). A tree, a rock or an ice block: clear it
	 * with its tool (the engine's `clearTile` checks the whole action), or,
	 * without the tool, say which one it takes. Anywhere
	 * else there is nothing to talk to, and the event says so without words:
	 * the client says how to find a doctor, in the player's language.
	 */
	private interact(): void {
		if (canTalkToDoctor(this.seed, this.pos, this.facing)) {
			this.visitDoctor();
			return;
		}
		const hole = holeAhead(this.seed, this.edits, this.pos, this.facing);
		if (hole) {
			this.fish(hole);
			return;
		}
		const player = { pos: this.pos, facing: this.facing, items: this.items };
		const result = clearTile(this.seed, this.edits, player, step(this.pos, this.facing));
		if (result.ok) {
			this.edits = result.edits;
			// Every world's cleared tiles share one budget: this world's come first.
			this.fitAround(this.edits);
			const { pos, was, tool, regrown } = result.cleared;
			this.emit({ type: 'tile-cleared', playerId: this.playerId, pos, was, tool, regrown });
		} else if (result.reason === 'needs-tool' && result.kind && result.tool) {
			const { kind, tool } = result;
			this.emit({ type: 'tool-needed', playerId: this.playerId, kind, tool });
		} else {
			this.emit({ type: 'nothing-to-interact', playerId: this.playerId });
		}
	}

	/**
	 * Enter facing a fishing hole: without the fishing rod, say it takes one;
	 * with it, cast a line (the engine's `castLine`). A cast is a step of the
	 * count, so every cast rolls on a stream of its own, keyed like an
	 * encounter, and a reload casts on as it would have. Something bit: its
	 * battle starts at once, in the water, fought by the swimmers.
	 */
	private fish(hole: GridPos): void {
		const owner = { items: this.items };
		if (!hasItem(owner, 'fishing-rod')) {
			this.emit({
				type: 'tool-needed',
				playerId: this.playerId,
				kind: 'hole',
				tool: 'fishing-rod'
			});
			return;
		}
		this.steps += 1;
		const rng = new Rng(hashInts(this.seed, FISHING_SALT, this.steps));
		const site = { hole, spawn: this.spawn };
		const cast = castLine(rng, this.seed, this.edits, site, owner, this.party);
		const speciesId = cast.outcome === 'bite' ? { speciesId: cast.wild.speciesId } : {};
		this.emit({
			type: 'line-cast',
			playerId: this.playerId,
			hole: { ...hole },
			outcome: cast.outcome,
			...speciesId
		});
		if (cast.outcome === 'bite') this.beginBattle({ ...cast.wild, id: mintId() }, 'water');
	}

	// --- doctor ------------------------------------------------------------

	/** Open a doctor visit: the player faces a tent. */
	private visitDoctor(): void {
		this.visits += 1;
		const state = startDoctorVisit(this.party, {
			tokens: this.tokens,
			items: this.items,
			shop: this.options.shop ?? shopFor(this.land),
			land: this.land,
			unlocked: this.unlocked,
			open: this.options.lands ? LAND_IDS : availableLands()
		});
		// A fresh seed per visit, keyed like everything else here so a session
		// replays; the visit count keeps a second visit from asking the same
		// puzzles, and tells the visits apart in their events.
		this.doctor = {
			visit: this.visits,
			state,
			seed: hashInts(this.seed, DOCTOR_SALT, this.steps, this.visits)
		};
		this.emit({ type: 'doctor-visit-started', visit: this.visits, state });
	}

	/**
	 * Apply one doctor intent. What it did is written back at once — a heal,
	 * animals gone home, tokens given, an item bought, a puzzle solved: the
	 * kid earned it, whatever happens to the visit after. Leaving ends the
	 * visit, and the client says the doctor's goodbye.
	 */
	private applyDoctor(intent: DoctorIntent): void {
		const doctor = this.doctor!;
		const { visit } = doctor;
		const { state, events } = applyDoctorIntent(doctor.state, intent, doctor.seed);
		doctor.state = state;
		this.emit({ type: 'doctor-visit-updated', visit, state, events });
		this.count(countSolved(this.solved, events));
		if (events.some((e) => e.type === 'healed' || e.type === 'went-home')) {
			this.party = state.party.map((a) => ({ ...a }));
			this.emit({ type: 'party-changed', party: this.partyCopy() });
		}
		// The kinds that went home are set free in the book, for good, and the last kind a land
		// asked for unlocks the next.
		this.note(recordWentHome(this.book, events));
		this.unlock();
		if (events.some((e) => e.type === 'tokens-given' || e.type === 'bought')) {
			this.tokens = state.tokens;
			this.items = [...state.items];
			this.emit({ type: 'belongings-changed', tokens: this.tokens, items: [...this.items] });
		}
		if (state.phase.kind !== 'ended') return;
		this.doctor = null;
		this.emit({ type: 'doctor-visit-ended', visit, state });
		const flew = events.find((e) => e.type === 'flew');
		if (flew?.type === 'flew') this.fly(flew.land);
	}

	// --- lands ---------------------------------------------------------------

	/**
	 * The fare was paid at the witch doctor's (`flew`): off to land `to`, in
	 * this world number (the engine's `fly`). This land is remembered as it is
	 * left, its party, tokens and items with it, and the land reached comes
	 * back as it was left, or with nothing on a first visit; the player comes
	 * down beside the tent the mapping gives (`tentArrival`), facing it. The
	 * name, the book, the puzzles solved, the counts and home go along. Not a
	 * step: nothing is rolled. With no animal of the land yet, the kid picks a
	 * starter there (`starter-wanted`).
	 */
	private fly(to: LandId): void {
		const trip = fly(
			{
				land: this.land,
				world: this.world,
				pos: this.pos,
				facing: this.facing,
				edits: this.edits,
				worlds: this.worlds,
				party: this.party,
				tokens: this.tokens,
				items: this.items,
				lands: this.lands
			},
			step(this.pos, this.facing),
			to,
			this.home
		);
		if (!trip.ok) return;
		const here = trip.place;
		this.land = here.land;
		this.seed = landSeed(here.land, here.world);
		this.spawn = spawnPoint(this.seed);
		this.pos = { ...here.pos };
		this.facing = here.facing;
		this.edits = here.edits;
		this.worlds = here.worlds.map(copyStay);
		this.party = here.party.map((a) => ({ ...a }));
		this.tokens = here.tokens;
		this.items = [...here.items];
		this.lands = here.lands.map(copyLand);
		this.emit({
			type: 'travelled',
			playerId: this.playerId,
			world: this.world,
			land: this.land,
			seed: this.seed,
			pos: { ...this.pos },
			facing: this.facing,
			edits: [...this.edits.encode()],
			firstVisit: trip.firstVisit
		});
		this.emit({ type: 'party-changed', party: this.partyCopy() });
		this.emit({ type: 'belongings-changed', tokens: this.tokens, items: [...this.items] });
		this.askStarter();
	}

	/**
	 * The worlds left behind, in this land and every other, with their
	 * cleared tiles cut to what fits beside `edits` (this world's) within the
	 * one budget (`fitStays`): this land's first, then the lands left.
	 */
	private fitted(edits: WorldEdits): { worlds: readonly WorldStay[]; lands: readonly LandStay[] } {
		const [worlds, ...lands] = fitStays(
			edits,
			[this.worlds, ...this.lands.map((l) => l.worlds)],
			this.home
		);
		return {
			worlds: worlds!,
			lands: this.lands.map((l, i) =>
				lands[i] === l.worlds ? l : { ...l, worlds: [...lands[i]!] }
			)
		};
	}

	/** Every world's cleared tiles, in every land, back within the budget after `edits` grew. */
	private fitAround(edits: WorldEdits): void {
		const { worlds, lands } = this.fitted(edits);
		this.worlds = worlds;
		this.lands = lands;
	}

	/** Waiting for the kid to pick the first animal of this land (`needsStarter`). */
	private waiting(): boolean {
		return needsStarter(this.land, this.party);
	}

	/** Ask for a starter, when the kid has no animal in this land yet. */
	private askStarter(): void {
		if (!this.waiting()) return;
		const starters = [...getLand(this.land).starters];
		this.emit({ type: 'starter-wanted', land: this.land, starters });
	}

	/**
	 * `pick-starter`: the first animal of this land, while one is waited for,
	 * one of the land's starters (the engine's `chooseStarter`, which cleans
	 * its name), with a fresh id like a caught animal. It is caught, in the book.
	 */
	private pickStarter(choice: Intent & { type: 'pick-starter' }): void {
		if (this.battle || this.doctor || !this.waiting()) {
			this.emit({ type: 'starter-refused', reason: 'not-wanted' });
			return;
		}
		const pick = chooseStarter(choice, getLand(this.land).starters);
		if (!pick.ok) {
			const reason = pick.reason === 'not-text' ? 'not-text' : 'not-a-starter';
			this.emit({ type: 'starter-refused', reason });
			return;
		}
		this.party = [{ ...pick.starter, id: mintId() }];
		this.emit({ type: 'party-changed', party: this.partyCopy() });
		this.note(recordParty(this.book, this.party));
	}

	/** The lands unlocked, grown by what the book now says is set free: say so when they grew. */
	private unlock(): void {
		const unlocked = unlockLands(this.unlocked, this.book.freed);
		if (unlocked === this.unlocked) return;
		this.unlocked = unlocked;
		// A visit under way flies to it at once: its rule reads the lands unlocked it opened with.
		if (this.doctor) this.doctor.state = { ...this.doctor.state, unlocked: [...unlocked] };
		this.emit({ type: 'unlocked-changed', unlocked: [...unlocked] });
	}

	// --- party ---------------------------------------------------------------

	/**
	 * Apply a party intent and say what happened: the facts only. The client
	 * words them (the message line's notice about the lead), in the language
	 * on screen.
	 */
	private editParty(intent: PartyIntent): void {
		const { party, events } = applyPartyIntent(this.party, intent, this.activity(), this.realm());
		this.party = party.map((a) => ({ ...a }));
		this.emit({ type: 'party-edited', party: this.partyCopy(), events });
	}

	// --- friendly matches ----------------------------------------------------

	/**
	 * `match-answers`: one step of a friendly match, as the server sent it.
	 * This player's right answers in it count (`countSolved` with their
	 * side), and nothing else changes, the animal book included. A step is
	 * counted once: the server numbers each match's steps (its view's `step`,
	 * one more for every intent it accepted), so a step at or below one
	 * already counted for that match is a batch passed twice, and adds
	 * nothing. A batch that is not one adds nothing either.
	 */
	private countMatch(intent: Intent & { type: 'match-answers' }): void {
		if (!isMatchBatch(intent)) return;
		const { match, step, side, events } = intent;
		if (step <= (this.matchSteps.get(match) ?? 0)) return;
		this.matchSteps.set(match, step);
		this.count(countSolved(this.solved, events, side));
	}

	/** What the player is doing, for the engine's rules that depend on it. */
	private activity(): PlayerActivity {
		if (this.battle) return 'battle';
		if (this.doctor) return 'doctor';
		return this.flight ? 'flight' : 'explore';
	}

	// --- helpers -----------------------------------------------------------

	/** The puzzles solved are `solved` now (`countSolved`'s): say so, when that is more than before. */
	private count(solved: number): void {
		if (solved === this.solved) return;
		this.solved = solved;
		this.emit({ type: 'solved-changed', solved });
	}

	/**
	 * The animal book is `book` now (`animals/book.ts`, whose rules hand back
	 * the very same book when nothing is new): say so, when it grew.
	 */
	private note(book: AnimalBook): void {
		if (book === this.book) return;
		this.book = book;
		this.emit({
			type: 'book-changed',
			seen: [...book.seen],
			caught: [...book.caught],
			freed: [...book.freed]
		});
	}

	private partyCopy(): AnimalInstance[] {
		return this.party.map((a) => ({ ...a }));
	}

	private emit(event: GameEvent): void {
		for (const l of this.listeners) l(event);
	}
}

/**
 * A `match-answers` that is one step of a match, whatever its type says: a
 * match id, a step that is a whole number, a side, and the events of one
 * intent: a list of at most `MAX_MATCH_EVENTS` (as the wire takes), each an
 * object with a `type`, and at most one `answer-judged`, with a side and
 * `correct` true or false (the match reducer judges one answer per intent).
 * So one step adds at most one puzzle solved. A step below 1 passes here,
 * but never counts: it is never above the last step counted, which starts
 * at 0.
 */
function isMatchBatch(intent: Intent & { type: 'match-answers' }): boolean {
	const { match, step, side, events } = intent as { [K in keyof typeof intent]: unknown };
	if (!isMatchId(match) || !Number.isSafeInteger(step)) return false;
	if (!MATCH_SIDES.includes(side as MatchSide)) return false;
	if (!Array.isArray(events) || events.length > MAX_MATCH_EVENTS) return false;
	let judged = 0;
	// An index loop, not `every`: a hole in the list is looked at too, and refused.
	for (let i = 0; i < events.length; i++) {
		const e: unknown = events[i];
		if (typeof e !== 'object' || e === null) return false;
		const { type, side: by, correct } = e as { type?: unknown; side?: unknown; correct?: unknown };
		if (typeof type !== 'string') return false;
		if (type !== 'answer-judged') continue;
		judged += 1;
		if (judged > 1 || !MATCH_SIDES.includes(by as MatchSide) || typeof correct !== 'boolean') {
			return false;
		}
	}
	return true;
}

/** A copy of a land left behind, so the authority's own never leaves it. */
function copyLand(stay: LandStay): LandStay {
	return {
		land: stay.land,
		party: stay.party.map((a) => ({ ...a })),
		tokens: stay.tokens,
		items: [...stay.items],
		worlds: stay.worlds.map(copyStay)
	};
}

/** A copy of a world left behind, so the authority's own never leaves it. */
function copyStay(stay: WorldStay): WorldStay {
	return {
		world: stay.world,
		pos: { x: stay.pos.x, y: stay.pos.y },
		facing: stay.facing,
		edits: [...stay.edits]
	};
}

/**
 * A new game's home world: a random one from 2 to `LAST_WORLD`, so strangers
 * don't all start in one world (World 1 is where the games from before
 * numbered worlds are).
 */
export function randomHome(): number {
	const [n] = globalThis.crypto.getRandomValues(new Uint32Array(1));
	return FIRST_WORLD + 1 + (n! % (LAST_WORLD - FIRST_WORLD));
}

/** A copy of the animal with its nickname cleaned, and no `nickname` key when none is left. */
function withCleanNickname(animal: AnimalInstance): AnimalInstance {
	const { nickname, ...rest } = animal;
	const clean = normalizeNickname(nickname);
	return clean === undefined ? rest : { ...rest, nickname: clean };
}

/**
 * A fresh instance id. `crypto.randomUUID` needs a secure context, which a
 * LAN address over plain http is not, so fall back to random bytes there.
 */
export function mintId(): string {
	const c = globalThis.crypto;
	if (typeof c.randomUUID === 'function') return c.randomUUID();
	const bytes = c.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
