import {
	WORLD_ONE_SEED,
	canReplace,
	getAnimal,
	newGame,
	readSave,
	restoreGame,
	saveDocument,
	type BattleState,
	type GameEvent,
	type Intent,
	type SaveWrite,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAuthority, mintId } from '../src/authority/local';
import type { SaveServer, ServerRead, ServerWrite } from '../src/save/api';
import { Autosave } from '../src/save/autosave';
import { COPY, LANGUAGES } from '../src/copy/languages';
import { flatten } from '../src/copy/translate';
import { SAVE_NOTICES } from '../src/save/notices';
import { KEYS, type KeyValueStore } from '../src/save/storage';
import { mint, testStarter } from './minted';

/**
 * The autosave's rules, against a localStorage stand-in shared by "tabs" and a
 * stand-in for an account's save on the server that applies the real write
 * guard (`canReplace`): the save is local first and rewritten after every
 * change, a page never writes over a save it has not seen, a save it cannot
 * read is set aside rather than lost, and the server's copy never blocks or
 * breaks the game. A tab with no server plays a guest's game.
 */

/** World 1: every game in these tests is played there. */
const WORLD = 1;

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

/**
 * One tab's view of the shared store. A browser brings a page's view of
 * `localStorage` up to date only between tasks, so a write another page makes
 * in the same instant is not in it yet: `freeze` holds a key as it is now
 * until this tab writes it or `thaw` is called.
 */
class LaggingView extends MemoryStore {
	private held = new Map<string, string | null>();
	constructor(private shared: MemoryStore) {
		super();
	}
	freeze(key: string): void {
		this.held.set(key, this.shared.get(key));
	}
	thaw(): void {
		this.held.clear();
	}
	override get(key: string): string | null {
		return this.held.has(key) ? this.held.get(key)! : this.shared.get(key);
	}
	override set(key: string, value: string): boolean {
		this.held.delete(key);
		return this.shared.set(key, value);
	}
	override remove(key: string): void {
		this.held.delete(key);
		this.shared.remove(key);
	}
}

/** An account's save on the server, behind a session cookie that stays live, with the real write guard. */
class FakeServer implements SaveServer {
	save: unknown = null;
	online = true;
	refuse = false;
	/** Every save sent is a conflict (409), whatever its `seq`: a server older than the save it holds. */
	conflictAlways = false;
	calls: string[] = [];
	keepalives = 0;

	async getSave(): Promise<ServerRead> {
		this.calls.push('get');
		if (!this.online) return { kind: 'offline' };
		if (this.save === null) return { kind: 'none' };
		return { kind: 'found', doc: JSON.parse(JSON.stringify(this.save)) };
	}

	async putSave(doc: SaveWrite, keepalive = false): Promise<ServerWrite> {
		this.calls.push('put');
		if (keepalive) this.keepalives++;
		if (!this.online) return { kind: 'offline' };
		if (this.refuse) return { kind: 'refused', error: 'no thanks' };
		if (this.conflictAlways || !canReplace(this.save, doc)) return { kind: 'conflict' };
		this.save = JSON.parse(JSON.stringify(doc));
		return { kind: 'saved' };
	}

	/** The account's save on the server is `save`. */
	seed(save: unknown): void {
		this.save = save;
	}

	saveOf(): SaveWrite | null {
		return this.save as SaveWrite | null;
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
		this.game = newGame(WORLD, testStarter());
		this.autosave = new Autosave({
			store,
			server,
			snapshot: () => JSON.parse(JSON.stringify(this.game)) as SavedGame,
			catchUp: ({ steps, visits }) => {
				this.game.steps = Math.max(this.game.steps, steps);
				this.game.visits = Math.max(this.game.visits, visits);
			},
			mintId: () => `lineage-${Math.random().toString(36).slice(2)}-${this.ids++}`,
			throwaway: options.throwaway,
			bootWaitMs: 100
		});
	}

	/** Boot only: the title is up, and no game has started. */
	async title(): Promise<{ game?: SavedGame; notice?: string }> {
		const plan = await this.autosave.boot();
		await settle();
		return plan;
	}

	/** Continue on the title: the authority picks up `game`, then the autosave begins, as in main.ts. */
	async continueWith(game: SavedGame): Promise<void> {
		this.game = JSON.parse(JSON.stringify(game)) as SavedGame;
		this.autosave.handle({ type: 'welcome', newGame: false } as GameEvent);
		if (this.game.battle) this.autosave.handle({ type: 'battle-started' } as GameEvent);
		this.autosave.begin();
		await settle();
	}

	/** A starter picked on the title: the authority's new game, and its `welcome`. */
	async startNew(speciesId = 'rabbit'): Promise<void> {
		const hp = getAnimal(speciesId).maxHp;
		this.game = newGame(WORLD, { id: `starter-${this.ids++}`, speciesId, hp });
		this.autosave.handle({ type: 'welcome', newGame: true } as GameEvent);
		await settle();
	}

	/** Quit to title: the authority's `game-left`. */
	async quit(): Promise<void> {
		this.autosave.handle({ type: 'game-left' });
		await settle();
	}

	/**
	 * Boot and begin, as `main.ts` does; the game is whatever the plan says. A
	 * page behind a newer version's save from the start starts nothing.
	 */
	async open(): Promise<{ game?: SavedGame; notice?: string }> {
		const plan = await this.autosave.boot();
		if (this.autosave.behind !== null) {
			await settle();
			return plan;
		}
		this.game = plan.game ? JSON.parse(JSON.stringify(plan.game)) : newGame(WORLD, testStarter());
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
		event: GameEvent['type'] | GameEvent = 'player-moved'
	): Promise<void> {
		change(this.game);
		this.autosave.handle(typeof event === 'string' ? ({ type: event } as GameEvent) : event);
		await settle();
	}

	walk(): Promise<void> {
		return this.play((g) => {
			g.pos = { x: g.pos.x + 1, y: g.pos.y };
			g.steps += 1;
		});
	}

	/** Something a kid would miss: a new animal in the party, and in the animal book. */
	catchOne(): Promise<void> {
		return this.play((g) => {
			g.party.push({ id: `caught-${g.party.length}`, speciesId: 'rabbit', hp: 7 });
			// As the authority keeps the book: a kind caught is caught and seen, once each.
			if (!g.seen.includes('rabbit')) g.seen.push('rabbit');
			if (!g.caught.includes('rabbit')) g.caught.push('rabbit');
		}, 'party-changed');
	}
}

/** How a newer version of the game can write a save this build cannot read. */
const NEWER_KINDS = [
	'a later version',
	'a species this build does not have',
	'a battle with a species this build does not have',
	'a battle in a realm this build does not have'
] as const;

/**
 * `game` as a newer version of the game would save it, in each way it can
 * differ (`NEWER_KINDS`). The ids are ones no catalog of this build has.
 */
function newerSaves(
	game: SavedGame,
	stamp: { lineage: string; seq: number }
): [(typeof NEWER_KINDS)[number], SaveWrite][] {
	const doc = saveDocument(game, stamp);
	const later = { id: 'later-1', speciesId: 'later-species', hp: 9 };
	const battle = {
		step: game.steps,
		turn: 1,
		party: doc.party,
		active: 0,
		opponent: later,
		leashQuality: 1,
		realm: 'land',
		phase: { kind: 'choose-action' }
	};
	const saves = [
		{ ...doc, version: 3 },
		{ ...doc, party: [...doc.party, later] },
		{ ...doc, battle },
		{ ...doc, battle: { ...battle, opponent: doc.party[0], realm: 'later-realm' } }
	] as unknown as SaveWrite[];
	for (const save of saves) expect(readSave(save)).toMatchObject({ ok: false, reason: 'newer' });
	return NEWER_KINDS.map((kind, i) => [kind, saves[i]!]);
}

/** A `party-edited` with these events. */
function edited(events: Extract<GameEvent, { type: 'party-edited' }>['events']): GameEvent {
	return { type: 'party-edited', party: [], events };
}

