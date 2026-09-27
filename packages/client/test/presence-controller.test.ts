import {
	PROTOCOL_VERSION,
	arrivalSpot,
	byeCloseCode,
	newGame,
	type GameEvent,
	type ServerMessage,
	type WhereMessage
} from '@mathgame/engine';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAuthority, WORLD_SEED } from '../src/authority/local';
import { t } from '../src/copy';
import {
	PresenceConnection,
	RESTART_RETRY_MS,
	type ConnectionDeps,
	type SocketLike
} from '../src/presence/connection';
import {
	FIND_SECONDS,
	HOLD_SECONDS,
	PresenceController,
	REFRESHED_KEY,
	edgeSpot,
	following,
	type PresenceRenderer
} from '../src/presence/controller';
import { GUEST_KEY } from '../src/presence/identity';
import { OtherPlayers } from '../src/render/others';
import { Poofs } from '../src/render/poof';
import type { KeyValueStore } from '../src/save/storage';
import { battle } from '../src/state/battle.svelte';
import { game } from '../src/state/game.svelte';
import { hud } from '../src/state/hud.svelte';
import { pause } from '../src/state/pause.svelte';
import { presence } from '../src/state/presence.svelte';

// The glue between the game, the socket and the screen: when the page is
// present and when not, what it says about itself, and "Go to", end to end
// with the real authority and a socket of the test's own.

class FakeSocket implements SocketLike {
	readyState = 0;
	sent: Record<string, unknown>[] = [];
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	send(text: string): void {
		this.sent.push(JSON.parse(text) as Record<string, unknown>);
	}
	close(): void {
		this.readyState = 3;
	}
	say(message: ServerMessage): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}
}

function memoryStore(
	entries: Record<string, string> = {}
): KeyValueStore & { map: Map<string, string> } {
	const map = new Map(Object.entries(entries));
	return {
		map,
		get: (k) => map.get(k) ?? null,
		set: (k, v) => (map.set(k, v), true),
		remove: (k) => void map.delete(k)
	};
}

let cleanups: (() => void)[] = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
	battle.active = false;
	pause.reset();
	presence.reset();
});

function setup(options: { name?: string | null; throwaway?: boolean; session?: null } = {}) {
	let now = 100;
	const sockets: FakeSocket[] = [];
	const timers: { at: number; run: () => void }[] = [];
	const deps: ConnectionDeps = {
		open: () => {
			const s = new FakeSocket();
			sockets.push(s);
			return s;
		},
		url: () => 'ws://test/api/ws',
		setTimer: (run, ms) => timers.push({ at: now * 1000 + ms, run }),
		clearTimer: () => {},
		now: () => now * 1000,
		random: () => 0.5
	};
	const scene = new THREE.Scene();
	const poofs = new Poofs(scene);
	const others = new OtherPlayers(
		scene,
		{ addFigure: (f) => scene.add(f), removeFigure: (f) => scene.remove(f) },
		poofs
	);
	const renderer: PresenceRenderer = {
		others,
		showingWorld: true,
		toScreen: (p) => ({ x: p.x * 10, y: p.z * 10, visible: true }),
		groundToScreen: (x, y) => ({ x: x * 10, y: y * 10 }),
		screenSize: () => ({ w: 1024, h: 768 })
	} as PresenceRenderer;
	const store = memoryStore();
	const session = options.session === null ? null : memoryStore();
	const authority = new LocalAuthority();
	let behind = false;
	let reloads = 0;
	let flushes = 0;
	const controller = new PresenceController({
		authority,
		renderer,
		store,
		session,
		throwaway: options.throwaway ?? false,
		behind: () => behind,
		flush: () => flushes++,
		reload: () => reloads++,
		clock: () => now,
		connection: (onMessage, onStatus) => new PresenceConnection(onMessage, onStatus, deps)
	});
	const events: GameEvent[] = [];
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
		hud.apply(e);
		controller.handle(e);
	});
	const socket = () => sockets.at(-1)!;
	/** The socket opens and the server says hi. */
	const connect = () => {
		socket().readyState = 1;
		socket().onopen?.({});
		socket().say({ t: 'hi', v: PROTOCOL_VERSION, pid: 'mine000001', name: 'Ada' });
	};
	/** A frame, as main.ts runs one: timers due, the others drawn, then presence. */
	const frame = (seconds = 0.1) => {
		now += seconds;
		for (const timer of timers.splice(0)) {
			if (timer.at <= now * 1000) timer.run();
			else timers.push(timer);
		}
		others.update(now, seconds);
		controller.update();
		controller.overlay();
	};
	const sentOf = (t: string) => socket().sent.filter((m) => m.t === t);
	/** A game under way in World 1, as Continue picks one up, named as `options` says (Ada). */
	const start = () =>
		authority.start({
			game: newGame(1, undefined, options.name === undefined ? 'Ada' : options.name)
		});
	cleanups.push(() => authority.dispatch({ type: 'leave-game' }));
	return {
		start,
		authority,
		controller,
		events,
		sockets,
		socket,
		connect,
		frame,
		sentOf,
		store,
		session,
		others,
		poofs,
		setBehind: (b: boolean) => (behind = b),
		reloads: () => reloads,
		flushes: () => flushes
	};
}

