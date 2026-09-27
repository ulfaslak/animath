import {
	PROTOCOL_VERSION,
	REFRESH_CLOSE_CODE,
	byeCloseCode,
	nameKey,
	parseServerMessage,
	type ServerMessage
} from '@mathgame/engine';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type ClientOptions } from 'ws';
import { PRESENCE_PATH, attachPresence, type PresenceOptions } from '../src/presence/socket.js';
import { createAccount } from '../src/accounts.js';
import { pool } from '../src/db/index.js';
import { sessionUserFromCookieHeader } from '../src/sessions.js';

afterAll(() => pool.end());

// The presence socket over a real HTTP server and real WebSockets, on a port
// of its own: what a browser (or anyone else) can do to it. The rules behind
// it are the hub's (`presence-hub.test.ts`).

const running: (() => Promise<void>)[] = [];
afterEach(async () => {
	while (running.length) await running.pop()!();
	// After the servers stop: a test that fakes a timer stops its server on the same clock.
	vi.useRealTimers();
});

async function start(options: PresenceOptions = {}) {
	const server: Server = createServer((_req, res) => {
		res.writeHead(404);
		res.end();
	});
	const presence = attachPresence(server, { rosterMs: 50, ...options });
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	const stop = async () => {
		await presence.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	};
	running.push(stop);
	return { presence, port, server, url: `ws://127.0.0.1:${port}${PRESENCE_PATH}` };
}

/** How many connections `server` holds open, upgraded ones and refused ones not yet let go included. */
function connections(server: Server): Promise<number> {
	return new Promise((resolve, reject) =>
		server.getConnections((error, count) => (error ? reject(error) : resolve(count)))
	);
}

class Client {
	readonly ws: WebSocket;
	readonly got: ServerMessage[] = [];
	readonly opened: Promise<void>;
	readonly closed: Promise<{ code: number; reason: string }>;
	private waiters: (() => void)[] = [];

	constructor(url: string, options: ClientOptions = {}) {
		this.ws = new WebSocket(url, options);
		this.opened = new Promise((resolve, reject) => {
			this.ws.once('open', () => resolve());
			this.ws.once('unexpected-response', (_req, res) =>
				reject(new Error(`HTTP ${res.statusCode}`))
			);
			this.ws.once('error', reject);
		});
		this.closed = new Promise((resolve) =>
			this.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
		);
		this.ws.on('message', (data) => {
			const message = parseServerMessage(JSON.parse(String(data)));
			expect(message, `the server sent ${String(data)}`).not.toBeNull();
			this.got.push(message!);
			for (const wake of this.waiters.splice(0)) wake();
		});
	}

	send(value: unknown): void {
		this.ws.send(typeof value === 'string' ? value : JSON.stringify(value));
	}

	hello(name = 'Ada', guest = 'g'.repeat(20)): void {
		this.send({ t: 'hello', v: PROTOCOL_VERSION, guest, name });
	}

	where(world: number, x: number, y: number, busy = 'explore'): void {
		this.send({ t: 'where', world, x, y, facing: 'down', lead: 'rabbit', boat: false, busy });
	}

	/** The first message of kind `t` received since message `after` (waiting for it up to `ms`). */
	next<T extends ServerMessage['t']>(
		t: T,
		ms = 2000,
		after = 0
	): Promise<Extract<ServerMessage, { t: T }>> {
		return this.until((m): m is Extract<ServerMessage, { t: T }> => m.t === t, ms, after);
	}

	/** The first message received since message `after` that `test` takes (waiting up to `ms`). */
	async until<M extends ServerMessage>(
		test: (m: ServerMessage) => m is M,
		ms = 2000,
		after = 0
	): Promise<M> {
		const deadline = Date.now() + ms;
		for (;;) {
			const found = this.got.slice(after).find(test);
			if (found) return found;
			if (Date.now() > deadline)
				throw new Error(`nothing within ${ms} ms: got ${JSON.stringify(this.got)}`);
			await new Promise<void>((resolve) => {
				this.waiters.push(resolve);
				setTimeout(resolve, 20);
			});
		}
	}
}

async function joined(url: string, name: string, guest: string, options: ClientOptions = {}) {
	const c = new Client(url, options);
	await c.opened;
	c.hello(name, guest);
	const hi = await c.next('hi');
	return { c, pid: hi.pid };
}

