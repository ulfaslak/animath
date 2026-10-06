import { ANIMALS, getAnimal } from '../animals/catalog.js';
import { ATTACK_LEVELS, type AnimalInstance, type AttackLevel } from '../animals/types.js';
import { MATCH_TEAM_SIZE } from '../match/team.js';
import {
	MATCH_SIDES,
	type MatchEndReason,
	type MatchEvent,
	type MatchIntent,
	type MatchRejection,
	type MatchSide,
	type MatchView,
	type MatchViewPhase,
	type ShownPuzzle
} from '../match/types.js';
import { ALL_PUZZLE_KINDS, MAX_DIFFICULTY, MIN_DIFFICULTY } from '../puzzles/types.js';
import { MAX_SAVE_ID_LENGTH } from '../save.js';
import type { Direction } from '../world/types.js';
import { readFightEvents, readFightView, type FightEvent, type FightView } from './fight.js';

/**
 * The multiplayer wire: what a browser and the server say to each other over
 * the WebSocket at `/api/ws`, one JSON text message at a time.
 *
 * The server is the authority for what two players share ([[DECISIONS]]):
 * presence — who is in which world, where, and what they are doing — and
 * friendly matches. Everything else a player does is still decided in their
 * own browser (`LocalAuthority`), which tells the server where it stands
 * (`where`), and the server tells everyone else in that world who is near and
 * who is about. A friendly match is played on the server: a page sends what
 * its kid chose (`play`), and the server sends each page its own view of the
 * match (`match`), which never holds a puzzle's answer.
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
 *
 * Version 2: friendly matches. Version 3: the glider's `flight` joined
 * `BUSY_STATES`. A version 2 server refuses a `where` that says it (junk, and
 * a whole glide of them closes the socket as `invalid`), and a version 2 page
 * drops a `peer` that says it, so the two could not speak. Version 4: battles
 * seen from outside (`battle` from a page, `fight` from the server:
 * `fight.ts`), which a version 3 server would count as junk. Version 5: the
 * big animals of #89's second wave. A page reads a `match` or a `fight` only
 * with species its own catalog has, so a version 4 page would drop every one
 * with a moose in it and never see the match: every new species bumps the
 * version. Version 6: the sea animals of #89's third wave, which a version 5
 * page would drop from a `fight` out at sea. Version 7: the birds in the air
 * (#91): the buzzard, and a `fight` fought in the air, which a version 6 page
 * drops for its realm.
 */
export const PROTOCOL_VERSION = 7;

/**
 * The most a message may take on the wire, in bytes (the server closes a
 * socket that sends more). The biggest a client sends, a `hello` with a
 * 64-unit name of four-byte characters, is well under half of it.
 */
export const MAX_MESSAGE_BYTES = 4096;

/**
 * The most a browser reads in one message from the server: a roster of
 * `MAX_ROSTER` players with names as long as the wire takes is about twice
 * `MAX_MESSAGE_BYTES`, and the server leaves the furthest off a roster that
 * would be longer.
 */
export const MAX_SERVER_MESSAGE_BYTES = 16_384;

/**
 * How far from 0 a coordinate on the wire may be: far past anywhere a kid
 * walks to (hours of walking one way), and near enough that the game still
 * draws every tile in its place, since a tile's place is a 32-bit float in
 * its matrix. A page further out is simply not seen, and a page that lies
 * about where it stands can send a friend who goes to it no further.
 */
export const MAX_WIRE_COORD = 100_000;

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
 * doctor (the card, the shop), in the pause menu, or in a friendly match. Or
 * up in the air with the glider (`flight`: no bubble, since the glider shows
 * it): from take-off to touch-down, the tiles in a `where` are flown over,
 * not walked, so the others draw them gliding.
 */
export const BUSY_STATES = ['explore', 'battle', 'doctor', 'menu', 'match', 'flight'] as const;
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
 * the water) and the harness (`harness`, only when they do: on land they ride
 * a lead big enough to carry them, `canRide`), and what they are busy with.
 */
export interface WhereMessage {
	t: 'where';
	world: number;
	x: number;
	y: number;
	facing: Direction;
	lead: string | null;
	boat: boolean;
	harness?: true;
	busy: Busy;
}

/** "Where exactly is this player?": to go to them. Answered with `found` or `lost`. */
export interface FindMessage {
	t: 'find';
	pid: string;
}

