import { ANIMALS } from '../animals/catalog.js';
import type { Direction } from '../world/types.js';

/**
 * The multiplayer wire: what a browser and the server say to each other over
 * the WebSocket at `/api/ws`, one JSON text message at a time.
 *
 * The server is the authority for what two players share ([[DECISIONS]]):
 * today that is presence — who is in which world, where, and what they are
 * doing. Everything else a player does is still decided in their own browser
 * (`LocalAuthority`), which tells the server where it stands (`where`), and
 * the server tells everyone else in that world who is near and who is about.
 *
 * Both ends read every message through a parser here before using it: an
 * unknown kind, a missing field, a number out of its bounds or of the wrong
 * kind, or text that is too long, and the message is null — ignored, never
 * half-read. A parser builds a new object from the fields it knows, so
 * nothing a client made up is ever passed on to another client.
 *
 * Kinds are tables, not a switch: a feature that talks over the same socket
 * (friendly matches) adds its messages to the unions and a parser to each
 * table, and bumps `PROTOCOL_VERSION` when an old page could no longer
 * understand the server. A page whose version the server no longer speaks is
 * told to `refresh` (it reloads at a calm moment: its game is saved in the
 * browser).
 */
export const PROTOCOL_VERSION = 1;

/**
 * The most a message may take on the wire, in bytes (the server closes a
 * socket that sends more). The biggest a client sends, a `hello` with a
 * 64-unit name of four-byte characters, is well under half of it.
 */
export const MAX_MESSAGE_BYTES = 4096;

/** How far from 0 a coordinate on the wire may be: far past anywhere a kid walks to. */
export const MAX_WIRE_COORD = 2 ** 30;

/** World numbers on the wire ([[DECISIONS]]: a world is a number from 1 to 9999). */
const MIN_WIRE_WORLD = 1;
const MAX_WIRE_WORLD = 9999;

/** A distance on the wire, in steps: two corners of the wire's square apart, and a rounding more. */
const MAX_WIRE_STEPS = 2 ** 33;

/**
 * A name on the wire, before the name rules: up to this many UTF-16 units.
 * The rules themselves (2–16 characters, letters, digits, inner spaces and
 * hyphens) are the server's check on a guest's name.
 */
export const MAX_WIRE_NAME = 64;

/** How many directions a roster's rough bearing tells apart: 16, like a compass rose. */
export const BEARINGS = 16;

/** How many players one roster lists at most: the nearest. */
export const MAX_ROSTER = 50;

/**
 * What a player is doing, which others see as a little bubble over them:
 * walking about (no bubble), in a battle with a wild animal, with the
 * doctor (the card, the shop), in the pause menu, or in a friendly match.
 */
export const BUSY_STATES = ['explore', 'battle', 'doctor', 'menu', 'match'] as const;
export type Busy = (typeof BUSY_STATES)[number];

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

/**
 * Why the server closed a socket: another window of this player took its
 * place, the name was refused, the world is full, too many messages, junk,
 * or this copy of the server is stopping (`restart`, a deploy's swap: come
 * straight back, to the copy taking over). New reasons go on the end, since
 * each one's place is its close code.
 */
export const BYE_REASONS = ['replaced', 'name', 'full', 'flood', 'invalid', 'restart'] as const;
export type ByeReason = (typeof BYE_REASONS)[number];

/** A socket closed with a `bye` is closed with this code plus the reason's place in `BYE_REASONS`. */
export const BYE_CLOSE_CODE = 4000;
/** A socket told to `refresh` is closed with this code. */
export const REFRESH_CLOSE_CODE = 4100;

/** The close code of a socket closed with a `bye` for `reason`. */
export function byeCloseCode(reason: ByeReason): number {
	return BYE_CLOSE_CODE + BYE_REASONS.indexOf(reason);
}

/** The reason a close code says, when it is a `bye`'s; else null. */
export function byeReasonOf(code: unknown): ByeReason | null {
	if (typeof code !== 'number' || !Number.isInteger(code)) return null;
	return BYE_REASONS[code - BYE_CLOSE_CODE] ?? null;
}

// --- from a browser ----------------------------------------------------------

/**
 * The first message on a socket. `guest` is the browser's own random id,
 * kept in its storage (an account holder is known by their session cookie
 * instead); `name` is the character's name, which the server checks with the
 * name rules. The server answers `hi`, or `refresh` for another version.
 */
export interface HelloMessage {
	t: 'hello';
	v: number;
	guest: string;
	name: string;
}