/**
 * A ping of the client's own, answered, or its socket closed. A socket's frames keep their
 * order both ways, so by then all the server sent `c` before has arrived, and, when the pong
 * came, the server has read all `c` sent before the ping: a barrier, where a wait on the
 * clock would only guess.
 */
function roundTrip(c: Client): Promise<void> {
	const answered = new Promise<void>((resolve) => c.ws.once('pong', () => resolve()));
	c.ws.ping();
	return Promise.race([answered, c.closed.then(() => {})]);
}

describe('presence socket', () => {
	it('says hi with the name as the rules clean it, and shows two players in one world to each other', async () => {
		const { url } = await start();
		const { c: ada, pid: adaPid } = await joined(url, '  Ada  ', 'a'.repeat(20));
		expect(ada.got[0]).toMatchObject({ t: 'hi', v: PROTOCOL_VERSION, name: 'Ada' });
		const { c: bo, pid: boPid } = await joined(url, 'Bo', 'b'.repeat(20));
		const { c: far } = await joined(url, 'Cy', 'c'.repeat(20));
		ada.where(1, 0, 0);
		bo.where(1, 2, 1);
		far.where(2, 0, 0);
		expect(await ada.next('peer')).toMatchObject({
			pid: boPid,
			name: 'Bo',
			x: 2,
			y: 1,
			lead: 'rabbit'
		});
		expect(await bo.next('peer')).toMatchObject({ pid: adaPid, name: 'Ada' });
		// Her first roster came as she arrived, before Bo said where he was; the next one has him.
		const roster = await ada.until(
			(m): m is ServerMessage & { t: 'roster' } => m.t === 'roster' && m.players.length > 0
		);
		expect(roster).toMatchObject({ world: 1, players: [{ pid: boPid, name: 'Bo', steps: 3 }] });
		// Cy, in another world, hears nothing of them.
		await roundTrip(far);
		expect(far.got.filter((m) => m.t === 'peer')).toEqual([]);
		// Bo goes home: Ada is told.
		bo.ws.close();
		expect(await ada.next('gone')).toEqual({ t: 'gone', pid: boPid });
	});

	it('finds a player for Go to, only in the same world', async () => {
		const { url } = await start();
		const { c: ada } = await joined(url, 'Ada', 'a'.repeat(20));
		const { c: bo, pid: boPid } = await joined(url, 'Bo', 'b'.repeat(20));
		ada.where(4, 0, 0);
		bo.where(4, -600, 17);
		await ada.next('roster');
		ada.send({ t: 'find', pid: boPid });
		expect(await ada.next('found')).toEqual({ t: 'found', pid: boPid, x: -600, y: 17 });
		bo.where(5, 0, 0);
		const seen = ada.got.length;
		ada.send({ t: 'find', pid: boPid });
		expect(await ada.next('lost', 2000, seen)).toEqual({ t: 'lost', pid: boPid });
	});

	it('refuses a name the rules refuse, and closes', async () => {
		const { url } = await start();
		for (const name of ['A', '<script>', 'x'.repeat(17), '   ']) {
			const c = new Client(url);
			await c.opened;
			c.hello(name);
			expect(await c.next('bye')).toEqual({ t: 'bye', reason: 'name' });
			expect((await c.closed).code).toBe(byeCloseCode('name'));
		}
	});

	it('tells a page of another version to refresh', async () => {
		const { url } = await start();
		const c = new Client(url);
		await c.opened;
		c.send({ t: 'hello', v: PROTOCOL_VERSION + 1, something: 'new' });
		expect(await c.next('refresh')).toEqual({ t: 'refresh', v: PROTOCOL_VERSION });
		expect((await c.closed).code).toBe(REFRESH_CLOSE_CODE);
	});

	it('keeps one presence per guest: a second socket replaces the first', async () => {
		const { url, presence } = await start();
		const { c: first } = await joined(url, 'Ada', 'same-guest-id-123');
		const { c: friend } = await joined(url, 'Bo', 'b'.repeat(20));
		first.where(1, 0, 0);
		friend.where(1, 1, 0);
		await friend.next('peer');
		const { c: second, pid } = await joined(url, 'Ada', 'same-guest-id-123');
		expect(await first.next('bye')).toEqual({ t: 'bye', reason: 'replaced' });
		expect((await first.closed).code).toBe(byeCloseCode('replaced'));
		await friend.next('gone');
		second.where(1, 2, 0);
		const seen = friend.got.length;
		expect(await friend.next('peer', 2000, seen)).toMatchObject({ pid, name: 'Ada' });
		expect(presence.hub.size).toBe(2);
	});

	it('knows an account holder by their session, and shows the account name', async () => {
		const { url } = await start({
			accountOf: async (headers) =>
				headers.get('cookie')?.includes('session=good') ? { id: 'u1', name: 'Nini' } : null
		});
		const { c: one } = await joined(url, 'Whatever', 'a'.repeat(20), {
			headers: { cookie: 'session=good' }
		});
		expect(one.got[0]).toMatchObject({ t: 'hi', name: 'Nini' });
		// The same account from another browser (another guest id) takes its place.
		await joined(url, 'Other', 'z'.repeat(20), { headers: { cookie: 'session=good' } });
		expect(await one.next('bye')).toEqual({ t: 'bye', reason: 'replaced' });
		// A lookup that fails leaves a guest, as the hello says.
		const broken = await start({
			accountOf: async () => {
				throw new Error('database down');
			}
		});
		const { c: guest } = await joined(broken.url, 'Bo', 'b'.repeat(20));
		expect(guest.got[0]).toMatchObject({ name: 'Bo' });
	});

	it('knows an account holder by their real session cookie, as the server wires it', async () => {
		const name = `Presence${randomUUID().slice(0, 6)}`;
		const created = await createAccount({
			name,
			nameKey: nameKey(name),
			passwordHash: 'x',
			save: null
		});
		expect(created).not.toBeNull();
		const { url } = await start({
			accountOf: (headers) => sessionUserFromCookieHeader(headers.get('cookie') ?? undefined)
		});
		const { c: holder } = await joined(url, 'Whatever', 'a'.repeat(20), {
			headers: { cookie: `animath_session=${created!.token}` }
		});
		expect(holder.got[0]).toMatchObject({ t: 'hi', name });
		// A cookie that is no session is a guest, by the hello's name.
		const { c: guest } = await joined(url, 'Bo', 'b'.repeat(20), {
			headers: { cookie: 'animath_session=not-a-session' }
		});
		expect(guest.got[0]).toMatchObject({ t: 'hi', name: 'Bo' });
	});

	it("refuses a socket opened from another site, and takes its own and a proxy's", async () => {
		const { url, port } = await start();
		await expect(new Client(url, { origin: 'http://evil.example' }).opened).rejects.toThrow(
			'HTTP 403'
		);
		await new Client(url, { origin: `http://127.0.0.1:${port}` }).opened;
		await new Client(url, {
			origin: 'https://animath.example',
			headers: { 'x-forwarded-host': 'animath.example' }
		}).opened;
		await expect(new Client(url.replace(PRESENCE_PATH, '/api/other'), {}).opened).rejects.toThrow(
			'HTTP 404'
		);
	});

	it('closes a socket that sends too much at once', async () => {
		const { url } = await start();
		const c = new Client(url);
		await c.opened;
		c.send(JSON.stringify({ t: 'hello', pad: 'x'.repeat(5000) }));
		expect((await c.closed).code).toBe(1009);
	});

	it('drops a flood of messages, then closes the socket', async () => {
		const { url } = await start({ ratePerSecond: 10, burst: 5, maxDropped: 20 });
		const { c } = await joined(url, 'Ada', 'a'.repeat(20));
		for (let i = 0; i < 200; i++) c.where(1, i, 0);
		expect(await c.next('bye')).toEqual({ t: 'bye', reason: 'flood' });
		expect((await c.closed).code).toBe(byeCloseCode('flood'));
	});

	it('closes a socket that keeps sending what is no message, or says nothing', async () => {
		// The wait for a hello runs on the fake clock.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const { url } = await start({ maxInvalid: 3, helloTimeoutMs: 300 });
		const junk = new Client(url);
		await junk.opened;
		junk.send('not json');
		junk.ws.send(Buffer.from([1, 2, 3]));
		junk.send({ t: 'where', world: 1, x: 0, y: 0 }); // before hello, and half a message
		expect(await junk.next('bye')).toEqual({ t: 'bye', reason: 'invalid' });
		// A socket that says nothing has 300 ms to say hello, and not one more.
		const silent = new Client(url);
		await silent.opened;
		vi.advanceTimersByTime(299);
		await roundTrip(silent);
		expect(silent.got).toEqual([]);
		vi.advanceTimersByTime(1);
		await roundTrip(silent);
		expect(silent.got).toEqual([{ t: 'bye', reason: 'invalid' }]);
		// A second hello counts too.
		const { c: twice } = await joined(url, 'Ada', 'a'.repeat(20));
		for (let i = 0; i < 3; i++) twice.hello();
		expect(await twice.next('bye')).toEqual({ t: 'bye', reason: 'invalid' });
	});

	it('drops a socket that stops answering pings', async () => {
		// The beats come from the fake clock, one at a time. On the real one, a beat that fell
		// while the machine was busy elsewhere could find the answering socket's pong still
		// unread, and drop that socket too.
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		const { url, presence } = await start({ heartbeatMs: 100 });
		const { c: quiet } = await joined(url, 'Ada', 'a'.repeat(20), { autoPong: false });
		const { c: lively } = await joined(url, 'Bo', 'b'.repeat(20));
		quiet.where(1, 0, 0);
		lively.where(1, 1, 0);
		await lively.next('peer');
		// The first beat pings both, and Bo's socket answers as the ping arrives; his own
		// round trip after that says the server has read the answer.
		const pinged = new Promise((resolve) => lively.ws.once('ping', resolve));
		vi.advanceTimersByTime(100);
		await pinged;
		await roundTrip(lively);
		// The next beat finds Ada's ping unanswered: she is dropped, and Bo stays.
		vi.advanceTimersByTime(100);
		await roundTrip(quiet);
		expect(quiet.ws.readyState).toBe(WebSocket.CLOSED);
		expect((await quiet.closed).code).toBe(1006);
		expect(await lively.next('gone')).toMatchObject({ t: 'gone' });
		expect(presence.hub.size).toBe(1);
	});

	it('holds at most maxPerAddress sockets from one address, the one the proxy saw', async () => {
		const { url } = await start({ maxPerAddress: 2 });
		const from = (address: string) => ({ headers: { 'X-Forwarded-For': address } });
		const first = await joined(url, 'Ada', 'a'.repeat(20), from('203.0.113.7'));
		// What the client said before the proxy's own entry counts for nothing.
		await joined(url, 'Bo', 'b'.repeat(20), from('198.51.100.1, 203.0.113.7'));
		await expect(new Client(url, from('203.0.113.7')).opened).rejects.toThrow('HTTP 429');
		// An IPv6 household is its /64: another address in it is the same one.
		await joined(url, 'Cy', 'c'.repeat(20), from('2001:db8:1:2::10'));
		await joined(url, 'Dee', 'd'.repeat(20), from('2001:db8:1:2:aaaa::1'));
		await expect(new Client(url, from('2001:db8:1:2::99')).opened).rejects.toThrow('HTTP 429');
		// Another address is let in; and one that closes a socket may open another.
		await joined(url, 'Eve', 'e'.repeat(20), from('203.0.113.8'));
		first.c.ws.close();
		await first.c.closed;
		for (let i = 0; i < 100; i++) {
			const again = new Client(url, from('203.0.113.7'));
			const ok = await again.opened.then(
				() => true,
				() => false
			);
			if (ok) return;
			await new Promise((r) => setTimeout(r, 10));
		}
		throw new Error('the address never got its place back');
	});

	it('tells every socket to come straight back when the server stops, before anyone hears who left', async () => {
		const { url, presence } = await start();
		const { c: ada } = await joined(url, 'Ada', 'a'.repeat(20));
		const { c: bo } = await joined(url, 'Bo', 'b'.repeat(20));
		ada.where(1, 0, 0);
		bo.where(1, 1, 0);
		await ada.next('peer');
		await bo.next('peer');
		// One more that has not said hello yet.
		const quiet = new Client(url);
		await quiet.opened;
		presence.restart();
		for (const c of [ada, bo, quiet]) {
			expect((await c.closed).code).toBe(byeCloseCode('restart'));
			expect(c.got.at(-1)).toEqual({ t: 'bye', reason: 'restart' });
			expect(c.got.some((m) => m.t === 'gone')).toBe(false);
		}
		// The server hears each close a moment after the page does.
		for (let i = 0; i < 100 && presence.hub.size > 0; i++)
			await new Promise((r) => setTimeout(r, 10));
		expect(presence.hub.size).toBe(0);
		// And no new socket: the next copy of the server takes them.
		await expect(new Client(url).opened).rejects.toThrow('HTTP 503');
	});

	it('gives a player the same public id on every copy of the server that shares the secret', async () => {
		const guest = 'c'.repeat(20);
		const pids: string[] = [];
		for (const idSecret of ['one secret', 'one secret', 'another secret', undefined, undefined]) {
			const { url } = await start({ idSecret });
			const { c, pid } = await joined(url, 'Cy', guest);
			pids.push(pid);
			c.ws.close();
		}
		const [first, again, other, random, random2] = pids;
		expect(again).toBe(first);
		expect(new Set([first, other, random, random2]).size).toBe(4);
	});

	it('holds at most maxSockets sockets', async () => {
		const { url } = await start({ maxSockets: 2 });
		await joined(url, 'Ada', 'a'.repeat(20));
		await joined(url, 'Bo', 'b'.repeat(20));
		await expect(new Client(url).opened).rejects.toThrow('HTTP 503');
	});
});