/**
 * An animal a page brings to a friendly match, as it sends it: the team its
 * party brings (`matchTeam`), without HP (everyone plays at full HP). The
 * server builds the team again from these with `matchTeam`, which checks
 * them and cleans the nicknames.
 */
export interface WireAnimal {
	id: string;
	speciesId: string;
	nickname?: string;
}

/**
 * "Would you like a friendly match?", to the player `pid`, bringing `team`.
 * Answered with `asking` (the invite is out) or `uninvite` (it can't be).
 */
export interface ChallengeMessage {
	t: 'challenge';
	pid: string;
	team: WireAnimal[];
}

/** The challenger takes their open challenge back. */
export interface WithdrawMessage {
	t: 'withdraw';
}

/** Yes to `pid`'s invite, bringing `team`: the match starts (`match`), or can't after all (`uninvite`). */
export interface AcceptMessage {
	t: 'accept';
	pid: string;
	team: WireAnimal[];
}

/** No to `pid`'s invite. */
export interface DeclineMessage {
	t: 'decline';
	pid: string;
}

/** What a kid can choose in a match: every `MatchIntent` but `timeout`, which only the server reports. */
export type PlayIntent = Exclude<MatchIntent, { type: 'timeout' }>;

/** A choice in match `id`: an attack, an answer, a switch, who steps in, or leaving. */
export interface PlayMessage {
	t: 'play';
	id: string;
	intent: PlayIntent;
}

/**
 * The kid is at the keys in match `id` (typing an answer, choosing, or
 * "I'm here!" after `nudge`): the turn clock starts again.
 */
export interface HereMessage {
	t: 'here';
	id: string;
}

/**
 * After match `id` ended: "Rematch?" — yes, bringing `team`. The next match
 * starts once both players have said so.
 */
export interface RematchMessage {
	t: 'rematch';
	id: string;
	team: WireAnimal[];
}

/**
 * After match `id` ended: this page is done with it (Back to exploring). A
 * rematch it asked for is taken back, and the other page hears it is off.
 */
export interface DoneMessage {
	t: 'done';
	id: string;
}

/**
 * The page's own battle with a wild animal, as the players near it may see
 * it (`fight.ts`): how it stands after the step (`view`) and what happened
 * in it (`events`; none when the battle just started, or the socket came
 * back). Sent while the page says it is busy in a battle, and read by the
 * server only then; the server passes it on to the players who see this one.
 */
export interface BattleMessage {
	t: 'battle';
	view: FightView;
	events: FightEvent[];
}

export type ClientMessage =
	| HelloMessage
	| WhereMessage
	| FindMessage
	| ChallengeMessage
	| WithdrawMessage
	| AcceptMessage
	| DeclineMessage
	| PlayMessage
	| HereMessage
	| RematchMessage
	| DoneMessage
	| BattleMessage;

// --- from the server ---------------------------------------------------------

/**
 * Welcome: the socket's public id (`pid`), the name the others see, and the
 * friendly match this player is in (its id), if one is going on: a page that
 * dropped out and came back is sent it again (`match`) at once. A page that
 * was in another match knows from this that it is over.
 *
 * `boot` is this run of the server's own id, new every time it starts: a
 * page back to no match can tell the server that forgot it (it restarted,
 * and no `bye` said so: it stopped without one) from the one it played on
 * (the match ended while the page was away). It may be left out, as a
 * match message's `rematchOf` and `calledOff` may: a server from before it
 * sends none (a rollback, or the old copy during a deploy), and a page
 * reads its `hi` all the same. An old page drops it, as every parser drops
 * a field it does not know, so it needed no new version.
 */
