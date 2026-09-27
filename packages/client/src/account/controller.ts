import { checkName, checkPassword, type GameEvent, type SaveWrite } from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { isShortcut, keyName } from '../input/keyboard';
import { isMashKey, PickGuard } from '../input/pick-guard';
import { REVEAL_KEY, tappedRow } from '../input/press';
import type { KeyValueStore } from '../save/storage';
import {
	PROMPT_CHOICES,
	account,
	type AccountFrom,
	type AccountProblem
} from '../state/account.svelte';
import { getAccountSave, login, logout, register } from './api';
import type { AccountNote } from './restart';
import {
	forgetLogout,
	guestGameFor,
	holdLogout,
	logInHere,
	logOutHere,
	moveGuestGameIn,
	releaseLogout,
	rememberLogout,
	takeAccountGame
} from './session';

/**
 * The account screens ([[UI_SPEC]] § Accounts): the card that makes an
 * account with the guest game or logs in to one, the hourly card that offers
 * to keep a guest's animals safe, and logging out. While either card is up it
 * takes every key (`main.ts`); walking waits.
 *
 * The card checks what it can before it asks the server (the engine's
 * `checkName` and `checkPassword`, the rules the server keeps), so a kid hears
 * at once why a name or a password won't do, in kind words. The server has
 * the last word on a taken name, a wrong password and too many tries.
 *
 * A login, a new account or a logout changes which game this browser plays,
 * so the page starts again in it (`hooks.restart`), after moving what must
 * move in the browser's storage (`session.ts`): nothing is written over, and
 * the game the kid was playing is saved first.
 */

export interface AccountHooks {
	store: KeyValueStore | null;
	/** Save the game as it stands, in the browser, now. */
	flush(): void;
	/**
	 * The game on screen as a save, once `flush` has run: what a new account
	 * takes along (the browser's copy can be older, when its storage is full).
	 */
	currentSave?(): SaveWrite | null;
	/** Before logging out: the newest save to the server, waited for a moment. */
	pushNow(): Promise<boolean>;
	/** The player's name in the game on screen (or the title's saved game), for the name box. */
	playerName(): string | null;
	/** The hourly card was answered: it comes back after another hour of play. */
	answered(): void;
	/** Start the page again, in the game the browser now plays, saying `note`. */
	restart(note: AccountNote): void;
}

/** Keys that change what a box holds without typing a letter. */
const EDIT_KEYS: ReadonlySet<string> = new Set(['Backspace', 'Delete']);

/** A wait the server asked for, in whole minutes, at least one. */
function minutes(seconds: number): number {
	return Math.max(1, Math.ceil(seconds / 60));
}

export class AccountController {
	/** The quiet moment the cards wait for before Enter or a tap picks (`input/pick-guard.ts`). */
	private guard = new PickGuard();

	constructor(private hooks: AccountHooks) {}

	/**
	 * Something else takes the screen (a step already under way met a wild
	 * animal, the doctor's card opened, the game left for the title): the
	 * hourly card goes unanswered, and comes back the next time the player is
	 * exploring.
	 */
	handle(event: GameEvent): void {
		switch (event.type) {
			case 'battle-started':
			case 'doctor-visit-started':
			case 'game-left':
				account.prompt = false;
				break;
		}
	}

	/** Frame time, for the quiet moment. */
	update(dt: number): void {
		if (account.card !== null || account.prompt) this.guard.tick(dt);
	}

	/** Make an account with the guest game: the card, the player's name in its box. */
	openRegister(from: AccountFrom): void {
		this.open('register', from, this.hooks.playerName() ?? '');
	}

	/** Log in to an account: the card, the name box holding the player's name, if any. */
	openLogin(from: AccountFrom): void {
		this.open('login', from, this.hooks.playerName() ?? '');
	}

	private open(card: 'register' | 'login', from: AccountFrom, name: string): void {
		account.card = card;
		account.from = from;
		account.nameDraft = name;
		account.passwordDraft = '';
		account.reveal = false;
		account.problem = null;
		account.busy = false;
		// Straight to the password when the name is there already.
		account.field = name === '' ? 'name' : 'password';
		this.guard.show();
		sfx.play('confirm');
	}

