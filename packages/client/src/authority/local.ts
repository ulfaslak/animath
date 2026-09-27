import {
	FIRST_WORLD,
	LAST_WORLD,
	Rng,
	WORLD_ONE_SEED,
	WorldEdits,
	applyBattleIntent,
	applyDoctorIntent,
	applyPartyIntent,
	arrivalSpot,
	bundled,
	canTalkToDoctor,
	checkName,
	chooseStarter,
	clearTile,
	editedTileAt,
	fitWorlds,
	flightPos,
	gearOf,
	getAnimal,
	glideOn,
	hashInts,
	hashString,
	isEncounterTile,
	isPassable,
	isWireCoord,
	joinParty,
	landFlight,
	leadIndex,
	newGame,
	normalizeNickname,
	rollEncounter,
	spawnPoint,
	startBattle,
	startDoctorVisit,
	step,
	surroundings,
	takeOff,
	takeToDoctor,
	tileRealm,
	travel,
	worldSeed,
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
	type Landing,
	type Line,
	type PartyIntent,
	type PlayerActivity,
	type Realm,
	type Rescue,
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
 * Salts keep the per-step encounter roll, the battle seed and the doctor's
 * seed apart from each other and from world generation, which also hashes the
 * world seed.
 */
const ENCOUNTER_SALT = hashString('encounter');
const BATTLE_SALT = hashString('battle');
const DOCTOR_SALT = hashString('doctor');

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
	private seed = WORLD_SEED;
	private spawn: GridPos = { x: 0, y: 0 };
	private pos: GridPos = { x: 0, y: 0 };
	/**
	 * The way the player faces, as the client shows it: `down` in a new game
	 * (the saved facing in a restored one), then the direction of every
	 * move, walked or blocked, and the direction of `taken-to-doctor`.
	 * `interact` talks to a doctor only when this faces a tent.
	 */
	private facing: Direction = 'down';
	private party: AnimalInstance[] = [];
	/** The tokens the doctor gave, less what the shop took. Saved with the game. */
	private tokens = 0;
	/** The ids of the items the player owns (`hasItem`). Saved with the game. */
	private items: string[] = [];
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
		this.seed = worldSeed(game.world);
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
		this.edits = WorldEdits.decode(game.edits);
		this.worlds = game.worlds.map(copyStay);
		this.battle = null;
		this.doctor = null;
		this.flight = null;
		this.started = true;
		this.emit({
			type: 'welcome',
			playerId: this.playerId,
			name: this.name,
			world: this.world,
			home: this.home,
			seed: this.seed,
			pos: { ...this.pos },
			facing: this.facing,
			party: this.partyCopy(),
			tokens: this.tokens,
			items: [...this.items],
			newGame: isNew,
			edits: [...this.edits.encode()]
		});
		if (game.battle) {
			// The battle's seed is the one it started with: the steps have not moved since
			// (or `catchUp` moved it with them).
			this.battle = { state: game.battle, seed: this.battleSeed() };
			this.emit({ type: 'battle-started', state: game.battle });
		}
	}

	/**
	 * The game as it stands, for a save. Mid-battle the party is the battle's,
	 * HP as it is now, and the battle comes too (its state, never its seed).
	 * A doctor visit is not saved; what it healed already is in the party.
	 *
	 * In the air it is the game as it will be once the kid comes down if they
	 * let go now (`landFlight`: on the landing tile, every tile to it a step,
	 * a tree or a rock there cleared), exactly what `land` would leave. So a
	 * save never holds a flight: a reload lands the kid by the landing rule,
	 * and a page on an older build, which knows no flying, finds them on
	 * ground they can stand on.
	 */
	snapshot(): SavedGame {
		const party = this.battle ? this.battle.state.party : this.party;
		const flight = this.flight;
		const landing = flight ? this.landing(flight) : null;
		const edits = landing?.cleared ? landing.edits : this.edits;
		const worlds = landing?.cleared ? fitWorlds(edits, this.worlds, this.home) : this.worlds;
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
			battle: this.battle ? this.battle.state : null,
			edits: [...edits.encode()],
			worlds: worlds.map(copyStay)
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
	 * there is one, and the `?tokens=` tokens.
	 */
	private newGame(): SavedGame {
		const game = { ...newGame(FIRST_WORLD), tokens: this.options.tokens ?? 0 };
		// An empty `?party=` is no party: the starter, as without one.
		return this.options.party?.length
			? { ...game, party: bundled(this.options.party).map((a) => ({ ...a })) }
			: game;
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
			else if (intent.type === 'land') this.land(this.flight);
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
		// Walked or blocked, the player turns to face the way they tried to go.
		this.facing = dir;
		const next = step(this.pos, dir);
		// The world as the player left it: a tree they chopped down is ground to walk
		// on; and with the boat the water is theirs too.
		const tile = editedTileAt(this.seed, this.edits, next.x, next.y);
		if (!isPassable(tile.kind, gearOf({ items: this.items }))) {
			this.emit({ type: 'player-blocked', playerId: this.playerId, dir });
			return;
		}
		this.pos = next;
		this.steps += 1;
		this.emit({ type: 'player-moved', playerId: this.playerId, pos: next, dir });

		// Only an encounter tile can start a battle, and the engine draws nothing
		// on any other: the ground around one is read only there.
		if (!isEncounterTile(tile.kind)) return;
		// The lead where the player now stands (the engine's `leadIndex`: the
		// first animal that isn't tired and can fight there; out on the water, one
		// that swims) is the one `startBattle` sends out first, and the one wild
		// animals size up before they come out, so choosing a lead changes what
		// the grass holds. With nobody standing who can fight here, nothing
		// challenges the player: a team of only tired animals (a `?party=` of
		// them, since losing takes everyone to the doctor) until the doctor has
		// helped, and out on the water a team with no swimmer standing.
		const realm = tileRealm(tile.kind);
		const lead = this.party[leadIndex(this.party, realm)];
		if (!lead) return;
		// One roll per completed step, keyed by the step count so a replayed
		// walk meets the same animals.
		const rng = new Rng(hashInts(this.seed, ENCOUNTER_SALT, this.steps));
		const site = { tile, pos: next, spawn: this.spawn, around: surroundings(this.seed, next) };
		const wild = rollEncounter(rng, site, getAnimal(lead.speciesId).tier);
		if (wild) this.beginBattle({ ...wild, id: mintId() }, realm);
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
	}

	/**
	 * `travel`, while exploring: to world `to` (the engine's `travel`). The
	 * world left is remembered as the player leaves it; the world reached is
	 * picked up where they left it, or at its spawn on a first visit. The
	 * party, tokens, items, name and counts go along unchanged.
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
			{ home: this.home, items: this.items }
		);
		if (!trip.ok) {
			this.emit({ type: 'travel-refused', reason: trip.reason });
			return;
		}
		const here = trip.whereabouts;
		this.world = here.world;
		this.seed = worldSeed(here.world);
		this.spawn = spawnPoint(this.seed);
		this.pos = { x: here.pos.x, y: here.pos.y };
		this.facing = here.facing;
		this.edits = here.edits;
		this.worlds = here.worlds.map(copyStay);
		this.emit({
			type: 'travelled',
			playerId: this.playerId,
			world: this.world,
			seed: this.seed,
			pos: { ...this.pos },
			facing: this.facing,
			edits: [...this.edits.encode()],
			firstVisit: trip.firstVisit
		});
	}

	/** Where the player stands: out on the water in the boat, or on land. */
	private realm(): Realm {
		return tileRealm(editedTileAt(this.seed, this.edits, this.pos.x, this.pos.y).kind);
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
		const { from, dir, reach } = result.flight;
		this.emit({ type: 'took-off', playerId: this.playerId, from: { ...from }, dir, reach });
	}

	/**
	 * `glide`: one tile on, a step like any (the step count keys what comes
	 * after a flight, as after a walk), and never a battle: nothing on the
	 * ground notices a kid up in the air. The glide onto the reach comes down
	 * there; a glide past it is a landing.
	 */
	private glide(flight: Flight): void {
		const next = glideOn(flight);
		if (next === flight) {
			this.land(flight);
			return;
		}
		this.flight = next;
		this.pos = flightPos(next);
		this.steps += 1;
		// #91 part 2, birds in the air: a bird may notice the glider on each tile it enters.
		this.emit({ type: 'glided', playerId: this.playerId, pos: { ...this.pos }, flown: next.flown });
		if (next.flown === next.reach) this.land(next);
	}

	/**
	 * `land`, or the reach: down on the first tile from the one the glider is
	 * over that the player can stand on (`landFlight`), every tile flown on to
	 * it a step. A tree or a rock there is cleared with its tool as they touch
	 * down, and every world's cleared tiles share one budget, as after a chop.
	 */
	private land(flight: Flight): void {
		const landing = this.landing(flight);
		this.flight = null;
		this.steps += landing.flown - flight.flown;
		this.pos = { ...landing.pos };
		this.facing = flight.dir;
		const cleared = landing.cleared;
		if (cleared) {
			this.edits = landing.edits;
			this.worlds = fitWorlds(this.edits, this.worlds, this.home);
		}
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
	}

	/** Where `flight` comes down if the kid lets go now, in this world as they left it. */
	private landing(flight: Flight): Landing {
		return landFlight(this.seed, this.edits, flight, { items: this.items });
	}

	// --- battle ------------------------------------------------------------

	private beginBattle(wild: AnimalInstance, realm: Realm): void {
		const state = startBattle(this.party, wild, { realm });
		this.battle = { state, seed: this.battleSeed() };
		this.emit({ type: 'battle-started', state });
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
		if (state.phase.kind !== 'ended') return;
		this.battle = null;
		this.endBattle(state, events);
	}

	/**
	 * Write the battle's result back into the world: HP lost stays lost, a
	 * caught animal joins the party (the engine's `joinParty`: at the end of
	 * its species' bundle, and there is no cap), and a lost battle takes
	 * the player to the nearest doctor's tent, where the whole party is healed
	 * (the engine's knock-out rule, `takeToDoctor`). That one has no `message`:
	 * the client words the doctor's line from `taken-to-doctor`. The closing
	 * line is a copy key and the wild animal, never words.
	 */
	private endBattle(state: BattleState, events: readonly BattleEvent[]): void {
		if (state.phase.kind !== 'ended') return;
		this.party = state.party.map((a) => ({ ...a }));
		const animal: SpeciesRef = { speciesId: state.opponent.speciesId };
		let rescue: Rescue | null = null;
		let line: Line | null = null;
		// Out on the water the wild animal swims home, or stays in the water, not the grass.
		const sea = state.realm === 'water';
		switch (state.phase.outcome) {
			case 'won':
				line = { key: sea ? 'battle.closing.wonSea' : 'battle.closing.won', params: { animal } };
				break;
			case 'fled':
				line = { key: sea ? 'battle.closing.fledSea' : 'battle.closing.fled', params: { animal } };
				break;
			case 'caught': {
				// The reducer always reports the caught animal on `ended`.
				const ended = events.find((e) => e.type === 'ended');
				const caught = ended?.type === 'ended' ? ended.caught : undefined;
				if (caught) this.party = joinParty(this.party, caught);
				line = { key: 'battle.closing.joined', params: { animal } };
				break;
			}
			case 'lost':
				// Every animal that could fight here is tired: off to the nearest tent,
				// facing it, by the paths the player cleared, and over the water too with
				// the boat.
				rescue = takeToDoctor(this.seed, this.pos, this.party, this.edits, {
					gear: gearOf({ items: this.items }),
					realm: state.realm
				});
				this.party = rescue.party;
				this.pos = rescue.pos;
				this.facing = rescue.facing;
				break;
		}
		this.emit({ type: 'battle-ended', state });
		if (rescue) {
			this.emit({
				type: 'taken-to-doctor',
				playerId: this.playerId,
				pos: { ...rescue.pos },
				dir: rescue.facing,
				tent: rescue.tent && { ...rescue.tent },
				party: this.partyCopy()
			});
		} else {
			this.emit({ type: 'party-changed', party: this.partyCopy() });
		}
		if (line !== null) this.emit({ type: 'message', line });
	}

	// --- interact: a tent, a tree, a rock ---------------------------------

	/**
	 * Enter/Space: whatever the player faces. A tent: talk to the doctor. A
	 * tree or a rock: clear it with its tool (the engine's `clearTile` checks
	 * the whole action), or, without the tool, say which one it takes. Anywhere
	 * else there is nothing to talk to, and the event says so without words:
	 * the client says how to find a doctor, in the player's language.
	 */
	private interact(): void {
		if (canTalkToDoctor(this.seed, this.pos, this.facing)) {
			this.visitDoctor();
			return;
		}
		const player = { pos: this.pos, facing: this.facing, items: this.items };
		const result = clearTile(this.seed, this.edits, player, step(this.pos, this.facing));
		if (result.ok) {
			this.edits = result.edits;
			// Every world's cleared tiles share one budget: this world's come first.
			this.worlds = fitWorlds(this.edits, this.worlds, this.home);
			const { pos, was, tool, regrown } = result.cleared;
			this.emit({ type: 'tile-cleared', playerId: this.playerId, pos, was, tool, regrown });
		} else if (result.reason === 'needs-tool' && result.kind && result.tool) {
			const { kind, tool } = result;
			this.emit({ type: 'tool-needed', playerId: this.playerId, kind, tool });
		} else {
			this.emit({ type: 'nothing-to-interact', playerId: this.playerId });
		}
	}

	// --- doctor ------------------------------------------------------------

	/** Open a doctor visit: the player faces a tent. */
	private visitDoctor(): void {
		this.visits += 1;
		const state = startDoctorVisit(this.party, {
			tokens: this.tokens,
			items: this.items,
			shop: this.options.shop
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
	 * animals gone home, tokens given, an item bought: the kid earned it,
	 * whatever happens to the visit after. Leaving ends the visit, and the
	 * client says the doctor's goodbye.
	 */
	private applyDoctor(intent: DoctorIntent): void {
		const doctor = this.doctor!;
		const { visit } = doctor;
		const { state, events } = applyDoctorIntent(doctor.state, intent, doctor.seed);
		doctor.state = state;
		this.emit({ type: 'doctor-visit-updated', visit, state, events });
		if (events.some((e) => e.type === 'healed' || e.type === 'went-home')) {
			this.party = state.party.map((a) => ({ ...a }));
			this.emit({ type: 'party-changed', party: this.partyCopy() });
		}
		if (events.some((e) => e.type === 'tokens-given' || e.type === 'bought')) {
			this.tokens = state.tokens;
			this.items = [...state.items];
			this.emit({ type: 'belongings-changed', tokens: this.tokens, items: [...this.items] });
		}
		if (state.phase.kind !== 'ended') return;
		this.doctor = null;
		this.emit({ type: 'doctor-visit-ended', visit, state });
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

	/** What the player is doing, for the engine's rules that depend on it. */
	private activity(): PlayerActivity {
		if (this.battle) return 'battle';
		if (this.doctor) return 'doctor';
		return this.flight ? 'flight' : 'explore';
	}

	// --- helpers -----------------------------------------------------------

	private partyCopy(): AnimalInstance[] {
		return this.party.map((a) => ({ ...a }));
	}

	private emit(event: GameEvent): void {
		for (const l of this.listeners) l(event);
	}
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
