import {
	SAVE_VERSION,
	isNewerSave,
	readSave,
	restoreGame,
	sameProgress,
	saveDocument,
	saveExtras,
	saveLineage,
	saveSeq,
	saveVersion,
	validateSaveWrite,
	type GameEvent,
	type SaveV2,
	type SaveWrite,
	type SavedGame
} from '@mathgame/engine';
import type { SaveServer } from './api';
import type { BehindCause } from './behind';
import type { SaveNotice } from './notices';
import {
	KEYS,
	MAX_PUT_AWAY,
	MAX_SET_ASIDE,
	parseJson,
	sameJson,
	setAside,
	type KeyValueStore,
	type SaveKeys
} from './storage';

/**
 * Saving, local first ([[DECISIONS]] § Saves). The save lives in this
 * browser's localStorage and is rewritten after every change: a step, a
 * battle turn, a catch. A reload therefore never loses anything, and the game
 * needs no server to be persistent. An account's game has a copy on the
 * server too (`server`), sent in the background and waited for only at
 * start, briefly: the account's game is played on other devices as well. A
 * guest's game has no copy anywhere else.
 *
 * Several tabs share one localStorage. Before every write a page checks that
 * the stored save is still the one it last read or wrote; if another page
 * saved in between, it carries on from that save only when the other page
 * merely walked around (`sameProgress`), and otherwise stops saving and
 * reloads into the newer game ([[INVARIANTS]] § Saves). The server takes a
 * save only with a higher `seq` than it holds, and keeps any game a save
 * replaces (`replacesAnotherGame`).
 *
 * A save a newer version of the game wrote (`readSave`'s `newer`: a later
 * version, or a species, or a battle's realm or puzzle kind, this build does not have)
 * is never loaded, written over or set aside, in this browser or on the
 * server. The page that meets one, at start or later, is behind (`newer`):
 * it takes no play and reloads, which fetches the new version.
 *
 * The title comes first. Nothing is written until a game starts: `begin`
 * after the authority picked up the plan's game (Continue), or a `welcome`
 * that says the game is new (a starter picked on the title), which is a game
 * of its own, a new lineage that takes the save key's place, the save there
 * kept aside first (its `previous` key). `game-left` (Quit to title) saves what
 * is there and stops until the next start.
 */

export interface Timers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface AutosaveOptions {
	/** Where the save lives: localStorage, or null when the browser refuses it. */
	store: KeyValueStore | null;
	/**
	 * Which keys this game's saves live under: the guest game's (`KEYS`, the
	 * default) or the account's this browser is logged in to (`accountKeys`).
	 */
	keys?: SaveKeys;
	/**
	 * The server's copy: the account's save (`accountSaveServer`), which the
	 * browser's session cookie names. Null for a guest's game, which only this
	 * browser keeps.
	 */
	server: SaveServer | null;
	/**
	 * The account's session has ended (the server answered "not logged in"):
	 * nothing more goes to the server this page load; the game plays and
	 * saves in the browser as before.
	 */
	loggedOut?: () => void;
	/** The game as it stands: the authority's snapshot. */
	snapshot: () => SavedGame;
	/**
	 * The authority's id minter: a fresh random id, for a new game's lineage and
	 * for the starter `restoreGame` adds to a party that cannot fight on land (the
	 * engine mints none). Never constant: `restoreGame` throws when every id it
	 * gives is already in the party.
	 */
	mintId: () => string;
	/**
	 * Another tab of this game walked further and this page carries on from
	 * its save: raise the authority's step and visit counts to those, so the
	 * next encounters and doctor puzzles follow on rather than repeat.
	 */
	catchUp?: (counts: { steps: number; visits: number }) => void;
	/** `?new`: a throwaway game that reads and writes nothing, and says nothing about it. */
	throwaway?: boolean;
	timers?: Timers;
	/** How long start-up waits for the server. */
	bootWaitMs?: number;
}

/**
 * How the page starts: `game` for `LocalAuthority.start` (none means a new
 * game), and what to tell the player about the save, as a copy key.
 */
export interface StartPlan {
	game?: SavedGame;
	notice?: SaveNotice;
}

/**
 * - `ok`: reads and writes the save key.
 * - `held`: the save key holds a document this build cannot read. It stays
 *   untouched until the kid has played (a battle ended, the party changed),
 *   then moves to its `unreadable` key and the new game takes its place.
 * - `frozen`: the save key holds a newer build's save. Never touched, and the
 *   page is behind it (`newer`) from the start.
 * - `broken`: writing failed (storage full). The server copy is the only one.
 * - `none`: no storage at all, or a throwaway game.
 */
type Local = 'ok' | 'held' | 'frozen' | 'broken' | 'none';