/**
 * Where the player is and what they are doing, sent whenever any of it
 * changes: the world, the tile, the way they face, the animal following them
 * (`lead`: the species on screen behind them, or null when nobody follows),
 * whether they own the boat (it rides on their back, and they sail in it on
 * the water), and what they are busy with.
 */
export interface WhereMessage {
	t: 'where';
	world: number;
	x: number;
	y: number;
	facing: Direction;
	lead: string | null;
	boat: boolean;
	busy: Busy;
}

/** "Where exactly is this player?": to go to them. Answered with `found` or `lost`. */
export interface FindMessage {
	t: 'find';
	pid: string;
}

export type ClientMessage = HelloMessage | WhereMessage | FindMessage;

// --- from the server ---------------------------------------------------------

/** Welcome: the socket's public id (`pid`), and the name the others see. */
export interface HiMessage {
	t: 'hi';
	v: number;
	pid: string;
	name: string;
}

/** The page speaks another version of this protocol (`v` is the server's): reload for the new game. */
export interface RefreshMessage {
	t: 'refresh';
	v: number;
}

/** A player near you, as they are now: sent when they come near, and every time they change. */
export interface PeerMessage {
	t: 'peer';
	pid: string;
	name: string;
	x: number;
	y: number;
	facing: Direction;
	lead: string | null;
	boat: boolean;
	busy: Busy;
}

/** That player is no longer near you: they walked off, went to another world, or left the game. */
export interface GoneMessage {
	t: 'gone';
	pid: string;
}

/**
 * Someone else in your world, roughly: which way (`bearing`, 0 to 15 round
 * the compass from grid up, clockwise; see `nearby.ts`) and how far, in
 * steps, rounded.
 */
export interface RosterEntry {
	pid: string;
	name: string;
	bearing: number;
	steps: number;
	busy: Busy;
}

/** Everyone else in your world, nearest first, at most `MAX_ROSTER`. */
export interface RosterMessage {
	t: 'roster';
	world: number;
	players: RosterEntry[];
}

/** Where a player you asked for (`find`) stands, exactly. */
export interface FoundMessage {
	t: 'found';
	pid: string;
	x: number;
	y: number;
}

/** The player you asked for is not in your world any more. */
export interface LostMessage {
	t: 'lost';
	pid: string;
}

/** The server is closing this socket, and why. */
export interface ByeMessage {
	t: 'bye';
	reason: ByeReason;
}

export type ServerMessage =
	| HiMessage
	| RefreshMessage
	| PeerMessage
	| GoneMessage
	| RosterMessage
	| FoundMessage
	| LostMessage
	| ByeMessage;

// --- reading -----------------------------------------------------------------

type Fields = Readonly<Record<string, unknown>>;
type Parser<T> = (o: Fields) => T | null;