/** Let microtasks and pending fake-server calls run. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
}

/** Run the server's timers: a push after a change goes out within this. */
async function later(ms = 16_000): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('Autosave: the save in this browser', () => {
	it('a first visit starts a new game and saves it at once; an account with no game sends it to the server', async () => {
		const guest = new MemoryStore();
		await new Tab(guest, null).open();
		expect([...guest.data.keys()]).toEqual([KEYS.save]);
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({});
		const saved = store.save()!;
		expect(saved).toMatchObject({
			version: 2,
			seq: 1,
			world: WORLD,
			home: WORLD,
			party: newGame(WORLD, testStarter()).party
		});
		expect(saved.lineage).toBeTruthy();
		await later();
		expect(server.saveOf()).toEqual(saved);
	});

	it("a reload starts from the saved game: a guest's at once, an account's after one look at the server, out of reach or not", async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const first = new Tab(store, server);
		await first.open();
		await first.walk();
		await first.catchOne();

		const calls = server.calls.length;
		const guest = new Tab(store, null);
		expect(await guest.autosave.boot()).toEqual({ game: first.game, notice: 'save.welcomeBack' });
		server.online = false;
		const again = new Tab(store, server);
		const plan = await again.autosave.boot();
		expect(server.calls.slice(calls)).toEqual(['get']);
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
		tab.autosave.handle({
			type: 'message',
			line: { key: 'battle.closing.fled', params: { animal: { speciesId: 'rabbit' } } }
		});
		await settle();
		expect(store.writes).toBe(before + 1);
		// A lead chosen, an animal moved or renamed in the pause menu is saved at once;
		// a refused edit changes nothing and writes nothing.
		tab.game.party = [...tab.game.party].reverse();
		tab.autosave.handle(edited([{ type: 'renamed', animalId: 'starter', nickname: 'Nut' }]));
		await settle();
		expect(store.writes).toBe(before + 2);
		expect(store.save()!.party).toEqual(tab.game.party);
		tab.autosave.handle(edited([{ type: 'rejected', reason: 'already-lead' }]));
		await settle();
		expect(store.writes).toBe(before + 2);
		// Tokens given or an item bought at the doctor: saved at once, mid-visit.
		tab.game.tokens = 12;
		tab.game.items = ['axe'];
		tab.autosave.handle({ type: 'belongings-changed', tokens: 12, items: ['axe'] });
		await settle();
		expect(store.writes).toBe(before + 3);
		expect(store.save()).toMatchObject({ tokens: 12, items: ['axe'] });
		// A puzzle solved in a friendly match, where nothing else changes: the count alone is saved.
		tab.game.solved = 1;
		tab.autosave.handle({ type: 'solved-changed', solved: 1 });
		await settle();
		expect(store.writes).toBe(before + 4);
		expect(store.save()).toMatchObject({ solved: 1 });
	});

	it('a field a later build added comes back in every save as it was: this build is some later one’s older build', async () => {
		// What lets a later build add to the save without a version bump ([[DECISIONS]] § Saves).
		const extra = { stars: [3, 1], note: 'from a later build' };
		const store = new MemoryStore();
		const server = new FakeServer();
		const doc = { ...saveDocument(newGame(WORLD, testStarter()), { lineage: 'L', seq: 4 }), extra };
		server.seed(doc);
		store.set(KEYS.save, JSON.stringify(doc));
		const tab = new Tab(store, server);
		await tab.open();
		await tab.walk();
		await tab.catchOne();
		tab.game.solved = 5;
		await tab.play(() => {}, { type: 'solved-changed', solved: 5 });
		expect(store.save()).toMatchObject({ extra, solved: 5 });
		expect(store.save()!.seq).toBeGreaterThan(4);
		await later();
		expect(server.saveOf()).toMatchObject({ extra, solved: 5 });
		// A reload reads it back and keeps it on.
		const again = new Tab(store, server);
		await again.open();
		await again.walk();
		expect(store.save()).toMatchObject({ extra, solved: 5 });
	});

	it('a party edit is playing, a refused one or a doctor visit alone is not', async () => {
		const broken = '{"version":1,"broken":true}';
		const store = new MemoryStore();
		store.set(KEYS.save, broken);
		const tab = new Tab(store, null);
		await tab.open();
		await tab.play(() => {}, edited([{ type: 'rejected', reason: 'already-lead' }]));
		await tab.play(() => {}, 'doctor-visit-ended');
		expect(store.get(KEYS.save)).toBe(broken);
		await tab.play(
			(g) => (g.party[0]!.nickname = 'Nut'),
			edited([{ type: 'renamed', animalId: 'starter', nickname: 'Nut' }])
		);
		expect(store.get(KEYS.unreadable)).toBe(broken);
		expect(store.save()!.party[0]!.nickname).toBe('Nut');
	});

	it('a tree chopped down is playing: saved at once, with the tiles cleared', async () => {
		const broken = '{"version":1,"broken":true}';
		const store = new MemoryStore();
		store.set(KEYS.save, broken);
		const tab = new Tab(store, null);
		await tab.open();
		const cleared: GameEvent = {
			type: 'tile-cleared',
			playerId: 'local',
			pos: { x: 3, y: -4 },
			was: 'tree',
			tool: 'axe',
			regrown: []
		};
		await tab.play((g) => (g.edits = ['0,-1:c3']), cleared);
		expect(store.get(KEYS.unreadable)).toBe(broken);
		expect(store.save()!.edits).toEqual(['0,-1:c3']);
	});

	it('a second unreadable save is kept beside the first, never over it', async () => {
		const store = new MemoryStore();
		store.set(KEYS.unreadable, 'the first one');
		store.set(KEYS.save, '{"version":1,"second":true}');
		const tab = new Tab(store, null);
		await tab.open();
		await tab.catchOne();
		expect(store.get(KEYS.unreadable)).toBe('the first one');
		expect(store.get(`${KEYS.unreadable}.2`)).toBe('{"version":1,"second":true}');
		expect(store.save()!.party).toHaveLength(2);
	});

	it('with nowhere left to keep it, an unreadable save is never written over', async () => {
		const store = new MemoryStore();
		store.set(KEYS.unreadable, 'kept 1');
		for (let n = 2; n <= 20; n++) store.set(`${KEYS.unreadable}.${n}`, `kept ${n}`);
		const broken = '{"version":1,"third":true}';
		store.set(KEYS.save, broken);
		const tab = new Tab(store, null);
		await tab.open();
		await tab.catchOne();
		await tab.walk();
		expect(store.get(KEYS.save)).toBe(broken);
		expect(store.get(KEYS.unreadable)).toBe('kept 1');
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
			realm: 'land' as const,
			phase: { kind: 'choose-action' as const }
		};
		await tab.play((g) => (g.battle = battle), 'battle-started');
		expect(store.save()!.battle).toEqual(battle);
		const plan = await new Tab(store, null).autosave.boot();
		expect(plan.game?.battle).toEqual(battle);
	});

	it("flushing on pagehide writes at once and sends the account's save with keepalive, once", async () => {
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
		expect(server.saveOf()!.steps).toBe(99);
	});

	it('a save that cannot be read is left alone until the kid plays, then kept aside', async () => {
		const store = new MemoryStore();
		// Broken for every build: an animal with less than no HP.
		const broken =
			'{"version":1,"seed":5,"pos":{"x":0,"y":0},"party":[{"id":"a","speciesId":"fox","hp":-3}]}';
		store.set(KEYS.save, broken);
		const server = new FakeServer();
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({ notice: 'save.couldNotLoad' });
		await tab.walk();
		await later();
		expect(store.get(KEYS.save)).toBe(broken);
		expect(server.saveOf()).toBeNull();

		await tab.catchOne();
		expect(store.get(KEYS.unreadable)).toBe(broken);
		expect(store.save()!.party).toHaveLength(2);
		await later();
		expect(server.saveOf()!.party).toHaveLength(2);
	});

	it('a save nested deeper than a save can be is one that cannot be read, however deep, and no crash', async () => {
		// A real save, edited by hand: a field nested far past what a walk one level at a time survives.
		const real = JSON.stringify(
			saveDocument(newGame(WORLD, testStarter()), { lineage: 'L', seq: 4 })
		);
		const deep = `${real.slice(0, -1)},"deep":${'['.repeat(100_000)}${']'.repeat(100_000)}}`;
		const store = new MemoryStore();
		store.set(KEYS.save, deep);
		const tab = new Tab(store, null);
		expect(await tab.open()).toEqual({ notice: 'save.couldNotLoad' });
		await tab.walk();
		expect(store.get(KEYS.save)).toBe(deep);
		await tab.catchOne();
		expect(store.get(KEYS.unreadable)).toBe(deep);
		expect(store.save()!.party).toHaveLength(2);
	});

	it("a newer build's save starts nothing: the page is behind it, never touches it, and the server is left alone", async () => {
		for (const [what, doc] of newerSaves(newGame(WORLD, testStarter()), {
			lineage: 'their-game',
			seq: 8
		})) {
			const store = new MemoryStore();
			const newer = JSON.stringify(doc);
			store.set(KEYS.save, newer);
			const server = new FakeServer();
			const tab = new Tab(store, server);
			// No game, no notice: the page reloads for the new version (`main.ts`), or says so.
			expect(await tab.open(), what).toEqual({});
			expect(tab.autosave.behind, what).toBe('newer');
			expect(tab.autosave.resumable(), what).toBeUndefined();
			// Whatever reaches it, nothing is written anywhere.
			await tab.startNew();
			await tab.catchOne();
			tab.autosave.onStorage(KEYS.save, newer);
			tab.autosave.recheck();
			tab.autosave.flush();
			await later(120_000);
			expect(store.get(KEYS.save), what).toBe(newer);
			for (const key of [KEYS.previous, KEYS.unreadable, KEYS.replaced, KEYS.upgraded]) {
				expect(store.get(key), `${what}: ${key}`).toBeNull();
			}
			expect(server.calls, what).toEqual([]);
		}
	});

	it('another tab on a newer version saves: this page is behind it, and never writes over it', async () => {
		for (const sameGame of [true, false]) {
			for (const [i, what] of NEWER_KINDS.entries()) {
				const store = new MemoryStore();
				const server = new FakeServer();
				const tab = new Tab(store, server);
				await tab.open();
				await tab.catchOne();
				await later();
				const mine = store.get(KEYS.save)!;
				const backedUp = server.saveOf();
				// The newer version played on from this page's save, or started a game of its own.
				const lineage = sameGame ? store.save()!.lineage : 'another-game';
				const stamp = { lineage, seq: store.save()!.seq + 5 };
				const newer = JSON.stringify(newerSaves(tab.game, stamp)[i]![1]);
				store.set(KEYS.save, newer);
				tab.autosave.onStorage(KEYS.save, newer);
				expect(tab.autosave.behind, what).toBe('newer');
				const calls = server.calls.length;
				await tab.catchOne();
				await tab.walk();
				tab.autosave.flush();
				await later(120_000);
				expect(store.get(KEYS.save), what).toBe(newer);
				// This page's last save is kept, unless the newer version played on from it.
				expect(store.get(KEYS.replaced), what).toBe(sameGame ? null : mine);
				// And nothing more goes to the server from here.
				expect(server.calls.length, what).toBe(calls);
				expect(server.saveOf(), what).toEqual(backedUp);
			}
		}
	});

	it("a newer version's save that lands just before a write (its storage event not in yet) is never written over or moved", async () => {
		for (const [what, doc] of newerSaves(newGame(WORLD, testStarter()), {
			lineage: 'their-game',
			seq: 90
		})) {
			const newer = JSON.stringify(doc);
			// A kid picking a starter on the title: the new game would put the key's save away.
			const titleStore = new MemoryStore();
			const onTitle = new Tab(titleStore, null);
			await onTitle.title();
			titleStore.set(KEYS.save, newer);
			await onTitle.startNew();
			expect(onTitle.autosave.behind, what).toBe('newer');
			expect(titleStore.get(KEYS.save), what).toBe(newer);
			expect(titleStore.get(KEYS.previous), what).toBeNull();
			// A page holding an unreadable save: playing would set the key's save aside.
			const heldStore = new MemoryStore();
			heldStore.set(KEYS.save, '{"version":2,"broken":true}');
			const holding = new Tab(heldStore, null);
			await holding.open();
			heldStore.set(KEYS.save, newer);
			await holding.catchOne();
			expect(holding.autosave.behind, what).toBe('newer');
			expect(heldStore.get(KEYS.save), what).toBe(newer);
			expect(heldStore.get(KEYS.unreadable), what).toBeNull();
			// A page playing on: its next save would go over it.
			const playStore = new MemoryStore();
			const playing = new Tab(playStore, null);
			await playing.open();
			playStore.set(KEYS.save, newer);
			await playing.walk();
			expect(playing.autosave.behind, what).toBe('newer');
			expect(playStore.get(KEYS.save), what).toBe(newer);
		}
	});

	it("an older build's save plays on upgraded, and its text is kept as it was before the first write takes the key", async () => {
		const store = new MemoryStore();
		// A save the build before numbered worlds wrote: version 1, the world by its seed.
		const old = JSON.stringify({
			version: 1,
			seed: WORLD_ONE_SEED,
			pos: { x: -2, y: 6 },
			facing: 'left',
			steps: 5957,
			visits: 34,
			party: [{ id: 'nini', speciesId: 'rabbit', nickname: 'nini', hp: 22 }],
			tokens: 9,
			items: ['axe', 'boat'],
			edits: ['0,0:11'],
			lineage: 'kids-real-game',
			seq: 19549
		});
		store.set(KEYS.save, old);
		const server = new FakeServer();
		const tab = new Tab(store, server);
		const plan = await tab.open();
		expect(plan.notice).toBe('save.welcomeBack');
		expect(plan.game).toMatchObject({ world: 1, home: 1, name: null, steps: 5957, tokens: 9 });
		// Nothing written yet: the key still holds the old text, and nothing is kept aside.
		expect(store.get(KEYS.save)).toBe(old);
		expect(store.get(KEYS.upgraded)).toBeNull();
		await tab.walk();
		expect(store.get(KEYS.upgraded)).toBe(old);
		expect(store.save()).toMatchObject({
			version: 2,
			world: 1,
			home: 1,
			lineage: 'kids-real-game',
			seq: 19550,
			tokens: 9,
			items: ['axe', 'boat'],
			edits: ['0,0:11']
		});
		// Kept once: later saves are this build's own.
		await tab.walk();
		await tab.catchOne();
		expect(store.get(`${KEYS.upgraded}.2`)).toBeNull();
		await later();
		expect(server.saveOf()).toMatchObject({ version: 2, seq: 19552 });
	});

	it("an older build's save is kept beside one kept before, and with nowhere left to keep it, the game saves all the same", async () => {
		const old = JSON.stringify({
			version: 1,
			seed: WORLD_ONE_SEED,
			pos: { x: -2, y: 6 },
			party: []
		});
		const beside = new MemoryStore();
		beside.set(KEYS.upgraded, 'kept before');
		beside.set(KEYS.save, old);
		const tab = new Tab(beside, null);
		await tab.open();
		await tab.walk();
		expect(beside.get(KEYS.upgraded)).toBe('kept before');
		expect(beside.get(`${KEYS.upgraded}.2`)).toBe(old);

		const full = new MemoryStore();
		full.set(KEYS.upgraded, 'kept 1');
		for (let n = 2; n <= 20; n++) full.set(`${KEYS.upgraded}.${n}`, `kept ${n}`);
		full.set(KEYS.save, old);
		const stuck = new Tab(full, null);
		await stuck.open();
		await stuck.catchOne();
		expect(full.save()).toMatchObject({ version: 2, world: 1 });
		// The starter the empty v1 party was given, and the one caught.
		expect(full.save()!.party).toHaveLength(2);
		expect(full.get(KEYS.upgraded)).toBe('kept 1');
		expect(full.get(`${KEYS.upgraded}.20`)).toBe('kept 20');
		expect(stuck.autosave.titleNotice).toBeNull();

		// Storage too full for a second copy, room for the save itself: the save goes on.
		class NoRoomAside extends MemoryStore {
			override set(key: string, value: string): boolean {
				return key.startsWith(KEYS.upgraded) ? false : super.set(key, value);
			}
		}
		const tight = new NoRoomAside();
		tight.set(KEYS.save, old);
		const cramped = new Tab(tight, null);
		await cramped.open();
		await cramped.catchOne();
		await cramped.walk();
		expect(tight.save()).toMatchObject({ version: 2, world: 1, seq: 2, steps: 1 });
		expect(tight.get(KEYS.upgraded)).toBeNull();
		expect(cramped.autosave.titleNotice).toBeNull();
		// And a reload carries on from it, not from the older save.
		const again = new Tab(tight, null);
		expect((await again.open()).game).toMatchObject({ steps: 1 });
	});

	it('going to another world and choosing a name are playing: saved at once', async () => {
		const broken = '{"version":1,"broken":true}';
		for (const event of [
			{
				type: 'travelled',
				playerId: 'local',
				world: 42,
				seed: 1,
				pos: { x: 0, y: 0 },
				facing: 'down',
				edits: [],
				firstVisit: true
			},
			{ type: 'name-chosen', playerId: 'local', name: 'Nini' }
		] as GameEvent[]) {
			const store = new MemoryStore();
			store.set(KEYS.save, broken);
			const tab = new Tab(store, null);
			await tab.open();
			await tab.play((g) => {
				g.world = 42;
				g.name = 'Nini';
			}, event);
			expect(store.get(KEYS.unreadable), event.type).toBe(broken);
			expect(store.save(), event.type).toMatchObject({ world: 42, name: 'Nini' });
		}
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

	it("when storage stops taking writes, the game goes on and the account's save still goes out", async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		store.failWrites = true;
		await tab.catchOne();
		await later();
		expect(server.saveOf()!.party).toHaveLength(2);
		// The next start finds the server ahead of this browser, and takes the server's game.
		store.failWrites = false;
		const next = new Tab(store, server);
		await next.open();
		await later();
		expect(next.autosave.behind).toBe('replaced');
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
		expect(b.autosave.behind).toBe('window');
		const saved = store.get(KEYS.save);
		await b.walk();
		b.autosave.flush();
		expect(store.get(KEYS.save)).toBe(saved);
	});

	it('so does one that falls behind a tree chopped down in the other: it is progress, not a walk', async () => {
		const { store, a, b } = await twoTabs();
		await a.play((g) => (g.edits = ['0,0:11']), {
			type: 'tile-cleared',
			playerId: 'local',
			pos: { x: 1, y: 1 },
			was: 'tree',
			tool: 'axe',
			regrown: []
		});
		b.autosave.onStorage(KEYS.save);
		expect(b.autosave.behind).toBe('window');
		expect(store.save()!.edits).toEqual(['0,0:11']);
	});

	it('the same, found at write time when no storage event came', async () => {
		const { store, a, b } = await twoTabs();
		await a.catchOne();
		const saved = store.get(KEYS.save);
		await b.walk();
		expect(b.autosave.behind).toBe('window');
		expect(store.get(KEYS.save)).toBe(saved);
	});

	it('when the other tab only walked, this tab carries on from its save and writes on top', async () => {
		const { store, a, b } = await twoTabs();
		await a.walk();
		await a.walk();
		const theirs = store.save()!;
		b.autosave.onStorage(KEYS.save);
		expect(b.autosave.behind).toBeNull();
		await b.catchOne();
		const mine = store.save()!;
		expect(mine.seq).toBe(theirs.seq + 1);
		expect(mine.lineage).toBe(theirs.lineage);
		expect(mine.party).toHaveLength(2);
		// And now the first tab is the one behind.
		await a.walk();
		expect(a.autosave.behind).toBe('window');
		expect(store.save()).toEqual(mine);
	});

	it('carrying on from a tab that walked further takes its step and visit counts too', async () => {
		const { store, a, b } = await twoTabs();
		for (let i = 0; i < 30; i++) await b.walk();
		await b.play((g) => (g.visits += 1), 'doctor-visit-ended');
		const theirs = store.save()!;
		await a.walk();
		const mine = store.save()!;
		expect(a.autosave.behind).toBeNull();
		expect(mine.steps).toBeGreaterThanOrEqual(theirs.steps);
		expect(mine.visits).toBe(theirs.visits);
		// A storage event does the same before this tab's next save.
		b.game.steps += 5;
		await b.walk();
		a.autosave.onStorage(KEYS.save);
		expect(a.game.steps).toBe(store.save()!.steps);
	});

	it('a storage event that arrives after this tab already saved on top of it changes nothing', async () => {
		const { store, a, b } = await twoTabs();
		await b.walk();
		// A saves next: B only walked, so A carries on from B's save and writes a catch on top.
		await a.catchOne();
		expect(store.save()!.party).toHaveLength(2);
		// Only now does A hear about B's walk: late, and already built on.
		a.autosave.onStorage(KEYS.save);
		expect(a.autosave.behind).toBeNull();
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
			realm: 'land' as const,
			phase: { kind: 'choose-action' as const }
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
		expect(a.autosave.behind).toBeNull();
	});

	it('two tabs writing in the same instant: the save that lost is kept aside, never gone', async () => {
		const store = new MemoryStore();
		const a = new Tab(store, null);
		await a.open();
		await a.walk();
		const view = new LaggingView(store);
		const b = new Tab(view, null);
		await b.open();
		// B's view of the save has not caught up with A's catch when B saves its step.
		view.freeze(KEYS.save);
		await a.catchOne();
		const caught = store.get(KEYS.save)!;
		await b.walk();
		expect(store.get(KEYS.save)).not.toBe(caught);
		view.thaw();
		a.autosave.onStorage(KEYS.save);
		expect(a.autosave.behind).toBe('window');
		expect(store.get(KEYS.replaced)).toBe(caught);
	});

	it('the same, when the other tab saved again before this one heard of it: the event shows it', async () => {
		const store = new MemoryStore();
		const a = new Tab(store, null);
		await a.open();
		await a.walk();
		const view = new LaggingView(store);
		const b = new Tab(view, null);
		await b.open();
		view.freeze(KEYS.save);
		await a.catchOne();
		const caught = store.get(KEYS.save)!;
		await b.walk();
		const over = store.get(KEYS.save)!;
		await b.walk();
		view.thaw();
		// A hears the first of B's saves only now, with the key already at B's second.
		a.autosave.onStorage(KEYS.save, over);
		a.autosave.onStorage(KEYS.save, store.get(KEYS.save));
		expect(a.autosave.behind).toBe('window');
		expect(store.get(KEYS.replaced)).toBe(caught);
	});

	it('a tab that played on from this one’s save puts it behind, and nothing is kept aside', async () => {
		const store = new MemoryStore();
		const a = new Tab(store, null);
		const b = new Tab(store, null);
		await a.open();
		await b.open();
		await a.walk();
		b.autosave.onStorage(KEYS.save, store.get(KEYS.save));
		expect(b.autosave.behind).toBeNull();
		await b.catchOne();
		a.autosave.onStorage(KEYS.save, store.get(KEYS.save));
		expect(a.autosave.behind).toBe('window');
		expect(store.get(KEYS.replaced)).toBeNull();
	});

	it('a save removed from under the page (site data cleared) is not written back', async () => {
		const { store, a } = await twoTabs();
		store.remove(KEYS.save);
		await a.walk();
		a.autosave.flush();
		expect(store.get(KEYS.save)).toBeNull();
		expect(a.autosave.behind).toBe('gone');
	});

	it('the same, found by the storage event', async () => {
		const { store, a } = await twoTabs();
		store.remove(KEYS.save);
		a.autosave.onStorage(KEYS.save);
		expect(a.autosave.behind).toBe('gone');
		await a.walk();
		a.autosave.flush();
		expect(store.get(KEYS.save)).toBeNull();
	});

	it('this game played on elsewhere puts a tab behind another window; another game in its place does not', async () => {
		for (const lineage of ['same', 'other'] as const) {
			const { store, a, b } = await twoTabs();
			const current = store.save()!;
			const theirs = {
				...current,
				lineage: lineage === 'same' ? current.lineage : 'from-server',
				seq: current.seq + 5,
				party: [...current.party, { id: 'fox', speciesId: 'fox', hp: 9 }]
			};
			store.set(KEYS.save, JSON.stringify(theirs));
			const cause = lineage === 'same' ? 'window' : 'replaced';
			a.autosave.onStorage(KEYS.save);
			expect(a.autosave.behind).toBe(cause);
			// Found at write time, the same.
			await b.catchOne();
			expect(b.autosave.behind).toBe(cause);
			expect(store.get(KEYS.save)).toBe(JSON.stringify(theirs));
		}
	});

	it('a tab that missed the storage event finds out when it checks again', async () => {
		const { a, b } = await twoTabs();
		await a.catchOne();
		b.autosave.recheck();
		expect(b.autosave.behind).toBe('window');
	});
});

