import type { SaveWrite } from '@mathgame/engine';

/**
 * The server backup's HTTP API ([[ARCHITECTURE]] § HTTP API), reduced to the
 * outcomes the autosave acts on. Every outcome needs the API's own JSON
 * answer, not only its status. Anything it cannot place — a network error, a
 * timeout, a 5xx, a page from something that is not our API (a proxy's
 * error, a tunnel's warning page, whatever its status) — is `offline`: the
 * state of the server is unknown, so nothing is decided from it.
 */

export interface Identity {
	id: string;
	secret: string;
}

export type ServerCreate = { kind: 'created'; identity: Identity } | { kind: 'offline' };

export type ServerRead =
	| { kind: 'found'; doc: unknown }
	| { kind: 'none' }
	| { kind: 'unknown-player' }
	| { kind: 'offline' };

export type ServerWrite =
	| { kind: 'saved' }
	/** The server holds a save with the same or a higher `seq` (409). */
	| { kind: 'conflict' }
	/** 400 or 413: this build wrote a document the server refuses. A bug, not a network problem. */
	| { kind: 'refused'; error: string }
	| { kind: 'unknown-player' }
	| { kind: 'offline' };

export interface SaveServer {
	createPlayer(): Promise<ServerCreate>;
	getSave(who: Identity, timeoutMs?: number): Promise<ServerRead>;
	/** `keepalive` lets the request outlive the page (`pagehide`); `sendBeacon` cannot send a header. */
	putSave(who: Identity, doc: SaveWrite, keepalive?: boolean): Promise<ServerWrite>;
}

/** The server's 404 bodies, which tell "nothing saved yet" from "no such player". */
const NO_SAVE = 'no save yet';
const NO_PLAYER = 'no such player';

/**
 * Background requests give up after this. Generous: the first ones go out
 * while the first frames build the world, which can hold the page's thread
 * for seconds on a slow machine, and an answer that arrives after the abort
 * is lost (a player made twice, the first one never used).
 */
const TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `v` is an identity as the server hands them out. */
export function isIdentity(v: unknown): v is Identity {
	if (typeof v !== 'object' || v === null) return false;
	const { id, secret } = v as Record<string, unknown>;
	return typeof id === 'string' && UUID.test(id) && typeof secret === 'string' && secret.length > 0;
}

async function send(
	url: string,
	init: RequestInit,
	timeoutMs = TIMEOUT_MS
): Promise<{ status: number; body: unknown } | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { ...init, signal: controller.signal });
		const json = (res.headers.get('content-type') ?? '').includes('application/json');
		let body: unknown = undefined;
		if (json) body = await res.json().catch(() => undefined);
		return { status: res.status, body };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** The `error` of one of the API's JSON error answers (`{ error: string }`). */
function errorOf(body: unknown): string | undefined {
	if (typeof body !== 'object' || body === null) return undefined;
	const error = (body as Record<string, unknown>).error;
	return typeof error === 'string' ? error : undefined;
}

/** The API's answer to a stored backup: `{ ok: true }`. */
function isStored(body: unknown): boolean {
	return typeof body === 'object' && body !== null && (body as Record<string, unknown>).ok === true;
}

/** 401, a missing or wrong secret, or 404 `no such player`: the API does not know this player. */
function unknownPlayer(res: { status: number; body: unknown }): boolean {
	const error = errorOf(res.body);
	return (res.status === 401 && error !== undefined) || (res.status === 404 && error === NO_PLAYER);
}

function auth(who: Identity): Record<string, string> {
	return { authorization: `Bearer ${who.secret}` };
}

/** The API under `base`, same origin: Vite proxies it in development, the server serves both in production. */
export function httpSaveServer(base = '/api'): SaveServer {
	return {
		async createPlayer() {
			const res = await send(`${base}/players`, { method: 'POST' });
			if (res?.status === 201 && isIdentity(res.body)) {
				return { kind: 'created', identity: { id: res.body.id, secret: res.body.secret } };
			}
			return { kind: 'offline' };
		},

		async getSave(who, timeoutMs) {
			const url = `${base}/players/${encodeURIComponent(who.id)}/save`;
			const res = await send(url, { headers: auth(who) }, timeoutMs);
			if (!res) return { kind: 'offline' };
			if (res.status === 200 && res.body !== undefined) return { kind: 'found', doc: res.body };
			if (res.status === 404 && errorOf(res.body) === NO_SAVE) return { kind: 'none' };
			if (unknownPlayer(res)) return { kind: 'unknown-player' };
			return { kind: 'offline' };
		},

		async putSave(who, doc, keepalive = false) {
			const url = `${base}/players/${encodeURIComponent(who.id)}/save`;
			const res = await send(url, {
				method: 'PUT',
				keepalive,
				headers: { ...auth(who), 'content-type': 'application/json' },
				body: JSON.stringify(doc)
			});
			if (!res) return { kind: 'offline' };
			if (res.status === 200 && isStored(res.body)) return { kind: 'saved' };
			const error = errorOf(res.body);
			if (res.status === 409 && error !== undefined) return { kind: 'conflict' };
			if ((res.status === 400 || res.status === 413) && error !== undefined) {
				return { kind: 'refused', error };
			}
			if (unknownPlayer(res)) return { kind: 'unknown-player' };
			return { kind: 'offline' };
		}
	};
}
