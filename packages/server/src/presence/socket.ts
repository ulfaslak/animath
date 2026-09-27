import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
	BYE_REASONS,
	MAX_MESSAGE_BYTES,
	PROTOCOL_VERSION,
	helloVersion,
	parseClientMessage,
	readWire,
	type ByeReason,
	type ServerMessage
} from '@mathgame/engine';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { PresenceHub, type Peer } from './hub.js';
import { checkName } from './names.js';

/**
 * The presence socket: a WebSocket at `/api/ws` on the API's own HTTP
 * server, same origin as the game ([[ARCHITECTURE]] § Presence). Every
 * message is read through the engine's parsers (`net/protocol.ts`) and
 * handed to the hub; this file is the guard at the door:
 *
 * - **Who.** An account holder is known by their session cookie
 *   (`accountOf`, looked up once as the socket opens), anyone else by the
 *   guest id their `hello` carries, and shown by the name it carries once
 *   the name rules pass it. A page on another site can't open the socket
 *   with a kid's cookie: an `Origin` that is not this host's is refused.
 * - **Which version.** A hello of another protocol version is told to
 *   `refresh` and closed.
 * - **How much.** A message is at most `MAX_MESSAGE_BYTES` (the socket
 *   closes on a bigger one), text only; a socket may send `ratePerSecond`
 *   messages a second on average (`burst` at once), the rest are dropped,
 *   and one that keeps sending too many (`maxDropped` in ten seconds) is
 *   closed (`flood`); so is one that sends `maxInvalid` messages that are
 *   no message at all (`invalid`), or no hello within `helloTimeoutMs`.
 *   The server holds `maxSockets` sockets at most, and stops writing to a
 *   socket that stopped reading (`maxBuffered` bytes waiting).
 * - **Who is still there.** Every `heartbeatMs` each socket is pinged, and
 *   one that did not answer the last ping is dropped: a tab closed without
 *   a goodbye, a laptop lid shut.
 */
export const PRESENCE_PATH = '/api/ws';

/** An account holder, from their session: their id, and their username, which is their name. */
export interface Account {
	id: string;
	name: string;
}

/** The account a request's session cookie belongs to, or null for a guest. */
export type AccountOf = (headers: Headers) => Promise<Account | null>;

/** Until accounts land (`feat/accounts-server`), everyone is a guest. */
export const noAccounts: AccountOf = async () => null;

export interface PresenceOptions {
	accountOf?: AccountOf;
	heartbeatMs?: number;
	helloTimeoutMs?: number;
	rosterMs?: number;
	maxSockets?: number;
	maxPerWorld?: number;
	ratePerSecond?: number;
	burst?: number;
	maxDropped?: number;
	maxInvalid?: number;
	maxBuffered?: number;
	/** A line for the server's log: a socket closed for cause. */
	log?: (line: string) => void;
}

export interface Presence {
	readonly hub: PresenceHub;
	/** Stop: every socket closed, the timers and the upgrade handler gone. */
	close(): Promise<void>;
}

/** A socket closed with a `bye` carries the reason in its close code too. */
export const BYE_CLOSE_CODE = 4000;
/** A socket told to refresh is closed with this code. */
export const REFRESH_CLOSE_CODE = 4100;

interface SocketState {
	alive: boolean;
	tokens: number;
	lastRefill: number;
	windowStart: number;
	dropped: number;
	invalid: number;
}