export interface HiMessage {
	t: 'hi';
	v: number;
	pid: string;
	name: string;
	match: string | null;
	boot?: string;
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
	harness?: true;
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

/** `pid` (called `name`) would like a friendly match: answer (`accept`, `decline`) within `ms`. */
export interface InviteMessage {
	t: 'invite';
	pid: string;
	name: string;
	ms: number;
}

/** Your challenge is out: `pid` has `ms` to answer it. */
export interface AskingMessage {
	t: 'asking';
	pid: string;
	ms: number;
}

/**
 * Why an invite is over without a match, said to each of its two players
 * about the other one ("they"):
 *
 * - `no`: they said no;
 * - `expired`: nobody answered in time;
 * - `withdrawn`: they took their challenge back;
 * - `gone`: they left the world or the game (or were never in yours);
 * - `moved`: they are out of reach: too far off, or out on the water;
 * - `busy`: they are busy: a battle, the doctor, the menu, a match;
 * - `taken`: they are asking someone else, or being asked;
 * - `wait`: they said no (or nothing) to you a moment ago: ask again soon;
 * - `no-team`: you bring no animal that can fight on land;
 * - `their-team`: they bring none;
 * - `off`: it ended by what you did yourself (you walked off, got busy,
 *   took it back, said no, or can't play now): nothing to tell you.
 */
export const INVITE_ENDS = [
	'no',
	'expired',
	'withdrawn',
	'gone',
	'moved',
	'busy',
	'taken',
	'wait',
	'no-team',
	'their-team',
	'off'
] as const;
export type InviteEnd = (typeof INVITE_ENDS)[number];

/** The invite between you and `pid` (whichever of you asked) is over, without a match. */
export interface UninviteMessage {
	t: 'uninvite';
	pid: string;
	reason: InviteEnd;
}

/**
 * Why the server reported a side gone (`timeout`): its page dropped out and
 * did not come back in time (`dropped`), or it sat on its turn past the turn
 * clock (`idle`).
 */
export const MATCH_TIMEOUTS = ['dropped', 'idle'] as const;
export type MatchTimeout = (typeof MATCH_TIMEOUTS)[number];

/**
 * A friendly match as this page may see it, sent at the start, after every
 * intent the match took (with its `events`, which the page plays back), and
 * again when anything else about it changes (a player dropped out or came
 * back; `events` is empty then). `view` is `matchView` for this page's side
 * (`view.you`): no answer anywhere. `pids` and `names` are both players', by
 * side. `away`: the side whose page dropped out, and how long it has left to
 * come back. `timeout`: why a side that timed out did (`view.phase` says it
 * ended `timed-out`).
 *
 * `rematchOf`: this match is a rematch of that one, both players having
 * said Rematch? on its result. `calledOff`: the rematch was called off
 * before anyone played it, because the kid who leaves it (`view.phase`) had
 * gone back to exploring from that result, their Back crossing the other's
 * Rematch? on the way (#147); a page that has it up puts that result back.
 * Both may be left out, as a `hi`'s `boot` may: a server from before them
 * sends neither, and a page from before them drops them, so they needed no
 * new version. Such a page reads a called-off rematch as the kid who went
 * back leaving it: the other kid's "Ada left the match.", and on the page of
 * the kid who went back, which put the rematch up as pages did before,
 * "You left the match.".
 */
export interface MatchMessage {
	t: 'match';
	id: string;
	pids: Record<MatchSide, string>;
	names: Record<MatchSide, string>;
	view: MatchView;
	events: WireMatchEvent[];
	away: { side: MatchSide; ms: number } | null;
	timeout: MatchTimeout | null;
	rematchOf?: string;
	calledOff?: true;
}

/** The events a match message carries: every `MatchEvent` but `rejected`, which goes in its own message. */
export type WireMatchEvent = Exclude<MatchEvent, { type: 'rejected' }>;

/** The match took no intent from this page: `reason` says why. Only the page that sent it hears. */
export interface RejectedMessage {
	t: 'rejected';
	id: string;
	reason: MatchRejection;
}

/** "Still there?": this page's kid has not touched the keys for a while on their turn. */
export interface NudgeMessage {
	t: 'nudge';
	id: string;
}

/**
 * After match `id` ended: side `side` would play again (`yes`), or went back
 * to exploring (`yes: false`), which puts a rematch off.
 */
export interface RematchWishMessage {
	t: 'rematch-wish';
	id: string;
	side: MatchSide;
	yes: boolean;
}

/**
 * A battle near you, seen from outside (`fight.ts`): player `pid`'s battle
 * with a wild animal, or, with `vs`, the friendly match between `pid` (side
 * `a`) and `vs` (side `b`). `view` is how it stands after `events`, which the
 * page plays first; none when you just came into view of it, or it just
 * began. Sent to the players who see either of its players, never to them.
 */
export interface FightMessage {
	t: 'fight';
	pid: string;
	vs: string | null;
	view: FightView;
	events: FightEvent[];
}

export type ServerMessage =
	| HiMessage
	| RefreshMessage
	| PeerMessage
	| GoneMessage
	| RosterMessage
	| FoundMessage
	| LostMessage
	| ByeMessage
	| InviteMessage
	| AskingMessage
	| UninviteMessage
	| MatchMessage
	| RejectedMessage
	| NudgeMessage
	| RematchWishMessage
	| FightMessage;

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
		(o.harness !== undefined && typeof o.harness !== 'boolean') ||
		!isBusy(o.busy)
	) {
		return null;
	}
	// The harness only when owned, so a page from before it is read as it always was.
	return {
		x: o.x,
		y: o.y,
		facing: o.facing,
		lead: lead.lead,
		boat: o.boat,
		...(o.harness === true ? { harness: true as const } : {}),
		busy: o.busy
	};
}

