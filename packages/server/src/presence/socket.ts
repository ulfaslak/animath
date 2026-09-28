import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
	MAX_MESSAGE_BYTES,
	PROTOCOL_VERSION,
	REFRESH_CLOSE_CODE,
	byeCloseCode,
	checkName,
	helloVersion,
	parseClientMessage,
	readWire,
	type ByeReason,
	type ServerMessage
} from '@mathgame/engine';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { clientAddress, rateKey } from '../request.js';
import { PresenceHub, type Peer } from './hub.js';
import { Matches, type MatchOptions } from './matches.js';

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
 *   The server holds `maxSockets` sockets at most, `maxPerAddress` from any
 *   one address (the one our proxy saw, an IPv6 household's /64 as one), so
 *   one machine can't take every place or fill a world, and stops writing to
 *   a socket that stopped reading (`maxBuffered` bytes waiting).
 * - **Who is still there.** Every `heartbeatMs` each socket is pinged, and
 *   one that did not answer the last ping is dropped: a tab closed without
 *   a goodbye, a laptop lid shut.
 * - **Stopping.** A server that is about to stop (a deploy swapping it for
 *   the next copy) tells every socket to come straight back (`restart`),
 *   which reaches the copy taking over, and takes no new one. Public ids are
 *   made from `idSecret`, which every copy shares, so a player keeps theirs
 *   from one copy to the next, and the pages that see them draw them on.
 *   Friendly matches (`matches.ts`) end first: a match lives in this
 *   process, and the pages offer to play again once they are back. Every
 *   `hi` carries this run's own id (`boot`), so a page that comes back to a
 *   server that stopped without a word (a crash) knows its match went with
 *   it, rather than ending while the page was away.
 * - **Matches.** The same socket carries friendly matches: the invites and
 *   the matches themselves are `matches.ts`'s, which hears every socket that
 *   says hello, says where it is or closes, whatever closed it.
 * - **Battles seen from outside.** A page reports its own battle with a
 *   wild animal (`battle`), read like everything else through the engine's
 *   parser (numbers and species, never a nickname or any other words), and
 *   the hub passes it on to the players near it: at most `battleRatePerSecond`
 *   a second (a kid plays a step every second or two), so what one page can
 *   make the server send each player near it stays small.
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
	maxPerAddress?: number;
	maxPerWorld?: number;
	ratePerSecond?: number;
	burst?: number;
	maxDropped?: number;
	maxInvalid?: number;
	maxBuffered?: number;
	/**
	 * Reports of a page's own battle (`battle`) passed on each second, on
	 * average (`battleBurst` at once): the rest are dropped, quietly.
	 */
	battleRatePerSecond?: number;
	battleBurst?: number;
	/**
	 * What public ids are made from, with who each player is: a secret every
	 * copy of the server shares, so a player keeps their id across a restart and
	 * from one copy to the next, and nobody can work back from it to who they
	 * are. Without one, a random one: ids last while this server runs.
	 */
	idSecret?: string;
	/**
	 * This run's own id, in every `hi`: a new random one each time the server
	 * starts, unlike the public ids. A page whose match was going on and comes
	 * back to a server with another one knows the server restarted, and forgot
	 * the match, though no `bye` said so (it stopped without one).
	 */
	boot?: string;
	/** A line for the server's log: a socket closed for cause. */
	log?: (line: string) => void;
	/** The friendly matches' times and limits (`matches.ts`). */
	matches?: MatchOptions;
}

export interface Presence {
	readonly hub: PresenceHub;
	readonly matches: Matches;
	/**
	 * This server is about to stop: every socket is told to come straight back
	 * (`bye: restart`, closed with its code) and closed, and no new socket is
	 * taken. The next copy of the server takes them; the pages come back to it
	 * quietly.
	 */
	restart(): void;
	/** Stop: every socket closed, the timers and the upgrade handler gone. */
	close(): Promise<void>;
}

