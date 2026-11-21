import {
	checkName,
	checkPassword,
	nameKey,
	readSave,
	type GameEvent,
	type SaveWrite
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { isShortcut, keyName } from '../input/keyboard';
import { isMashKey, PickGuard } from '../input/pick-guard';
import { REVEAL_KEY, tappedRow } from '../input/press';
import { KEYS, parseJson, type KeyValueStore } from '../save/storage';
import {
	PROMPT_CHOICES,
	account,
	awayFromHome,
	cardBoxes,
	loginByNameAlone,
	type AccountCard,
	type AccountField,
	type AccountFrom,
	type AccountProblem,
	type WelcomeView
} from '../state/account.svelte';
import {
	acceptWelcome,
	changePassword,
	getAccountSave,
	homeAccounts,
	keepGame,
	login,
	loginAtHome,
	logout,
	lookAtWelcome,
	register,
	renameAccount
} from './api';
import { keepingCursors } from './ready';
import type { AccountNote } from './restart';
import {
	forgetLogout,
	guestGameFor,
	holdLogout,
	logInHere,
	logOutHere,
	moveAccountGame,
	moveGuestGameIn,
	putGuestGameAway,
	releaseLogout,
	rememberLogout,
	takeAccountGame
} from './session';

/**
 * The account screens ([[UI_SPEC]] § Accounts): the card that makes an
 * account with the guest game or logs in to one, the save card that offers
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
 *
 * A welcome link (`welcome.ts`) opens the welcome card over the title: the
 * account the admin made for a game that came from another server, whose
 * password the kid picks. Picking it logs in as a login does; a spent link
 * says so kindly and offers a login, or the game this browser plays.
 *
 * The pause menu's New name and New password open the card for the player
 * on screen. A guest's new name is the game's alone (`nameChosen`). An
 * account's goes to the server first, and on any browser but the account's
 * own the account's password goes with either; a new name then moves the
 * account's game in this browser to the new name's keys, and the page starts
 * again in it.
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
	/** The save card was answered: it comes back after another 1,000 steps. */
	answered(): void;
	/**
	 * Start the page again, in the game the browser now plays, saying `note`;
	 * after a logout, `name` is the account just left, which the title offers
	 * to log in to again.
	 */
	restart(note: AccountNote, name?: string): void;
	/**
	 * The welcome link is settled (used, spent, or put away): the tab, which
	 * keeps its token for its own next starts (`welcome.ts`), forgets it.
	 */
	forgetWelcome?(): void;
	/** A new password was picked: the card is gone, and the game says so. */
	passwordChanged?(): void;
	/** A guest picked a new name (as `checkName` keeps it): the card is gone, and the game takes it. */
	nameChosen?(name: string): void;
	/**
	 * The account took a new name, and this browser has no room to keep its
	 * game under it: nothing this page plays reaches the account any more, so
	 * the page plays on as a logged-out one (its game kept in this browser
	 * only), and says so; logging in by the new name brings the account back.
	 */
	cannotFollow?(): void;
	/**
	 * The gate could not make the account because the server is busy or away
	 * (too many tries from one school's network, no connection): the card is
	 * gone, and the game goes on as a guest. The gate asks again next time.
	 */
	gateStepsAside?(): void;
}

/** Keys that change what a box holds without typing a letter. */
const EDIT_KEYS: ReadonlySet<string> = new Set(['Backspace', 'Delete']);

/**
 * How long a page following its account's new name waits for the server's
 * copy of the game before it starts again with its own: start-up's wait.
 */
export const FOLLOW_WAIT_MS = 2_500;

/** What the box `field` holds. */
function draftOf(field: AccountField): string {
	switch (field) {
		case 'name':
			return account.nameDraft;
		case 'password':
			return account.passwordDraft;
		case 'current':
			return account.currentDraft;
	}
}

/** A wait the server asked for, in whole minutes, at least one. */
function minutes(seconds: number): number {
	return Math.max(1, Math.ceil(seconds / 60));
}