// --- friendly matches on the wire --------------------------------------------

/** A match's id: the server's, 6 to 32 characters of base64url. */
export function isMatchId(value: unknown): value is string {
	return isToken(value, 6, 32);
}

/** A run of the server's id (`HiMessage.boot`): 6 to 32 characters of base64url. */
export function isBootId(value: unknown): value is string {
	return isToken(value, 6, 32);
}

/** The most UTF-16 units a nickname takes on the wire (the cleaner keeps 12 letters, each with its marks). */
const MAX_WIRE_NICKNAME = 64;
/** An attack's number on the wire: 1-based, and no species has near this many. */
const MAX_WIRE_ATTACK = 16;
/** The most characters an answer takes on the wire: the page types at most seven. */
const MAX_WIRE_ANSWER = 32;
/** The longest prompt on the wire: every prompt is a short sum or a short row of numbers. */
const MAX_WIRE_PROMPT = 80;
/** The most events one match message carries: one intent causes at most five. */
const MAX_MATCH_EVENTS = 16;
/** The longest wait the wire says (an invite's, the time to come back): ten minutes. */
const MAX_WIRE_MS = 600_000;
/** HP, damage, turns and steps on the wire are whole numbers up to this. */
const MAX_WIRE_COUNT = 2 ** 31;

function isSide(value: unknown): value is MatchSide {
	return MATCH_SIDES.includes(value as MatchSide);
}

function isLevel(value: unknown): value is AttackLevel {
	return ATTACK_LEVELS.includes(value as AttackLevel);
}

function isTeamIndex(value: unknown): value is number {
	return isWhole(value, 0, MATCH_TEAM_SIZE - 1);
}

function isNickname(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && value.length <= MAX_WIRE_NICKNAME;
}

/** One animal a page brings: an id as a save holds it, a species this build knows, maybe a nickname. */
function readWireAnimal(value: unknown): WireAnimal | null {
	if (!isRecord(value)) return null;
	const { id, speciesId, nickname } = value;
	if (typeof id !== 'string' || id.length === 0 || id.length > MAX_SAVE_ID_LENGTH) return null;
	if (typeof speciesId !== 'string' || !SPECIES.has(speciesId)) return null;
	if (nickname === undefined) return { id, speciesId };
	return isNickname(nickname) ? { id, speciesId, nickname } : null;
}

/** The team a page brings: one to `MATCH_TEAM_SIZE` animals. */
function readWireTeam(value: unknown): WireAnimal[] | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > MATCH_TEAM_SIZE) return null;
	const team: WireAnimal[] = [];
	for (const entry of value) {
		const animal = readWireAnimal(entry);
		if (!animal) return null;
		team.push(animal);
	}
	return team;
}