describe('Autosave: two tabs, each with the real authority', () => {
	/**
	 * One page as `main.ts` wires it: the authority's events go to the
	 * autosave, and the autosave carries the authority's counts on (#58).
	 * Storage events are handed over by the test, so it decides when a tab
	 * hears of the other's saves.
	 */
	class Page {
		authority = new LocalAuthority();
		events: GameEvent[] = [];
		autosave: Autosave;
		constructor(store: MemoryStore) {
			this.autosave = new Autosave({
				store,
				server: null,
				snapshot: () => this.authority.snapshot(),
				catchUp: (counts) => this.authority.catchUp(counts),
				mintId
			});
			this.authority.subscribe((e) => {
				this.events.push(e);
				this.autosave.handle(e);
			});
		}
		async continue(): Promise<void> {
			const plan = await this.autosave.boot();
			this.authority.start({ game: this.autosave.resumable() ?? plan.game });
			this.autosave.begin();
		}
		async act(intent: Intent): Promise<GameEvent[]> {
			const from = this.events.length;
			this.authority.dispatch(intent);
			await settle();
			return this.events.slice(from);
		}
	}

	function savedAt(store: MemoryStore, game: Partial<SavedGame>): void {
		const base = newGame(WORLD, testStarter());
		store.set(
			KEYS.save,
			JSON.stringify(saveDocument({ ...base, ...game }, { lineage: 'kid-game', seq: 1 }))
		);
	}
	const savedCounts = (store: MemoryStore) => {
		const save = store.save()!;
		return { steps: save.steps, visits: save.visits };
	};
	function readSaveOrThrow(save: SaveWrite) {
		const read = readSave(JSON.parse(JSON.stringify(save)));
		if (!read.ok) throw new Error(read.error);
		return read.save;
	}
	function latestBattle(events: GameEvent[]): BattleState {
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i]!;
			if (e.type === 'battle-updated' || e.type === 'battle-started') return e.state;
		}
		throw new Error('no battle');
	}
	/** What a kid does next in a battle: the first attack, easy, answered wrong; or send in who stands. */
	function battleStep(state: BattleState): Intent {
		if (state.phase.kind === 'choose-animal') {
			const partyIndex = state.party.findIndex((a) => a.hp > 0);
			return { type: 'battle', intent: { type: 'switch', partyIndex } };
		}
		if (state.phase.kind === 'solving') {
			const input = String(state.phase.puzzle.answer + 1);
			return { type: 'battle', intent: { type: 'answer', input } };
		}
		return { type: 'battle', intent: { type: 'attack', attackIndex: 1, level: 1 } };
	}

	it('a flight is saved as a walk is: in the air as the landing it would make, and down where it came down', async () => {
		const store = new MemoryStore();
		// At the start, facing the lake north of it, with the glider.
		savedAt(store, { pos: { x: -2, y: 6 }, facing: 'up', items: ['glider'] });
		const page = new Page(store);
		await page.continue();
		const writes = store.writes;
		// Up in the air: saved at once, as letting go would leave the game, on the far shore.
		await page.act({ type: 'take-off' });
		expect(store.writes).toBeGreaterThan(writes);
		expect(store.save()).toMatchObject({ pos: { x: -2, y: -8 }, steps: 14 });
		await page.act({ type: 'glide' });
		expect(store.save()).toMatchObject({ pos: { x: -2, y: -8 }, steps: 14 });
		// Down, with no step after it: the landing is saved, and a reload finds the kid there.
		await page.act({ type: 'land' });
		expect(store.save()).toMatchObject({ pos: { x: -2, y: -8 }, facing: 'up', steps: 14 });
		const reload = new Page(store);
		await reload.continue();
		expect(reload.authority.snapshot()).toMatchObject({ pos: { x: -2, y: -8 }, steps: 14 });
	});

	it('a tab at the doctor carries the other tab’s walk on: the counts never go back (#58)', async () => {
		const store = new MemoryStore();
		// One step above the tent at (5, 7), facing it.
		savedAt(store, { pos: { x: 5, y: 6 }, facing: 'down', steps: 10 });
		const a = new Page(store);
		const b = new Page(store);
		await a.continue();
		await b.continue();
		expect((await a.act({ type: 'interact' })).map((e) => e.type)).toContain(
			'doctor-visit-started'
		);
		b.autosave.onStorage(KEYS.save);
		for (const dir of ['left', 'right', 'left', 'right', 'left', 'right'] as const) {
			await b.act({ type: 'move', dir });
			a.autosave.onStorage(KEYS.save);
		}
		const walked = savedCounts(store);
		expect(walked.steps).toBe(16);
		expect(a.autosave.behind).toBeNull();
		await a.act({ type: 'doctor', intent: { type: 'leave' } });
		await a.act({ type: 'move', dir: 'left' });
		const after = savedCounts(store);
		expect(after.steps).toBe(17);
		expect(after.visits).toBeGreaterThanOrEqual(walked.visits);
	});

	it('a battle that starts before the tab hears of the other’s walk is keyed on the walk, as its save is (#58)', async () => {
		// A game on the spawn tile from which one step left, onto the reed, meets an animal.
		let steps = 0;
		for (; steps < 2000; steps++) {
			const probe = new LocalAuthority();
			const seen: GameEvent[] = [];
			probe.subscribe((e) => seen.push(e));
			probe.start({ game: { ...newGame(WORLD, testStarter()), steps } });
			probe.dispatch({ type: 'move', dir: 'left' });
			if (seen.some((e) => e.type === 'battle-started')) break;
		}
		const store = new MemoryStore();
		savedAt(store, { steps });
		const a = new Page(store);
		const b = new Page(store);
		await a.continue();
		await b.continue();
		// B walks on the grass to the right and back; A hears nothing of it yet.
		for (const dir of ['right', 'left', 'right', 'left'] as const)
			await b.act({ type: 'move', dir });
		const walked = savedCounts(store).steps;
		expect(walked).toBe(steps + 4);
		const started = await a.act({ type: 'move', dir: 'left' });
		expect(started.map((e) => e.type)).toContain('battle-started');
		expect(a.autosave.behind).toBeNull();
		const save = store.save()!;
		expect(save.steps).toBeGreaterThanOrEqual(walked);
		expect(save.battle).not.toBeNull();
		// A page picked up from that save plays the battle on exactly as A does.
		const c = new Page(new MemoryStore());
		c.authority.start({ game: restoreGame(readSaveOrThrow(save), mint) });
		for (let i = 0; i < 6; i++) {
			const state = latestBattle(a.events);
			if (state.phase.kind === 'ended') break;
			const intent = battleStep(state);
			await a.act(intent);
			c.authority.dispatch(intent);
			expect(latestBattle(c.events)).toEqual(latestBattle(a.events));
		}
	});
});