/**
 * A WebSocket frame from a client (text, unless `opcode` says otherwise), masked as a
 * client's must be: for a raw socket that ignores the rules.
 */
function frame(data: string | Buffer, opcode = 0x1): Buffer {
	const payload = typeof data === 'string' ? Buffer.from(data) : data;
	const mask = randomBytes(4);
	const head =
		payload.length < 126
			? Buffer.from([0x80 | opcode, 0x80 | payload.length])
			: Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 255]);
	const masked = Buffer.alloc(payload.length);
	for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i % 4]!;
	return Buffer.concat([head, mask, masked]);
}

/** A socket that shakes hands and then does what the test writes to it, rules or none. */
async function rawSocket(port: number) {
	const s = connect(port, '127.0.0.1');
	const got: Buffer[] = [];
	const text = () => Buffer.concat(got).toString('latin1');
	s.on('data', (d: Buffer) => got.push(d));
	s.on('error', () => {});
	/** Once the server has sent `what`. */
	const heard = (what: string) =>
		new Promise<void>((resolve) => {
			const check = () => {
				if (!text().includes(what)) return;
				s.off('data', check);
				resolve();
			};
			s.on('data', check);
			check();
		});
	const closed = new Promise<void>((resolve) => s.once('close', () => resolve()));
	await new Promise((r) => s.once('connect', r));
	s.write(
		`GET ${PRESENCE_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
			`Connection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
			'Sec-WebSocket-Version: 13\r\n\r\n'
	);
	await heard('\r\n\r\n');
	expect(text()).toMatch(/^HTTP\/1\.1 101 /);
	return { s, heard, closed };
}