export class AccountController {
	/** The quiet moment the cards wait for before Enter or a tap picks (`input/pick-guard.ts`). */
	private guard = new PickGuard();

	/** The welcome link's token while its card is up: the controller's alone, never the view's. */
	private welcomeToken: string | null = null;

	/** A new name this browser had no room to follow (`followRename`): not tried again on this page. */
	private unfollowed: string | null = null;

	/** The name of the guest game the password gate last stood before (`openGate`). */
	private gateName = '';

	constructor(private hooks: AccountHooks) {}

	/**
	 * Something else takes the screen (a step already under way met a wild
	 * animal, the doctor's card opened, the game left for the title): the
	 * save card goes unanswered, and comes back the next time the player is
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

	/**
	 * Continue on the title, for a guest's game: it goes on only as an
	 * account's, so the card asks for a password first, the game's name
	 * (`name`) in its box. Back is the title again. When the game's name is an
	 * account this browser is the own of, the kid has that account already:
	 * the card logs in to it by the name alone instead of calling it taken.
	 */
	openGate(name: string): void {
		const own = name !== '' && account.homeNames.some((n) => nameKey(n) === nameKey(name));
		this.gateName = name;
		this.open(own ? 'login' : 'register', 'gate', name);
	}

	/**
	 * Log in to an account: the card, the name box holding the player's name,
	 * if any. On a browser that is some account's own, the server is asked
	 * which, so that one logs in by its name alone.
	 */
	openLogin(from: AccountFrom): void {
		this.open('login', from, this.hooks.playerName() ?? '');
		void this.learnHome();
	}

	/**
	 * A new password for the account the page plays (the pause menu): on its
	 * own browser the new one alone, anywhere else the password now first.
	 */
	openPassword(): void {
		if (account.name === null) return;
		this.open('password', 'pause', account.name);
	}

	/**
	 * A new name for the player (the pause menu): the name box holds the name
	 * they have, picked whole so typing replaces it. An account's, away from
	 * its own browser, asks for the password too.
	 */
	openName(): void {
		this.open('name', 'pause', this.hooks.playerName() ?? account.name ?? '');
	}

	/**
	 * Asks the server which accounts this browser is the own of, and keeps the
	 * answer (no answer keeps the last one). The login card waits for nothing:
	 * it asks for a password until the answer says it need not.
	 */
	async learnHome(): Promise<void> {
		const names = await homeAccounts();
		if (names === null) return;
		const before = loginByNameAlone();
		account.homeNames = names;
		// The password box went: the name box takes the typing, and Enter logs in.
		if (!before && loginByNameAlone() && account.passwordDraft === '') account.field = 'name';
	}

	/**
	 * A welcome link opened the page: its card, over the title, asks the
	 * server whose account the link opens, then takes the password the kid
	 * picks for it.
	 */
	openWelcome(token: string): void {
		this.open('welcome', 'title', '');
		this.welcomeToken = token;
		this.showWelcome({ phase: 'checking' });
		void this.lookAtWelcome(token);
	}

	/** What the welcome card shows now: a new choice, so a key mashed as it came picks nothing. */
	private showWelcome(view: WelcomeView): void {
		account.welcome = view;
		this.guard.show();
	}

	private async lookAtWelcome(token: string): Promise<void> {
		const look = await lookAtWelcome(token);
		// The card went, or another card took its place, while the server was asked.
		if (account.card !== 'welcome' || this.welcomeToken !== token) return;
		if (look.kind === 'live') {
			account.nameDraft = look.name;
			this.showWelcome({ phase: 'ready', name: look.name });
		} else if (look.kind === 'gone') {
			this.hooks.forgetWelcome?.();
			this.showWelcome({ phase: 'gone', why: look.why });
		} else if (look.kind === 'too-many') {
			this.showWelcome({ phase: 'unreachable', minutes: minutes(look.retryAfter) });
		} else {
			this.showWelcome({ phase: 'unreachable' });
		}
	}

