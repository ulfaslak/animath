import { newGame, saveDocument, type SavedGame } from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NUDGE_KEY, SaveNudge } from '../src/account/nudge';
import { noteNextStart, takeAccountNote } from '../src/account/restart';
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

	it("leaves the retired anonymous backup's identity where an old browser keeps it, for the export", () => {
		const identity = JSON.stringify({ id: '00000000-0000-4000-8000-000000000009', secret: 's' });
		store.set('animath.player', identity);
		store.set(KEYS.save, saveText(8));
		moveGuestGameIn(store, 'Ida');
		expect(store.get('animath.player')).toBe(identity);
		expect(store.get('animath.player.previous')).toBeNull();
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

	it("never writes over or sets aside a newer build's save in the account keys: the guest game stays the guest's", () => {
		const keys = gameKeys({ name: 'Ida' });
		// Both ways a save is a newer build's: a later version, and a species this build lacks.
		const later = JSON.parse(saveText(500, 'deleted-account-game'));
		later.party = [{ id: 'later-1', speciesId: 'later-species', hp: 9 }];
		for (const newer of [JSON.stringify({ version: 99, seq: 1 }), JSON.stringify(later)]) {
			store = new MemoryStore();
			const guest = saveText(20);
			store.set(keys.save, newer);
			store.set(KEYS.save, guest);
			expect(moveGuestGameIn(store, 'Ida')).toBe(true);
			expect(store.get(keys.save)).toBe(newer);
			expect(store.get(keys.replaced)).toBeNull();
			expect(store.get(keys.unreadable)).toBeNull();
			expect(store.get(KEYS.save)).toBe(guest);
			expect(store.get(KEYS.previous)).toBeNull();
			// Logged in all the same: the page that starts next is behind the newer save.
			expect(currentAccount(store)).toEqual({ name: 'Ida' });
		}
	});

	it('keeps an unreadable save the account keys held aside as unreadable', () => {
		const keys = gameKeys({ name: 'Ida' });
		store.set(keys.save, '{"not a save"');
		store.set(KEYS.save, saveText(20));
		moveGuestGameIn(store, 'Ida');
		expect(store.get(keys.unreadable)).toBe('{"not a save"');
		expect(store.get(keys.replaced)).toBeNull();
		expect(JSON.parse(store.get(keys.save)!).seq).toBe(20);
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

describe('the save card every 1,000 steps (account/nudge.ts)', () => {
	it('is due at 1,000 steps in a new game, and again at the next whole 1,000 after it was answered', () => {
		const nudge = new SaveNudge(store);
		expect(nudge.due('game-a', 0)).toBe(false);
		expect(nudge.due('game-a', 999)).toBe(false);
		expect(nudge.due('game-a', 1000)).toBe(true);
		nudge.answered('game-a', 1003);
		expect(nudge.due('game-a', 1003)).toBe(false);
		expect(nudge.due('game-a', 1999)).toBe(false);
		expect(nudge.due('game-a', 2000)).toBe(true);
	});

	it('a game first seen part-way is due at the next whole 1,000 of its own steps', () => {
		expect(new SaveNudge(store).due('game-a', 4500)).toBe(false);
		const nudge = new SaveNudge(store);
		expect(nudge.due('game-a', 4999)).toBe(false);
		expect(nudge.due('game-a', 5000)).toBe(true);
	});

	it('follows each game on its own: a new game starts from its own steps', () => {
		const nudge = new SaveNudge(store);
		expect(nudge.due('game-a', 1200)).toBe(false);
		nudge.answered('game-a', 1200);
		expect(nudge.due('game-b', 10)).toBe(false);
		expect(nudge.due('game-b', 1000)).toBe(true);
	});

	it('a card missed while busy comes once, not once for every 1,000 missed', () => {
		const nudge = new SaveNudge(store);
		expect(nudge.due('game-a', 3500)).toBe(false);
		expect(nudge.due('game-a', 7200)).toBe(true);
		nudge.answered('game-a', 7200);
		expect(nudge.due('game-a', 7999)).toBe(false);
		expect(nudge.due('game-a', 8000)).toBe(true);
	});

	it('keeps the step its card is due at across a reload, even one that crossed it', () => {
		expect(new SaveNudge(store).due('game-a', 990)).toBe(false);
		// The page went at 990 steps and the game was saved at 1010: the card is due on the next page.
		expect(new SaveNudge(store).due('game-a', 1010)).toBe(true);
		const answered = new SaveNudge(store);
		answered.answered('game-a', 1010);
		expect(new SaveNudge(store).due('game-a', 1500)).toBe(false);
		expect(new SaveNudge(store).due('game-a', 2000)).toBe(true);
		for (const bad of ['nope', '{"lineage":"game-a","next":"soon"}', '{"next":1}']) {
			store.set(NUDGE_KEY, bad);
			expect(new SaveNudge(store).due('game-a', 1999), bad).toBe(false);
		}
	});

	it('a card kept for a longer stretch is due within the shorter one: ?steps= on a game played before (#156)', () => {
		const long = new SaveNudge(store);
		expect(long.due('game-a', 300)).toBe(false);
		// The next page opens with `?steps=20`: the card comes 20 steps from now, not at 1,000.
		const short = new SaveNudge(store, 20);
		expect(short.due('game-a', 300)).toBe(false);
		expect(short.due('game-a', 319)).toBe(false);
		expect(short.due('game-a', 320)).toBe(true);
		short.answered('game-a', 330);
		expect(short.due('game-a', 339)).toBe(false);
		expect(short.due('game-a', 340)).toBe(true);
		// A card already due stays due, whatever the stretch of the page that reads it.
		expect(new SaveNudge(store).due('game-a', 340)).toBe(true);
	});

	it('clears the hour clock that came before it, and works with no storage at all', () => {
		store.set('animath.playtime', '{"lineage":"game-a","ms":5,"next":3600000}');
		new SaveNudge(store);
		expect(store.get('animath.playtime')).toBeNull();
		const nudge = new SaveNudge(null);
		expect(nudge.due('game-a', 999)).toBe(false);
		expect(nudge.due('game-a', 1000)).toBe(true);
		nudge.answered('game-a', 1000);
		expect(nudge.due('game-a', 1999)).toBe(false);
	});
});

describe('the note for the next start (account/restart.ts)', () => {
	let session: Map<string, string>;
	beforeEach(() => {
		session = new Map();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => session.get(key) ?? null,
			setItem: (key: string, value: string) => void session.set(key, value),
			removeItem: (key: string) => void session.delete(key)
		});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('a logout names the account left, for the title after it; read once', () => {
		noteNextStart('loggedOut', 'Nini');
		expect(takeAccountNote()).toEqual({ note: 'loggedOut', name: 'Nini' });
		expect(takeAccountNote()).toBeNull();
		expect(session.size).toBe(0);
	});

	it('a note without a name leaves none behind from an earlier one', () => {
		noteNextStart('loggedOut', 'Nini');
		noteNextStart('movedAhead');
		expect(takeAccountNote()).toEqual({ note: 'movedAhead', name: null });
	});

	it('a note this build does not know is none, and without sessionStorage nothing is said', () => {
		session.set('animath.accountNote', 'somethingNew');
		session.set('animath.accountNote.name', 'Nini');
		expect(takeAccountNote()).toBeNull();
		expect(session.size).toBe(0);
		// An older build left the note alone, with no name beside it.
		session.set('animath.accountNote', 'loggedOut');
		expect(takeAccountNote()).toEqual({ note: 'loggedOut', name: null });
		const broken = () => {
			throw new Error('blocked');
		};
		vi.stubGlobal('sessionStorage', { getItem: broken, setItem: broken, removeItem: broken });
		noteNextStart('loggedOut', 'Nini');
		expect(takeAccountNote()).toBeNull();
	});
});