/**
 * - `unknown`: not yet compared with what the server holds; nothing is sent.
 * - `ready`: saves are sent.
 * - `stopped`: nothing more is sent this page load (the session ended, the
 *   server holds a newer build's save or refused one of ours, or its game
 *   could not be kept in this browser).
 */
type Server = 'unknown' | 'ready' | 'stopped';

/** A save goes to the server this long after a change that matters, or after walking. */
const SOON_MS = 1000;
const WALK_MS = 15_000;
/** Retries back off from 2 s, doubling, to 32 s, and give up after this many in a row. */
const MAX_FAILURES = 6;
const BOOT_WAIT_MS = 2500;

const browserTimers: Timers = {
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** Whether `text` is a save an older build wrote: one this build reads only through the upgrade. */
function isOlderVersion(text: string): boolean {
	const version = saveVersion(parseJson(text));
	return version > 0 && version < SAVE_VERSION;
}

export class Autosave {
	private readonly store: KeyValueStore | null;
	private readonly keys: SaveKeys;
	private readonly server: SaveServer | null;
	private readonly loggedOut: (() => void) | null;
	private readonly snapshot: () => SavedGame;
	private readonly mintId: () => string;
	private readonly catchUp: ((counts: { steps: number; visits: number }) => void) | null;
	private readonly throwaway: boolean;
	private readonly timers: Timers;
	private readonly bootWaitMs: number;

	private local: Local = 'none';
	private serverState: Server = 'stopped';

	/** The game this page saves, and the number of its last save. */
	private lineage = '';
	private seq = 0;
	/** The exact text of the save key when this page last read or wrote it; null when it was empty. */
	private seenText: string | null = null;
	/** The text of this page's own last write of the save key, and its `seq`. */
	private writtenText: string | null = null;
	private writtenSeq = 0;
	/** The save this page's game grows from: the one it loaded, carried on from, or last wrote. */
	private base: SaveV2 | null = null;
	/** Fields a newer build left in the loaded save, written back unchanged. */
	private extras: Record<string, unknown> = {};
	/** The newest document built, for the server. */
	private latest: SaveWrite | null = null;
	/** The highest `seq` of this game the server is known to hold. */
	private pushed = 0;

	/** Whether the page has something to write before a new game is saved at start. */
	private firstWrite = false;
	private dirty = false;
	private dirtyMatters = false;
	private commitQueued = false;
	/** A battle ended or the party changed this page load. */
	private played = false;
	/** The server holds a save this build cannot read: nothing sent replaces it until the kid has played. */
	private serverHeld = false;
	/** Why this page is behind, once it is (`behind`). It never stops being behind. */
	private staleCause: BehindCause | null = null;
	/**
	 * A game is under way and saved as it changes: from `begin` (the plan's
	 * game picked up) or a new game's `welcome`, until `game-left`.
	 */
	private begun = false;
	/**
	 * The kid started a new game here: the next write takes the save key
	 * whatever it holds, which is kept aside first (its `previous` key).
	 */
	private replacing = false;
	/**
	 * The games the kid left for a new one on this page, by lineage. The
	 * server's copy of one of those never comes back in place of the new
	 * game: it gives way, and the server keeps it aside, as it keeps every
	 * game a save replaces. Any other game the server holds is settled as
	 * usual, so a game the kid never saw on the title is never put away
	 * without their knowing.
	 */
	private putAway = new Set<string>();

	private pushTimer: unknown = null;
	private pushDue = Infinity;
	private retryTimer: unknown = null;
	private pushing = false;
	/** An account's save the server just refused (`409`), until the server's copy is settled with. */
	private refused: SaveWrite | null = null;
	/** The newest `seq` already sent with `keepalive`, so hiding and then leaving send it once. */
	private flushed = 0;
	private failures = 0;
	/** What to try again once the server answers, while retries rest. */
	private resting: (() => void) | null = null;

	constructor(options: AutosaveOptions) {
		this.throwaway = options.throwaway ?? false;
		this.store = this.throwaway ? null : options.store;
		this.keys = options.keys ?? KEYS;
		this.server = this.throwaway ? null : options.server;
		this.loggedOut = options.loggedOut ?? null;
		this.snapshot = options.snapshot;
		this.mintId = options.mintId;
		this.catchUp = options.catchUp ?? null;
		this.timers = options.timers ?? browserTimers;
		this.bootWaitMs = options.bootWaitMs ?? BOOT_WAIT_MS;
	}

	/**
	 * Null while this page's game is the newest. Once the browser's save has
	 * moved past it, why: another page played on in the same game (`window`),
	 * the save now holds another game, which this page or another took from the
	 * server (`replaced`), the save was removed from under it (`gone`), or a
	 * newer version of the game saved the game, here or on the server
	 * (`newer`: from the start, when start-up found it). From then on the page
	 * saves nothing, and should reload to pick up the newest game
	 * (`save/behind.ts`).
	 */
	get behind(): BehindCause | null {
		return this.staleCause;
	}

	/**
	 * What every title this page opens says about the save: this page cannot
	 * keep the game (`save.cannotSave`: the browser gives it no storage;
	 * `save.storageFull`: a write failed). Null otherwise, and on a throwaway
	 * page, which says nothing about it. (A page that met a newer build's save
	 * is behind, and opens no title.)
	 */
	get titleNotice(): SaveNotice | null {
		if (this.throwaway) return null;
		if (this.local === 'none') return 'save.cannotSave';
		if (this.local === 'broken') return 'save.storageFull';
		return null;
	}

	/** The game this page saves, by its lineage, while one is under way; null before and after. */
	get playing(): string | null {
		return this.begun && this.lineage !== '' ? this.lineage : null;
	}

	/**
	 * Whether this page keeps the game it plays: then a game left for a new
	 * one is put away. False with no storage, a newer build's save in the key,
	 * a write that failed, or a throwaway game.
	 */
	get keeps(): boolean {
		return this.local !== 'none' && this.local !== 'frozen' && this.local !== 'broken';
	}

	/**
	 * Check the save again, as a `storage` event would. For a page that may
	 * have missed one: back from the back/forward cache, resumed after the
	 * browser froze it, or just focused.
	 */
	recheck(): void {
		this.onStorage(this.keys.save);
	}

	/**
	 * This page's game is no longer the one the browser plays: another tab
	 * logged in or out, so the browser's game is now another account's or
	 * the guest's. The page saves nothing more and reloads into the newest
	 * game, as it does when another game takes its save's place.
	 */
	fallBehind(): void {
		this.goStale('replaced');
	}

	/**
	 * Send the newest save to the server now and wait for the answer, at most
	 * `timeoutMs`: before a logout, so the account's copy is the newest. True
	 * when the server holds this page's newest save (or there was nothing to
	 * send); false when it could not be sent.
	 */
	async pushNow(timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		const pause = (ms: number) =>
			new Promise<void>((resolve) => this.timers.setTimeout(resolve, Math.max(0, ms)));
		for (;;) {
			const doc = this.latest;
			if (!doc || doc.seq <= this.pushed) return true;
			const left = deadline - Date.now();
			// Out of reach and waiting to try again: no use asking now.
			if (!this.canPush() || left <= 0 || this.retryTimer !== null || this.resting) return false;
			// A push already on its way sends the newest when it is done; wait for it.
			await Promise.race([this.pushing ? pause(50) : this.push(false), pause(left)]);
		}
	}

	private get stale(): boolean {
		return this.staleCause !== null;
	}

	/**
	 * Work out how the game starts. A guest's game: instant, from this
	 * browser's save. An account's game: the server is asked too, waiting up
	 * to `bootWaitMs`, for the game when this browser holds no readable save
	 * of it, and otherwise for whether a newer version saved it on another
	 * device. A newer build's save, here or there, starts nothing: the page is
	 * behind it (`newer`) and the plan is empty.
	 */
	async boot(): Promise<StartPlan> {
		if (this.throwaway) return {};
		const store = this.store;
		if (!store) return { notice: 'save.cannotSave' };

		const text = store.get(this.keys.save);
		this.seenText = text;
		this.local = 'ok';
		let plan: StartPlan = {};
		if (text !== null) {
			const read = readSave(parseJson(text));
			if (read.ok) {
				this.carryOn(read.save);
				this.serverState = 'unknown';
				// An account's game: the server is asked first, so this page never plays on in a
				// fork of a game a newer version has saved on another device. Anything else it
				// holds is settled as usual once the game begins.
				if (await this.newerOnServer()) return {};
				return { game: restoreGame(read.save, this.mintId), notice: 'save.welcomeBack' };
			}
			if (read.reason === 'newer') {
				// Never written over or set aside: a reload fetches the version that reads it.
				this.local = 'frozen';
				this.staleCause = 'newer';
				return {};
			}
			this.local = 'held';
			plan = { notice: 'save.couldNotLoad' };
		}

		// No save this build can read here. The server may have the account's game.
		this.lineage = this.mintId();
		this.firstWrite = true;
		this.serverState = 'ready';
		if (this.server) {
			const got = await this.server.getSave(this.bootWaitMs);
			if (got.kind === 'found') {
				const read = readSave(got.doc);
				if (read.ok) {
					this.carryOn(read.save);
					this.pushed = this.seq;
					// The kid's game is back: an unreadable local save is set aside for it at once.
					this.played = true;
					return { game: restoreGame(read.save, this.mintId), notice: 'save.welcomeBack' };
				}
				if (read.reason === 'newer') {
					// The kid's game is on the server, saved by a newer version: this page neither
					// plays a new game over it nor sends anything; a reload fetches the new version.
					this.serverState = 'stopped';
					this.staleCause = 'newer';
					return {};
				}
				// The kid's game is on the server, but this page cannot read it: a new game, said so.
				// Saves are numbered past it, and it waits until the kid has played the new game;
				// then the server sets it aside when the first save sent replaces it.
				this.seq = Math.max(this.seq, saveSeq(got.doc));
				this.serverHeld = true;
				plan = { notice: 'save.couldNotLoad' };
			} else if (got.kind === 'logged-out') {
				this.endSession();
			} else if (got.kind === 'offline') {
				this.serverState = 'unknown';
			}
		}
		return plan;
	}

	/**
	 * Start-up with an account's game in this browser: whether the server
	 * holds one a newer version saved (then the page is behind it, `newer`),
	 * asked for no longer than start-up waits. A session that has ended ends
	 * the pushes, as it would later.
	 */
	private async newerOnServer(): Promise<boolean> {
		if (!this.server) return false;
		const got = await this.server.getSave(this.bootWaitMs);
		if (got.kind === 'logged-out') this.endSession();
		if (got.kind !== 'found' || !isNewerSave(got.doc)) return false;
		this.serverState = 'stopped';
		this.staleCause = 'newer';
		return true;
	}

	/**
	 * Call once the authority has picked up a saved game (the plan's, or the
	 * one left for the title): save its changes from now on.
	 */
	begin(): void {
		this.begun = true;
		if (this.firstWrite) this.changed(false);
		this.startServer();
	}

	/**
	 * Every authority event: anything that changes the game is saved. Events
	 * before `begin` are the authority starting from the plan (a restored
	 * battle's `battle-started` among them); they change nothing, so they
	 * write nothing. A new game's `welcome` starts saving by itself, and
	 * `game-left` stops it.
	 */
	handle(event: GameEvent): void {
		if (event.type === 'welcome' && event.newGame) {
			this.newGameStarted();
			return;
		}
		if (!this.begun) return;
		switch (event.type) {
			case 'game-left':
				// Back to the title: save what there is, send it to the server, and write nothing more.
				this.flush();
				this.begun = false;
				break;
			case 'battle-ended':
			case 'party-changed':
			case 'belongings-changed':
			// A tree chopped down or a rock broken is something the kid did, as a catch is;
			// so is going to another world, and choosing a name.
			case 'tile-cleared':
			case 'travelled':
			case 'name-chosen':
				this.changed(true);
				break;
			case 'party-edited':
				// A refused edit changes nothing.
				if (event.events.some((e) => e.type !== 'rejected')) this.changed(true);
				break;
			case 'doctor-visit-ended':
			case 'player-moved':
			case 'player-blocked':
			case 'player-placed':
			// The glider: each tile flown is a step, and the game saved in the air is the one
			// letting go would leave (`LocalAuthority.snapshot`), so a reload lands where a let-go
			// would; the landing saves where it came down. A bird following the glider saves as
			// its battle, under way where the flight comes down: a reload is no escape.
			case 'took-off':
			case 'glided':
			case 'bird-follows':
			case 'landed':
			case 'battle-started':
			case 'battle-updated':
			case 'doctor-visit-started':
			case 'doctor-visit-updated':
			// A puzzle solved. In a battle or at the doctor the event that judged it saves too;
			// in a friendly match, where nothing else changes, this is what writes the count to
			// this browser, and the server's copy follows as it does a battle turn's. Not playing by
			// itself: every game under way beside an unreadable save has been played already
			// (a starter picked, or the server's game taken).
			case 'solved-changed':
			// The animal book grew, at a battle's start or a catch: the battle's own events save too.
			case 'book-changed':
				this.changed(false);
				break;
			// Nothing changed: a game picked up (its start writes nothing), a refusal, a line to say.
			case 'welcome':
			case 'new-game-refused':
			case 'name-refused':
			case 'travel-refused':
			case 'go-to-refused':
			case 'take-off-refused':
			case 'message':
			case 'nothing-to-interact':
			case 'tool-needed':
				break;
			default: {
				// Every event is sorted above, so a new one must say whether it saves: the glider's
				// took-off, glided and landed first went unsaved, a landing lost to a reload.
				const unsorted: never = event;
				void unsorted;
			}
		}
	}

	/** The page is being hidden or left: save now, and send it to the server with `keepalive`. */
	flush(): void {
		this.commit();
		const latest = this.latest;
		if (!this.canPush() || !latest || latest.seq <= Math.max(this.pushed, this.flushed)) return;
		this.flushed = latest.seq;
		void this.push(true);
	}

	/**
	 * A `storage` event: another page of this site changed `key` (null:
	 * storage was cleared), to `written` when the event says.
	 */
	onStorage(key: string | null, written: string | null = null): void {
		if (key !== null && key !== this.keys.save) return;
		// A save of this game numbered no higher than this page's last one, and not it, was
		// written over it without seeing it: keep this page's aside, whatever comes after.
		if (written !== null && this.overwrittenUnseen(written)) this.keepOwnSave(true);
		if (this.stale || (this.local !== 'ok' && this.local !== 'held')) return;
		// Judge the save as it is now, not the value the event carried: events arrive late,
		// and that value may already be replaced, by this page's own next save among others.
		const now = this.store?.get(this.keys.save) ?? null;
		if (now === this.seenText) return;
		// The other page only walked: carry on from its save now, counters and all.
		if (!this.carryOnFrom(now)) this.goStale(this.causeOf(now));
	}

	/**
	 * A new game began (its `welcome`): the kid picked a starter on the
	 * title. It is a game of its own, with a lineage of its own, numbered on
	 * from every save this page has seen, so the server takes it over the
	 * game the kid left (`putAway`). Picking a starter counts as playing: an
	 * unreadable save waiting in the key goes aside at once. Saved now, and
	 * from now on.
	 */
	private newGameStarted(): void {
		// The game the title offered as Continue, if it offered one; else a lineage no game has.
		this.putAway.add(this.lineage);
		this.lineage = this.mintId();
		this.extras = {};
		this.base = null;
		this.latest = null;
		this.pushed = 0;
		this.firstWrite = false;
		this.replacing = true;
		this.begun = true;
		this.changed(true);
		this.startServer();
	}

	/**
	 * The game Continue picks up: the save this page carries on from, as it
	 * is now. That is the one it loaded, or last wrote, or took on from
	 * another tab that walked on while the title was up, so the step and
	 * visit counts never go back. Undefined when the page saves nothing.
	 */
	resumable(): SavedGame | undefined {
		return this.base ? restoreGame(this.base, this.mintId) : undefined;
	}

	// --- local ----------------------------------------------------------------

	/** The game changed; `matters` when the kid has played (a battle ended, the party changed). */
	private changed(matters: boolean): void {
		if (matters) this.played = true;
		this.markDirty(matters);
	}

	private markDirty(matters: boolean): void {
		if (matters) this.dirtyMatters = true;
		this.dirty = true;
		if (this.commitQueued) return;
		this.commitQueued = true;
		// Everything one intent causes is emitted in one go: save once, after all of it.
		queueMicrotask(() => {
			this.commitQueued = false;
			this.commit();
		});
	}

	private commit(): void {
		if (!this.dirty) return;
		const matters = this.dirtyMatters;
		this.dirty = false;
		this.dirtyMatters = false;
		if (this.stale || this.local === 'frozen' || this.local === 'none') return;
		if (this.local === 'held' && !this.played) return;

		const store = this.store;
		if (store !== null && (this.local === 'ok' || this.local === 'held')) {
			const current = store.get(this.keys.save);
			if (current !== this.seenText && current !== null && isNewerSave(parseJson(current))) {
				// A newer version of the game saved here since this page last looked (another tab
				// on the new version, its storage event not in yet): whatever this page was about
				// to do, a new game or setting an unreadable save aside included, that save is
				// never written over or moved.
				this.goStale('newer');
				return;
			}
			if (this.replacing) {
				// A new game the kid chose takes the key, whatever it holds now: the game they
				// left, or another tab's later save of it. That is kept aside first, never
				// written over; with nowhere to keep it, it stays and this game is not saved here.
				// (An unreadable save waiting in the key goes to its own place, below.)
				this.seq = Math.max(this.seq, saveSeq(current === null ? null : parseJson(current)));
				if (
					this.local === 'ok' &&
					current !== null &&
					!this.setAside(this.keys.previous, current, MAX_PUT_AWAY)
				) {
					this.local = 'broken';
				}
			} else if (current !== this.seenText && !this.carryOnFrom(current)) {
				this.goStale(this.causeOf(current));
				return;
			}
			if (this.local === 'held') {
				// The unreadable save is kept aside before the new game takes its place; with
				// nowhere to keep it, it stays where it is and this game is not saved here.
				this.local =
					current === null || this.setAside(this.keys.unreadable, current) ? 'ok' : 'broken';
			} else if (!this.replacing && current !== null && isOlderVersion(current)) {
				// An older build's save, which this page read through the upgrade: its text is
				// kept as it was before this version's first write takes the key. With nowhere to
				// keep it (storage full, or every slot taken) the game is saved over it all the
				// same: the upgrade loses nothing, so this version's save holds everything the
				// older one did, and the server keeps its own copy of the older one. Holding back
				// would leave the game unsaved here, reload after reload.
				this.setAside(this.keys.upgraded, current);
			}
		}
		const writesLocal = store !== null && this.local === 'ok';

		const doc = saveDocument(
			this.snapshot(),
			{ lineage: this.lineage, seq: this.seq + 1 },
			this.extras
		);
		const checked = validateSaveWrite(doc);
		if (!checked.ok) {
			console.error(`Animath could not save the game: ${checked.error}`);
			return;
		}
		if (writesLocal) {
			const text = JSON.stringify(doc);
			if (store.set(this.keys.save, text)) {
				this.seenText = text;
				this.writtenText = text;
				this.writtenSeq = doc.seq;
			} else this.local = 'broken';
		}
		this.replacing = false;
		this.seq = doc.seq;
		this.base = doc;
		this.latest = doc;
		this.firstWrite = false;
		if (matters) this.wake();
		this.schedulePush(matters);
	}

	/** Take `save` as the one this page's game grows from. */
	private carryOn(save: SaveV2): void {
		this.lineage = saveLineage(save) || this.mintId();
		this.seq = Math.max(this.seq, saveSeq(save));
		this.extras = saveExtras(save);
		this.base = save;
		const whole = validateSaveWrite(save);
		this.latest = whole.ok ? whole.value : null;
	}

	/** Whether this page may carry on from `text`, the save another page left. */
	private canCarryOnFrom(text: string | null): boolean {
		if (text === null || this.base === null) return false;
		const read = readSave(parseJson(text));
		return read.ok && sameProgress(read.save, this.base);
	}

	/**
	 * Another page saved since this one last looked. If it only walked
	 * around, carry on from its save (this page's own changes go on top);
	 * otherwise this page is behind and must not write.
	 */
	private carryOnFrom(text: string | null): boolean {
		if (!this.canCarryOnFrom(text)) return false;
		const read = readSave(parseJson(text!));
		if (!read.ok) return false;
		this.carryOn(read.save);
		this.seenText = text;
		this.catchUp?.({ steps: read.save.steps ?? 0, visits: read.save.visits ?? 0 });
		return true;
	}

	/**
	 * Keep `text` under `prefix`, or the first free `prefix.2`, `prefix.3`, …
	 * up to `slots`: a save set aside is never written over. False when
	 * nowhere is left.
	 */
	private setAside(prefix: string, text: string, slots = MAX_SET_ASIDE): boolean {
		return this.store !== null && setAside(this.store, prefix, text, slots);
	}

	/**
	 * Why a save this page cannot carry on from puts it behind: a newer
	 * version of the game wrote it; its own game played on elsewhere keeps the
	 * lineage; another game in its place does not.
	 */
	private causeOf(text: string | null): BehindCause {
		if (text === null) return 'gone';
		const doc = parseJson(text);
		if (isNewerSave(doc)) return 'newer';
		return saveLineage(doc) === this.lineage ? 'window' : 'replaced';
	}

	private goStale(cause: BehindCause): void {
		if (this.staleCause === null && cause !== 'gone') this.keepOwnSave();
		this.staleCause ??= cause;
		this.clearTimers();
	}

	/**
	 * This page is behind. Whoever wrote the save in its place either played
	 * on from this page's last save (the same game, a higher `seq`) or kept it
	 * aside (another game took the key). Two pages writing in the same
	 * instant break that: a page's view of `localStorage` is only brought up
	 * to date between tasks, so both pass compare-before-write and the one
	 * written first is lost. Then this page keeps its own last save aside, so
	 * what the kid did in it is never gone.
	 */
	private keepOwnSave(knownLost = false): void {
		const store = this.store;
		const text = this.writtenText;
		// Nothing of this page's that no other page has seen.
		if (!store || text === null || text !== this.seenText) return;
		const current = store.get(this.keys.save);
		if (current === null || current === text) return;
		// A later save of this game played on from this page's, unless a storage event showed
		// this page's written over first (`overwrittenUnseen`): the seq alone cannot tell.
		const doc = parseJson(current);
		const later = saveLineage(doc) === this.lineage && saveSeq(doc) > this.writtenSeq;
		if (later && !knownLost) return;
		const prefixes = [this.keys.replaced, this.keys.previous, this.keys.unreadable];
		if (prefixes.some((prefix) => this.keptUnder(prefix, text))) return;
		this.setAside(this.keys.replaced, text);
	}

	/**
	 * Whether `written`, a save another page just wrote, went over this page's
	 * last save without seeing it: the same game, numbered no higher. A page
	 * that had seen it would have carried on from it, and numbered past it.
	 */
	private overwrittenUnseen(written: string): boolean {
		if (this.writtenText === null || written === this.writtenText) return false;
		const doc = parseJson(written);
		return saveLineage(doc) === this.lineage && saveSeq(doc) <= this.writtenSeq;
	}

	/** Whether `text` is in one of `prefix`'s set-aside slots (they fill in order). */
	private keptUnder(prefix: string, text: string): boolean {
		const store = this.store;
		if (!store) return false;
		for (let n = 1; n <= MAX_PUT_AWAY; n++) {
			const there = store.get(n === 1 ? prefix : `${prefix}.${n}`);
			if (there === null) return false;
			if (there === text) return true;
		}
		return false;
	}

	// --- server ---------------------------------------------------------------

	private startServer(): void {
		if (!this.server || !this.store || this.stale) return;
		if (this.local === 'frozen' || this.serverState === 'stopped') return;
		if (this.serverState === 'unknown') {
			void this.checkServer();
			return;
		}
		this.schedulePush(true);
	}

	private canPush(): boolean {
		return (
			this.server !== null &&
			this.serverState === 'ready' &&
			!this.stale &&
			this.local !== 'frozen' &&
			((this.local !== 'held' && !this.serverHeld) || this.played)
		);
	}

	private schedulePush(matters: boolean): void {
		// While retries rest, only `wake` sends anything.
		if (!this.canPush() || this.retryTimer !== null || this.resting) return;
		const delay = matters ? SOON_MS : WALK_MS;
		const due = Date.now() + delay;
		if (this.pushTimer !== null) {
			if (due >= this.pushDue) return;
			this.timers.clearTimeout(this.pushTimer);
		}
		this.pushDue = due;
		this.pushTimer = this.timers.setTimeout(() => {
			this.pushTimer = null;
			this.pushDue = Infinity;
			void this.push(false);
		}, delay);
	}

	private async push(keepalive: boolean): Promise<void> {
		const doc = this.latest;
		if (!this.canPush() || !doc || doc.seq <= this.pushed) return;
		if (this.pushing && !keepalive) return; // the running push sends the newest when it is done
		if (!keepalive) this.pushing = true;
		const result = await this.server!.putSave(doc, keepalive);
		if (!keepalive) this.pushing = false;
		if (this.stale || this.serverState !== 'ready') return;
		switch (result.kind) {
			case 'saved':
				this.pushed = Math.max(this.pushed, doc.seq);
				this.succeeded();
				if (this.latest && this.latest.seq > this.pushed) this.schedulePush(true);
				return;
			case 'conflict':
				// Refused: another device's save got there first, or a newer version's is there.
				this.refused = doc;
				await this.checkServer(doc.seq);
				return;
			case 'refused':
				// The server and this build disagree about what a save is: stop, and say so to developers.
				console.error(`Animath: the server refused a save: ${result.error}`);
				this.serverState = 'stopped';
				return;
			case 'logged-out':
				this.endSession();
				return;
			case 'offline':
				if (!keepalive) this.retry(() => void this.push(false));
				return;
		}
	}

	/**
	 * Compare with what the server holds, and settle who carries on.
	 * `refused`: the `seq` of a save the server just turned away as a
	 * conflict (409).
	 */
	private async checkServer(refused?: number): Promise<void> {
		if (!this.server) return;
		const got = await this.server.getSave();
		if (this.stale) return;
		switch (got.kind) {
			case 'offline':
				this.serverState = this.serverState === 'ready' ? 'ready' : 'unknown';
				this.retry(() => void this.checkServer(refused));
				return;
			case 'logged-out':
				this.endSession();
				return;
			case 'none':
				this.succeeded();
				this.pushed = 0;
				this.serverState = 'ready';
				this.schedulePush(true);
				return;
			case 'found':
				if (refused !== undefined && saveSeq(got.doc) < refused && !isNewerSave(got.doc)) {
					// The server turned away a save numbered past the one it holds, which `seq` does
					// not explain: it cannot take this page's saves now (a server older than the save
					// it holds, while a deploy swaps it, or after a rollback). Sent again at once it
					// would be turned away again, for ever: try later, as when it is out of reach,
					// backing off and then resting until the kid plays. The game is saved here.
					this.retry(() => void this.push(false));
					return;
				}
				this.succeeded();
				this.settleWith(got.doc);
				return;
		}
	}

	/**
	 * The server holds `doc`. The save with the higher `seq` is the game that
	 * carries on: this page's, sent as the next save, or the server's,
	 * which this page adopts and reloads into. A newer version's save there
	 * puts this page behind (`newer`), and is never sent over.
	 */
	private settleWith(doc: unknown): void {
		const read = readSave(doc);
		const theirs = saveSeq(doc);
		if (!read.ok && read.reason === 'newer') {
			// A newer version of the game saved this player's game on the server: this page
			// can neither read nor replace it, so it takes no more play, and a reload fetches
			// the new version. Playing on here would fork the game behind the newer one.
			this.serverState = 'stopped';
			this.goStale('newer');
			return;
		}
		if (!read.ok) {
			// Unreadable: once the kid has played, save past it; the server sets it aside when
			// the save sent replaces it.
			this.serverState = 'ready';
			this.serverHeld = true;
			if (theirs >= this.seq) {
				this.seq = theirs;
				this.markDirty(true);
			} else this.schedulePush(true);
			return;
		}
		const sameGame = saveLineage(doc) === this.lineage;
		if (!sameGame && this.putAway.has(saveLineage(doc))) {
			// The server's copy of a game the kid left for this one on the title gives way:
			// saves are numbered past it, and the server keeps it aside when the next save lands.
			this.pushed = 0;
			this.serverState = 'ready';
			if (theirs >= this.seq) {
				this.seq = theirs;
				this.markDirty(true);
			} else this.schedulePush(true);
			return;
		}
		// A save refused (`409`) because another device's got there first: the
		// server's copy is the game now, even when this page has saved on since, unless it is
		// this page's own save, sent before and not heard back. The refusal is kept until the
		// adoption is done: carrying on from another tab's walk settles again, and must not
		// then push that walk over the other device's game.
		const refused = this.refused;
		if (refused && sameGame && theirs >= refused.seq && !sameJson(refused, doc)) {
			this.adopt(read.save, doc);
			this.refused = null;
			return;
		}
		this.refused = null;
		// A tie goes to the server's game, but only a tie between saves: at 0 neither has one.
		// An account's game is played on several devices, so a tie within the game goes to the
		// server's too when the two saves differ.
		const tie = theirs === this.seq && theirs > 0;
		const fork = sameGame && tie && !sameJson(this.ours(), doc);
		if (theirs > this.seq || (tie && !sameGame) || fork) {
			this.adopt(read.save, doc);
			return;
		}
		this.pushed = sameGame ? theirs : 0;
		this.serverState = 'ready';
		if (this.seq > this.pushed) this.schedulePush(true);
	}

	/**
	 * The newest document of the game on screen: the one this page built last
	 * (the browser may not hold it, when a write failed), else the one it
	 * loaded. Null before any.
	 */
	get newest(): SaveWrite | null {
		return this.latest;
	}

	/** This page's newest save: the one it built last, else the one it loaded. */
	private ours(): unknown {
		return this.latest ?? this.base;
	}

	/**
	 * The server's game is ahead of this browser's: keep this browser's in
	 * its `replaced` key (or `unreadable`), make the server's the saved
	 * game, and reload into it.
	 */
	private adopt(save: SaveV2, doc: unknown): void {
		const store = this.store;
		if (!store || this.local === 'frozen' || this.local === 'none') return;
		const current = store.get(this.keys.save);
		if (current !== this.seenText && current !== null) {
			// Another page wrote meanwhile, and its storage event has not come yet. If it only
			// walked, carry on from it, as the event would have, and settle again: the server
			// may hold that very walk. Otherwise it will settle with the server itself.
			if (this.carryOnFrom(current)) this.settleWith(doc);
			else this.goStale(this.causeOf(current));
			return;
		}
		const aside = this.local === 'held' ? this.keys.unreadable : this.keys.replaced;
		if (current !== null && !this.setAside(aside, current)) {
			// Nowhere to keep this browser's game: it is not replaced.
			this.serverState = 'stopped';
			return;
		}
		if (!store.set(this.keys.save, JSON.stringify(save))) {
			// Cannot keep the server's game here, so reloading would not reach it. Carry on as we are.
			this.serverState = 'stopped';
			return;
		}
		this.goStale('replaced');
	}

	/**
	 * The account's session ended (a logout elsewhere, a new password, a year
	 * unused): the game goes on in the browser, and the server hears nothing
	 * more this visit.
	 */
	private endSession(): void {
		this.serverState = 'stopped';
		this.clearTimers();
		this.loggedOut?.();
	}

	/**
	 * The server was out of reach: try `action` again after a growing pause.
	 * After `MAX_FAILURES` in a row, rest instead — no timer, so an API that
	 * is simply not running costs nothing — until something worth backing up
	 * happens (`wake`).
	 */
	private retry(action: () => void): void {
		this.failures += 1;
		this.resting = action;
		if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
		this.retryTimer = null;
		if (this.failures >= MAX_FAILURES) return;
		const delay = Math.min(60_000, 2000 * 2 ** (this.failures - 1));
		this.retryTimer = this.timers.setTimeout(() => {
			this.retryTimer = null;
			this.resting = null;
			action();
		}, delay);
	}

	/** The server answered: retries start over. */
	private succeeded(): void {
		this.failures = 0;
		this.resting = null;
	}

	/** A battle ended or the party changed: a resting send to the server tries once more. */
	private wake(): void {
		const action = this.resting;
		if (!action || this.retryTimer !== null || this.stale) return;
		this.resting = null;
		this.failures = MAX_FAILURES - 1;
		action();
	}

	private clearTimers(): void {
		if (this.pushTimer !== null) this.timers.clearTimeout(this.pushTimer);
		if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
		this.pushTimer = null;
		this.retryTimer = null;
		this.pushDue = Infinity;
	}
}