/** A kid's choice in a match; never `timeout`, which only the server reports. */
function readPlayIntent(value: unknown): PlayIntent | null {
	if (!isRecord(value)) return null;
	switch (value.type) {
		case 'attack':
			return isWhole(value.attackIndex, 1, MAX_WIRE_ATTACK) && isLevel(value.level)
				? { type: 'attack', attackIndex: value.attackIndex, level: value.level }
				: null;
		case 'answer':
			return typeof value.input === 'string' && value.input.length <= MAX_WIRE_ANSWER
				? { type: 'answer', input: value.input }
				: null;
		case 'switch':
		case 'pick-next':
			return isTeamIndex(value.teamIndex) ? { type: value.type, teamIndex: value.teamIndex } : null;
		case 'leave':
			return { type: 'leave' };
		default:
			return null;
	}
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
	find: (o) => (isPid(o.pid) ? { t: 'find', pid: o.pid } : null),
	challenge: (o) => {
		const team = readWireTeam(o.team);
		return team && isPid(o.pid) ? { t: 'challenge', pid: o.pid, team } : null;
	},
	withdraw: () => ({ t: 'withdraw' }),
	accept: (o) => {
		const team = readWireTeam(o.team);
		return team && isPid(o.pid) ? { t: 'accept', pid: o.pid, team } : null;
	},
	decline: (o) => (isPid(o.pid) ? { t: 'decline', pid: o.pid } : null),
	play: (o) => {
		const intent = readPlayIntent(o.intent);
		return intent && isMatchId(o.id) ? { t: 'play', id: o.id, intent } : null;
	},
	here: (o) => (isMatchId(o.id) ? { t: 'here', id: o.id } : null),
	rematch: (o) => {
		const team = readWireTeam(o.team);
		return team && isMatchId(o.id) ? { t: 'rematch', id: o.id, team } : null;
	},
	done: (o) => (isMatchId(o.id) ? { t: 'done', id: o.id } : null),
	battle: (o) => {
		const view = readFightView(o.view);
		const events = readFightEvents(o.events);
		return view && events ? { t: 'battle', view, events } : null;
	}
};

function readRosterEntry(value: unknown): RosterEntry | null {
	if (!isRecord(value)) return null;
	const { pid, name, bearing, steps, busy } = value;
	if (!isPid(pid) || !isWireName(name) || !isWhole(bearing, 0, BEARINGS - 1)) return null;
	if (!isWhole(steps, 0, MAX_WIRE_STEPS) || !isBusy(busy)) return null;
	return { pid, name, bearing, steps, busy };
}

const END_REASONS: readonly MatchEndReason[] = ['all-tired', 'left', 'timed-out'];
const REJECTIONS: ReadonlySet<string> = new Set<MatchRejection>([
	'not-an-intent',
	'match-over',
	'not-your-turn',
	'not-choosing-an-action',
	'no-puzzle',
	'no-such-attack',
	'no-such-level',
	'not-picking',
	'no-such-animal',
	'already-in-front',
	'tired'
]);

/**
 * A team member as a match shows it: its id (a save's, with the side before
 * it), a species this build knows, maybe a nickname, and HP within the
 * species' own.
 */
function readMatchAnimal(value: unknown): AnimalInstance | null {
	if (!isRecord(value)) return null;
	const { id, speciesId, nickname, hp } = value;
	if (typeof id !== 'string' || id.length === 0 || id.length > MAX_SAVE_ID_LENGTH + 2) return null;
	if (typeof speciesId !== 'string' || !SPECIES.has(speciesId)) return null;
	if (!isWhole(hp, 0, getAnimal(speciesId).maxHp)) return null;
	if (nickname === undefined) return { id, speciesId, hp };
	return isNickname(nickname) ? { id, speciesId, nickname, hp } : null;
}

function readMatchTeam(value: unknown): AnimalInstance[] | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > MATCH_TEAM_SIZE) return null;
	const team: AnimalInstance[] = [];
	for (const entry of value) {
		const animal = readMatchAnimal(entry);
		if (!animal) return null;
		team.push(animal);
	}
	return team;
}

/** Something for each side, read by `read`: a new object of `a` and `b` alone. */
function readBySide<T>(
	value: unknown,
	read: (v: unknown) => T | null
): Record<MatchSide, T> | null {
	if (!isRecord(value)) return null;
	const a = read(value.a);
	const b = read(value.b);
	return a === null || b === null ? null : { a, b };
}

/** A puzzle as a match shows it: its kind, difficulty and prompt. There is no answer to read. */
function readShownPuzzle(value: unknown): ShownPuzzle | null {
	if (!isRecord(value)) return null;
	const { kind, difficulty, prompt } = value;
	if (!ALL_PUZZLE_KINDS.includes(kind as ShownPuzzle['kind'])) return null;
	if (!isWhole(difficulty, MIN_DIFFICULTY, MAX_DIFFICULTY)) return null;
	if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > MAX_WIRE_PROMPT)
		return null;
	return { kind: kind as ShownPuzzle['kind'], difficulty, prompt };
}

