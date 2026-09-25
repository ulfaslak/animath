import {
	canReplace,
	hashString,
	newGame,
	readSave,
	type GameEvent,
	type SaveWrite,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity, SaveServer, ServerRead, ServerWrite } from '../src/save/api';
import { Autosave } from '../src/save/autosave';
import { COPY, LANGUAGES } from '../src/copy/languages';
import { flatten } from '../src/copy/translate';
import { SAVE_NOTICES } from '../src/state/notice.svelte';
import { KEYS, type KeyValueStore } from '../src/save/storage';

/**
 * The autosave's rules, against a localStorage stand-in shared by "tabs" and a
 * server stand-in that applies the real write guard (`canReplace`): the save
 * is local first and rewritten after every change, a page never writes over a
 * save it has not seen, a save it cannot read is set aside rather than lost,
 * and the server backup never blocks or breaks the game.
 */

const SEED = hashString('prototype');

class MemoryStore implements KeyValueStore {
	data = new Map<string, string>();
	failWrites = false;
	writes = 0;
	get(key: string): string | null {
		return this.data.get(key) ?? null;
	}
	set(key: string, value: string): boolean {
		if (this.failWrites) return false;
		this.writes++;
		this.data.set(key, value);
		return true;
	}
	remove(key: string): void {
		this.data.delete(key);
	}
	/** The parsed save, or null. */
	save(): SaveWrite | null {
		const text = this.get(KEYS.save);
		return text === null ? null : (JSON.parse(text) as SaveWrite);
	}
}

class FakeServer implements SaveServer {
	players = new Map<string, { secret: string; save: unknown }>();
	online = true;
	refuse = false;
	calls: string[] = [];
	keepalives = 0;
	private next = 1;

	async createPlayer() {
		this.calls.push('create');
		if (!this.online) return { kind: 'offline' as const };
		const id = `00000000-0000-4000-8000-${String(this.next++).padStart(12, '0')}`;
		this.players.set(id, { secret: `secret-${id}`, save: null });
		return { kind: 'created' as const, identity: { id, secret: `secret-${id}` } };
	}

	async getSave(who: Identity): Promise<ServerRead> {
		this.calls.push('get');
		if (!this.online) return { kind: 'offline' };
		const player = this.players.get(who.id);
		if (!player || player.secret !== who.secret) return { kind: 'unknown-player' };
		if (player.save === null) return { kind: 'none' };
		return { kind: 'found', doc: JSON.parse(JSON.stringify(player.save)) };
	}

	async putSave(who: Identity, doc: SaveWrite, keepalive = false): Promise<ServerWrite> {
		this.calls.push('put');
		if (keepalive) this.keepalives++;
		if (!this.online) return { kind: 'offline' };
		if (this.refuse) return { kind: 'refused', error: 'no thanks' };
		const player = this.players.get(who.id);
		if (!player || player.secret !== who.secret) return { kind: 'unknown-player' };
		if (!canReplace(player.save, doc)) return { kind: 'conflict' };
		player.save = JSON.parse(JSON.stringify(doc));
		return { kind: 'saved' };
	}

	/** A player the server knows, holding `save`. */
	seed(save: unknown): Identity {
		const id = `00000000-0000-4000-8000-${String(this.next++).padStart(12, '0')}`;
		this.players.set(id, { secret: `secret-${id}`, save });
		return { id, secret: `secret-${id}` };
	}

	saveOf(who: Identity): SaveWrite | null {
		return (this.players.get(who.id)?.save as SaveWrite | null) ?? null;
	}
}

/** One page of the game: its own copy of the game state, the shared store, the shared server. */
class Tab {
	game: SavedGame;
	autosave: Autosave;
	private ids = 0;
	constructor(
		public store: MemoryStore | null,
		public server: FakeServer | null,
		options: { throwaway?: boolean } = {}
	) {
		this.game = newGame(SEED);
		this.autosave = new Autosave({
			store,
			server,
			snapshot: () => JSON.parse(JSON.stringify(this.game)) as SavedGame,
			mintId: () => `lineage-${Math.random().toString(36).slice(2)}-${this.ids++}`,
			throwaway: options.throwaway,
			bootWaitMs: 100
		});
	}