export function attachPresence(server: Server, options: PresenceOptions = {}): Presence {
	const accountOf = options.accountOf ?? noAccounts;
	const heartbeatMs = options.heartbeatMs ?? 20_000;
	const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
	const rosterMs = options.rosterMs ?? 2_000;
	const maxSockets = options.maxSockets ?? 1_000;
	const ratePerSecond = options.ratePerSecond ?? 10;
	const burst = options.burst ?? 20;
	const maxDropped = options.maxDropped ?? 40;
	const maxInvalid = options.maxInvalid ?? 10;
	const maxBuffered = options.maxBuffered ?? 256 * 1024;
	const log = options.log ?? (() => {});

	const hub = new PresenceHub({
		mintPid: () => randomBytes(9).toString('base64url'),
		maxPerWorld: options.maxPerWorld
	});
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_MESSAGE_BYTES,
		perMessageDeflate: false
	});
	const states = new WeakMap<WebSocket, SocketState>();
	/** Upgrades waiting for their account lookup: they count against `maxSockets` too. */
	let opening = 0;

	const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
		if (pathOf(req) !== PRESENCE_PATH) return refuse(socket, '404 Not Found');
		if (!sameOrigin(req)) {
			log(`presence: refused a socket from ${String(req.headers.origin)}`);
			return refuse(socket, '403 Forbidden');
		}
		if (wss.clients.size + opening >= maxSockets) return refuse(socket, '503 Service Unavailable');
		opening++;
		accountOf(headersOf(req))
			.catch(() => null)
			.then((account) => {
				opening--;
				if (socket.destroyed) return;
				wss.handleUpgrade(req, socket, head, (ws) => open(ws, account));
			});
	};
	server.on('upgrade', onUpgrade);

	function open(ws: WebSocket, account: Account | null): void {
		const now = Date.now();
		const state: SocketState = {
			alive: true,
			tokens: burst,
			lastRefill: now,
			windowStart: now,
			dropped: 0,
			invalid: 0
		};
		states.set(ws, state);
		const peer: Peer = {
			send(message: ServerMessage) {
				if (ws.readyState !== WebSocket.OPEN) return;
				// A socket that stopped reading would hold everything sent to it in memory.
				if (ws.bufferedAmount > maxBuffered) {
					ws.terminate();
					return;
				}
				ws.send(JSON.stringify(message));
			},
			close(reason: ByeReason) {
				peer.send({ t: 'bye', reason });
				ws.close(BYE_CLOSE_CODE + BYE_REASONS.indexOf(reason), reason);
			}
		};
		/** Closed for cause: out of the hub first, so nobody sees it again. */
		const dismiss = (reason: ByeReason) => {
			hub.leave(peer);
			peer.close(reason);
			log(`presence: closed a socket (${reason})`);
		};
		const helloTimer = setTimeout(() => {
			if (!hub.has(peer)) dismiss('invalid');
		}, helloTimeoutMs);
		helloTimer.unref();

		const bad = () => {
			if (++state.invalid >= maxInvalid) dismiss('invalid');
		};

		ws.on('pong', () => {
			state.alive = true;
		});
		ws.on('error', () => {
			// A broken socket: `close` follows, which leaves the hub.
		});
		ws.on('close', () => {
			clearTimeout(helloTimer);
			hub.leave(peer);
		});
		ws.on('message', (data: RawData, isBinary: boolean) => {
			state.alive = true;
			if (!takeToken(state, ratePerSecond, burst)) {
				if (state.dropped > maxDropped) dismiss('flood');
				return;
			}
			if (isBinary) return bad();
			const value = readWire(textOf(data));
			if (!hub.has(peer)) {
				const version = helloVersion(value);
				if (version !== null && version !== PROTOCOL_VERSION) {
					peer.send({ t: 'refresh', v: PROTOCOL_VERSION });
					ws.close(REFRESH_CLOSE_CODE, 'refresh');
					return;
				}
				const hello = parseClientMessage(value);
				if (hello?.t !== 'hello') return bad();
				let key: string;
				let name: string;
				if (account) {
					key = `account:${account.id}`;
					name = account.name;
				} else {
					const check = checkName(hello.name);
					if (!check.ok) return dismiss('name');
					key = `guest:${hello.guest}`;
					name = check.name;
				}
				clearTimeout(helloTimer);
				const pid = hub.join(peer, key, name);
				peer.send({ t: 'hi', v: PROTOCOL_VERSION, pid, name });
				return;
			}
			const message = parseClientMessage(value);
			switch (message?.t) {
				case 'where':
					hub.where(peer, message);
					return;
				case 'find':
					hub.find(peer, message.pid);
					return;
				default:
					// A second hello, or nothing we know.
					return bad();
			}
		});
	}

	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			const state = states.get(ws);
			if (!state) continue;
			if (!state.alive) {
				ws.terminate();
				continue;
			}
			state.alive = false;
			ws.ping();
		}
	}, heartbeatMs);
	heartbeat.unref();
	const rosters = setInterval(() => hub.sendRosters(), rosterMs);
	rosters.unref();

	return {
		hub,
		close() {
			clearInterval(heartbeat);
			clearInterval(rosters);
			server.off('upgrade', onUpgrade);
			for (const ws of wss.clients) ws.terminate();
			return new Promise((resolve) => wss.close(() => resolve()));
		}
	};
}

/**
 * Take a message's token from the socket's bucket: `ratePerSecond` of them
 * come back each second, up to `burst`. Without one the message is dropped,
 * and counted: `dropped` is the count in the last ten seconds.
 */
function takeToken(state: SocketState, ratePerSecond: number, burst: number): boolean {
	const now = Date.now();
	state.tokens = Math.min(burst, state.tokens + ((now - state.lastRefill) / 1000) * ratePerSecond);
	state.lastRefill = now;
	if (now - state.windowStart > 10_000) {
		state.windowStart = now;
		state.dropped = 0;
	}
	if (state.tokens < 1) {
		state.dropped++;
		return false;
	}
	state.tokens -= 1;
	return true;
}

function pathOf(req: IncomingMessage): string {
	try {
		return new URL(req.url ?? '/', 'http://presence.invalid').pathname;
	} catch {
		return '';
	}
}

/**
 * Whether the page that opened the socket is this site: its `Origin` names
 * the host the request came to (or, behind a proxy, the host the proxy says
 * it came to). No `Origin` at all is no browser, and carries no kid's cookie.
 */
function sameOrigin(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	let host: string;
	try {
		host = new URL(origin).host.toLowerCase();
	} catch {
		return false;
	}
	const forwarded = req.headers['x-forwarded-host'];
	const hosts = [
		req.headers.host,
		...(typeof forwarded === 'string' ? forwarded.split(',') : (forwarded ?? []))
	];
	return hosts.some((h) => h !== undefined && h.trim().toLowerCase() === host);
}

function refuse(socket: Duplex, status: string): void {
	socket.once('finish', () => socket.destroy());
	socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function headersOf(req: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (typeof value === 'string') headers.set(key, value);
		else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
	}
	return headers;
}

function textOf(data: RawData): string {
	if (Buffer.isBuffer(data)) return data.toString('utf8');
	if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
	return Buffer.from(data).toString('utf8');
}
