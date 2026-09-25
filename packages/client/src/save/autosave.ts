import {
	readSave,
	restoreGame,
	sameProgress,
	saveDocument,
	saveExtras,
	saveLineage,
	saveSeq,
	validateSaveWrite,
	type GameEvent,
	type SaveV1,
	type SaveWrite,
	type SavedGame
} from '@mathgame/engine';
import { isIdentity, type Identity, type SaveServer } from './api';
import type { SaveNotice } from '../state/notice.svelte';
import { KEYS, parseJson, type KeyValueStore } from './storage';

/**
 * Saving, local first ([[DECISIONS]] § Saves). The save lives in this
 * browser's localStorage and is rewritten after every change: a step, a
 * battle turn, a catch. A reload therefore never loses anything, and the game
 * needs no server to be persistent. The server holds a backup copy, sent in
 * the background, never waited for except once at start when this browser
 * has an identity but no save of its own.
 *
 * Several tabs share one localStorage. Before every write a page checks that
 * the stored save is still the one it last read or wrote; if another page
 * saved in between, it carries on from that save only when the other page
 * merely walked around (`sameProgress`), and otherwise stops saving and
 * reloads into the newer game ([[INVARIANTS]] § Saves). The server takes a
 * backup only with a higher `seq` than it holds, and keeps any game a
 * backup replaces (`replacesAnotherGame`).
 */