describe("Autosave: an account's save on the server", () => {
	it("with no save of the account's game here, start waits briefly for the server and takes its game", async () => {
		const server = new FakeServer();
		const theirs = {
			...saveDocument(newGame(WORLD, testStarter()), { lineage: 'from-server', seq: 40 }),
			steps: 55
		};
		theirs.party = [...theirs.party, { id: 'fox', speciesId: 'fox', hp: 9 }];
		server.seed(theirs);
		const store = new MemoryStore();
		const tab = new Tab(store, server);
		const plan = await tab.open();
		expect(plan.notice).toBe('save.welcomeBack');
		expect(plan.game?.party).toHaveLength(2);
		expect(store.save()).toMatchObject({ lineage: 'from-server', seq: 41, steps: 55 });
	});

	it('an unknown server game at start (offline) is found later; the bigger game wins and this tab reloads', async () => {
		const server = new FakeServer();
		const theirs = {
			...saveDocument(newGame(WORLD, testStarter()), { lineage: 'from-server', seq: 40 }),
			steps: 55
		};
		server.seed(theirs);
		const store = new MemoryStore();
		server.online = false;
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({});
		await tab.walk();
		const fresh = store.get(KEYS.save);
		expect(server.saveOf()).toEqual(theirs);

		server.online = true;
		await later(10_000);
		expect(tab.autosave.behind).toBe('replaced');
		expect(store.save()).toMatchObject({ lineage: 'from-server', seq: 40 });
		expect(store.get(KEYS.replaced)).toBe(fresh);
		expect(server.saveOf()).toEqual(theirs);
	});

	it("a server's copy behind this browser is brought up to date; one of the same seq is left alone", async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		server.online = false;
		await tab.walk();
		await tab.catchOne();
		server.online = true;
		const next = new Tab(store, server);
		await next.open();
		await later();
		expect(server.saveOf()).toEqual(store.save());
		expect(next.autosave.behind).toBeNull();
		const puts = server.calls.filter((c) => c === 'put').length;
		const third = new Tab(store, server);
		await third.open();
		await later();
		expect(server.calls.filter((c) => c === 'put').length).toBe(puts);
	});

	it('an unreadable save on the server is never adopted, and saved past once the kid plays', async () => {
		const server = new FakeServer();
		const unreadable = { version: 1, seq: 500, party: 'not a party' };
		server.seed(unreadable);
		const store = new MemoryStore();
		const tab = new Tab(store, server);
		await tab.open();
		const next = new Tab(store, server);
		await next.open();
		await next.walk();
		await later();
		expect(next.autosave.behind).toBeNull();
		expect(server.saveOf()).toEqual(unreadable);
		await next.catchOne();
		await later();
		expect(server.saveOf()!.seq).toBeGreaterThan(500);
		expect(store.save()!.seq).toBe(server.saveOf()!.seq);
	});

	it("with no save here, an unreadable server's copy gives a new game that says so and waits for play", async () => {
		const server = new FakeServer();
		const unreadable = { version: 1, seq: 70, party: [{ id: 'a', speciesId: 'dragon', hp: 3 }] };
		server.seed(unreadable);
		const store = new MemoryStore();
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({ notice: 'save.couldNotLoad' });
		expect(store.save()!.seq).toBeGreaterThan(70);
		await tab.walk();
		await later();
		expect(server.saveOf()).toEqual(unreadable);
		await tab.catchOne();
		await later();
		expect(server.saveOf()).toEqual(store.save());
	});

	it("with no save here (or an unreadable one), a newer build's save on the server starts nothing: the page is behind it, and never sends", async () => {
		for (const local of [null, '{"version":2,"broken":true}']) {
			for (const [what, newer] of newerSaves(newGame(WORLD, testStarter()), {
				lineage: 'their-game',
				seq: 9
			})) {
				const server = new FakeServer();
				server.seed(newer);
				const store = new MemoryStore();
				if (local !== null) store.set(KEYS.save, local);
				const tab = new Tab(store, server);
				expect(await tab.open(), what).toEqual({});
				expect(tab.autosave.behind, what).toBe('newer');
				await tab.startNew();
				await tab.catchOne();
				tab.autosave.flush();
				await later(60_000);
				expect(server.saveOf(), what).toEqual(newer);
				expect(server.calls, what).toEqual(['get']);
				// Nothing is written here either: an unreadable save stays where it was.
				expect(store.get(KEYS.save), what).toBe(local);
				expect(store.get(KEYS.unreadable), what).toBeNull();
			}
		}
	});

	it('a server save from before seq and lineage never sends the page round a reload loop', async () => {
		const server = new FakeServer();
		const legacy = { version: 1, seed: WORLD_ONE_SEED, pos: { x: -2, y: 6 }, party: [] };
		server.seed(legacy);
		const store = new MemoryStore();
		store.set(KEYS.save, '{"version":1,"broken":true}');
		server.online = false;
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({ notice: 'save.couldNotLoad' });
		server.online = true;
		await later(10_000);
		expect(tab.autosave.behind).toBeNull();
		// The kid plays the new game, and it is backed up over the old one.
		await tab.catchOne();
		await later();
		expect(server.saveOf()).toEqual(store.save());
		// And a reload settles, with nothing to adopt.
		const again = new Tab(store, server);
		await again.open();
		await later();
		expect(again.autosave.behind).toBeNull();
	});

	it('a game adopted from the server never overwrites a game already kept aside', async () => {
		const server = new FakeServer();
		const theirs = {
			...saveDocument(newGame(WORLD, testStarter()), { lineage: 'from-server', seq: 40 })
		};
		server.seed(theirs);
		const store = new MemoryStore();
		store.set(KEYS.replaced, 'an earlier game');
		server.online = false;
		const tab = new Tab(store, server);
		await tab.open();
		await tab.walk();
		const fresh = store.get(KEYS.save);
		server.online = true;
		await later(10_000);
		expect(tab.autosave.behind).toBe('replaced');
		expect(store.get(KEYS.replaced)).toBe('an earlier game');
		expect(store.get(`${KEYS.replaced}.2`)).toBe(fresh);
	});

	it("a newer build's save on the server is never overwritten: the page that finds it is behind it, and plays no further", async () => {
		for (const [what, newer] of newerSaves(newGame(WORLD, testStarter()), {
			lineage: 'their-game',
			seq: 3
		})) {
			const server = new FakeServer();
			server.seed(newer);
			const store = new MemoryStore();
			// A game saved here, and the server's copy of this player's game is a newer build's.
			await new Tab(store, null).open();
			const tab = new Tab(store, server);
			await tab.open();
			await later(20_000);
			// Found when the page first compares with the server, before anything is sent.
			expect(tab.autosave.behind, what).toBe('newer');
			const mine = store.get(KEYS.save);
			for (let i = 0; i < 5; i++) await tab.walk();
			await tab.catchOne();
			tab.autosave.flush();
			await later(20_000);
			expect(server.saveOf(), what).toEqual(newer);
			expect(
				server.calls.filter((c) => c === 'put'),
				what
			).toEqual([]);
			// Nor does the game here play on past it: the save here is as the page found it.
			expect(store.get(KEYS.save), what).toBe(mine);
		}
	});

	it("a newer build's save that reaches the server while a page plays puts that page behind at its next send", async () => {
		const server = new FakeServer();
		const store = new MemoryStore();
		const tab = new Tab(store, server);
		await tab.open();
		await tab.catchOne();
		await later();
		// Another device, on the new version, played the game on: the server holds its save.
		const newer = newerSaves(tab.game, { lineage: store.save()!.lineage, seq: 40 })[1]![1];
		server.save = newer;
		await tab.catchOne();
		await later();
		expect(tab.autosave.behind).toBe('newer');
		expect(server.saveOf()).toEqual(newer);
		const puts = server.calls.filter((c) => c === 'put').length;
		await tab.catchOne();
		tab.autosave.flush();
		await later(60_000);
		expect(server.calls.filter((c) => c === 'put').length).toBe(puts);
		expect(server.saveOf()).toEqual(newer);
	});

	it('a server that turns a save away for no reason its seq explains is asked again only as one out of reach is, and takes it once it can', async () => {
		// A server older than the save it holds (a deploy half done, or a rollback) turns
		// every backup away as a conflict, whatever its number: it will not replace a save
		// it cannot read, which this page, on the newer version, reads.
		const server = new FakeServer();
		const store = new MemoryStore();
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		expect(server.saveOf()!.seq).toBe(1);
		server.conflictAlways = true;
		const asked = server.calls.length;
		await tab.catchOne();
		// Ten minutes with no play: a backup and a look at what the server holds, then again
		// after 2, 4, 8, 16 and 32 s, and then rest; never a loop of the two.
		await later(10 * 60_000);
		expect(server.calls.slice(asked)).toEqual(
			Array.from({ length: 6 }, () => ['put', 'get']).flat()
		);
		expect(tab.autosave.behind).toBeNull();
		// The game saves here all the while, and goes up at the next catch once the server takes it.
		server.conflictAlways = false;
		await tab.catchOne();
		await later();
		expect(store.save()!.party).toHaveLength(3);
		expect(server.saveOf()).toEqual(store.save());
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
		// One look as the page starts, then a try and at most five more, 2 s to 32 s apart.
		expect(tries).toBeLessThanOrEqual(7);
		// Resting: walking costs the server nothing, and the game saves here all the same.
		for (let i = 0; i < 10; i++) await tab.walk();
		await later(10 * 60_000);
		expect(server.calls.length).toBe(tries);
		expect(store.save()!.steps).toBe(10);
		// A catch tries once more; still down, so it rests again.
		await tab.catchOne();
		await later(10 * 60_000);
		expect(server.calls.length).toBe(tries + 1);
		// The server is back: the next catch sends the game.
		server.online = true;
		await tab.catchOne();
		await later();
		expect(server.saveOf()).toEqual(store.save());
		expect(server.saveOf()!.party).toHaveLength(3);
		expect(errors).not.toHaveBeenCalled();
	});

	it('a save that failed to reach a restarting server goes out once it is back', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		server.online = false;
		await tab.catchOne();
		await later(3000);
		server.online = true;
		await later(10_000);
		expect(server.saveOf()).toEqual(store.save());
	});

	it('a save the server refuses is reported once to developers and not sent again', async () => {
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

	it('a tab taking the server’s game in the same instant another tab saves a catch: the catch is kept aside', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const theirs = {
			...saveDocument(newGame(WORLD, testStarter()), { lineage: 'from-server', seq: 40 })
		};
		server.seed(theirs);
		const first = new Tab(store, null);
		await first.open();
		await first.walk();
		const a = new Tab(store, null);
		await a.open();
		// B starts cut off from the server; its view of the save lags A's next save.
		server.online = false;
		const view = new LaggingView(store);
		const b = new Tab(view, server);
		await b.open();
		view.freeze(KEYS.save);
		await a.catchOne();
		const caught = store.get(KEYS.save)!;
		server.online = true;
		await later(5_000);
		expect(b.autosave.behind).toBe('replaced');
		expect(store.save()!.lineage).toBe('from-server');
		view.thaw();
		a.autosave.onStorage(KEYS.save);
		expect(a.autosave.behind).toBe('replaced');
		const kept = [KEYS.replaced, `${KEYS.replaced}.2`].map((k) => store.get(k));
		expect(kept).toContain(caught);
	});

	it("a server answer that comes before another tab's storage event does not put this tab behind a walk", async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const first = new Tab(store, server);
		await first.open();
		await first.catchOne();
		await later();
		// This tab starts while the server is out of reach: its first check waits for a retry.
		server.online = false;
		const tab = new Tab(store, server);
		await tab.open();
		// Another tab (no server of its own here) walks on, and its backup lands first.
		const other = new Tab(store, null);
		await other.open();
		await other.walk();
		server.save = JSON.parse(store.get(KEYS.save)!);
		const walked = store.get(KEYS.save);
		// The server answers this tab before the other tab's storage event reaches it.
		server.online = true;
		await later(5_000);
		expect(tab.autosave.behind).toBeNull();
		expect(store.get(KEYS.replaced)).toBeNull();
		expect(store.get(KEYS.save)).toBe(walked);
		// It carried on from the walk: its next save goes on top.
		await tab.catchOne();
		expect(store.save()!.seq).toBe(JSON.parse(walked!).seq + 1);
	});

	it('a 409 for a save that already landed (its answer was lost) settles without a reload', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.open();
		await later();
		await tab.catchOne();
		// The server stored the save, but the page never heard back.
		server.save = JSON.parse(store.get(KEYS.save)!);
		await later();
		expect(tab.autosave.behind).toBeNull();
		expect(readSave(server.saveOf()).ok).toBe(true);
		await tab.walk();
		await later();
		expect(server.saveOf()).toEqual(store.save());
	});
});