function isRecord(value: unknown): value is Fields {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWhole(value: unknown, min: number, max: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

const TOKEN = /^[A-Za-z0-9_-]+$/;
function isToken(value: unknown, min: number, max: number): value is string {
	return (
		typeof value === 'string' && value.length >= min && value.length <= max && TOKEN.test(value)
	);
}

/** A guest's id: the browser's own, 16 to 64 characters of base64url. */
export function isGuestId(value: unknown): value is string {
	return isToken(value, 16, 64);
}

/** A socket's public id: the server's, 6 to 32 characters of base64url. */
export function isPid(value: unknown): value is string {
	return isToken(value, 6, 32);
}

function isWireName(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && value.length <= MAX_WIRE_NAME;
}

/** A world number on the wire. */
export function isWireWorld(value: unknown): value is number {
	return isWhole(value, MIN_WIRE_WORLD, MAX_WIRE_WORLD);
}

/** A coordinate on the wire. */
export function isWireCoord(value: unknown): value is number {
	return isWhole(value, -MAX_WIRE_COORD, MAX_WIRE_COORD);
}

function isDirection(value: unknown): value is Direction {
	return DIRECTIONS.includes(value as Direction);
}

function isBusy(value: unknown): value is Busy {
	return BUSY_STATES.includes(value as Busy);
}

const SPECIES = new Set(ANIMALS.map((a) => a.id));

/**
 * The animal following a player: a species of the catalog, or null. A
 * species this build does not know (a newer page's) reads as nobody, so
 * the rest of the message still counts.
 */
function readLead(value: unknown): { ok: true; lead: string | null } | { ok: false } {
	if (value === null) return { ok: true, lead: null };
	if (typeof value !== 'string' || value.length > 32) return { ok: false };
	return { ok: true, lead: SPECIES.has(value) ? value : null };
}

/** The fields `where` and `peer` share: a spot in the world and what the player there shows. */
function readSpot(o: Fields): Omit<WhereMessage, 't' | 'world'> | null {
	const lead = readLead(o.lead);
	if (
		!isWireCoord(o.x) ||
		!isWireCoord(o.y) ||
		!isDirection(o.facing) ||
		!lead.ok ||
		typeof o.boat !== 'boolean' ||
		!isBusy(o.busy)
	) {
		return null;
	}
	return { x: o.x, y: o.y, facing: o.facing, lead: lead.lead, boat: o.boat, busy: o.busy };
}

const CLIENT_PARSERS: { [K in ClientMessage['t']]: Parser<Extract<ClientMessage, { t: K }>> } = {
	hello: (o) =>
		o.v === PROTOCOL_VERSION && isGuestId(o.guest) && isWireName(o.name)
			? { t: 'hello', v: PROTOCOL_VERSION, guest: o.guest, name: o.name }
			: null,
	where: (o) => {
		const spot = readSpot(o);
		return spot && isWireWorld(o.world) ? { t: 'where', world: o.world, ...spot } : null;
	},
	find: (o) => (isPid(o.pid) ? { t: 'find', pid: o.pid } : null)
};

function readRosterEntry(value: unknown): RosterEntry | null {
	if (!isRecord(value)) return null;
	const { pid, name, bearing, steps, busy } = value;
	if (!isPid(pid) || !isWireName(name) || !isWhole(bearing, 0, BEARINGS - 1)) return null;
	if (!isWhole(steps, 0, MAX_WIRE_STEPS) || !isBusy(busy)) return null;
	return { pid, name, bearing, steps, busy };
}

const SERVER_PARSERS: { [K in ServerMessage['t']]: Parser<Extract<ServerMessage, { t: K }>> } = {
	hi: (o) =>
		isWhole(o.v, 0, 2 ** 31) && isPid(o.pid) && isWireName(o.name)
			? { t: 'hi', v: o.v, pid: o.pid, name: o.name }
			: null,
	refresh: (o) => (isWhole(o.v, 0, 2 ** 31) ? { t: 'refresh', v: o.v } : null),
	peer: (o) => {
		const spot = readSpot(o);
		return spot && isPid(o.pid) && isWireName(o.name)
			? { t: 'peer', pid: o.pid, name: o.name, ...spot }
			: null;
	},
	gone: (o) => (isPid(o.pid) ? { t: 'gone', pid: o.pid } : null),
	roster: (o) => {
		if (!isWireWorld(o.world) || !Array.isArray(o.players) || o.players.length > MAX_ROSTER) {
			return null;
		}
		const players: RosterEntry[] = [];
		for (const p of o.players) {
			const entry = readRosterEntry(p);
			if (!entry) return null;
			players.push(entry);
		}
		return { t: 'roster', world: o.world, players };
	},
	found: (o) =>
		isPid(o.pid) && isWireCoord(o.x) && isWireCoord(o.y)
			? { t: 'found', pid: o.pid, x: o.x, y: o.y }
			: null,
	lost: (o) => (isPid(o.pid) ? { t: 'lost', pid: o.pid } : null),
	bye: (o) =>
		BYE_REASONS.includes(o.reason as ByeReason) ? { t: 'bye', reason: o.reason as ByeReason } : null
};

function parseWith<M extends { t: string }>(
	parsers: { readonly [K in M['t']]: Parser<M> },
	value: unknown
): M | null {
	if (!isRecord(value) || typeof value.t !== 'string' || !Object.hasOwn(parsers, value.t)) {
		return null;
	}
	return parsers[value.t as M['t']](value);
}

/** A message from a browser, checked: null for anything that is not exactly one. */
export function parseClientMessage(value: unknown): ClientMessage | null {
	return parseWith<ClientMessage>(CLIENT_PARSERS, value);
}

/** A message from the server, checked: null for anything that is not exactly one. */
export function parseServerMessage(value: unknown): ServerMessage | null {
	return parseWith<ServerMessage>(SERVER_PARSERS, value);
}

/**
 * The version a `hello` speaks, before anything else in it is read: another
 * version's hello may hold other fields. Null when `value` is no hello.
 */
export function helloVersion(value: unknown): number | null {
	if (!isRecord(value) || value.t !== 'hello' || !isWhole(value.v, 0, 2 ** 31)) return null;
	return value.v;
}

/**
 * Text off the socket as JSON, or undefined when it is too long or no JSON
 * at all. (A JSON `null` is `null`, which no parser takes.)
 */
export function readWire(text: string): unknown {
	// A UTF-16 unit is at least one byte in UTF-8: longer text is surely too many bytes.
	if (text.length > MAX_MESSAGE_BYTES) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}
