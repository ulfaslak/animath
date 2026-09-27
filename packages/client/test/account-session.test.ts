import { newGame, saveDocument, type SavedGame } from '@mathgame/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlayClock, PLAYTIME_KEY } from '../src/account/playtime';
import {
	LOGOUT_HOLD_MS,
	currentAccount,
	forgetLogout,
	gameKeys,
	guestGameFor,
	holdLogout,
	logInHere,
	logOutHere,
	logoutPending,
	moveGuestGameIn,
	releaseLogout,
	rememberLogout,
	takeAccountGame
} from '../src/account/session';
import { ACCOUNT_KEYS, KEYS, accountKeys, type KeyValueStore } from '../src/save/storage';

/**
 * Which game the browser plays, and the moves between the guest's and an
 * account's ([[DECISIONS]] § Accounts): the two never share a key, and no
 * move writes over a save without keeping it.
 */

class MemoryStore implements KeyValueStore {
	data = new Map<string, string>();
	failWrites = false;
	get(key: string): string | null {
		return this.data.get(key) ?? null;
	}
	set(key: string, value: string): boolean {
		if (this.failWrites) return false;
		this.data.set(key, value);
		return true;
	}
	remove(key: string): void {
		this.data.delete(key);
	}
}

/** A save of a game in World 1 with `seq`, `lineage` and a name. */
function saveText(seq: number, lineage = 'game-a', name: string | null = 'Ida'): string {
	const game: SavedGame = { ...newGame(1, { id: 'a', speciesId: 'rabbit', hp: 5 }), name };
	return JSON.stringify(saveDocument(game, { lineage, seq }));
}

let store: MemoryStore;
beforeEach(() => {
	store = new MemoryStore();
});

describe('which game the browser plays', () => {
	it('a guest plays under the guest keys; an account under its own, whatever case its name is typed in', () => {
		expect(currentAccount(store)).toBeNull();
		expect(gameKeys(null)).toBe(KEYS);
		logInHere(store, 'Åse Marie');
		expect(currentAccount(store)).toEqual({ name: 'Åse Marie' });
		const keys = gameKeys({ name: 'Åse Marie' });
		expect(keys).toEqual(gameKeys({ name: 'ÅSE MARIE' }));
		expect(keys).toEqual(accountKeys('åse marie'));
		for (const key of Object.values(keys)) expect(Object.values(KEYS)).not.toContain(key);
		expect(gameKeys({ name: 'Bo' }).save).not.toBe(keys.save);
		logOutHere(store, 'åse marie');
		expect(currentAccount(store)).toBeNull();
	});

	it('reads a pointer it cannot make sense of as a guest', () => {
		for (const bad of ['', 'not json', '{}', '{"name":""}', '{"name":5}', 'null']) {
			store.set(ACCOUNT_KEYS.current, bad);
			expect(currentAccount(store), bad).toBeNull();
		}
		expect(currentAccount(null)).toBeNull();
	});

	it('a logout held by a login or a registration is not sent meanwhile, and is again once released or stale', () => {
		rememberLogout(store, 'Ida');
		expect(holdLogout(store, 1_000)).toBe('Ida');
		expect(logoutPending(store, 1_000)).toBeNull();
		expect(logoutPending(store, 1_000 + LOGOUT_HOLD_MS - 1)).toBeNull();
		// The page that held it went away mid-request: sent again after all.
		expect(logoutPending(store, 1_000 + LOGOUT_HOLD_MS)).toBe('Ida');
		// A login that failed releases it at once.
		holdLogout(store, 5_000);
		releaseLogout(store, 'Ida');
		expect(logoutPending(store, 5_000)).toBe('Ida');
		// Nothing held: nothing to hold or release.
		forgetLogout(store);
		expect(holdLogout(store)).toBeNull();
		releaseLogout(store, 'Ida');
		expect(logoutPending(store)).toBeNull();
	});

	it('a note this build cannot read is no note', () => {
		for (const text of ['1', 'null', '{"name":""}', '{"name":7}', 'not json']) {
			store.set('animath.logout.pending', text);
			expect(logoutPending(store), text).toBeNull();
			expect(holdLogout(store), text).toBeNull();
		}
	});

	it('logging out leaves a pointer another tab set to another account meanwhile', () => {
		logInHere(store, 'Bo');
		logOutHere(store, 'Ida');
		expect(currentAccount(store)).toEqual({ name: 'Bo' });
		logOutHere(store, 'BO');
		expect(currentAccount(store)).toBeNull();
		logOutHere(store, 'Ida');
		expect(currentAccount(store)).toBeNull();
	});

	it('remembers a logout the server did not hear, until it has', () => {
		expect(logoutPending(store)).toBeNull();
		rememberLogout(store, 'Ida');
		expect(logoutPending(store)).toBe('Ida');
		forgetLogout(store);
		expect(logoutPending(store)).toBeNull();
	});
});