	/** Boot and begin, as `main.ts` does; the game is whatever the plan says. */
	async open(): Promise<{ game?: SavedGame; notice?: string }> {
		const plan = await this.autosave.boot();
		this.game = plan.game ? JSON.parse(JSON.stringify(plan.game)) : newGame(SEED);
		// What `authority.start(plan)` emits, before `begin` — as in main.ts.
		this.autosave.handle({ type: 'welcome' } as GameEvent);
		if (this.game.battle) this.autosave.handle({ type: 'battle-started' } as GameEvent);
		this.autosave.begin();
		await settle();
		return plan;
	}

	/** Change the game and tell the autosave, as an authority event would. */
	async play(
		change: (game: SavedGame) => void,
		event: GameEvent['type'] = 'player-moved'
	): Promise<void> {
		change(this.game);
		this.autosave.handle({ type: event } as GameEvent);
		await settle();
	}

	walk(): Promise<void> {
		return this.play((g) => {
			g.pos = { x: g.pos.x + 1, y: g.pos.y };
			g.steps += 1;
		});
	}

	/** Something a kid would miss: a new animal in the party. */
	catchOne(): Promise<void> {
		return this.play(
			(g) => g.party.push({ id: `caught-${g.party.length}`, speciesId: 'rabbit', hp: 7 }),
			'party-changed'
		);
	}
}

/** Let microtasks and pending fake-server calls run. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
}

/** Run the backup timers: a push after a change goes out within this. */
async function later(ms = 16_000): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
}

function identityIn(store: MemoryStore): Identity | null {
	const text = store.get(KEYS.player);
	return text === null ? null : (JSON.parse(text) as Identity);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('Autosave: the save in this browser', () => {
	it('a first visit starts a new game, saves it at once, and makes a player for the backup', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({});
		const saved = store.save()!;
		expect(saved).toMatchObject({ version: 1, seq: 1, seed: SEED, party: newGame(SEED).party });
		expect(saved.lineage).toBeTruthy();
		const who = identityIn(store)!;
		expect(who).toBeTruthy();
		await later();
		expect(server.saveOf(who)).toEqual(saved);
	});

	it('a reload starts from the saved game at once, without waiting for the server', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const first = new Tab(store, server);
		await first.open();
		await first.walk();
		await first.catchOne();

		server.online = false;
		const calls = server.calls.length;
		const again = new Tab(store, server);
		const plan = await again.autosave.boot();
		expect(server.calls.length).toBe(calls);
		expect(plan).toEqual({ game: first.game, notice: 'save.welcomeBack' });
	});

	it('writes after every change, once for everything one intent causes', async () => {
		const store = new MemoryStore();
		const tab = new Tab(store, null);
		await tab.open();
		const before = store.writes;
		tab.game.steps = 1;
		for (const type of ['battle-updated', 'battle-ended', 'party-changed'] as const) {
			tab.autosave.handle({ type } as GameEvent);
		}
		await settle();
		expect(store.writes).toBe(before + 1);
		expect(store.save()!.steps).toBe(1);
		// A message changes nothing and writes nothing.
		tab.autosave.handle({ type: 'message', text: 'hi' });
		await settle();
		expect(store.writes).toBe(before + 1);
	});

	it('saves a battle in progress with the game, so a reload picks it up', async () => {
		const store = new MemoryStore();
		const tab = new Tab(store, null);
		await tab.open();
		const battle = {
			step: 1,
			turn: 1,
			party: tab.game.party,
			active: 0,
			opponent: { id: 'wild-1', speciesId: 'rabbit', hp: 20 },
			leashQuality: 1,
			phase: { kind: 'choose-action' as const },
			log: []
		};
		await tab.play((g) => (g.battle = battle), 'battle-started');
		expect(store.save()!.battle).toEqual(battle);
		const plan = await new Tab(store, null).autosave.boot();
		expect(plan.game?.battle).toEqual(battle);
	});

	it('flushing on pagehide writes at once and sends the backup with keepalive, once', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		tab.game.steps = 99;
		tab.autosave.handle({ type: 'player-moved' } as GameEvent);
		tab.autosave.flush(); // before the microtask: the write must not wait for it
		expect(store.save()!.steps).toBe(99);
		tab.autosave.flush(); // visibilitychange, then pagehide
		await settle();
		expect(server.keepalives).toBe(1);
		expect(server.saveOf(identityIn(store)!)!.steps).toBe(99);
	});

	it('a save that cannot be read is left alone until the kid plays, then kept aside', async () => {
		const store = new MemoryStore();
		const broken =
			'{"version":1,"seed":5,"pos":{"x":0,"y":0},"party":[{"id":"a","speciesId":"dragon","hp":3}]}';
		store.set(KEYS.save, broken);
		const server = new FakeServer();
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({ notice: 'save.couldNotLoad' });
		await tab.walk();
		await later();
		expect(store.get(KEYS.save)).toBe(broken);
		const who = identityIn(store);
		if (who) expect(server.saveOf(who)).toBeNull();

		await tab.catchOne();
		expect(store.get(KEYS.unreadable)).toBe(broken);
		expect(store.save()!.party).toHaveLength(2);
		await later();
		expect(server.saveOf(identityIn(store)!)!.party).toHaveLength(2);
	});

	it("a newer build's save is never touched, and the server is left alone", async () => {
		const store = new MemoryStore();
		const newer = JSON.stringify({ version: 2, whatever: true });
		store.set(KEYS.save, newer);
		const server = new FakeServer();
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({ notice: 'save.newerGame' });
		await tab.catchOne();
		tab.autosave.flush();
		await later();
		expect(store.get(KEYS.save)).toBe(newer);
		expect(server.calls).toEqual([]);
	});

	it('with no storage the game plays and says it cannot keep the game; ?new plays and says nothing', async () => {
		const server = new FakeServer();
		const blocked = new Tab(null, server);
		expect(await blocked.open()).toEqual({ notice: 'save.cannotSave' });
		await blocked.catchOne();
		blocked.autosave.flush();
		await later();
		expect(server.calls).toEqual([]);

		const store = new MemoryStore();
		store.set(KEYS.save, 'the real game');
		const throwaway = new Tab(store, server, { throwaway: true });
		expect(await throwaway.open()).toEqual({});
		await throwaway.catchOne();
		throwaway.autosave.flush();
		await later();
		expect(store.get(KEYS.save)).toBe('the real game');
		expect(server.calls).toEqual([]);
	});

	it('when storage stops taking writes, the game goes on and the backup still goes out', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		store.failWrites = true;
		await tab.catchOne();
		await later();
		expect(server.saveOf(identityIn(store)!)!.party).toHaveLength(2);
		// The next start finds the server ahead of this browser, and takes the server's game.
		store.failWrites = false;
		const next = new Tab(store, server);
		await next.open();
		await later();
		expect(next.autosave.wantsReload).toBe(true);
		expect(store.save()!.party).toHaveLength(2);
	});
});

