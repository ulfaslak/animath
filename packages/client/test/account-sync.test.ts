import {
	canReplace,
	newGame,
	saveDocument,
	type GameEvent,
	type SaveWrite,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveServer, ServerRead, ServerWrite } from '../src/save/api';
import { Autosave } from '../src/save/autosave';
import { KEYS, accountKeys, type KeyValueStore } from '../src/save/storage';

/**
 * An account's game in the browser ([[DECISIONS]] § Accounts): the same
 * autosave as the guest's, under the account's own keys, against the
 * account's save on the server, which the session cookie names. Local first,
 * then the server, with the higher `seq` winning both ways; a server that
 * says the session is over stops the pushes and never the game.
 */

class MemoryStore implements KeyValueStore {
	data = new Map<string, string>();
	get(key: string): string | null {
		return this.data.get(key) ?? null;
	}
	set(key: string, value: string): boolean {
		this.data.set(key, value);
		return true;
	}
	remove(key: string): void {
		this.data.delete(key);
	}
}

/** The account's save on the server, behind a session cookie, with the real write guard. */
class FakeAccountServer implements SaveServer {
	readonly session = true;
	save: unknown = null;
	online = true;
	loggedIn = true;
	calls: string[] = [];

	async createPlayer() {
		this.calls.push('create');
		return { kind: 'offline' as const };
	}

	async getSave(): Promise<ServerRead> {
		this.calls.push('get');
		if (!this.online) return { kind: 'offline' };
		if (!this.loggedIn) return { kind: 'unknown-player' };
		return this.save === null
			? { kind: 'none' }
			: { kind: 'found', doc: JSON.parse(JSON.stringify(this.save)) };
	}

	async putSave(_who: unknown, doc: SaveWrite): Promise<ServerWrite> {
		this.calls.push('put');
		if (!this.online) return { kind: 'offline' };
		if (!this.loggedIn) return { kind: 'unknown-player' };
		if (!canReplace(this.save, doc)) return { kind: 'conflict' };
		this.save = JSON.parse(JSON.stringify(doc));
		return { kind: 'saved' };
	}
}

const KEYS_IDA = accountKeys('ida');

function gameOf(name = 'Ida'): SavedGame {
	return { ...newGame(1, { id: 'a', speciesId: 'rabbit', hp: 5 }), name };
}

class Page {
	game: SavedGame = gameOf();
	loggedOut = 0;
	autosave: Autosave;
	constructor(
		public store: MemoryStore,
		public server: FakeAccountServer
	) {
		this.autosave = new Autosave({
			store,
			keys: KEYS_IDA,
			server,
			loggedOut: () => this.loggedOut++,
			snapshot: () => JSON.parse(JSON.stringify(this.game)) as SavedGame,
			mintId: () => `lineage-${Math.random().toString(36).slice(2)}`,
			bootWaitMs: 100
		});
	}

	/** Boot and begin, as `main.ts` does. */
	async open(): Promise<void> {
		const plan = await this.autosave.boot();
		if (plan.game) this.game = JSON.parse(JSON.stringify(plan.game));
		this.autosave.handle({ type: 'welcome' } as GameEvent);
		this.autosave.begin();
		await settle();
	}

	async walk(): Promise<void> {
		this.game.pos = { x: this.game.pos.x + 1, y: this.game.pos.y };
		this.game.steps += 1;
		this.autosave.handle({ type: 'player-moved' } as GameEvent);
		await settle();
	}

	async catchOne(): Promise<void> {
		this.game.party.push({ id: `c${this.game.party.length}`, speciesId: 'rabbit', hp: 3 });
		this.autosave.handle({ type: 'party-changed' } as GameEvent);
		await settle();
	}

	saved(): SaveWrite | null {
		const text = this.store.get(KEYS_IDA.save);
		return text === null ? null : (JSON.parse(text) as SaveWrite);
	}
}