describe('presence on the page', () => {
	it('is never there behind the title, in a throwaway game, or without a name', () => {
		const title = setup();
		expect(title.sockets).toHaveLength(0);
		title.frame();
		expect(title.sockets).toHaveLength(0);
		const throwaway = setup({ throwaway: true });
		throwaway.start();
		throwaway.frame();
		expect(throwaway.sockets).toHaveLength(0);
		const nameless = setup({ name: null });
		nameless.start();
		nameless.frame();
		expect(nameless.sockets).toHaveLength(0);
		expect(presence.status).toBe('off');
		// A game saved before names: once the player has one, the others can see them.
		nameless.authority.dispatch({ type: 'choose-name', name: 'Ada' });
		expect(nameless.sockets).toHaveLength(1);
	});

	it('says hello with its guest id and name once a game is under way, then where it is and what it does', () => {
		const s = setup();
		s.start();
		expect(s.sockets).toHaveLength(1);
		s.connect();
		const hello = s.sentOf('hello')[0]!;
		expect(hello).toMatchObject({ name: 'Ada', guest: s.store.get(GUEST_KEY) });
		s.frame();
		expect(s.sentOf('where').at(-1)).toMatchObject({
			world: 1,
			x: game.pos.x,
			y: game.pos.y,
			lead: 'squirrel',
			busy: 'explore'
		});
		// Each change goes within a frame or two (at most one message every tenth of a second).
		pause.open = true;
		s.frame();
		s.frame();
		expect(s.sentOf('where').at(-1)).toMatchObject({ busy: 'menu' });
		pause.open = false;
		battle.active = true;
		s.frame();
		s.frame();
		expect(s.sentOf('where').at(-1)).toMatchObject({ busy: 'battle' });
	});

	it('up in the air says so: each tile flown goes as a flight, and the landing tile as walking again', () => {
		const s = setup();
		s.authority.start({
			game: { ...newGame(1, undefined, 'Ada'), items: ['glider'], facing: 'up' }
		});
		s.connect();
		s.frame();
		expect(s.sentOf('where').at(-1)).toMatchObject({ x: -2, y: 6, busy: 'explore' });
		s.authority.dispatch({ type: 'take-off' });
		s.frame();
		s.frame();
		expect(s.sentOf('where').at(-1)).toMatchObject({ x: -2, y: 6, busy: 'flight' });
		s.authority.dispatch({ type: 'glide' });
		s.frame();
		s.frame();
		expect(s.sentOf('where').at(-1)).toMatchObject({ x: -2, y: 5, busy: 'flight' });
		// Let go over the lake: down on its far shore, walking again.
		s.authority.dispatch({ type: 'land' });
		s.frame();
		s.frame();
		expect(s.sentOf('where').at(-1)).toMatchObject({ x: -2, y: -8, busy: 'explore' });
		// No moment of the flight was sent as a walk over the water.
		const overWater = s
			.sentOf('where')
			.map((m) => m as unknown as WhereMessage)
			.filter((m) => m.y < 6 && m.y > -8 && m.busy !== 'flight');
		expect(overWater).toEqual([]);
	});

	it('never draws or lists the player themselves, whatever the server says', () => {
		const s = setup();
		s.start();
		s.connect();
		const me = 'mine000001';
		s.socket().say({
			t: 'peer',
			pid: me,
			name: 'Ada',
			x: game.pos.x,
			y: game.pos.y,
			facing: 'down',
			lead: null,
			boat: false,
			busy: 'explore'
		});
		s.socket().say({
			t: 'roster',
			world: 1,
			players: [{ pid: me, name: 'Ada', bearing: 0, steps: 0, busy: 'explore' }]
		});
		s.frame();
		expect(s.others.pids()).toEqual([]);
		expect(presence.roster).toEqual([]);
	});

	it('moves to another world with the player: the next where names it, and nobody from the last is shown', () => {
		const s = setup();
		s.start();
		s.connect();
		s.socket().say({
			t: 'peer',
			pid: 'friend0001',
			name: 'Bo',
			x: game.pos.x + 1,
			y: game.pos.y,
			facing: 'left',
			lead: 'fox',
			boat: false,
			busy: 'explore'
		});
		s.socket().say({
			t: 'roster',
			world: 1,
			players: [{ pid: 'friend0001', name: 'Bo', bearing: 4, steps: 1, busy: 'explore' }]
		});
		s.frame();
		expect(s.others.pids()).toEqual(['friend0001']);
		s.authority.dispatch({ type: 'travel', world: 7 });
		expect(s.events.at(-1)).toMatchObject({ type: 'travelled', world: 7 });
		expect(s.others.pids()).toEqual([]);
		expect(presence.roster).toEqual([]);
		s.frame();
		s.frame();
		expect(s.sentOf('where').at(-1)).toMatchObject({ world: 7, x: game.pos.x, y: game.pos.y });
		// A roster of the world left, late, is not this world's.
		s.socket().say({
			t: 'roster',
			world: 1,
			players: [{ pid: 'friend0001', name: 'Bo', bearing: 4, steps: 1, busy: 'explore' }]
		});
		expect(presence.roster).toEqual([]);
	});

	it('goes to a player: asks the server, then the authority, and says so', () => {
		const s = setup();
		s.start();
		s.connect();
		s.frame();
		s.socket().say({
			t: 'roster',
			world: 1,
			players: [{ pid: 'friend0001', name: 'Bo', bearing: 4, steps: 150, busy: 'explore' }]
		});
		s.controller.goTo('friend0001');
		expect(s.sentOf('find')).toEqual([{ t: 'find', pid: 'friend0001' }]);
		const friend = { x: 140, y: -40 };
		s.socket().say({ t: 'found', pid: 'friend0001', ...friend });
		const want = arrivalSpot(WORLD_SEED, friend)!;
		expect(s.events.at(-1)).toEqual({
			type: 'player-placed',
			playerId: 'local',
			pos: want.pos,
			dir: want.facing
		});
		hud.tick(0);
		expect(hud.message).toBe(t('presence.nextTo', { name: 'Bo' }));
		// And where it is now goes to the server.
		s.frame(1);
		expect(s.sentOf('where').at(-1)).toMatchObject({ x: want.pos.x, y: want.pos.y });
	});

	it('never goes where no page could honestly be, however far the server says a player stands', () => {
		const s = setup();
		s.start();
		s.connect();
		s.socket().say({
			t: 'roster',
			world: 1,
			players: [{ pid: 'friend0001', name: 'Bo', bearing: 4, steps: 150, busy: 'explore' }]
		});
		const at = { ...game.pos };
		s.controller.goTo('friend0001');
		// A page that lies about where it stands: a million tiles out, where the world can't be drawn true.
		s.socket().say({ t: 'found', pid: 'friend0001', x: 1_000_000, y: 6 });
		s.frame(FIND_SECONDS + 0.5);
		expect(game.pos).toEqual(at);
		expect(s.events.some((e) => e.type === 'player-placed')).toBe(false);
		hud.tick(0);
		expect(hud.message).toBe(t('presence.cantFind', { name: 'Bo' }));
	});

	it('says so kindly when the player left, or no answer came', () => {
		const s = setup();
		s.start();
		s.connect();
		s.socket().say({
			t: 'roster',
			world: 1,
			players: [{ pid: 'friend0001', name: 'Bo', bearing: 4, steps: 150, busy: 'explore' }]
		});
		s.controller.goTo('friend0001');
		s.socket().say({ t: 'lost', pid: 'friend0001' });
		hud.tick(0);
		expect(hud.message).toBe(t('presence.lost', { name: 'Bo' }));
		s.controller.goTo('friend0001');
		s.frame(FIND_SECONDS + 0.5);
		hud.tick(0);
		expect(hud.message).toBe(t('presence.cantFind', { name: 'Bo' }));
		// A late answer does nothing.
		const at = game.pos;
		s.socket().say({ t: 'found', pid: 'friend0001', x: 500, y: 500 });
		expect(game.pos).toEqual(at);
	});

	it('does not go when a battle started while the server answered', () => {
		const s = setup();
		s.start();
		s.connect();
		s.controller.goTo('friend0001');
		battle.active = true;
		const at = game.pos;
		s.socket().say({ t: 'found', pid: 'friend0001', x: 140, y: -40 });
		expect(game.pos).toEqual(at);
	});

	it('draws who the server says is near, and fades them all when the socket is gone a while', () => {
		const s = setup();
		s.start();
		s.connect();
		s.socket().say({
			t: 'peer',
			pid: 'friend0001',
			name: 'Bo',
			x: game.pos.x + 1,
			y: game.pos.y,
			facing: 'left',
			lead: 'fox',
			boat: false,
			busy: 'doctor'
		});
		s.socket().say({
			t: 'roster',
			world: 1,
			players: [{ pid: 'friend0001', name: 'Bo', bearing: 4, steps: 1, busy: 'doctor' }]
		});
		s.frame();
		expect(s.others.pids()).toEqual(['friend0001']);
		expect(presence.labels).toMatchObject([{ pid: 'friend0001', name: 'Bo', busy: 'doctor' }]);
		s.socket().readyState = 3;
		s.socket().onclose?.({});
		expect(presence.status).toBe('waiting');
		// A restart: everyone stays a moment, in case the socket is back at once.
		s.frame(HOLD_SECONDS / 2);
		expect(s.others.pids()).toEqual(['friend0001']);
		expect(presence.roster).toHaveLength(1);
		// Gone a while: nobody is known where they were, on screen, in the list or by an arrow.
		s.frame(HOLD_SECONDS);
		expect(s.others.pids()).toEqual([]);
		expect(presence.roster).toEqual([]);
	});

	it('hops to the next copy of the server on a deploy without a flicker: nobody drawn twice, no note, no poof', () => {
		const s = setup();
		s.start();
		s.connect();
		const bo: ServerMessage = {
			t: 'peer',
			pid: 'friend0001',
			name: 'Bo',
			x: game.pos.x + 1,
			y: game.pos.y,
			facing: 'left',
			lead: 'fox',
			boat: false,
			busy: 'explore'
		};
		const roster: ServerMessage = {
			t: 'roster',
			world: 1,
			players: [{ pid: 'friend0001', name: 'Bo', bearing: 4, steps: 1, busy: 'explore' }]
		};
		s.socket().say(bo);
		s.socket().say(roster);
		// A while later: Bo is known, anything about him coming is long over.
		for (let i = 0; i < 300; i++) s.frame();
		expect(s.others.pids()).toEqual(['friend0001']);
		expect(presence.note).toBeNull();
		// The server stops for a deploy, said with a bye and a close code; nobody is told who left.
		const before = s.sockets.length;
		s.socket().say({ t: 'bye', reason: 'restart' });
		s.socket().readyState = 3;
		s.socket().onclose?.({ code: byeCloseCode('restart') });
		const unchanged = () => {
			expect(s.others.pids()).toEqual(['friend0001']);
			expect(presence.roster.map((p) => p.name)).toEqual(['Bo']);
			expect(presence.note).toBeNull();
			expect(s.poofs.playing).toBe(0);
		};
		s.frame(RESTART_RETRY_MS / 2000);
		unchanged();
		// Straight back, to the copy taking over, which knows Bo by the same id.
		s.frame(RESTART_RETRY_MS / 1000);
		expect(s.sockets.length).toBe(before + 1);
		s.connect();
		s.socket().say(bo);
		s.socket().say(roster);
		// Through the confirm and every note's grace: Bo stays put, once, and nothing is said.
		for (let i = 0; i < 300; i++) {
			s.frame();
			unchanged();
		}
	});

	it('reloads for a newer version once, at a calm moment, after saving', () => {
		const s = setup();
		s.start();
		s.connect();
		pause.open = true;
		s.socket().say({ t: 'refresh', v: PROTOCOL_VERSION + 1 });
		s.socket().readyState = 3;
		s.socket().onclose?.({});
		s.frame();
		expect(s.reloads()).toBe(0);
		pause.open = false;
		s.frame();
		expect([s.flushes(), s.reloads()]).toEqual([1, 1]);
		expect(s.session!.get(REFRESHED_KEY)).toBe(String(PROTOCOL_VERSION + 1));
		// The page came back still out of date (a cached build): it does not reload again.
		const again = setup();
		again.session!.set(REFRESHED_KEY, String(PROTOCOL_VERSION + 1));
		again.start();
		again.connect();
		again.socket().say({ t: 'refresh', v: PROTOCOL_VERSION + 1 });
		again.socket().readyState = 3;
		again.socket().onclose?.({});
		again.frame();
		expect(again.reloads()).toBe(0);
		// A page that can't remember it reloaded never reloads on its own: it could loop.
		const forgetful = setup({ session: null });
		forgetful.start();
		forgetful.connect();
		forgetful.socket().say({ t: 'refresh', v: PROTOCOL_VERSION + 1 });
		forgetful.socket().readyState = 3;
		forgetful.socket().onclose?.({});
		forgetful.frame();
		expect(forgetful.reloads()).toBe(0);
	});

	it('leaves when the page falls behind the save, and when the game goes back to the title', () => {
		const s = setup();
		s.start();
		s.connect();
		s.setBehind(true);
		s.frame();
		expect(presence.status).toBe('off');
		const t2 = setup();
		t2.start();
		t2.connect();
		t2.authority.dispatch({ type: 'leave-game' });
		expect(presence.status).toBe('off');
		expect(t2.socket().readyState).toBe(3);
	});
});