function readViewPhase(value: unknown): MatchViewPhase | null {
	if (!isRecord(value)) return null;
	switch (value.kind) {
		case 'choose-action':
		case 'choose-animal':
			return isSide(value.side) ? { kind: value.kind, side: value.side } : null;
		case 'solving': {
			const puzzle = readShownPuzzle(value.puzzle);
			const { side, attackIndex, level } = value;
			if (
				!puzzle ||
				!isSide(side) ||
				!isWhole(attackIndex, 1, MAX_WIRE_ATTACK) ||
				!isLevel(level)
			) {
				return null;
			}
			return { kind: 'solving', side, attackIndex, level, puzzle };
		}
		case 'ended':
			return isSide(value.winner) && END_REASONS.includes(value.reason as MatchEndReason)
				? { kind: 'ended', winner: value.winner, reason: value.reason as MatchEndReason }
				: null;
		default:
			return null;
	}
}

/** A match view: both teams, who is in front on each side (one of its own), and the phase. */
function readMatchView(value: unknown): MatchView | null {
	if (!isRecord(value)) return null;
	const teams = readBySide(value.teams, readMatchTeam);
	const phase = readViewPhase(value.phase);
	if (!teams || !phase || !isSide(value.you)) return null;
	if (!isWhole(value.step, 0, MAX_WIRE_COUNT) || !isWhole(value.turn, 1, MAX_WIRE_COUNT)) {
		return null;
	}
	const active = readBySide(value.active, (v) => (isTeamIndex(v) ? v : null));
	if (!active || active.a >= teams.a.length || active.b >= teams.b.length) return null;
	return { you: value.you, step: value.step, turn: value.turn, teams, active, phase };
}

function readMatchEvent(value: unknown): WireMatchEvent | null {
	if (!isRecord(value)) return null;
	const { type } = value;
	switch (type) {
		case 'puzzle-shown': {
			const puzzle = readShownPuzzle(value.puzzle);
			const { side, attackIndex, level } = value;
			if (
				!puzzle ||
				!isSide(side) ||
				!isWhole(attackIndex, 1, MAX_WIRE_ATTACK) ||
				!isLevel(level)
			) {
				return null;
			}
			return { type, side, attackIndex, level, puzzle };
		}
		case 'answer-judged':
			return isSide(value.side) && typeof value.correct === 'boolean'
				? { type, side: value.side, correct: value.correct }
				: null;
		case 'hit': {
			const { attacker, attackIndex, level, damage, targetHp } = value;
			if (!isSide(attacker) || !isWhole(attackIndex, 1, MAX_WIRE_ATTACK) || !isLevel(level)) {
				return null;
			}
			if (!isWhole(damage, 0, MAX_WIRE_COUNT) || !isWhole(targetHp, 0, MAX_WIRE_COUNT)) return null;
			return { type, attacker, attackIndex, level, damage, targetHp };
		}
		case 'missed': {
			const { attacker, attackIndex, level } = value;
			return isSide(attacker) && isWhole(attackIndex, 1, MAX_WIRE_ATTACK) && isLevel(level)
				? { type, attacker, attackIndex, level }
				: null;
		}
		case 'fainted': {
			const animal = readMatchAnimal(value.animal);
			return animal && isSide(value.side) ? { type, side: value.side, animal } : null;
		}
		case 'switched': {
			const animal = readMatchAnimal(value.animal);
			return animal && isSide(value.side) && isTeamIndex(value.teamIndex)
				? { type, side: value.side, animal, teamIndex: value.teamIndex }
				: null;
		}
		case 'ended':
			return isSide(value.winner) && END_REASONS.includes(value.reason as MatchEndReason)
				? { type, winner: value.winner, reason: value.reason as MatchEndReason }
				: null;
		default:
			return null;
	}
}

function readMatchEvents(value: unknown): WireMatchEvent[] | null {
	if (!Array.isArray(value) || value.length > MAX_MATCH_EVENTS) return null;
	const events: WireMatchEvent[] = [];
	for (const entry of value) {
		const event = readMatchEvent(entry);
		if (!event) return null;
		events.push(event);
	}
	return events;
}

function readAway(value: unknown): MatchMessage['away'] | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !isSide(value.side) || !isWhole(value.ms, 0, MAX_WIRE_MS)) {
		return undefined;
	}
	return { side: value.side, ms: value.ms };
}