	private open(card: AccountCard, from: AccountFrom, name: string): void {
		this.welcomeToken = null;
		account.card = card;
		account.from = from;
		account.nameDraft = name;
		account.passwordDraft = '';
		account.currentDraft = '';
		account.reveal = false;
		account.problem = null;
		account.busy = false;
		// Straight to the password when the name is there already, or is the account's own;
		// a name that logs in alone keeps the typing in the name box, the only box. A new
		// name starts in its box; a new password away from home with the password now.
		account.field =
			card === 'name' ||
			(name === '' && card !== 'welcome' && card !== 'password') ||
			loginByNameAlone()
				? 'name'
				: card === 'password' && awayFromHome()
					? 'current'
					: 'password';
		this.guard.show();
		sfx.play('confirm');
	}

	/** The card goes, and whatever it was opened over has the keys again. */
	close(): void {
		// Not now: the kid put the link away, and the tab's next start leaves it be.
		if (account.card === 'welcome') this.hooks.forgetWelcome?.();
		this.welcomeToken = null;
		account.card = null;
		account.busy = false;
		account.problem = null;
		account.passwordDraft = '';
		account.currentDraft = '';
	}

	/**
	 * The server said whether it can keep an account now (`ready.ts`). When it
	 * cannot, a save card that is up goes, unanswered: it offers what the
	 * server cannot do, and comes back once it can. An account card that is
	 * up stays, with the kid's typing: its answer says kindly if the server
	 * is out of reach.
	 */
	heardReady(ready: boolean): void {
		account.ready = ready;
		account.readyHeard = true;
		if (!ready) account.prompt = false;
	}

	/**
	 * The save card, while exploring a guest's game, and only while the
	 * server can keep an account: "Save my game" must be a promise it keeps.
	 */
	openPrompt(): void {
		if (!account.ready) return;
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
		if (account.card === 'welcome' && account.welcome.phase !== 'ready') {
			this.welcomeChoiceKey(e);
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
			case 'Tab': {
				// The next box the card has, round again; the focus never leaves the card. The
				// welcome card's name and the new password card's are the account's, not typed, and
				// a name that logs in alone has no password box to go to (`cardBoxes`).
				e.preventDefault();
				const boxes = cardBoxes();
				const at = boxes.indexOf(account.field);
				if (boxes.length > 1) account.field = boxes[(at + 1) % boxes.length]!;
				return;
			}
			case 'Enter': {
				e.preventDefault();
				if (e.repeat || !this.guard.press()) return;
				// Enter goes on to the next box first while it is empty: the name, then the password.
				const boxes = cardBoxes();
				const next = boxes[boxes.indexOf(account.field) + 1];
				if (next !== undefined && draftOf(next) === '') {
					account.field = next;
					return;
				}
				void this.submit();
				return;
			}
		}
		// Typing again, or rubbing out: the problem goes until the next try.
		if (account.problem !== null && (e.key.length === 1 || EDIT_KEYS.has(e.key))) {
			account.problem = null;
		}
	}

	/**
	 * The server said this page's session is over, in answer to a card. The
	 * account's rows follow the session (New password and New name go, Log in
	 * comes), so the Settings cursor keeps its row, or Back when its row went,
	 * as when the session check hears it first (`heardSession` in `main.ts`).
	 */
	private sessionEnded(): void {
		keepingCursors(() => {
			account.session = 'ended';
		});
	}

	private refuse(problem: AccountProblem): void {
		account.problem = problem;
		account.busy = false;
		sfx.play('wrong');
		if (problem.kind === 'name' || problem.kind === 'taken') account.field = 'name';
		else if (problem.kind === 'password' || problem.kind === 'wrong') account.field = 'password';
		else if (problem.kind === 'wrong-current' || problem.kind === 'not-home')
			account.field = 'current';
	}