	/** The card goes, and whatever it was opened over has the keys again. */
	close(): void {
		account.card = null;
		account.busy = false;
		account.problem = null;
		account.passwordDraft = '';
	}

	/** The hourly card, while exploring a guest's game. */
	openPrompt(): void {
		account.prompt = true;
		account.promptChoice = 0;
		this.guard.show();
		sfx.play('confirm');
	}

	onKey(e: KeyboardEvent): void {
		// An input method is still building a character; its Enter and Escape are its own.
		if (e.isComposing || e.keyCode === 229) return;
		if (account.card !== null) this.cardKey(e);
		else if (account.prompt) this.promptKey(e);
	}

	// --- the card -------------------------------------------------------------

	private cardKey(e: KeyboardEvent): void {
		// Paste, select all: the boxes' and the browser's own.
		if (isShortcut(e)) return;
		if (account.busy) {
			// The server is being asked: nothing changes the card meanwhile, typing included.
			e.preventDefault();
			return;
		}
		if (e.key === REVEAL_KEY) {
			e.preventDefault();
			account.reveal = !account.reveal;
			sfx.play('move');
			return;
		}
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				if (!e.repeat) this.close();
				return;
			case 'Tab':
				// The other box; the focus never leaves the card.
				e.preventDefault();
				account.field = account.field === 'name' ? 'password' : 'name';
				return;
			case 'Enter':
				e.preventDefault();
				if (e.repeat || !this.guard.press()) return;
				// From the name box, Enter goes on to the password first.
				if (account.field === 'name' && account.passwordDraft === '') {
					account.field = 'password';
					return;
				}
				void this.submit();
				return;
		}
		// Typing again, or rubbing out: the problem goes until the next try.
		if (account.problem !== null && (e.key.length === 1 || EDIT_KEYS.has(e.key))) {
			account.problem = null;
		}
	}

	private refuse(problem: AccountProblem): void {
		account.problem = problem;
		account.busy = false;
		sfx.play('wrong');
		if (problem.kind === 'name' || problem.kind === 'taken') account.field = 'name';
		else if (problem.kind === 'password' || problem.kind === 'wrong') account.field = 'password';
	}

	private async submit(): Promise<void> {
		if (account.card === 'register') await this.register();
		else if (account.card === 'login') await this.logIn();
	}

	private async register(): Promise<void> {
		const store = this.hooks.store;
		const named = checkName(account.nameDraft);
		if (!named.ok) return this.refuse({ kind: 'name', reason: named.reason });
		const password = checkPassword(account.passwordDraft);
		if (!password.ok) return this.refuse({ kind: 'password', reason: password.reason });
		if (!store) return this.refuse({ kind: 'offline' });
		account.nameDraft = named.name;
		account.busy = true;
		account.problem = null;
		// The game as it stands goes with the account, with the account's name on it.
		this.hooks.flush();
		const onScreen = this.hooks.currentSave?.() ?? null;
		const save = onScreen
			? { ...onScreen, name: named.name }
			: (guestGameFor(store, named.name) as SaveWrite | null);
		const waiting = holdLogout(store);
		const result = await register(named.name, account.passwordDraft, save);
		if (result.kind !== 'registered') releaseLogout(store, waiting);
		switch (result.kind) {
			case 'registered':
				sfx.play('confirm');
				// This browser's new session replaced the old one: the logout held is moot.
				forgetLogout(store);
				// The game is in the account now; a browser that keeps nothing cannot play it as
				// the account's here, and says so instead of starting again as a guest.
				if (!moveGuestGameIn(store, result.name)) return this.refuse({ kind: 'storage' });
				this.hooks.restart('saved');
				return;
			case 'bad-name':
				return this.refuse({ kind: 'name', reason: result.reason });
			case 'taken':
				return this.refuse({ kind: 'taken' });
			case 'bad-password':
				return this.refuse({ kind: 'password', reason: result.reason });
			case 'too-many':
				return this.refuse({ kind: 'too-many', minutes: minutes(result.retryAfter) });
			case 'refused':
			case 'offline':
				return this.refuse({ kind: 'offline' });
		}
	}

	private async logIn(): Promise<void> {
		const store = this.hooks.store;
		if (account.nameDraft.trim() === '') return this.refuse({ kind: 'name', reason: 'empty' });
		// No account has a password this short, so this one is simply wrong: said as the server would.
		if (!checkPassword(account.passwordDraft).ok) return this.refuse({ kind: 'wrong' });
		if (!store) return this.refuse({ kind: 'offline' });
		account.busy = true;
		account.problem = null;
		const waiting = holdLogout(store);
		const result = await login(account.nameDraft, account.passwordDraft);
		if (result.kind !== 'logged-in') releaseLogout(store, waiting);
		switch (result.kind) {
			case 'logged-in': {
				sfx.play('confirm');
				// This browser's new session replaced the old one: the logout held is moot.
				forgetLogout(store);
				// The game on screen is saved first, where it lives (the guest's stays the guest's).
				this.hooks.flush();
				const theirs = await getAccountSave(result.name);
				if (theirs.kind === 'found') takeAccountGame(store, result.name, theirs.doc);
				logInHere(store, result.name);
				this.hooks.restart('welcome');
				return;
			}
			case 'wrong':
				return this.refuse({ kind: 'wrong' });
			case 'too-many':
				return this.refuse({ kind: 'too-many', minutes: minutes(result.retryAfter) });
			case 'refused':
			case 'offline':
				return this.refuse({ kind: 'offline' });
		}
	}

	/**
	 * Log out (the pause menu): the game is saved, and sent to the server as
	 * far as it will go; the server ends the session (or hears it at the next
	 * start, when it cannot be reached now); then the page starts again as a
	 * guest. The account's game stays in this browser for the next login.
	 */
	async logOut(): Promise<void> {
		const store = this.hooks.store;
		const name = account.name;
		if (account.leaving || !store || name === null) return;
		account.leaving = true;
		this.hooks.flush();
		await this.hooks.pushNow();
		if ((await logout(name)) === 'offline') rememberLogout(store, name);
		logOutHere(store, name);
		this.hooks.restart('loggedOut');
	}

	// --- the hourly card ------------------------------------------------------

	private promptKey(e: KeyboardEvent): void {
		if (isShortcut(e)) return;
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		const key = keyName(e);
		const fresh = isMashKey(key) ? this.guard.press() : this.guard.ready;
		const tapped = tappedRow(key);
		if (tapped !== undefined) {
			e.preventDefault();
			// A tap picks, so it waits the quiet moment as Enter does.
			if (tapped >= PROMPT_CHOICES.length || !fresh) return;
			account.promptChoice = tapped;
			this.answer();
			return;
		}
		switch (key) {
			case 'ArrowLeft':
			case 'a':
			case 'ArrowUp':
			case 'w':
				e.preventDefault();
				if (account.promptChoice > 0) {
					account.promptChoice--;
					sfx.play('move');
				}
				return;
			case 'ArrowRight':
			case 'd':
			case 'ArrowDown':
			case 's':
				e.preventDefault();
				if (account.promptChoice < PROMPT_CHOICES.length - 1) {
					account.promptChoice++;
					sfx.play('move');
				}
				return;
			case 'Enter':
			case ' ':
				e.preventDefault();
				if (fresh) this.answer();
				return;
			case 'Escape':
				e.preventDefault();
				account.promptChoice = PROMPT_CHOICES.indexOf('later');
				this.answer();
				return;
		}
	}

	private answer(): void {
		const choice = PROMPT_CHOICES[account.promptChoice];
		account.prompt = false;
		this.hooks.answered();
		if (choice === 'save') this.openRegister('prompt');
		else sfx.play('move');
	}
}