describe('Autosave: the title', () => {
	it('every title a page opens says whether it keeps the game, Start screen’s too (#61)', async () => {
		const says = (tab: Tab) => [tab.autosave.titleNotice, tab.autosave.keeps];
		// No storage: every title says this browser cannot keep the game.
		const blocked = new Tab(null, null);
		await blocked.title();
		expect(says(blocked)).toEqual(['save.cannotSave', false]);
		await blocked.startNew();
		await blocked.quit();
		expect(says(blocked)).toEqual(['save.cannotSave', false]);
		// (A newer build's save, here or on the server, opens no title: the page is behind it.)
		// Writing failed (storage full): from then on every title says so, and nothing is put away.
		const full = new MemoryStore();
		const filling = new Tab(full, null);
		await filling.title();
		await filling.startNew();
		full.failWrites = true;
		await filling.catchOne();
		await filling.quit();
		expect(says(filling)).toEqual(['save.storageFull', false]);
		// A throwaway game keeps nothing, and says nothing about it.
		const throwaway = new Tab(new MemoryStore(), null, { throwaway: true });
		await throwaway.open();
		expect(says(throwaway)).toEqual([null, false]);
		// A page that saves keeps its game, and needs no line.
		const saving = new Tab(new MemoryStore(), null);
		await saving.title();
		await saving.startNew();
		await saving.quit();
		expect(says(saving)).toEqual([null, true]);
	});

	/** A saved game with progress in it, as this browser holds it: `seq` 5, a caught fox. */
	function savedGame(store: MemoryStore, lineage = 'old-game'): string {
		const game = newGame(WORLD, testStarter());
		game.party.push({ id: 'fox-1', speciesId: 'fox', nickname: 'Rusty', hp: 9 });
		// As the game writes it (`saveDocument`): no battle, no `battle` key.
		const text = JSON.stringify(saveDocument(game, { lineage, seq: 5 }));
		store.set(KEYS.save, text);
		return text;
	}

	it('nothing is written or sent while the title is up, with a save or without one', async () => {
		for (const withSave of [true, false]) {
			const store = new MemoryStore();
			const server = new FakeServer();
			if (withSave) savedGame(store);
			const writes = store.writes;
			const tab = new Tab(store, server);
			const plan = await tab.title();
			expect(plan.game !== undefined).toBe(withSave);
			await later(60_000);
			expect(store.writes).toBe(writes);
			// An account's page looks at the server once as it starts, and sends nothing.
			expect(server.calls).toEqual(['get']);
			// Events without a game under way change nothing either.
			tab.autosave.handle({ type: 'player-moved' } as GameEvent);
			await later();
			expect(store.writes).toBe(writes);
		}
	});

	it('a first visit saves nothing until a starter is picked, then saves that game at once', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		expect(await tab.title()).toEqual({});
		expect(store.save()).toBeNull();
		await tab.startNew('rabbit');
		expect(store.save()).toMatchObject({ seq: 1, party: [{ speciesId: 'rabbit', hp: 22 }] });
		expect(store.get(KEYS.previous)).toBeNull();
		await later();
		expect(server.saveOf()).toEqual(store.save());
	});

	it('a new game over a saved one keeps the old save aside, never over it, and numbers past it', async () => {
		const store = new MemoryStore();
		const old = savedGame(store);
		const tab = new Tab(store, null);
		const plan = await tab.title();
		expect(plan.game?.party).toHaveLength(2);
		await tab.startNew('rabbit');
		const now = store.save()!;
		expect(now.party).toEqual([{ id: expect.any(String), speciesId: 'rabbit', hp: 22 }]);
		expect(now.lineage).not.toBe('old-game');
		expect(now.seq).toBe(6);
		// Byte for byte, in the first free slot.
		expect(store.get(KEYS.previous)).toBe(old);

		// A second new game: the first new game goes beside the old one, not over it.
		await tab.quit();
		const first = store.get(KEYS.save);
		await tab.startNew('squirrel');
		expect(store.get(KEYS.previous)).toBe(old);
		expect(store.get(`${KEYS.previous}.2`)).toBe(first);
		expect(store.save()).toMatchObject({ seq: 7, party: [{ speciesId: 'squirrel' }] });
	});

	it('a kid trying the starters one after another keeps every game they left', async () => {
		const store = new MemoryStore();
		const tab = new Tab(store, null);
		await tab.title();
		const left: string[] = [];
		for (let n = 0; n < 30; n++) {
			await tab.startNew(n % 2 === 0 ? 'rabbit' : 'squirrel');
			await tab.quit();
			left.push(store.get(KEYS.save)!);
		}
		await tab.startNew('squirrel');
		await tab.catchOne();
		expect(store.save()!.party).toHaveLength(2);
		const kept = left.map((_, i) =>
			store.get(i === 0 ? KEYS.previous : `${KEYS.previous}.${i + 1}`)
		);
		expect(kept).toEqual(left);
	});

	it('with nowhere left to keep the old save, a new game never writes over it', async () => {
		const store = new MemoryStore();
		const old = savedGame(store);
		for (let n = 1; n <= 200; n++) {
			store.set(n === 1 ? KEYS.previous : `${KEYS.previous}.${n}`, `kept ${n}`);
		}
		const tab = new Tab(store, null);
		await tab.title();
		await tab.startNew('rabbit');
		await tab.walk();
		expect(store.get(KEYS.save)).toBe(old);
		expect(store.get(`${KEYS.previous}.200`)).toBe('kept 200');
	});

	it('a new game started while the server was out of reach never puts away a game the title did not show', async () => {
		const server = new FakeServer();
		// The kid's real game is on the server; this browser has lost its own copy.
		const theirs = {
			...saveDocument(newGame(WORLD, testStarter()), { lineage: 'kids-real-game', seq: 50 })
		};
		theirs.party = [...theirs.party, { id: 'bear-1', speciesId: 'bear', hp: 100 }];
		server.seed(theirs);
		const store = new MemoryStore();
		server.online = false;
		const tab = new Tab(store, server);
		// Out of reach at start: the title has no Continue, and New game asks nothing.
		expect(await tab.title()).toEqual({});
		await tab.startNew('rabbit');
		const rabbitGame = store.get(KEYS.save);
		server.online = true;
		await later(60_000);
		// The bigger game on the server wins, as without the title; the new one is kept too.
		expect(tab.autosave.behind).toBe('replaced');
		expect(store.save()).toMatchObject({ lineage: 'kids-real-game', seq: 50 });
		expect(store.get(KEYS.replaced)).toBe(rabbitGame);
		expect(server.saveOf()).toEqual(theirs);
	});

	it('Continue after another tab walked on while the title was up carries on from that walk', async () => {
		const store = new MemoryStore();
		savedGame(store);
		const title = new Tab(store, null);
		const plan = await title.title();
		const playing = new Tab(store, null);
		await playing.open();
		for (let i = 0; i < 5; i++) await playing.walk();
		title.autosave.onStorage(KEYS.save);
		expect(title.autosave.behind).toBeNull();
		const resumed = title.autosave.resumable()!;
		expect(plan.game!.steps).toBe(0);
		expect(resumed).toMatchObject({ steps: 5, pos: playing.game.pos });
		// Continue from there: the next step is the sixth, never a second second.
		await title.continueWith(resumed);
		await title.walk();
		expect(store.save()!.steps).toBe(6);
	});

	it('the new game takes the server over the old one, even when the server was ahead', async () => {
		const server = new FakeServer();
		const store = new MemoryStore();
		savedGame(store);
		// The server holds the old game further on than this browser does.
		const ahead = {
			...saveDocument(newGame(WORLD, testStarter()), { lineage: 'old-game', seq: 50 })
		};
		server.seed(ahead);
		const tab = new Tab(store, server);
		await tab.title();
		await tab.startNew('rabbit');
		await later();
		expect(tab.autosave.behind).toBeNull();
		expect(store.save()).toMatchObject({ party: [{ speciesId: 'rabbit' }] });
		expect(store.save()!.seq).toBeGreaterThan(50);
		expect(server.saveOf()).toEqual(store.save());
	});

	it('an unreadable save waiting in the key goes aside as soon as a starter is picked', async () => {
		const broken = '{"version":1,"broken":true}';
		const store = new MemoryStore();
		store.set(KEYS.save, broken);
		const tab = new Tab(store, null);
		expect(await tab.title()).toEqual({ notice: 'save.couldNotLoad' });
		await tab.startNew('squirrel');
		expect(store.get(KEYS.unreadable)).toBe(broken);
		expect(store.get(KEYS.previous)).toBeNull();
		expect(store.save()).toMatchObject({ party: [{ speciesId: 'squirrel' }] });
	});

	it("a newer build's save is never touched by a new game", async () => {
		for (const [what, doc] of newerSaves(newGame(WORLD, testStarter()), {
			lineage: 'their-game',
			seq: 5
		})) {
			const newer = JSON.stringify(doc);
			const store = new MemoryStore();
			store.set(KEYS.save, newer);
			const tab = new Tab(store, null);
			expect(await tab.title(), what).toEqual({});
			expect(tab.autosave.behind, what).toBe('newer');
			// No title opens (`main.ts`); even a starter picked all the same is saved nowhere.
			await tab.startNew('rabbit');
			await tab.catchOne();
			expect(store.get(KEYS.save), what).toBe(newer);
			expect(store.get(KEYS.previous), what).toBeNull();
		}
	});

	it('quit to title saves at once; nothing more is written until a game starts again', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const tab = new Tab(store, server);
		await tab.title();
		await tab.startNew('rabbit');
		await tab.walk();
		// A step and the quit in one go: the quit saves it there and then, not a microtask later.
		tab.game.steps += 1;
		tab.autosave.handle({ type: 'player-moved' } as GameEvent);
		tab.autosave.handle({ type: 'game-left' });
		expect(store.save()!.steps).toBe(tab.game.steps);
		await settle();
		const writes = store.writes;
		await tab.play((g) => (g.steps += 1));
		await tab.catchOne();
		await later(60_000);
		expect(store.writes).toBe(writes);

		// Continue: the same game, saved again from its next change, on the same lineage.
		const { lineage, seq } = store.save()!;
		await tab.continueWith(tab.game);
		expect(store.writes).toBe(writes);
		await tab.walk();
		expect(store.save()).toMatchObject({ steps: tab.game.steps, lineage, seq: seq + 1 });
		expect(store.writes).toBe(writes + 1);
		await later();
		expect(server.saveOf()).toEqual(store.save());
	});

	it('a tab still playing the old game falls behind a new game, and the old game is kept', async () => {
		const store = new MemoryStore();
		savedGame(store);
		const playing = new Tab(store, null);
		await playing.open();
		const title = new Tab(store, null);
		await title.title();
		await playing.walk();
		const walked = store.get(KEYS.save);
		await title.startNew('rabbit');
		expect(store.get(KEYS.previous)).toBe(walked);
		playing.autosave.onStorage(KEYS.save);
		expect(playing.autosave.behind).toBe('replaced');
		await playing.catchOne();
		expect(store.save()).toMatchObject({ party: [{ speciesId: 'rabbit' }] });
	});

	it('a throwaway page plays a new game and writes nothing', async () => {
		const store = new MemoryStore();
		const old = savedGame(store);
		const tab = new Tab(store, new FakeServer(), { throwaway: true });
		expect(await tab.title()).toEqual({});
		await tab.startNew('rabbit');
		await tab.catchOne();
		expect(store.get(KEYS.save)).toBe(old);
		expect(store.get(KEYS.previous)).toBeNull();
	});
});