	/**
	 * The welcome card without its boxes: the server being asked about the
	 * link (Escape only), a spent link (Enter logs in, only while the server
	 * can keep an account, as every offer of one waits; Escape plays the game
	 * this browser plays), or no answer (Enter asks again). Enter or Space,
	 * after the quiet moment.
	 */
	private welcomeChoiceKey(e: KeyboardEvent): void {
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				if (!e.repeat) this.close();
				return;
			case 'Enter':
			case ' ': {
				e.preventDefault();
				if (e.repeat || !this.guard.press()) return;
				const token = this.welcomeToken;
				if (account.welcome.phase === 'gone') {
					if (account.ready) this.openLogin('title');
				} else if (account.welcome.phase === 'unreachable' && token !== null) {
					sfx.play('move');
					this.showWelcome({ phase: 'checking' });
					void this.lookAtWelcome(token);
				}
				return;
			}
		}
	}

	private async submit(): Promise<void> {
		if (account.card === 'register') await this.register();
		else if (account.card === 'login') await this.logIn();
		else if (account.card === 'welcome') await this.welcome();
		else if (account.card === 'password') await this.newPassword();
		else if (account.card === 'name') await this.newName();
	}

	/**
	 * A new password for the account the page plays: the server keeps it and
	 * logs every other browser out; this one plays on, the card goes, and the
	 * game says so. Away from the account's own browser the password now goes
	 * with it.
	 */
	private async newPassword(): Promise<void> {
		const name = account.name;
		if (name === null) return;
		const away = awayFromHome();
		// No account has a password this short, so this one is simply wrong: said as the server would.
		if (away && !checkPassword(account.currentDraft).ok)
			return this.refuse({ kind: 'wrong-current' });
		const password = checkPassword(account.passwordDraft);
		if (!password.ok) return this.refuse({ kind: 'password', reason: password.reason });
		account.busy = true;
		account.problem = null;
		const result = await changePassword(
			name,
			account.passwordDraft,
			away ? account.currentDraft : undefined
		);
		switch (result.kind) {
			case 'changed':
				sfx.play('confirm');
				this.close();
				this.hooks.passwordChanged?.();
				return;
			case 'bad-password':
				return this.refuse({ kind: 'password', reason: result.reason });
			case 'not-home':
				// This browser is the account's own no more (a grown-up moved it): the password now too.
				account.home = false;
				return this.refuse({ kind: 'not-home' });
			case 'wrong':
				return this.refuse({ kind: 'wrong-current' });
			case 'logged-out':
				this.sessionEnded();
				return this.refuse({ kind: 'logged-out' });
			case 'renamed':
				// The account took a new name on another page first: this one follows it.
				this.close();
				await this.followRename(result.name);
				return;
			case 'too-many':
				return this.refuse({ kind: 'too-many', minutes: minutes(result.retryAfter) });
			case 'refused':
			case 'offline':
				return this.refuse({ kind: 'offline' });
		}
	}

	/**
	 * A new name for the player. A guest's is the game's alone: the card goes,
	 * and the game takes it. An account's goes to the server, which keeps the
	 * old one for the account; then the account's game in this browser moves
	 * to the new name, with it, and the page starts again in it. Away from the
	 * account's own browser the password goes with it.
	 */
	private async newName(): Promise<void> {
		const named = checkName(account.nameDraft);
		if (!named.ok) return this.refuse({ kind: 'name', reason: named.reason });
		account.nameDraft = named.name;
		const name = account.name;
		if (name === null) {
			sfx.play('confirm');
			this.close();
			this.hooks.nameChosen?.(named.name);
			return;
		}
		const store = this.hooks.store;
		const away = awayFromHome();
		if (away && !checkPassword(account.currentDraft).ok)
			return this.refuse({ kind: 'wrong-current' });
		if (named.name === name) {
			// The name it has: nothing to change.
			sfx.play('move');
			this.close();
			return;
		}
		if (!store) return this.refuse({ kind: 'offline' });
		account.busy = true;
		account.problem = null;
		const result = await renameAccount(name, named.name, away ? account.currentDraft : undefined);
		switch (result.kind) {
			case 'renamed':
				sfx.play('confirm');
				// The card stays up until the page starts again; one that cannot (no room) goes.
				if (!(await this.followRename(result.name))) this.close();
				return;
			case 'bad-name':
				return this.refuse({ kind: 'name', reason: result.reason });
			case 'taken':
				return this.refuse({ kind: 'taken' });
			case 'not-home':
				account.home = false;
				return this.refuse({ kind: 'not-home' });
			case 'wrong':
				return this.refuse({ kind: 'wrong-current' });
			case 'logged-out':
				this.sessionEnded();
				return this.refuse({ kind: 'logged-out' });
			case 'renamed-before':
				this.close();
				await this.followRename(result.name);
				return;
			case 'too-many':
				return this.refuse({ kind: 'too-many', minutes: minutes(result.retryAfter) });
			case 'refused':
			case 'offline':
				return this.refuse({ kind: 'offline' });
		}
	}

	/**
	 * The account the page plays is called `name` now: the kid picked it on
	 * this page, or on another (another tab, another tablet) and the server
	 * says so. The server's copy is asked for first (`FOLLOW_WAIT_MS` at most),
	 * while the game plays on under the old name; then, with no wait between,
	 * the game as it stands is saved, moves to the new name's keys in this
	 * browser (`moveAccountGame`), the server's copy is taken when it is
	 * further along (as at a login), and the page starts again in it, saying
	 * the new name. So nothing played meanwhile stays under the old name. Once: the page waits
	 * meanwhile (`account.leaving`) and hears nothing more. When the browser
	 * cannot keep the game under the new name (its storage is full), the page
	 * plays on as a logged-out one and says so (`hooks.cannotFollow`), once:
	 * starting again would only hear the new name again, and start again for
	 * ever.
	 * True when this call starts the page again.
	 */
	async followRename(name: string): Promise<boolean> {
		const from = account.name;
		const store = this.hooks.store;
		if (account.leaving || from === null || !store || this.unfollowed === name) return false;
		account.leaving = true;
		const theirs = await getAccountSave(name, undefined, FOLLOW_WAIT_MS);
		this.hooks.flush();
		if (!moveAccountGame(store, from, name)) {
			account.leaving = false;
			this.unfollowed = name;
			this.hooks.cannotFollow?.();
			return false;
		}
		if (theirs.kind === 'found') takeAccountGame(store, name, theirs.doc);
		this.hooks.restart('renamed', name);
		return true;
	}

	/**
	 * The password picked on the welcome card: the server sets it, uses the
	 * link up and logs this browser in, as a login does, and the account's
	 * save becomes this browser's copy of the account's game (the guest game
	 * stays where it is). Then the page starts again, into it.
	 */
	private async welcome(): Promise<void> {
		const store = this.hooks.store;
		const token = this.welcomeToken;
		if (account.welcome.phase !== 'ready' || token === null) return;
		const password = checkPassword(account.passwordDraft);
		if (!password.ok) return this.refuse({ kind: 'password', reason: password.reason });
		// A browser that keeps nothing could not play the account here: the link waits for one that can.
		if (!store) return this.refuse({ kind: 'storage' });
		account.busy = true;
		account.problem = null;
		const waiting = holdLogout(store);
		const result = await acceptWelcome(token, account.passwordDraft);
		if (result.kind !== 'welcomed') releaseLogout(store, waiting);
		switch (result.kind) {
			case 'welcomed':
				sfx.play('confirm');
				// This browser's new session replaced the old one: the logout held is moot.
				forgetLogout(store);
				this.hooks.flush();
				takeAccountGame(store, result.name, result.save);
				logInHere(store, result.name);
				// Before the page starts again, which would otherwise open the card for a used link.
				this.hooks.forgetWelcome?.();
				this.hooks.restart('welcome');
				return;
			case 'gone':
				// Used meanwhile (in another tab, say), or too old by now.
				account.busy = false;
				sfx.play('wrong');
				this.hooks.forgetWelcome?.();
				this.showWelcome({ phase: 'gone', why: result.why });
				return;
			case 'bad-password':
				return this.refuse({ kind: 'password', reason: result.reason });
			case 'too-many':
				return this.refuse({ kind: 'too-many', minutes: minutes(result.retryAfter) });
			case 'refused':
			case 'offline':
				return this.refuse({ kind: 'offline' });
		}
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
				if (this.stepAside()) return;
				return this.refuse({ kind: 'too-many', minutes: minutes(result.retryAfter) });
			case 'refused':
			case 'offline':
				if (this.stepAside()) return;
				return this.refuse({ kind: 'offline' });
		}
	}

	/** At the gate, a server that cannot make the account now lets the game go on as a guest's. */
	private stepAside(): boolean {
		if (account.from !== 'gate' || !this.hooks.gateStepsAside) return false;
		this.close();
		this.hooks.gateStepsAside();
		return true;
	}

	private async logIn(): Promise<void> {
		const store = this.hooks.store;
		// The guest game's own name, when this card is the gate's: only a login to that account
		// passes the game over for good (any other account leaves it for its own login).
		const gameName = account.from === 'gate' && this.gateName !== '' ? this.gateName : null;
		if (account.nameDraft.trim() === '') return this.refuse({ kind: 'name', reason: 'empty' });
		// On the account's own browser the name alone logs in.
		const alone = loginByNameAlone();
		// No account has a password this short, so this one is simply wrong: said as the server would.
		if (!alone && !checkPassword(account.passwordDraft).ok) return this.refuse({ kind: 'wrong' });
		if (!store) return this.refuse({ kind: 'offline' });
		account.busy = true;
		account.problem = null;
		const waiting = holdLogout(store);
		const result = alone
			? await loginAtHome(account.nameDraft)
			: await login(account.nameDraft, account.passwordDraft);
		if (result.kind !== 'logged-in') releaseLogout(store, waiting);
		switch (result.kind) {
			case 'logged-in': {
				sfx.play('confirm');
				// This browser's new session replaced the old one: the logout held is moot.
				forgetLogout(store);
				// The game on screen is saved first, where it lives (the guest's stays the guest's,
				// except one the gate passed over, which the account keeps aside on the server).
				this.hooks.flush();
				const theirs = await getAccountSave(result.name);
				if (theirs.kind === 'found') takeAccountGame(store, result.name, theirs.doc);
				if (gameName !== null && nameKey(gameName) === nameKey(result.name)) {
					await this.keepGuestGame(store, result.name);
				}
				logInHere(store, result.name);
				this.hooks.restart('welcome');
				return;
			}
			case 'wrong':
				return this.refuse({ kind: 'wrong' });
			case 'not-home':
				// This browser is that account's own no more (the grown-up moved it): the
				// password box comes back, to type it in.
				account.homeNames = account.homeNames.filter(
					(n) => nameKey(n) !== nameKey(account.nameDraft)
				);
				account.busy = false;
				sfx.play('wrong');
				void this.learnHome();
				if (!loginByNameAlone()) account.field = 'password';
				return;
			case 'too-many':
				return this.refuse({ kind: 'too-many', minutes: minutes(result.retryAfter) });
			case 'refused':
			case 'offline':
				return this.refuse({ kind: 'offline' });
		}
	}

	/**
	 * The password gate logged in to `name`, the account the guest game is named
	 * for, instead of going on with that game, which this browser alone holds
	 * and every later Continue would lead to the same login: it goes to the account's set-aside
	 * games on the server, for the grown-up to bring back, and once the server
	 * has it, it is put away here too (`putGuestGameAway`), so the gate does not
	 * stand before it again. No word is said: the kid plays the account's game,
	 * as the login always did. A server that does not take it (out of reach,
	 * too many saves, a game it refuses) leaves it where it is, and the next
	 * gate sends it again.
	 */
	private async keepGuestGame(store: KeyValueStore, name: string): Promise<void> {
		const text = store.get(KEYS.save);
		if (text === null) return;
		const doc = parseJson(text);
		if (!readSave(doc).ok) return;
		if (await keepGame(name, doc)) putGuestGameAway(store, text);
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
		this.hooks.restart('loggedOut', name);
	}

	// --- the save card ------------------------------------------------------

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