describe('battles seen from outside, over the socket', () => {
	const view = (hp: number, nickname?: unknown) => ({
		realm: 'land',
		a: nickname === undefined ? { species: 'rabbit', hp } : { species: 'rabbit', nickname, hp },
		b: { species: 'fox', hp: 1 },
		turn: 'a',
		puzzle: { kind: 'mul', numbers: [7, 8] }
	});

	it("passes a page's battle to a player near it, as numbers and a clean nickname and nothing else", async () => {
		const { url } = await start();
		const { c: ada, pid } = await joined(url, 'Ada', 'a'.repeat(20));
		const { c: bo } = await joined(url, 'Bo', 'b'.repeat(20));
		bo.where(1, 2, 0);
		ada.where(1, 0, 0, 'battle');
		await bo.until((m): m is ServerMessage => m.t === 'peer' && m.busy === 'battle');
		ada.send({
			t: 'battle',
			view: {
				...view(3, 'Pip'),
				words: 'hello',
				puzzle: { kind: 'mul', numbers: [7, 8], prompt: 'hi' }
			},
			events: [{ type: 'judged', side: 'a', correct: true, said: 'nice' }]
		});
		expect(await bo.next('fight')).toEqual({
			t: 'fight',
			pid,
			vs: null,
			view: view(3, 'Pip'),
			events: [{ type: 'judged', side: 'a', correct: true }]
		});
		// A rude nickname reaches nobody: the rabbit goes by its kind.
		const after = bo.got.length;
		ada.send({ t: 'battle', view: view(2, 'shit'), events: [] });
		expect((await bo.next('fight', 2000, after)).view).toEqual(view(2));
		// A battle is never shown to its own page.
		expect(ada.got.filter((m) => m.t === 'fight')).toEqual([]);
	});

	it('passes on a few reports a second, drops the rest quietly, and counts a report that is not one as junk', async () => {
		const { url } = await start({ battleRatePerSecond: 1, battleBurst: 3, maxInvalid: 3 });
		const { c: ada } = await joined(url, 'Ada', 'a'.repeat(20));
		const { c: bo } = await joined(url, 'Bo', 'b'.repeat(20));
		bo.where(1, 2, 0);
		ada.where(1, 0, 0, 'battle');
		await bo.until((m): m is ServerMessage => m.t === 'peer' && m.busy === 'battle');
		for (let hp = 0; hp < 8; hp++) ada.send({ t: 'battle', view: view(hp), events: [] });
		await new Promise((r) => setTimeout(r, 300));
		expect(bo.got.filter((m) => m.t === 'fight').length).toBe(3);
		// Words where a puzzle goes, a species nobody knows: not a report, and a few of them close the socket.
		ada.send({ t: 'battle', view: { ...view(1), puzzle: '7 × 8 = ? hi' }, events: [] });
		ada.send({ t: 'battle', view: { ...view(1), a: { species: 'dragon', hp: 1 } }, events: [] });
		ada.send({ t: 'battle', view: view(1), events: [{ type: 'said', text: 'hello' }] });
		expect(await ada.next('bye')).toEqual({ t: 'bye', reason: 'invalid' });
		expect(bo.got.filter((m) => m.t === 'fight').length).toBe(3);
	});
});