async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
}
async function later(ms = 16_000): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("an account's game in the browser", () => {
	it('saves under the account’s keys, never the guest’s, and keeps no identity', async () => {
		const store = new MemoryStore();
		const guest = JSON.stringify(saveDocument(gameOf('Guest'), { lineage: 'guest', seq: 4 }));
		store.set(KEYS.save, guest);
		const server = new FakeAccountServer();
		const page = new Page(store, server);
		await page.open();
		await page.catchOne();
		await later();
		expect(page.saved()?.party).toHaveLength(2);
		expect(store.get(KEYS.save)).toBe(guest);
		expect(store.get(KEYS.player)).toBeNull();
		expect(store.get(KEYS_IDA.player)).toBeNull();
		expect(server.calls).not.toContain('create');
		expect((server.save as SaveWrite).party).toHaveLength(2);
	});

	it("starts from the account's save on the server when this browser has none of it", async () => {
		const server = new FakeAccountServer();
		server.save = saveDocument({ ...gameOf(), tokens: 9 }, { lineage: 'theirs', seq: 40 });
		const page = new Page(new MemoryStore(), server);
		await page.open();
		expect(page.game.tokens).toBe(9);
		await page.walk();
		expect(page.saved()?.lineage).toBe('theirs');
		expect(page.saved()?.seq).toBeGreaterThan(40);
	});

	it("another device got further: the server's newer save comes in, this browser's kept aside, and the page is behind", async () => {
		const store = new MemoryStore();
		const server = new FakeAccountServer();
		const page = new Page(store, server);
		await page.open();
		await page.catchOne();
		await later();
		const mine = page.saved()!;
		// Another device plays on in the same game, further than this page.
		server.save = { ...mine, seq: mine.seq + 50, tokens: 77 };
		await page.catchOne();
		await later();
		expect(page.autosave.behind).toBe('replaced');
		expect(page.saved()?.tokens).toBe(77);
		expect(JSON.parse(store.get(KEYS_IDA.replaced)!).party).toHaveLength(3);
	});

	it('a session that ended stops the pushes, once, and the game still saves in the browser', async () => {
		const server = new FakeAccountServer();
		const page = new Page(new MemoryStore(), server);
		await page.open();
		await later();
		server.loggedIn = false;
		await page.catchOne();
		await later();
		expect(page.loggedOut).toBe(1);
		const calls = server.calls.length;
		await page.catchOne();
		await page.walk();
		await later(120_000);
		expect(server.calls.length).toBe(calls);
		expect(page.saved()?.party).toHaveLength(3);
		expect(page.autosave.behind).toBeNull();
	});

	it("pushNow waits for the newest save to reach the server, and gives up at once when it can't", async () => {
		const server = new FakeAccountServer();
		const page = new Page(new MemoryStore(), server);
		await page.open();
		await later();
		await page.walk();
		const pushed = page.autosave.pushNow(3000);
		await settle();
		expect(await pushed).toBe(true);
		expect((server.save as SaveWrite).seq).toBe(page.saved()!.seq);
		// Nothing new: done at once.
		expect(await page.autosave.pushNow(3000)).toBe(true);
		// Out of reach: the push fails and retries wait; pushNow says so without waiting.
		server.online = false;
		await page.catchOne();
		await later(2000);
		let answered: boolean | null = null;
		void page.autosave.pushNow(3000).then((ok) => (answered = ok));
		await settle();
		expect(answered).toBe(false);
	});

	it('another tab logged in or out: the page is behind, and saves nothing more', async () => {
		const store = new MemoryStore();
		const page = new Page(store, new FakeAccountServer());
		await page.open();
		await page.walk();
		const before = store.get(KEYS_IDA.save);
		page.autosave.fallBehind();
		expect(page.autosave.behind).toBe('replaced');
		await page.catchOne();
		expect(store.get(KEYS_IDA.save)).toBe(before);
	});

	it('a newer build’s save on the server: at load, the page is behind it and writes nothing, here or there', async () => {
		const future = { version: 99, seq: 5, lineage: 'future' };
		const server = new FakeAccountServer();
		server.save = future;
		const store = new MemoryStore();
		const page = new Page(store, server);
		await page.open();
		await page.catchOne();
		await later(120_000);
		expect(page.autosave.behind).toBe('newer');
		expect(server.save).toEqual(future);
		expect(server.calls).not.toContain('put');
		expect(store.get(KEYS_IDA.save)).toBeNull();
	});

	it('a server save no build could read is saved past, as the backup does, once the kid has played', async () => {
		const broken = { version: 2, seq: 5, lineage: 'odd', party: 'not a party' };
		const server = new FakeAccountServer();
		server.save = broken;
		const page = new Page(new MemoryStore(), server);
		await page.open();
		await later(120_000);
		// Nothing goes over it until the kid has played the new game.
		expect(server.calls).not.toContain('put');
		expect(server.save).toEqual(broken);
		await page.catchOne();
		await later(120_000);
		expect(page.autosave.behind).toBeNull();
		expect(server.save).toEqual(page.saved());
		expect(page.saved()!.seq).toBeGreaterThan(5);
	});

	it('a server save this build cannot read, found while playing: both copies stay as they are, and nothing more is pushed', async () => {
		const server = new FakeAccountServer();
		const store = new MemoryStore();
		const page = new Page(store, server);
		await page.open();
		await page.catchOne();
		await later();
		const mine = store.get(KEYS_IDA.save);
		// A newer build, on another device, saves the account's game past this one.
		const future = { version: 99, seq: 999, lineage: page.saved()!.lineage };
		server.save = future;
		const puts = server.calls.filter((c) => c === 'put').length;
		await page.catchOne();
		await later(120_000);
		expect(page.autosave.behind).toBe('newer');
		expect(server.save).toEqual(future);
		expect(server.calls.filter((c) => c === 'put').length).toBe(puts + 1);
		expect(store.get(KEYS_IDA.save)).not.toBeNull();
		expect(JSON.parse(store.get(KEYS_IDA.save)!).party).toHaveLength(
			JSON.parse(mine!).party.length + 1
		);
		// Behind: the page writes nothing more, here or there.
		const now = store.get(KEYS_IDA.save);
		await page.catchOne();
		await later(120_000);
		expect(store.get(KEYS_IDA.save)).toBe(now);
		expect(server.calls.filter((c) => c === 'put').length).toBe(puts + 1);
	});

	it('two devices at the same save number with different games: the one refused takes the server’s and keeps its own aside', async () => {
		const server = new FakeAccountServer();
		server.save = saveDocument(gameOf(), { lineage: 'shared', seq: 10 });
		const x = new Page(new MemoryStore(), server);
		const y = new Page(new MemoryStore(), server);
		await x.open();
		await y.open();
		// Both write the same first save at 11: one lands, the other is the same game.
		await later(2000);
		expect(y.autosave.behind).toBeNull();
		await x.catchOne();
		await later(2000);
		const xs = server.save as SaveWrite;
		expect(xs.seq).toBe(12);
		// Y caught something else, and saves the same number: refused, it takes X's.
		y.game.party.push({ id: 'bear', speciesId: 'bear', hp: 9 });
		y.autosave.handle({ type: 'party-changed' } as GameEvent);
		await settle();
		await later(2000);
		expect(y.autosave.behind).toBe('replaced');
		expect(server.save).toEqual(xs);
		expect(y.saved()?.party.map((a) => a.id)).toEqual(xs.party.map((a) => a.id));
		const kept = JSON.parse(y.store.get(KEYS_IDA.replaced)!) as SaveWrite;
		expect(kept.party.some((a) => a.id === 'bear')).toBe(true);
		// And Y pushes nothing over X's game.
		expect(await y.autosave.pushNow(1000)).toBe(false);
		expect(server.save).toEqual(xs);
	});

	it('refused, then saved on past the server’s number before hearing what it holds: still the server’s game, never pushed over it', async () => {
		const server = new FakeAccountServer();
		server.save = saveDocument(gameOf(), { lineage: 'shared', seq: 10 });
		const x = new Page(new MemoryStore(), server);
		const y = new Page(new MemoryStore(), server);
		await x.open();
		await y.open();
		await later(2000);
		await x.catchOne();
		await later(2000);
		const xs = server.save as SaveWrite;
		expect(xs.seq).toBe(12);
		// Y's own 12 is refused, and the answer to "what does the server hold?" is lost on the way.
		const get = server.getSave.bind(server);
		let lost = true;
		server.getSave = async () => {
			if (!lost) return get();
			lost = false;
			return { kind: 'offline' };
		};
		y.game.party.push({ id: 'bear', speciesId: 'bear', hp: 9 });
		y.autosave.handle({ type: 'party-changed' } as GameEvent);
		await settle();
		await later(1500);
		// Y plays on past the server's number before it asks again.
		await y.walk();
		await y.walk();
		expect(y.saved()!.seq).toBeGreaterThan(xs.seq);
		expect(y.autosave.behind).toBeNull();
		await later(70_000);
		expect(y.autosave.behind).toBe('replaced');
		expect(server.save).toEqual(xs);
		const kept = JSON.parse(y.store.get(KEYS_IDA.replaced)!) as SaveWrite;
		expect(kept.seq).toBe(xs.seq + 2);
		expect(kept.party.some((a) => a.id === 'bear')).toBe(true);
	});

	it('refused while another tab walked on unseen: the re-settle still takes the server’s game', async () => {
		const server = new FakeAccountServer();
		server.save = saveDocument(gameOf(), { lineage: 'shared', seq: 10 });
		const shared = new MemoryStore();
		const x = new Page(new MemoryStore(), server);
		const y1 = new Page(shared, server);
		await x.open();
		await y1.open();
		const y2 = new Page(shared, server);
		await y2.open();
		await later(2000);
		await x.catchOne();
		await later(2000);
		const xs = server.save as SaveWrite;
		expect(xs.seq).toBe(12);
		// Tab 1 walks (12), and tab 2 walks on from it (13) before tab 1 hears of it.
		await y1.walk();
		await later(100);
		await y2.walk();
		expect(y1.saved()!.seq).toBe(13);
		// Tab 1's walk is refused. Carrying on from tab 2's walk must not make it forget why.
		await later(14_950);
		expect(y1.autosave.behind).toBe('replaced');
		expect(y1.saved()).toEqual(xs);
		expect((JSON.parse(shared.get(KEYS_IDA.replaced)!) as SaveWrite).seq).toBe(13);
		expect(server.save).toEqual(xs);
	});

	it('its own save, sent before and not heard back, is not another device’s: it goes on pushing', async () => {
		const server = new FakeAccountServer();
		const page = new Page(new MemoryStore(), server);
		await page.open();
		await page.catchOne();
		await later(2000);
		// The server already holds exactly this page's newest save (an answer lost on the way).
		const mine = page.saved()!;
		server.save = JSON.parse(JSON.stringify(mine));
		const put = server.putSave.bind(server);
		let once = true;
		server.putSave = async (who, doc) => {
			if (once) {
				once = false;
				return { kind: 'conflict' };
			}
			return put(who, doc);
		};
		await page.walk();
		await later(20_000);
		expect(page.autosave.behind).toBeNull();
		expect((server.save as SaveWrite).seq).toBe(page.saved()!.seq);
	});

	it('names the game it plays while one is under way', async () => {
		const page = new Page(new MemoryStore(), new FakeAccountServer());
		expect(page.autosave.playing).toBeNull();
		await page.open();
		expect(page.autosave.playing).toMatch(/^lineage-/);
	});
});