interface SocketState {
	alive: boolean;
	tokens: number;
	lastRefill: number;
	windowStart: number;
	dropped: number;
	invalid: number;
	/** The page's own battle's reports have a bucket of their own (`battleRatePerSecond`). */
	battleTokens: number;
	battleRefill: number;
}

export function attachPresence(server: Server, options: PresenceOptions = {}): Presence {
	const accountOf = options.accountOf ?? noAccounts;
	const heartbeatMs = options.heartbeatMs ?? 20_000;
	const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
	const rosterMs = options.rosterMs ?? 2_000;
	const maxSockets = options.maxSockets ?? 1_000;
	const maxPerAddress = options.maxPerAddress ?? 40;
	const ratePerSecond = options.ratePerSecond ?? 10;
	const burst = options.burst ?? 20;
	const maxDropped = options.maxDropped ?? 40;
	const maxInvalid = options.maxInvalid ?? 10;
	const maxBuffered = options.maxBuffered ?? 256 * 1024;
	const battleRatePerSecond = options.battleRatePerSecond ?? 2;
	const battleBurst = options.battleBurst ?? 4;
	const log = options.log ?? (() => {});
	const boot = options.boot ?? randomBytes(9).toString('base64url');

	// Public ids: a keyed hash of who it is, so the same player keeps one (on every copy
	// of the server that shares the secret) and nobody can work back to their guest id.
	const secret = options.idSecret ?? randomBytes(32);
	const hub = new PresenceHub({
		pidFor: (key, attempt) =>
			createHmac('sha256', secret).update(`${attempt}:${key}`).digest('base64url').slice(0, 12),
		maxPerWorld: options.maxPerWorld
	});
	const matches = new Matches(hub, { log, ...options.matches });
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_MESSAGE_BYTES,
		perMessageDeflate: false
	});
	const states = new WeakMap<WebSocket, SocketState>();
	/** Upgrades waiting for their account lookup: they count against `maxSockets` too. */
	let opening = 0;
	/** Sockets open or opening, by the address they came from (`rateKey`). */
	const byAddress = new Map<string, number>();
	const release = (address: string) => {
		const left = (byAddress.get(address) ?? 1) - 1;
		if (left > 0) byAddress.set(address, left);
		else byAddress.delete(address);
	};
	/** Every open socket's peer, for telling them all to come back when the server stops. */
	const peers = new Map<WebSocket, Peer>();
	/** The server is stopping: no new socket. */
	let stopping = false;

	const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
		// Node takes its own error listener off a socket it hands to `upgrade`: until `ws`
		// adds one, a write to a socket the other end reset would be an unhandled error,
		// which takes the whole process down (every save with it). This one keeps it up.
		const quiet = () => {};
		socket.on('error', quiet);
		if (pathOf(req) !== PRESENCE_PATH) return refuse(socket, '404 Not Found');
		if (stopping) return refuse(socket, '503 Service Unavailable');
		if (!sameOrigin(req)) {
			log(`presence: refused a socket from ${String(req.headers.origin)}`);
			return refuse(socket, '403 Forbidden');
		}
		if (wss.clients.size + opening >= maxSockets) return refuse(socket, '503 Service Unavailable');
		const address = rateKey(
			clientAddress(req.socket.remoteAddress, headerOf(req, 'x-forwarded-for'))
		);
		if ((byAddress.get(address) ?? 0) >= maxPerAddress) {
			// Not which address: no log keeps a player's (DECISIONS § Deployment).
			log(`presence: refused a socket from an address holding ${maxPerAddress} already`);
			return refuse(socket, '429 Too Many Requests');
		}
		byAddress.set(address, (byAddress.get(address) ?? 0) + 1);
		// However it ends (refused below, a handshake `ws` turns down, a socket closed), the place is given back.
		socket.once('close', () => release(address));
		opening++;
		// A database that does not answer makes a guest of an account holder, not a socket
		// that waits for ever holding a place.
		withTimeout(accountOf(headersOf(req)), ACCOUNT_LOOKUP_MS)
			.catch(() => null)
			.then((account) => {
				opening--;
				if (socket.destroyed) return;
				if (stopping) return refuse(socket, '503 Service Unavailable');
				wss.handleUpgrade(req, socket, head, (ws) => {
					socket.off('error', quiet);
					open(ws, account);
				});
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
			invalid: 0,
			battleTokens: battleBurst,
			battleRefill: now
		};
		states.set(ws, state);
		/**
		 * The socket is on its way out: told to go (`bye`, or `refresh`) and closing.
		 * A client may ignore the close and go on sending for as long as `ws` waits for
		 * its answer; nothing it sends from here on is read, so it can never say hello
		 * again, and it is cut off a moment later whatever it does.
		 */
		let closing = false;
		const goodbye = (code: number, reason: string) => {
			if (closing) return;
			closing = true;
			ws.close(code, reason);
			setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
		};
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
				if (closing) return;
				peer.send({ t: 'bye', reason });
				goodbye(byeCloseCode(reason), reason);
			}
		};
		peers.set(ws, peer);
		/** Closed for cause: out of the hub first, so nobody sees it again; said once in the log. */
		const dismiss = (reason: ByeReason) => {
			if (closing) return;
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
			peers.delete(ws);
			hub.leave(peer);
			matches.left(peer);
		});
		ws.on('message', (data: RawData, isBinary: boolean) => {
			if (closing) return;
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
					goodbye(REFRESH_CLOSE_CODE, 'refresh');
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
				// A player back in a match hears so in the hi, and is sent the match straight after.
				const present = hub.present(peer);
				const match = present ? matches.joined(peer, present) : null;
				peer.send({ t: 'hi', v: PROTOCOL_VERSION, pid, name, match, boot });
				matches.resume(peer);
				return;
			}
			const message = parseClientMessage(value);
			switch (message?.t) {
				case 'where':
					hub.where(peer, message);
					matches.moved(peer);
					return;
				case 'find':
					hub.find(peer, message.pid);
					return;
				case 'challenge':
				case 'withdraw':
				case 'accept':
				case 'decline':
				case 'play':
				case 'here':
				case 'rematch':
				case 'done':
					matches.handle(peer, message);
					return;
				case 'battle':
					// A kid plays a step every second or two; a page that reports faster is not
					// shown faster, and the next report says how the battle stands anyway.
					if (takeBattleToken(state, battleRatePerSecond, battleBurst)) {
						hub.battle(peer, message.view, message.events);
					}
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
		matches,
		restart() {
			if (stopping) return;
			stopping = true;
			clearInterval(rosters);
			// A match lives in this process: it ends here, before its pages are sent on.
			matches.stop();
			// Every socket is told before any closes: a page hears `bye` before anyone's `gone`.
			for (const peer of peers.values()) peer.close('restart');
			log(`presence: stopping, ${peers.size} sockets told to come back`);
		},
		close() {
			clearInterval(heartbeat);
			clearInterval(rosters);
			matches.stop();
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

/**
 * Take a battle report's token from its own bucket: `ratePerSecond` come
 * back each second, up to `burst`. Without one the report is dropped: it is
 * already counted against the socket's own rate, so a flood still closes it.
 */
function takeBattleToken(state: SocketState, ratePerSecond: number, burst: number): boolean {
	const now = Date.now();
	state.battleTokens = Math.min(
		burst,
		state.battleTokens + ((now - state.battleRefill) / 1000) * ratePerSecond
	);
	state.battleRefill = now;
	if (state.battleTokens < 1) return false;
	state.battleTokens -= 1;
	return true;
}

/** How long a socket told to go has to answer the close before it is cut off. */
const CLOSE_GRACE_MS = 1_000;

/** How long the account lookup may take before the socket goes on as a guest's. */
const ACCOUNT_LOOKUP_MS = 3_000;

/** `promise`, or a rejection once `ms` have passed without it settling. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out')), ms);
		timer.unref();
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		);
	});
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

/** One header of an upgrade request, repeated ones joined as one list. */
function headerOf(req: IncomingMessage, name: string): string | undefined {
	const value = req.headers[name];
	return Array.isArray(value) ? value.join(', ') : value;
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
