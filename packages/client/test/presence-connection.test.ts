import {
	BEARINGS,
	MAX_MESSAGE_BYTES,
	MAX_ROSTER,
	MAX_WIRE_NAME,
	PROTOCOL_VERSION,
	byeCloseCode,
	type ServerMessage,
	type WhereMessage
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import {
	BACKOFF_MS,
	FULL_RETRY_MS,
	MIN_GAP_MS,
	PresenceConnection,
	RESTART_RETRY_MS,
	presenceUrl,
	type ConnectionDeps,
	type PresenceStatus,
	type SocketLike
} from '../src/presence/connection';

// The presence socket from the page's side, with a clock, timers and sockets
// of the test's own: what it says, when it tries again, and that nothing it
// meets makes it throw.

class FakeSocket implements SocketLike {
	readyState = 0;
	sent: unknown[] = [];
	closed = false;
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	send(text: string): void {
		if (this.readyState !== 1) throw new Error('not open');
		this.sent.push(JSON.parse(text));
	}
	close(): void {
		this.closed = true;
		this.readyState = 3;
	}
	open(): void {
		this.readyState = 1;
		this.onopen?.({});
	}
	say(message: ServerMessage | string): void {
		this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
	}
	/** Closed from the other end, with a close code when given. */
	drop(code?: number): void {
		this.readyState = 3;
		this.onclose?.(code === undefined ? {} : { code });
	}
}

function setup(options: { failToOpen?: boolean } = {}) {
	let now = 0;
	const timers: { at: number; run: () => void; id: number }[] = [];
	let ids = 0;
	const sockets: FakeSocket[] = [];
	const got: ServerMessage[] = [];
	const statuses: PresenceStatus[] = [];
	const deps: ConnectionDeps = {
		open: () => {
			if (options.failToOpen) throw new Error('no WebSocket here');
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		url: () => 'ws://example.test/api/ws',
		setTimer: (run, ms) => {
			const timer = { at: now + ms, run, id: ++ids };
			timers.push(timer);
			return timer.id;
		},
		clearTimer: (id) => {
			const i = timers.findIndex((t) => t.id === id);
			if (i >= 0) timers.splice(i, 1);
		},
		now: () => now,
		random: () => 0.5
	};
	const connection = new PresenceConnection(
		(m) => got.push(m),
		(s) => statuses.push(s),
		deps
	);
	/** Let `ms` pass, running every timer due, in order. */
	const pass = (ms: number) => {
		const until = now + ms;
		for (;;) {
			timers.sort((a, b) => a.at - b.at);
			const next = timers[0];
			if (!next || next.at > until) break;
			timers.shift();
			now = next.at;
			next.run();
		}
		now = until;
	};
	const last = () => sockets.at(-1)!;
	return { connection, sockets, got, statuses, pass, last, timers };
}

function where(x: number, patch: Partial<WhereMessage> = {}): WhereMessage {
	return {
		t: 'where',
		world: 1,
		x,
		y: 0,
		facing: 'down',
		lead: 'rabbit',
		boat: false,
		busy: 'explore',
		...patch
	};
}

const hi = { t: 'hi', v: PROTOCOL_VERSION, pid: 'abcdef123', name: 'Ada', match: null } as const;

describe('the presence connection', () => {
	it('says hello on opening, is on after hi, and then says where it is', () => {
		const { connection, last, statuses } = setup();
		connection.start('g'.repeat(22), 'Ada');
		expect(connection.status).toBe('connecting');
		connection.where(where(1));
		last().open();
		expect(last().sent).toEqual([
			{ t: 'hello', v: PROTOCOL_VERSION, guest: 'g'.repeat(22), name: 'Ada' }
		]);
		last().say(hi);
		expect(connection.status).toBe('on');
		expect(connection.pid).toBe('abcdef123');
		// Where it was before the socket was on goes at once.
		expect(last().sent.at(-1)).toEqual(where(1));
		expect(statuses).toEqual(['connecting', 'on']);
	});

	it('sends only what changed, at most every MIN_GAP_MS, the latest winning', () => {
		const { connection, last, pass } = setup();
		connection.start('g'.repeat(22), 'Ada');
		last().open();
		last().say(hi);
		connection.where(where(1));
		const after = last().sent.length;
		connection.where(where(1));
		expect(last().sent.length).toBe(after);
		pass(MIN_GAP_MS);
		for (let x = 2; x <= 9; x++) connection.where(where(x));
		expect(last().sent.length).toBe(after + 1);
		pass(MIN_GAP_MS);
		expect(last().sent.length).toBe(after + 2);
		expect(last().sent.at(-1)).toEqual(where(9));
	});

	it('tries again after half a second, then longer each time up to 30 seconds, and from the first after a hi', () => {
		const { connection, sockets, last, pass } = setup();
		connection.start('g'.repeat(22), 'Ada');
		const tries: number[] = [];
		let t = 0;
		for (let i = 0; i < BACKOFF_MS.length + 2; i++) {
			last().drop();
			expect(connection.status).toBe('waiting');
			const before = sockets.length;
			let waited = 0;
			while (sockets.length === before) {
				pass(100);
				waited += 100;
			}
			tries.push(waited);
			t += waited;
		}
		expect(tries).toEqual([...BACKOFF_MS, 30_000, 30_000].map((ms) => Math.ceil(ms / 100) * 100));
		// A server that restarts in five seconds finds everyone back within a few seconds of it.
		expect(BACKOFF_MS.slice(0, 4).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(7_000);
		// A hi resets it.
		last().open();
		last().say(hi);
		last().drop();
		const before = sockets.length;
		pass(BACKOFF_MS[0]);
		expect(sockets.length).toBe(before + 1);
		expect(t).toBeGreaterThan(0);
	});

	it('stops for good when another window takes its place, until this window is used again', () => {
		const { connection, sockets, last, pass, got } = setup();
		connection.start('g'.repeat(22), 'Ada');
		last().open();
		last().say(hi);
		last().say({ t: 'bye', reason: 'replaced' });
		last().drop();
		expect(connection.status).toBe('elsewhere');
		expect(got.at(-1)).toEqual({ t: 'bye', reason: 'replaced' });
		const before = sockets.length;
		pass(10 * 60_000);
		expect(sockets.length).toBe(before);
		connection.wake();
		expect(sockets.length).toBe(before + 1);
		expect(connection.status).toBe('connecting');
	});

	it('comes straight back from a server stopping for a deploy, however it says so, and not as a failure', () => {
		const { connection, sockets, last, pass, got } = setup();
		connection.start('g'.repeat(22), 'Ada');
		last().open();
		last().say(hi);
		// Said with a bye, then with the close code alone (a bye lost on the way).
		for (const withBye of [true, false]) {
			const heard = got.length;
			if (withBye) last().say({ t: 'bye', reason: 'restart' });
			last().drop(withBye ? undefined : byeCloseCode('restart'));
			// Either way the page hears one bye: a match on it must know the server stopped.
			expect(got.slice(heard)).toEqual([{ t: 'bye', reason: 'restart' }]);
			expect(connection.status).toBe('waiting');
			const before = sockets.length;
			pass(RESTART_RETRY_MS * 0.75 - 1);
			expect(sockets.length).toBe(before);
			pass(RESTART_RETRY_MS * 0.5 + 1);
			expect(sockets.length).toBe(before + 1);
			// The next copy is not up yet: the tries go on from the first.
			last().drop();
			pass(BACKOFF_MS[0] * 0.75 - 1);
			expect(sockets.length).toBe(before + 1);
			pass(BACKOFF_MS[0] * 0.5 + 1);
			expect(sockets.length).toBe(before + 2);
			last().open();
			last().say(hi);
			expect(connection.status).toBe('on');
		}
		// Any bye's close code counts without its message: another window took this one's place.
		last().drop(byeCloseCode('replaced'));
		expect(connection.status).toBe('elsewhere');
	});

	it('waits for another name after a refused one, and a minute for a full world', () => {
		const { connection, sockets, last, pass } = setup();
		connection.start('g'.repeat(22), 'X');
		last().open();
		last().say({ t: 'bye', reason: 'name' });
		last().drop();
		expect(connection.status).toBe('refused');
		const before = sockets.length;
		pass(60_000);
		expect(sockets.length).toBe(before);
		connection.start('g'.repeat(22), 'Xavier');
		expect(sockets.length).toBe(before + 1);
		last().open();
		last().say({ t: 'bye', reason: 'full' });
		last().drop();
		expect(connection.status).toBe('waiting');
		const now = sockets.length;
		pass(FULL_RETRY_MS * 0.9);
		expect(sockets.length).toBe(now);
		pass(FULL_RETRY_MS * 0.2);
		expect(sockets.length).toBe(now + 1);
	});

	it('is out of date when the server speaks a newer version, and waits out an older one', () => {
		const newer = setup();
		newer.connection.start('g'.repeat(22), 'Ada');
		newer.last().open();
		newer.last().say({ t: 'refresh', v: PROTOCOL_VERSION + 1 });
		newer.last().drop();
		expect(newer.connection.status).toBe('outdated');
		const older = setup();
		older.connection.start('g'.repeat(22), 'Ada');
		older.last().open();
		older.last().say({ t: 'refresh', v: PROTOCOL_VERSION - 1 });
		older.last().drop();
		expect(older.connection.status).toBe('waiting');
	});

	it('reads a whole roster of fifty of the longest names, longer than any message it sends', () => {
		const { connection, last, got } = setup();
		connection.start('g'.repeat(22), 'Ada');
		last().open();
		last().say(hi);
		const roster: ServerMessage = {
			t: 'roster',
			world: 1,
			players: Array.from({ length: MAX_ROSTER }, (_, i) => ({
				pid: `pid${String(i).padStart(9, '0')}`,
				name: '𝐀'.repeat(MAX_WIRE_NAME / 2),
				bearing: i % BEARINGS,
				steps: 400_000,
				busy: 'explore' as const
			}))
		};
		expect(JSON.stringify(roster).length).toBeGreaterThan(MAX_MESSAGE_BYTES);
		last().say(roster);
		expect(got.at(-1)).toEqual(roster);
	});

	it('never throws: no WebSocket at all, junk from the server, a send on a closed socket', () => {
		const broken = setup({ failToOpen: true });
		expect(() => broken.connection.start('g'.repeat(22), 'Ada')).not.toThrow();
		expect(broken.connection.status).toBe('waiting');
		expect(() => broken.pass(120_000)).not.toThrow();
		const { connection, last, got } = setup();
		connection.start('g'.repeat(22), 'Ada');
		last().open();
		for (const junk of ['nope', '{"t":"peer"}', '[]', 'null', JSON.stringify({ t: 'hi', v: 1 })]) {
			expect(() => last().say(junk)).not.toThrow();
		}
		expect(got).toEqual([]);
		last().say(hi);
		last().readyState = 3;
		expect(() => connection.where(where(5))).not.toThrow();
		expect(connection.find('abcdef123')).toBe(true);
	});

	it('closes and forgets on stop, and a late close of the old socket changes nothing', () => {
		const { connection, sockets, last, pass } = setup();
		connection.start('g'.repeat(22), 'Ada');
		const first = last();
		first.open();
		first.say(hi);
		connection.stop();
		expect(first.closed).toBe(true);
		expect(connection.status).toBe('off');
		first.drop();
		pass(120_000);
		expect(sockets.length).toBe(1);
		expect(connection.find('abcdef123')).toBe(false);
	});

	it("finds the socket at /api/ws on the page's own host, wss on https", () => {
		expect(presenceUrl('http://localhost:5191/?debug')).toBe('ws://localhost:5191/api/ws');
		expect(presenceUrl('https://animath.example/')).toBe('wss://animath.example/api/ws');
	});
});