describe('presence socket under attack', () => {
	it('never lets a socket closed for cause back in, however it goes on sending', async () => {
		// The server's timeouts wait on the fake clock: the socket it closes is not cut off (a
		// second after its bye, on the real clock) before the server has read all it sends.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const logs: string[] = [];
		const { url, port, presence } = await start({ maxInvalid: 3, log: (l) => logs.push(l) });
		const { c: kid } = await joined(url, 'Kid', 'k'.repeat(20));
		kid.where(1, 0, 0);
		const joins = vi.spyOn(presence.hub, 'join');
		const raw = await rawSocket(port);
		for (let i = 0; i < 3; i++) raw.s.write(frame('junk'));
		await raw.heard('"bye"');
		// It ignores the close, says hello and stands next to the kid.
		raw.s.write(
			frame(
				JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, guest: 'z'.repeat(20), name: 'Ghost' })
			)
		);
		raw.s.write(
			frame(
				JSON.stringify({
					t: 'where',
					world: 1,
					x: 1,
					y: 0,
					facing: 'down',
					lead: null,
					boat: false,
					busy: 'battle'
				})
			)
		);
		// Then floods: nothing more is logged of a socket already on its way out.
		for (let i = 0; i < 2000; i++) raw.s.write(frame('x'));
		// At last it answers the close (code 1000). The server reads a socket's frames in order,
		// so once it has ended the connection it has read all the rest.
		raw.s.write(frame(Buffer.from([0x03, 0xe8]), 0x8));
		await raw.closed;
		await roundTrip(kid);
		expect(joins).not.toHaveBeenCalled();
		expect(kid.got.filter((m) => m.t === 'peer')).toEqual([]);
		expect(logs.length).toBeLessThanOrEqual(1);
	});

	it('survives upgrades that reset as they are refused: a wrong path, another site, a full server', async () => {
		const { url, port, server } = await start({ maxSockets: 1 });
		const { c: ada } = await joined(url, 'Ada', 'a'.repeat(20));
		const raw = (path: string, origin: string) =>
			new Promise<void>((resolve) => {
				const s = connect(port, '127.0.0.1');
				s.on('error', () => resolve());
				s.on('close', () => resolve());
				s.on('connect', () => {
					s.write(
						`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${origin}Upgrade: websocket\r\n` +
							'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
							'Sec-WebSocket-Version: 13\r\n\r\n'
					);
					s.resetAndDestroy();
				});
			});
		for (let i = 0; i < 60; i++) {
			await Promise.all([
				raw('/nope', ''),
				raw(PRESENCE_PATH, 'Origin: https://evil.example\r\n'),
				raw(PRESENCE_PATH, '')
			]);
		}
		// The server has let every one of them go, whatever it wrote to it: only Ada's is left.
		while ((await connections(server)) > 1) await new Promise((r) => setImmediate(r));
		// Still up (a write to a socket the other end reset must never take the process down):
		// it still answers, and Ada is still there.
		expect(await fetch(`http://127.0.0.1:${port}/`).then((r) => r.status)).toBe(404);
		await roundTrip(ada);
		expect(ada.ws.readyState).toBe(WebSocket.OPEN);
		// About 0.3 s alone (180 upgrades, each reset as it is refused); 2.6 s beside the rest of
		// the server's tests at a load average of 50 to 72.
	}, 30_000);
});