function readMatchMessage(o: Fields): MatchMessage | null {
	const pids = readBySide(o.pids, (v) => (isPid(v) ? v : null));
	const names = readBySide(o.names, (v) => (isWireName(v) ? v : null));
	const view = readMatchView(o.view);
	const events = readMatchEvents(o.events);
	const away = readAway(o.away);
	const timeout = o.timeout === null || MATCH_TIMEOUTS.includes(o.timeout as MatchTimeout);
	if (!isMatchId(o.id) || !pids || !names || !view || !events || away === undefined || !timeout) {
		return null;
	}
	// Left out by a server from before them; there, anything but a match's id (never its own), or
	// `true`, is junk.
	const rematchOf = !('rematchOf' in o)
		? undefined
		: isMatchId(o.rematchOf) && o.rematchOf !== o.id
			? o.rematchOf
			: null;
	const calledOff = !('calledOff' in o) ? undefined : o.calledOff === true ? true : null;
	if (rematchOf === null || calledOff === null) return null;
	return {
		t: 'match',
		id: o.id,
		pids,
		names,
		view,
		events,
		away,
		timeout: o.timeout as MatchTimeout | null,
		...(rematchOf === undefined ? {} : { rematchOf }),
		...(calledOff === undefined ? {} : { calledOff })
	};
}

const SERVER_PARSERS: { [K in ServerMessage['t']]: Parser<Extract<ServerMessage, { t: K }>> } = {
	hi: (o) => {
		const match = o.match === null ? null : isMatchId(o.match) ? o.match : undefined;
		// Left out by a server from before it; anything else that is no run's id is junk.
		const boot = !('boot' in o) ? undefined : isBootId(o.boot) ? o.boot : null;
		if (boot === null) return null;
		return isWhole(o.v, 0, 2 ** 31) && isPid(o.pid) && isWireName(o.name) && match !== undefined
			? {
					t: 'hi',
					v: o.v,
					pid: o.pid,
					name: o.name,
					match,
					...(boot === undefined ? {} : { boot })
				}
			: null;
	},
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
		BYE_REASONS.includes(o.reason as ByeReason)
			? { t: 'bye', reason: o.reason as ByeReason }
			: null,
	invite: (o) =>
		isPid(o.pid) && isWireName(o.name) && isWhole(o.ms, 0, MAX_WIRE_MS)
			? { t: 'invite', pid: o.pid, name: o.name, ms: o.ms }
			: null,
	asking: (o) =>
		isPid(o.pid) && isWhole(o.ms, 0, MAX_WIRE_MS) ? { t: 'asking', pid: o.pid, ms: o.ms } : null,
	uninvite: (o) =>
		isPid(o.pid) && INVITE_ENDS.includes(o.reason as InviteEnd)
			? { t: 'uninvite', pid: o.pid, reason: o.reason as InviteEnd }
			: null,
	match: readMatchMessage,
	rejected: (o) =>
		isMatchId(o.id) && typeof o.reason === 'string' && REJECTIONS.has(o.reason)
			? { t: 'rejected', id: o.id, reason: o.reason as MatchRejection }
			: null,
	nudge: (o) => (isMatchId(o.id) ? { t: 'nudge', id: o.id } : null),
	'rematch-wish': (o) =>
		isMatchId(o.id) && isSide(o.side) && typeof o.yes === 'boolean'
			? { t: 'rematch-wish', id: o.id, side: o.side, yes: o.yes }
			: null,
	fight: (o) => {
		const view = readFightView(o.view);
		const events = readFightEvents(o.events);
		const vs = o.vs === null ? null : isPid(o.vs) ? o.vs : undefined;
		return view && events && isPid(o.pid) && vs !== undefined && vs !== o.pid
			? { t: 'fight', pid: o.pid, vs, view, events }
			: null;
	}
};

function parseWith<M extends { t: string }>(
	parsers: { readonly [K in M['t']]: Parser<M> },
	value: unknown
): M | null {
	if (
		!isRecord(value) ||
		typeof value.t !== 'string' ||
		!Object.prototype.hasOwnProperty.call(parsers, value.t)
	) {
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
 * Text off the socket as JSON, or undefined when it is longer than `max`
 * (what a browser may send, unless said otherwise) or no JSON at all. (A JSON
 * `null` is `null`, which no parser takes.)
 */
export function readWire(text: string, max: number = MAX_MESSAGE_BYTES): unknown {
	// A UTF-16 unit is at least one byte in UTF-8: longer text is surely too many bytes.
	if (text.length > max) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}
