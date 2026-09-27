import type { SaveWrite } from '@mathgame/engine';

/**
 * The server's copy of the game, as the autosave sees it: an account's save
 * (`accountSaveServer` in `account/api.ts`; [[ARCHITECTURE]] § HTTP API),
 * reduced to the outcomes the autosave acts on, and the pieces every API
 * client here shares. Every outcome needs the API's own JSON answer, not only
 * its status. Anything it cannot place — a network error, a timeout, a 5xx, a
 * page from something that is not our API (a proxy's error, a tunnel's
 * warning page, whatever its status) — is `offline`: the state of the server
 * is unknown, so nothing is decided from it.
 */

export type ServerRead =
	| { kind: 'found'; doc: unknown }
	| { kind: 'none' }
	/** The account's session has ended, or the cookie is another account's. */
	| { kind: 'logged-out' }
	| { kind: 'offline' };

export type ServerWrite =
	| { kind: 'saved' }
	/** The server holds a save with the same or a higher `seq` (409). */
	| { kind: 'conflict' }
	/** 400 or 413: this build wrote a document the server refuses. A bug, not a network problem. */
	| { kind: 'refused'; error: string }
	/** The account's session has ended, or the cookie is another account's. */
	| { kind: 'logged-out' }
	| { kind: 'offline' };

/** The account's save on the server, which the browser's session cookie names. */
export interface SaveServer {
	getSave(timeoutMs?: number): Promise<ServerRead>;
	/** `keepalive` lets the request outlive the page (`pagehide`); `sendBeacon` cannot send a header. */
	putSave(doc: SaveWrite, keepalive?: boolean): Promise<ServerWrite>;
}

/**
 * Background requests give up after this. Generous: the first ones go out
 * while the first frames build the world, which can hold the page's thread
 * for seconds on a slow machine, and an answer that arrives after the abort
 * is lost.
 */
const TIMEOUT_MS = 15_000;

/**
 * One request to the API, and its answer: the status and the JSON body (none
 * when the answer is not JSON). Null for no answer at all: a network error,
 * or no answer within `timeoutMs`.
 */
export async function send(
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
export function errorOf(body: unknown): string | undefined {
	if (typeof body !== 'object' || body === null) return undefined;
	const error = (body as Record<string, unknown>).error;
	return typeof error === 'string' ? error : undefined;
}

/** The API's answer to a stored save: `{ ok: true }`. */
export function isStored(body: unknown): boolean {
	return typeof body === 'object' && body !== null && (body as Record<string, unknown>).ok === true;
}

/** A stored save as the API returns it: every one it holds passed its check, and has a `version`. */
export function isStoredSave(body: unknown): boolean {
	return (
		typeof body === 'object' &&
		body !== null &&
		typeof (body as Record<string, unknown>).version === 'number'
	);
}
