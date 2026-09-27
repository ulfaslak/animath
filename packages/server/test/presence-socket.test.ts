import {
	BYE_REASONS,
	PROTOCOL_VERSION,
	nameKey,
	parseServerMessage,
	type ServerMessage
} from '@mathgame/engine';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type ClientOptions } from 'ws';
import {
	BYE_CLOSE_CODE,
	PRESENCE_PATH,
	REFRESH_CLOSE_CODE,
	attachPresence,
	type PresenceOptions
} from '../src/presence/socket.js';
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
	return { presence, port, url: `ws://127.0.0.1:${port}${PRESENCE_PATH}` };
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

const byeCode = (reason: (typeof BYE_REASONS)[number]) =>
	BYE_CLOSE_CODE + BYE_REASONS.indexOf(reason);

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
		await new Promise((r) => setTimeout(r, 150));
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
			expect((await c.closed).code).toBe(byeCode('name'));
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
		expect((await first.closed).code).toBe(byeCode('replaced'));
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
		expect((await c.closed).code).toBe(byeCode('flood'));
	});

	it('closes a socket that keeps sending what is no message, or says nothing', async () => {
		const { url } = await start({ maxInvalid: 3, helloTimeoutMs: 300 });
		const junk = new Client(url);
		await junk.opened;
		junk.send('not json');
		junk.ws.send(Buffer.from([1, 2, 3]));
		junk.send({ t: 'where', world: 1, x: 0, y: 0 }); // before hello, and half a message
		expect(await junk.next('bye')).toEqual({ t: 'bye', reason: 'invalid' });
		const silent = new Client(url);
		await silent.opened;
		expect(await silent.next('bye', 2000)).toEqual({ t: 'bye', reason: 'invalid' });
		// A second hello counts too.
		const { c: twice } = await joined(url, 'Ada', 'a'.repeat(20));
		for (let i = 0; i < 3; i++) twice.hello();
		expect(await twice.next('bye')).toEqual({ t: 'bye', reason: 'invalid' });
	});

	it('drops a socket that stops answering pings', async () => {
		const { url, presence } = await start({ heartbeatMs: 100 });
		const { c: quiet } = await joined(url, 'Ada', 'a'.repeat(20), { autoPong: false });
		const { c: lively } = await joined(url, 'Bo', 'b'.repeat(20));
		quiet.where(1, 0, 0);
		lively.where(1, 1, 0);
		await lively.next('peer');
		expect((await quiet.closed).code).toBe(1006);
		expect(await lively.next('gone')).toMatchObject({ t: 'gone' });
		expect(presence.hub.size).toBe(1);
	});

	it('holds at most maxSockets sockets', async () => {
		const { url } = await start({ maxSockets: 2 });
		await joined(url, 'Ada', 'a'.repeat(20));
		await joined(url, 'Bo', 'b'.repeat(20));
		await expect(new Client(url).opened).rejects.toThrow('HTTP 503');
	});
});

/** A WebSocket frame of text from a client, masked as a client's must be: for a raw socket that ignores the rules. */
function frame(text: string): Buffer {
	const payload = Buffer.from(text);
	const mask = randomBytes(4);
	const head =
		payload.length < 126
			? Buffer.from([0x81, 0x80 | payload.length])
			: Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 255]);
	const masked = Buffer.alloc(payload.length);
	for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i % 4]!;
	return Buffer.concat([head, mask, masked]);
}

/** A socket that shakes hands and then never answers a close: it goes on sending. */
async function rawSocket(port: number) {
	const s = connect(port, '127.0.0.1');
	const got: Buffer[] = [];
	s.on('data', (d: Buffer) => got.push(d));
	s.on('error', () => {});
	await new Promise((r) => s.once('connect', r));
	s.write(
		`GET ${PRESENCE_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
			`Connection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
			'Sec-WebSocket-Version: 13\r\n\r\n'
	);
	await new Promise((r) => setTimeout(r, 100));
	return { s, text: () => Buffer.concat(got).toString('latin1') };
}

describe('presence socket under attack', () => {
	it('never lets a socket closed for cause back in, however it goes on sending', async () => {
		const logs: string[] = [];
		const { url, port, presence } = await start({ maxInvalid: 3, log: (l) => logs.push(l) });
		const { c: kid } = await joined(url, 'Kid', 'k'.repeat(20));
		kid.where(1, 0, 0);
		const raw = await rawSocket(port);
		for (let i = 0; i < 3; i++) raw.s.write(frame('junk'));
		await new Promise((r) => setTimeout(r, 100));
		expect(raw.text()).toContain('"bye"');
		// It ignores the close, says hello and stands next to the kid.
		raw.s.write(
			frame(
				JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, guest: 'z'.repeat(20), name: 'Ghost' })
			)
		);
		await new Promise((r) => setTimeout(r, 50));
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
		await new Promise((r) => setTimeout(r, 300));
		expect(kid.got.filter((m) => m.t === 'peer')).toEqual([]);
		expect(presence.hub.size).toBe(1);
		expect(logs.length).toBeLessThanOrEqual(1);
		raw.s.destroy();
	});

	it('survives upgrades that reset as they are refused: a wrong path, another site, a full server', async () => {
		const { url, port } = await start({ maxSockets: 1 });
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
		await new Promise((r) => setTimeout(r, 200));
		// Still up (a write to a socket the other end reset must never take the process down):
		// it still answers, and Ada is still there.
		expect(await fetch(`http://127.0.0.1:${port}/`).then((r) => r.status)).toBe(404);
		expect(ada.ws.readyState).toBe(WebSocket.OPEN);
	});
});