describe('making an account with the guest game', () => {
	it("takes the guest game's newest save along with the account's name on it", () => {
		store.set(KEYS.save, saveText(9, 'game-a', 'Ida'));
		const game = guestGameFor(store, 'Ida B');
		expect(game?.name).toBe('Ida B');
		expect(game?.seq).toBe(9);
		store.set(KEYS.save, 'not a save');
		expect(guestGameFor(store, 'Ida')).toBeNull();
	});

	it('moves the guest game in: the account keys get it, named, and the guest key is empty, its text put away', () => {
		const guest = saveText(12);
		store.set(KEYS.save, guest);
		expect(moveGuestGameIn(store, 'Ida B')).toBe(true);
		const keys = gameKeys({ name: 'Ida B' });
		const moved = JSON.parse(store.get(keys.save)!);
		expect(moved).toEqual({ ...JSON.parse(guest), name: 'Ida B' });
		expect(store.get(KEYS.save)).toBeNull();
		expect(store.get(KEYS.previous)).toBe(guest);
		expect(currentAccount(store)).toEqual({ name: 'Ida B' });
	});

	it("puts the guest game's anonymous backup identity aside with it, so a guest start later does not fetch the game back", () => {
		const identity = JSON.stringify({ id: '00000000-0000-4000-8000-000000000009', secret: 's' });
		store.set(KEYS.player, identity);
		store.set(KEYS.save, saveText(8));
		moveGuestGameIn(store, 'Ida');
		expect(store.get(KEYS.player)).toBeNull();
		expect(store.get(KEYS.previousPlayer)).toBe(identity);
	});

	it('keeps aside what the account keys held here before, and a put-away game already there', () => {
		const keys = gameKeys({ name: 'Ida' });
		store.set(keys.save, saveText(3, 'old-account-game'));
		store.set(KEYS.previous, saveText(1, 'left-for-a-new-game'));
		store.set(KEYS.save, saveText(20));
		moveGuestGameIn(store, 'Ida');
		expect(JSON.parse(store.get(keys.replaced)!).lineage).toBe('old-account-game');
		expect(JSON.parse(store.get(keys.save)!).seq).toBe(20);
		expect(JSON.parse(store.get(KEYS.previous)!).lineage).toBe('left-for-a-new-game');
		expect(JSON.parse(store.get(`${KEYS.previous}.2`)!).seq).toBe(20);
	});

	it('moves nothing when it cannot even log in, and the guest game plays on', () => {
		const guest = saveText(5);
		store.set(KEYS.save, guest);
		store.failWrites = true;
		expect(moveGuestGameIn(store, 'Ida')).toBe(false);
		expect(store.get(KEYS.save)).toBe(guest);
		expect(currentAccount(store)).toBeNull();
	});
});