describe('Autosave: what start-up tells the player', () => {
	it('every notice is a line in every language', () => {
		for (const lang of LANGUAGES) {
			const lines = flatten(COPY[lang]);
			for (const key of SAVE_NOTICES) expect(lines.has(key), `${lang}: ${key}`).toBe(true);
		}
	});
});

describe('Autosave: two tabs', () => {
	async function twoTabs() {
		const store = new MemoryStore();
		const server = new FakeServer();
		const a = new Tab(store, server);
		await a.open();
		await a.walk();
		const b = new Tab(store, server);
		await b.open();
		return { store, server, a, b };
	}

	it('a tab that falls behind a catch stops saving and asks to reload', async () => {
		const { store, a, b } = await twoTabs();
		await a.catchOne();
		b.autosave.onStorage(KEYS.save);
		expect(b.autosave.wantsReload).toBe(true);
		const saved = store.get(KEYS.save);
		await b.walk();
		b.autosave.flush();
		expect(store.get(KEYS.save)).toBe(saved);
	});

	it('the same, found at write time when no storage event came', async () => {
		const { store, a, b } = await twoTabs();
		await a.catchOne();
		const saved = store.get(KEYS.save);
		await b.walk();
		expect(b.autosave.wantsReload).toBe(true);
		expect(store.get(KEYS.save)).toBe(saved);
	});

	it('when the other tab only walked, this tab carries on from its save and writes on top', async () => {
		const { store, a, b } = await twoTabs();
		await a.walk();
		await a.walk();
		const theirs = store.save()!;
		b.autosave.onStorage(KEYS.save);
		expect(b.autosave.wantsReload).toBe(false);
		await b.catchOne();
		const mine = store.save()!;
		expect(mine.seq).toBe(theirs.seq + 1);
		expect(mine.lineage).toBe(theirs.lineage);
		expect(mine.party).toHaveLength(2);
		// And now the first tab is the one behind.
		await a.walk();
		expect(a.autosave.wantsReload).toBe(true);
		expect(store.save()).toEqual(mine);
	});

	it('a storage event that arrives after this tab already saved on top of it changes nothing', async () => {
		const { store, a, b } = await twoTabs();
		await b.walk();
		// A saves next: B only walked, so A carries on from B's save and writes a catch on top.
		await a.catchOne();
		expect(store.save()!.party).toHaveLength(2);
		// Only now does A hear about B's walk: late, and already built on.
		a.autosave.onStorage(KEYS.save);
		expect(a.autosave.wantsReload).toBe(false);
		await a.walk();
		expect(store.save()!.steps).toBe(a.game.steps);
	});

	it('picking up a saved battle writes nothing, so another tab is not disturbed', async () => {
		const { store, a } = await twoTabs();
		const battle = {
			step: 3,
			turn: 2,
			party: a.game.party,
			active: 0,
			opponent: { id: 'wild-1', speciesId: 'rabbit', hp: 20 },
			leashQuality: 1,
			phase: { kind: 'choose-action' as const },
			log: []
		};
		await a.play((g) => (g.battle = battle), 'battle-updated');
		const saved = store.get(KEYS.save);
		const writes = store.writes;
		const c = new Tab(store, null);
		const plan = await c.open();
		expect(plan.game?.battle).toEqual(battle);
		expect(store.writes).toBe(writes);
		expect(store.get(KEYS.save)).toBe(saved);
		a.autosave.onStorage(KEYS.save);
		expect(a.autosave.wantsReload).toBe(false);
	});

	it('a save removed from under the page (site data cleared) is not written back', async () => {
		const { store, a } = await twoTabs();
		store.remove(KEYS.save);
		await a.walk();
		a.autosave.flush();
		expect(store.get(KEYS.save)).toBeNull();
		expect(a.autosave.wantsReload).toBe(true);
	});
});

