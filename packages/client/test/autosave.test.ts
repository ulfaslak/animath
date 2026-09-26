import {
	canReplace,
	getAnimal,
	hashString,
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
import type { Identity, SaveServer, ServerRead, ServerWrite } from '../src/save/api';
import { Autosave } from '../src/save/autosave';
import { COPY, LANGUAGES } from '../src/copy/languages';
import { flatten } from '../src/copy/translate';
import { SAVE_NOTICES } from '../src/save/notices';
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
		this.game = newGame(SEED, { id: `starter-${this.ids++}`, speciesId, hp });
		this.autosave.handle({ type: 'welcome', newGame: true } as GameEvent);
		await settle();
	}

	/** Quit to title: the authority's `game-left`. */
	async quit(): Promise<void> {
		this.autosave.handle({ type: 'game-left' });
		await settle();
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

	/** Something a kid would miss: a new animal in the party. */
	catchOne(): Promise<void> {
		return this.play(
			(g) => g.party.push({ id: `caught-${g.party.length}`, speciesId: 'rabbit', hp: 7 }),
			'party-changed'
		);
	}
}

/** A `party-edited` with these events. */
function edited(events: Extract<GameEvent, { type: 'party-edited' }>['events']): GameEvent {
	return { type: 'party-edited', party: [], events };
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
		const base = newGame(SEED);
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
			probe.start({ game: { ...newGame(SEED), steps } });
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
		c.authority.start({ game: restoreGame(readSaveOrThrow(save)) });
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
		expect(tab.autosave.behind).toBe('replaced');
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
		const who = server.seed(unreadable);
		const store = new MemoryStore();
		const tab = new Tab(store, server);
		await tab.open();
		store.set(KEYS.player, JSON.stringify(who));
		const next = new Tab(store, server);
		await next.open();
		await next.walk();
		await later();
		expect(next.autosave.behind).toBeNull();
		expect(server.saveOf(who)).toEqual(unreadable);
		await next.catchOne();
		await later();
		expect(server.saveOf(who)!.seq).toBeGreaterThan(500);
		expect(store.save()!.seq).toBe(server.saveOf(who)!.seq);
	});

	it('with no save here, an unreadable backup gives a new game that says so and waits for play', async () => {
		const server = new FakeServer();
		const unreadable = { version: 1, seq: 70, party: [{ id: 'a', speciesId: 'dragon', hp: 3 }] };
		const who = server.seed(unreadable);
		const store = new MemoryStore();
		store.set(KEYS.player, JSON.stringify(who));
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({ notice: 'save.couldNotLoad' });
		expect(store.save()!.seq).toBeGreaterThan(70);
		await tab.walk();
		await later();
		expect(server.saveOf(who)).toEqual(unreadable);
		await tab.catchOne();
		await later();
		expect(server.saveOf(who)).toEqual(store.save());
	});

	it("with no save here, a newer build's backup gives a new game that says so and never sends", async () => {
		const server = new FakeServer();
		const newer = { version: 2, seq: 9, whatever: true };
		const who = server.seed(newer);
		const store = new MemoryStore();
		store.set(KEYS.player, JSON.stringify(who));
		const tab = new Tab(store, server);
		expect(await tab.open()).toEqual({ notice: 'save.newerGame' });
		await tab.catchOne();
		tab.autosave.flush();
		await later(60_000);
		expect(server.saveOf(who)).toEqual(newer);
		expect(server.calls.filter((c) => c === 'put')).toEqual([]);
	});

	it('a server save from before seq and lineage never sends the page round a reload loop', async () => {
		const server = new FakeServer();
		const legacy = { version: 1, seed: SEED, pos: { x: -2, y: 6 }, party: [] };
		const who = server.seed(legacy);
		const store = new MemoryStore();
		store.set(KEYS.player, JSON.stringify(who));
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
		expect(server.saveOf(who)).toEqual(store.save());
		// And a reload settles, with nothing to adopt.
		const again = new Tab(store, server);
		await again.open();
		await later();
		expect(again.autosave.behind).toBeNull();
	});

	it('a game adopted from the server never overwrites a game already kept aside', async () => {
		const server = new FakeServer();
		const theirs = { ...newGame(SEED), version: 1, lineage: 'from-server', seq: 40 };
		const who = server.seed(theirs);
		const store = new MemoryStore();
		store.set(KEYS.player, JSON.stringify(who));
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
		expect(tab.autosave.behind).toBeNull();
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

	it('a second identity the server stops knowing is kept beside the first, never over it', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const ghost = { id: '00000000-0000-4000-8000-999999999999', secret: 'gone' };
		store.set(KEYS.player, JSON.stringify(ghost));
		const tab = new Tab(store, server);
		await tab.open();
		await tab.catchOne();
		await later();
		const second = identityIn(store)!;
		// The server loses the new player too (a database reset, say).
		server.players.delete(second.id);
		await tab.catchOne();
		await later();
		expect(JSON.parse(store.get(KEYS.previousPlayer)!)).toEqual(ghost);
		expect(JSON.parse(store.get(`${KEYS.previousPlayer}.2`)!)).toEqual(second);
		const third = identityIn(store)!;
		expect([ghost.id, second.id]).not.toContain(third.id);
		expect(server.saveOf(third)).toEqual(store.save());
	});

	it('a tab taking the server’s game in the same instant another tab saves a catch: the catch is kept aside', async () => {
		const store = new MemoryStore();
		const server = new FakeServer();
		const theirs = { ...newGame(SEED), version: 1, lineage: 'from-server', seq: 40 };
		const who = server.seed(theirs);
		const first = new Tab(store, null);
		await first.open();
		await first.walk();
		store.set(KEYS.player, JSON.stringify(who));
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
		const who = identityIn(store)!;
		// This tab starts while the server is out of reach: its first check waits for a retry.
		server.online = false;
		const tab = new Tab(store, server);
		await tab.open();
		// Another tab (no server of its own here) walks on, and its backup lands first.
		const other = new Tab(store, null);
		await other.open();
		await other.walk();
		server.players.get(who.id)!.save = JSON.parse(store.get(KEYS.save)!);
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
		expect(tab.autosave.behind).toBeNull();
		expect(readSave(server.saveOf(who)).ok).toBe(true);
		await tab.walk();
		await later();
		expect(server.saveOf(who)).toEqual(store.save());
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
		// A newer build's save waiting: every title says so, and it is never touched.
		const store = new MemoryStore();
		const newer = JSON.stringify({ version: 2, whatever: true });
		store.set(KEYS.save, newer);
		const frozen = new Tab(store, null);
		await frozen.title();
		expect(says(frozen)).toEqual(['save.newerGame', false]);
		await frozen.startNew();
		await frozen.quit();
		expect(says(frozen)).toEqual(['save.newerGame', false]);
		expect(store.get(KEYS.save)).toBe(newer);
		// A newer build's game on the server, none here: every title says so; a new game is kept here.
		const server = new FakeServer();
		const who = server.seed({ version: 2, whatever: true });
		const fresh = new MemoryStore();
		fresh.set(KEYS.player, JSON.stringify(who));
		const behindServer = new Tab(fresh, server);
		expect(await behindServer.title()).toEqual({ notice: 'save.newerGame' });
		expect(says(behindServer)).toEqual(['save.newerGame', true]);
		await behindServer.startNew();
		await behindServer.quit();
		expect(says(behindServer)).toEqual(['save.newerGame', true]);
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
		const game = newGame(SEED);
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
			expect(server.calls).toEqual([]);
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
		expect(server.saveOf(identityIn(store)!)).toEqual(store.save());
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
		const theirs = { ...newGame(SEED), version: 1, lineage: 'kids-real-game', seq: 50 };
		theirs.party = [...theirs.party, { id: 'bear-1', speciesId: 'bear', hp: 100 }];
		const who = server.seed(theirs);
		const store = new MemoryStore();
		store.set(KEYS.player, JSON.stringify(who));
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
		expect(server.saveOf(who)).toEqual(theirs);
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
		const ahead = { ...newGame(SEED), version: 1, lineage: 'old-game', seq: 50 };
		const who = server.seed(ahead);
		store.set(KEYS.player, JSON.stringify(who));
		const tab = new Tab(store, server);
		await tab.title();
		await tab.startNew('rabbit');
		await later();
		expect(tab.autosave.behind).toBeNull();
		expect(store.save()).toMatchObject({ party: [{ speciesId: 'rabbit' }] });
		expect(store.save()!.seq).toBeGreaterThan(50);
		expect(server.saveOf(who)).toEqual(store.save());
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
		const newer = JSON.stringify({ version: 99, whatever: true });
		const store = new MemoryStore();
		store.set(KEYS.save, newer);
		const tab = new Tab(store, null);
		expect(await tab.title()).toEqual({ notice: 'save.newerGame' });
		await tab.startNew('rabbit');
		await tab.catchOne();
		expect(store.get(KEYS.save)).toBe(newer);
		expect(store.get(KEYS.previous)).toBeNull();
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
		expect(server.saveOf(identityIn(store)!)).toEqual(store.save());
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