export interface Timers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface AutosaveOptions {
	/** Where the save lives: localStorage, or null when the browser refuses it. */
	store: KeyValueStore | null;
	/** The server backup, or null for none. */
	server: SaveServer | null;
	/** The game as it stands: the authority's snapshot. */
	snapshot: () => SavedGame;
	/** A fresh random id, for a new game's lineage. */
	mintId: () => string;
	/** `?new`: a throwaway game that reads and writes nothing, and says nothing about it. */
	throwaway?: boolean;
	timers?: Timers;
	/** How long start-up waits for the server when this browser has an identity but no save. */
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
 *   then moves to `KEYS.unreadable` and the new game takes its place.
 * - `frozen`: the save key holds a newer build's save. Never touched.
 * - `broken`: writing failed (storage full). The server copy is the only one.
 * - `none`: no storage at all, or a throwaway game.
 */
type Local = 'ok' | 'held' | 'frozen' | 'broken' | 'none';

/**
 * - `unknown`: not yet compared with what the server holds; nothing is sent.
 * - `ready`: backups are sent.
 * - `stopped`: no more backups this page load (no identity can be kept, the
 *   server holds a newer build's save, or it refused one of ours, or it has
 *   been out of reach too long).
 */
type Server = 'unknown' | 'ready' | 'stopped';

/** Backups wait this long after a change that matters, or after walking. */
const SOON_MS = 1000;
const WALK_MS = 15_000;
/** Retries back off from 2 s to a minute, and give up after this many in a row. */
const MAX_FAILURES = 6;
const BOOT_WAIT_MS = 2500;

const browserTimers: Timers = {
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export class Autosave {
	private readonly store: KeyValueStore | null;
	private readonly server: SaveServer | null;
	private readonly snapshot: () => SavedGame;
	private readonly mintId: () => string;
	private readonly throwaway: boolean;
	private readonly timers: Timers;
	private readonly bootWaitMs: number;

	private local: Local = 'none';
	private serverState: Server = 'stopped';
	private identity: Identity | null = null;

	/** The game this page saves, and the number of its last save. */
	private lineage = '';
	private seq = 0;
	/** The exact text of the save key when this page last read or wrote it; null when it was empty. */
	private seenText: string | null = null;
	/** The save this page's game grows from: the one it loaded, carried on from, or last wrote. */
	private base: SaveV1 | null = null;
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
	private stale = false;
	/** `begin` was called: the authority has started from the plan. */
	private begun = false;

	private pushTimer: unknown = null;
	private pushDue = Infinity;
	private retryTimer: unknown = null;
	private pushing = false;
	/** The newest `seq` already sent with `keepalive`, so hiding and then leaving send it once. */
	private flushed = 0;
	private creating = false;
	private failures = 0;
	/** What to try again once the server answers, while retries rest. */
	private resting: (() => void) | null = null;

	constructor(options: AutosaveOptions) {
		this.throwaway = options.throwaway ?? false;
		this.store = this.throwaway ? null : options.store;
		this.server = this.throwaway ? null : options.server;
		this.snapshot = options.snapshot;
		this.mintId = options.mintId;
		this.timers = options.timers ?? browserTimers;
		this.bootWaitMs = options.bootWaitMs ?? BOOT_WAIT_MS;
	}

	/** True once another page has taken over the save: reload to pick up the newest game. */
	get wantsReload(): boolean {
		return this.stale;
	}

	/**
	 * Work out how the game starts. Instant when this browser holds a save;
	 * waits up to `bootWaitMs` for the server only when it holds an identity
	 * and no readable save.
	 */
	async boot(): Promise<StartPlan> {
		if (this.throwaway) return {};
		const store = this.store;
		if (!store) return { notice: 'save.cannotSave' };
		this.readIdentity(store);

		const text = store.get(KEYS.save);
		this.seenText = text;
		this.local = 'ok';
		let plan: StartPlan = {};
		if (text !== null) {
			const read = readSave(parseJson(text));
			if (read.ok) {
				this.carryOn(read.save);
				this.serverState = this.identity ? 'unknown' : 'ready';
				return { game: restoreGame(read.save), notice: 'save.welcomeBack' };
			}
			if (read.reason === 'newer') {
				this.local = 'frozen';
				return { notice: 'save.newerGame' };
			}
			this.local = 'held';
			plan = { notice: 'save.couldNotLoad' };
		}

		// No save this build can read here. The server may have this player's game.
		this.lineage = this.mintId();
		this.firstWrite = true;
		this.serverState = 'ready';
		if (this.identity && this.server) {
			const got = await this.server.getSave(this.identity, this.bootWaitMs);
			if (got.kind === 'found') {
				const read = readSave(got.doc);
				if (read.ok) {
					this.carryOn(read.save);
					this.pushed = this.seq;
					// The kid's game is back: an unreadable local save is set aside for it at once.
					this.played = true;
					return { game: restoreGame(read.save), notice: 'save.welcomeBack' };
				}
				if (read.reason === 'newer') this.serverState = 'stopped';
				// Unreadable: our saves are numbered past it, and the server sets it aside when one lands.
				else this.seq = Math.max(this.seq, saveSeq(got.doc));
			} else if (got.kind === 'unknown-player') {
				this.retireIdentity();
			} else if (got.kind === 'offline') {
				this.serverState = 'unknown';
			}
		}
		return plan;
	}

	/** Call once the authority has started from the plan. */
	begin(): void {
		this.begun = true;
		if (this.firstWrite) this.changed(false);
		this.startServer();
	}

	/**
	 * Every authority event: anything that changes the game is saved. Events
	 * before `begin` are the authority starting from the plan (a restored
	 * battle's `battle-started` among them); they change nothing, so they
	 * write nothing.
	 */
	handle(event: GameEvent): void {
		if (!this.begun) return;
		switch (event.type) {
			case 'battle-ended':
			case 'party-changed':
			case 'taken-to-doctor':
			case 'doctor-visit-ended':
				this.changed(true);
				break;
			case 'player-moved':
			case 'player-blocked':
			case 'player-placed':
			case 'battle-started':
			case 'battle-updated':
			case 'doctor-visit-started':
			case 'doctor-visit-updated':
				this.changed(false);
				break;
		}
	}

	/** The page is being hidden or left: save now, and send the backup with `keepalive`. */
	flush(): void {
		this.commit();
		const latest = this.latest;
		if (!this.canPush() || !latest || latest.seq <= Math.max(this.pushed, this.flushed)) return;
		this.flushed = latest.seq;
		void this.push(true);
	}

	/** A `storage` event: another page of this site changed `key` (null: storage was cleared). */
	onStorage(key: string | null): void {
		if (this.stale || (this.local !== 'ok' && this.local !== 'held')) return;
		if (key !== null && key !== KEYS.save) return;
		// Judge the save as it is now, not the value the event carried: events arrive late,
		// and that value may already be replaced, by this page's own next save among others.
		const now = this.store?.get(KEYS.save) ?? null;
		if (now === this.seenText) return;
		if (!this.canCarryOnFrom(now)) this.goStale();
		// Otherwise the other page only walked: this one carries on from it at its next save.
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
		const writesLocal = store !== null && (this.local === 'ok' || this.local === 'held');
		if (writesLocal) {
			const current = store.get(KEYS.save);
			if (current !== this.seenText && !this.carryOnFrom(current)) {
				this.goStale();
				return;
			}
			if (this.local === 'held') {
				if (current !== null && store.get(KEYS.unreadable) === null) {
					store.set(KEYS.unreadable, current);
				}
				this.local = 'ok';
			}
		}

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
			if (store.set(KEYS.save, text)) this.seenText = text;
			else this.local = 'broken';
		}
		this.seq = doc.seq;
		this.base = doc;
		this.latest = doc;
		this.firstWrite = false;
		if (matters) this.wake();
		this.schedulePush(matters);
	}

	/** Take `save` as the one this page's game grows from. */
	private carryOn(save: SaveV1): void {
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
		return true;
	}

	private goStale(): void {
		this.stale = true;
		this.clearTimers();
	}

	private readIdentity(store: KeyValueStore): void {
		const text = store.get(KEYS.player);
		if (text === null) return;
		const parsed = parseJson(text);
		if (isIdentity(parsed)) {
			this.identity = { id: parsed.id, secret: parsed.secret };
			return;
		}
		store.set(KEYS.previousPlayer, text);
		store.remove(KEYS.player);
	}

	// --- server ---------------------------------------------------------------

	private startServer(): void {
		if (!this.server || !this.store || this.stale) return;
		if (this.local === 'frozen' || this.serverState === 'stopped') return;
		if (!this.identity) {
			void this.createIdentity();
			return;
		}
		if (this.serverState === 'unknown') {
			void this.checkServer();
			return;
		}
		this.schedulePush(true);
	}

	private canPush(): boolean {
		return (
			this.server !== null &&
			this.identity !== null &&
			this.serverState === 'ready' &&
			!this.stale &&
			this.local !== 'frozen' &&
			(this.local !== 'held' || this.played)
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
		const result = await this.server!.putSave(this.identity!, doc, keepalive);
		if (!keepalive) this.pushing = false;
		if (this.stale || this.serverState !== 'ready') return;
		switch (result.kind) {
			case 'saved':
				this.pushed = Math.max(this.pushed, doc.seq);
				this.succeeded();
				if (this.latest && this.latest.seq > this.pushed) this.schedulePush(true);
				return;
			case 'conflict':
				await this.checkServer();
				return;
			case 'refused':
				// The server and this build disagree about what a save is: stop, and say so to developers.
				console.error(`Animath: the server refused a save backup: ${result.error}`);
				this.serverState = 'stopped';
				return;
			case 'unknown-player':
				this.retireIdentity();
				return;
			case 'offline':
				if (!keepalive) this.retry(() => void this.push(false));
				return;
		}
	}

	/** Compare with what the server holds, and settle who carries on. */
	private async checkServer(): Promise<void> {
		if (!this.server || !this.identity) return;
		const got = await this.server.getSave(this.identity);
		if (this.stale) return;
		switch (got.kind) {
			case 'offline':
				this.serverState = this.serverState === 'ready' ? 'ready' : 'unknown';
				this.retry(() => void this.checkServer());
				return;
			case 'unknown-player':
				this.retireIdentity();
				return;
			case 'none':
				this.succeeded();
				this.pushed = 0;
				this.serverState = 'ready';
				this.schedulePush(true);
				return;
			case 'found':
				this.succeeded();
				this.settleWith(got.doc);
				return;
		}
	}

	/**
	 * The server holds `doc`. The save with the higher `seq` is the game that
	 * carries on: this page's, sent as the next backup, or the server's,
	 * which this page adopts and reloads into.
	 */
	private settleWith(doc: unknown): void {
		const read = readSave(doc);
		const theirs = saveSeq(doc);
		if (!read.ok) {
			if (read.reason === 'newer') {
				this.serverState = 'stopped';
				return;
			}
			// Unreadable: save past it; the server sets it aside when the backup replaces it.
			this.serverState = 'ready';
			if (theirs >= this.seq) {
				this.seq = theirs;
				this.markDirty(true);
			} else this.schedulePush(true);
			return;
		}
		const sameGame = saveLineage(doc) === this.lineage;
		if (theirs > this.seq || (theirs === this.seq && !sameGame)) {
			this.adopt(read.save);
			return;
		}
		this.pushed = sameGame ? theirs : 0;
		this.serverState = 'ready';
		if (this.seq > this.pushed) this.schedulePush(true);
	}

	/**
	 * The server's game is ahead of this browser's: keep this browser's in
	 * `KEYS.replaced` (or `KEYS.unreadable`), make the server's the saved
	 * game, and reload into it.
	 */
	private adopt(save: SaveV1): void {
		const store = this.store;
		if (!store || this.local === 'frozen' || this.local === 'none') return;
		const current = store.get(KEYS.save);
		if (current !== this.seenText && current !== null) {
			// Another page wrote meanwhile; it will settle with the server itself.
			this.goStale();
			return;
		}
		if (current !== null)
			store.set(this.local === 'held' ? KEYS.unreadable : KEYS.replaced, current);
		if (!store.set(KEYS.save, JSON.stringify(save))) {
			// Cannot keep the server's game here, so reloading would not reach it. Carry on as we are.
			this.serverState = 'stopped';
			return;
		}
		this.goStale();
	}

	private async createIdentity(): Promise<void> {
		if (this.creating || !this.server || !this.store) return;
		this.creating = true;
		const result = await this.server.createPlayer();
		this.creating = false;
		if (this.stale) return;
		if (result.kind === 'offline') {
			this.retry(() => void this.createIdentity());
			return;
		}
		this.succeeded();
		// Another page of this browser may have made one first: use it, so both back up to one player.
		const theirs = parseJson(this.store.get(KEYS.player) ?? '');
		if (isIdentity(theirs)) {
			this.identity = { id: theirs.id, secret: theirs.secret };
			this.serverState = 'unknown';
			void this.checkServer();
			return;
		}
		if (!this.store.set(KEYS.player, JSON.stringify(result.identity))) {
			this.serverState = 'stopped';
			return;
		}
		this.identity = result.identity;
		this.pushed = 0;
		this.serverState = 'ready';
		this.schedulePush(true);
	}

	/** The server does not know this identity: keep it aside, and start a new one. */
	private retireIdentity(): void {
		if (this.identity && this.store) {
			this.store.set(KEYS.previousPlayer, JSON.stringify(this.identity));
			this.store.remove(KEYS.player);
		}
		this.identity = null;
		this.pushed = 0;
		this.serverState = 'ready';
		void this.createIdentity();
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

	/** A battle ended or the party changed: a resting backup tries once more. */
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