describe('Autosave: the server backup', () => {
	it('with an identity but no save here, start waits briefly for the server and takes its game', async () => {
		const server = new FakeServer();
		const theirs = { ...newGame(SEED), version: 1, lineage: 'from-server', seq: 40, steps: 55 };
		theirs.party = [...theirs.party, { id: 'fox', speciesId: 'fox', hp: 9 }];
		const who = server.seed(theirs);
		const store = new MemoryStore();
		store.set(KEYS.player, JSON.stringify(who));
		const tab = new Tab(store, server);
		const plan = await tab.open();
		expect(plan.notice).toBe('save.welcomeBack');
		expect(plan.game?.party).toHaveLength(2);
		expect(store.save()).toMatchObject({ lineage: 'from-server', seq: 41, steps: 55 });
	});

	it('an unknown server game at start (offline) is found later; the bigger game wins and this tab reloads', async () => {
		const server = new FakeServer();
		const theirs = { ...newGame(SEED), version: 1, lineage: 'from-server', seq: 40, steps: 55 };
		const who = server.seed(theirs);
		const store = new MemoryStore();
		store.set(KEYS.player, JSON.stringify(who));
		server.online = false;
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({});
		await tab.walk();
		const fresh = store.get(KEYS.save);
		expect(server.saveOf(who)).toEqual(theirs);

		server.online = true;
		await later(10_000);
		expect(tab.autosave.wantsReload).toBe(true);
		expect(store.save()).toMatchObject({ lineage: 'from-server', seq: 40 });
		expect(store.get(KEYS.replaced)).toBe(fresh);
		expect(server.saveOf(who)).toEqual(theirs);
	});

	it('a backup behind this browser is brought up to date; one of the same seq is left alone', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		const who = identityIn(store)!;
		server.online = false;
		await tab.walk();
		await tab.catchOne();
		server.online = true;
		const next = new Tab(store, server);
		await next.open();
		await later();
		expect(server.saveOf(who)).toEqual(store.save());
		expect(next.autosave.wantsReload).toBe(false);
		const puts = server.calls.filter((c) => c === 'put').length;
		const third = new Tab(store, server);
		await third.open();
		await later();
		expect(server.calls.filter((c) => c === 'put').length).toBe(puts);
	});

	it('an unreadable save on the server is saved past, and never adopted', async () => {
		const server = new FakeServer();
		const who = server.seed({ version: 1, seq: 500, party: 'not a party' });
		const store = new MemoryStore();
		const tab = new Tab(store, server);
		await tab.open();
		store.set(KEYS.player, JSON.stringify(who));
		const next = new Tab(store, server);
		await next.open();
		await next.walk();
		await later();
		expect(next.autosave.wantsReload).toBe(false);
		expect(server.saveOf(who)!.seq).toBeGreaterThan(500);
		expect(store.save()!.seq).toBe(server.saveOf(who)!.seq);
	});

	it("a newer build's save on the server is never overwritten", async () => {
		const server = new FakeServer();
		const newer = { version: 2, seq: 3 };
		const who = server.seed(newer);
		const store = new MemoryStore();
		const first = new Tab(store, server);
		await first.open();
		store.set(KEYS.player, JSON.stringify(who));
		const tab = new Tab(store, server);
		await tab.open();
		for (let i = 0; i < 5; i++) await tab.walk();
		await tab.catchOne();
		await later(20_000);
		expect(server.saveOf(who)).toEqual(newer);
		expect(tab.autosave.wantsReload).toBe(false);
	});

	it('while the server is down the game saves locally, retries quietly, then rests until a catch', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		server.online = false;
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const tab = new Tab(store, server);
		await tab.open();
		await later(10 * 60_000);
		const tries = server.calls.length;
		expect(tries).toBeGreaterThan(1);
		expect(tries).toBeLessThanOrEqual(6);
		// Resting: walking costs the server nothing, and the game saves here all the same.
		for (let i = 0; i < 10; i++) await tab.walk();
		await later(10 * 60_000);
		expect(server.calls.length).toBe(tries);
		expect(store.save()!.steps).toBe(10);
		// A catch tries once more; still down, so it rests again.
		await tab.catchOne();
		await later(10 * 60_000);
		expect(server.calls.length).toBe(tries + 1);
		// The server is back: the next catch makes the player and backs the game up.
		server.online = true;
		await tab.catchOne();
		await later();
		const who = identityIn(store)!;
		expect(server.saveOf(who)).toEqual(store.save());
		expect(server.saveOf(who)!.party).toHaveLength(3);
		expect(errors).not.toHaveBeenCalled();
	});

	it('a backup that failed while the server restarted goes out once it is back', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		const who = identityIn(store)!;
		server.online = false;
		await tab.catchOne();
		await later(3000);
		server.online = true;
		await later(10_000);
		expect(server.saveOf(who)).toEqual(store.save());
	});

	it('a refused backup is reported once to developers and not sent again', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		server.refuse = true;
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		await tab.catchOne();
		await tab.catchOne();
		await later();
		expect(errors).toHaveBeenCalledTimes(1);
		expect(server.calls.filter((c) => c === 'put')).toHaveLength(1);
	});

	it('an identity the server does not know is kept aside, and the game is backed up to a new one', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const ghost = { id: '00000000-0000-4000-8000-999999999999', secret: 'gone' };
		store.set(KEYS.player, JSON.stringify(ghost));
		const tab = new Tab(store, server);
		await tab.open();
		await tab.catchOne();
		await later();
		expect(JSON.parse(store.get(KEYS.previousPlayer)!)).toEqual(ghost);
		const who = identityIn(store)!;
		expect(who.id).not.toBe(ghost.id);
		expect(server.saveOf(who)).toEqual(store.save());
	});

	it('a 409 for a backup that already landed (its answer was lost) settles without a reload', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		const who = identityIn(store)!;
		await tab.catchOne();
		// The server stored the save, but the page never heard back.
		server.players.get(who.id)!.save = JSON.parse(store.get(KEYS.save)!);
		await later();
		expect(tab.autosave.wantsReload).toBe(false);
		expect(readSave(server.saveOf(who)).ok).toBe(true);
		await tab.walk();
		await later();
		expect(server.saveOf(who)).toEqual(store.save());
	});
});