describe('what presence works out', () => {
	it('follows the lead on land, and out on the water the first that swims, else the land lead riding', () => {
		const party = [
			{ id: 'a', speciesId: 'squirrel', hp: 20 },
			{ id: 'b', speciesId: 'otter', hp: 0 },
			{ id: 'c', speciesId: 'frog', hp: 12 }
		];
		expect(following(party, false)).toBe('squirrel');
		expect(following(party, true)).toBe('frog');
		expect(following(party.slice(0, 2), true)).toBe('squirrel');
		expect(following([], false)).toBeNull();
	});

	it('puts an arrow on the edge of the screen, on the line to the player it points at', () => {
		const me = { x: 512, y: 384 };
		for (const there of [
			{ x: 5000, y: 384 },
			{ x: -300, y: 100 },
			{ x: 512, y: -9000 },
			{ x: 900, y: 2000 }
		]) {
			const spot = edgeSpot(me, there, 1024, 768)!;
			const onEdge = spot.x <= 44 || spot.x >= 1024 - 44 || spot.y <= 44 || spot.y >= 768 - 96;
			expect(onEdge).toBe(true);
			// On the line from me to them, pointing their way.
			const cross = (spot.x - me.x) * (there.y - me.y) - (spot.y - me.y) * (there.x - me.x);
			expect(Math.abs(cross) / Math.hypot(there.x - me.x, there.y - me.y)).toBeLessThan(1);
			const dir = { x: Math.sin(spot.angle), y: -Math.cos(spot.angle) };
			expect(dir.x * (there.x - me.x) + dir.y * (there.y - me.y)).toBeGreaterThan(0);
		}
		expect(edgeSpot(me, me, 1024, 768)).toBeNull();
	});
});