describe('logging in', () => {
	const keys = () => gameKeys({ name: 'Ida' });

	it("takes the server's save when this browser has none of the account's", () => {
		const theirs = JSON.parse(saveText(30));
		takeAccountGame(store, 'Ida', theirs);
		expect(JSON.parse(store.get(keys().save)!)).toEqual(theirs);
	});

	it("takes the server's when it is further along, keeping this browser's aside; keeps this browser's when it is", () => {
		store.set(keys().save, saveText(10));
		takeAccountGame(store, 'Ida', JSON.parse(saveText(30)));
		expect(JSON.parse(store.get(keys().save)!).seq).toBe(30);
		expect(JSON.parse(store.get(keys().replaced)!).seq).toBe(10);
		store.set(keys().save, saveText(50));
		takeAccountGame(store, 'Ida', JSON.parse(saveText(40)));
		expect(JSON.parse(store.get(keys().save)!).seq).toBe(50);
	});

	it("a tie within one game, played differently on two devices, goes to the server's", () => {
		const here = JSON.parse(saveText(10, 'game-a'));
		here.tokens = 3;
		store.set(keys().save, JSON.stringify(here));
		const there = JSON.parse(saveText(10, 'game-a'));
		there.tokens = 7;
		takeAccountGame(store, 'Ida', there);
		expect(JSON.parse(store.get(keys().save)!).tokens).toBe(7);
		expect(JSON.parse(store.get(keys().replaced)!).tokens).toBe(3);
	});

	it("a tie between two games goes to the server's; the same game at the same seq changes nothing", () => {
		store.set(keys().save, saveText(10, 'here'));
		takeAccountGame(store, 'Ida', JSON.parse(saveText(10, 'there')));
		expect(JSON.parse(store.get(keys().save)!).lineage).toBe('there');
		expect(JSON.parse(store.get(keys().replaced)!).lineage).toBe('here');
		const before = new Map(store.data);
		takeAccountGame(store, 'Ida', JSON.parse(saveText(10, 'there')));
		expect(store.data).toEqual(before);
	});

	it("never writes over a newer build's copy, nor takes a server save it cannot read", () => {
		const newer = JSON.stringify({ version: 99, seq: 1 });
		store.set(keys().save, newer);
		takeAccountGame(store, 'Ida', JSON.parse(saveText(30)));
		expect(store.get(keys().save)).toBe(newer);
		store.set(keys().save, saveText(3));
		takeAccountGame(store, 'Ida', { version: 99, seq: 100 });
		expect(JSON.parse(store.get(keys().save)!).seq).toBe(3);
	});

	it('leaves the guest game alone', () => {
		const guest = saveText(7, 'guest');
		store.set(KEYS.save, guest);
		takeAccountGame(store, 'Ida', JSON.parse(saveText(30)));
		logInHere(store, 'Ida');
		expect(store.get(KEYS.save)).toBe(guest);
	});
});

describe('the play clock', () => {
	const HOUR = 60_000;

	it('is due after an hour of play in one game, and again an hour after it was answered', () => {
		const clock = new PlayClock(store, HOUR);
		clock.tick('game-a', 59);
		expect(clock.due('game-a')).toBe(false);
		clock.tick('game-a', 1);
		expect(clock.due('game-a')).toBe(true);
		clock.answered('game-a');
		expect(clock.due('game-a')).toBe(false);
		clock.tick('game-a', 59.9);
		expect(clock.due('game-a')).toBe(false);
		clock.tick('game-a', 0.2);
		expect(clock.due('game-a')).toBe(true);
	});

	it('counts each game on its own: a new game starts from nothing', () => {
		const clock = new PlayClock(store, HOUR);
		clock.tick('game-a', 70);
		expect(clock.due('game-b')).toBe(false);
		clock.tick('game-b', 30);
		expect(clock.due('game-b')).toBe(false);
	});

	it('a card missed while busy comes once, not once for every hour missed', () => {
		const clock = new PlayClock(store, HOUR);
		clock.tick('game-a', 3.5 * 60);
		expect(clock.due('game-a')).toBe(true);
		clock.answered('game-a');
		expect(clock.due('game-a')).toBe(false);
		clock.tick('game-a', 0.4 * 60);
		expect(clock.due('game-a')).toBe(false);
		clock.tick('game-a', 0.2 * 60);
		expect(clock.due('game-a')).toBe(true);
	});

	it('keeps its count across a reload, written every few seconds of play', () => {
		const first = new PlayClock(store, HOUR);
		first.tick('game-a', 45);
		first.flush();
		const second = new PlayClock(store, HOUR);
		second.tick('game-a', 15);
		expect(second.due('game-a')).toBe(true);
		for (const bad of ['nope', '{"lineage":"game-a","ms":-5,"next":1}', '{"ms":1}']) {
			store.set(PLAYTIME_KEY, bad);
			expect(new PlayClock(store, HOUR).due('game-a'), bad).toBe(false);
		}
	});

	it('ignores a frame with no time in it, and works with no storage at all', () => {
		const clock = new PlayClock(null, HOUR);
		clock.tick('game-a', 0);
		clock.tick('game-a', Number.NaN);
		clock.tick('game-a', 60);
		expect(clock.due('game-a')).toBe(true);
	});
});
