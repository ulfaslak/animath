import { nameKey, type NameRejection, type PasswordRefusal } from '@mathgame/engine';

/**
 * What the account screens show ([[UI_SPEC]] § Accounts): who this page
 * plays as, the card that makes an account, logs in or takes a welcome
 * link's password, and the save card that offers to keep a guest's
 * animals safe. Written only by
 * `AccountController` and `main.ts`, except the drafts, which the card's
 * boxes bind as the player types, and `field`, which follows the box a
 * finger or a click focuses.
 */

/**
 * The card: make an account with the guest game, log in to one, pick the
 * password of the account a welcome link opens, pick a new password for the
 * account the page plays, or a new name for the player (a guest's, or the
 * account's).
 */
export type AccountCard = 'register' | 'login' | 'welcome' | 'password' | 'name';

/** Why a welcome link opens no account: used up, too old, or no link the server knows. */
export type WelcomeGone = 'used' | 'expired' | 'unknown';

/**
 * What the welcome card shows: the server being asked about the link, the
 * account it opens (whose password the kid picks), a spent link, or no
 * answer from the server (or, with `minutes`, too many tries from here
 * lately, and the wait the server asked for).
 */
export type WelcomeView =
	| { phase: 'checking' }
	| { phase: 'ready'; name: string }
	| { phase: 'gone'; why: WelcomeGone }
	| { phase: 'unreachable'; minutes?: number };

/**
 * The card's boxes: a name, a password (typed to log in, or picked), and the
 * account's password now, which a new name or a new password asks for away
 * from the account's own browser.
 */
export type AccountField = 'name' | 'password' | 'current';

/**
 * Where the card was opened: where Back returns. `gate`: Continue on the
 * title, for a guest's game, which goes on only once it is an account's.
 */
export type AccountFrom = 'title' | 'pause' | 'prompt' | 'gate';

/** Why the card did not go on, said kindly under its boxes until the player types again. */
export type AccountProblem =
	| { kind: 'name'; reason: NameRejection }
	| { kind: 'taken' }
	| { kind: 'password'; reason: PasswordRefusal }
	| { kind: 'wrong' }
	/** The password now, for a new name or a new password away from home, was not the account's. */
	| { kind: 'wrong-current' }
	/** The server says this page's session is over: a change to the account waits for a login. */
	| { kind: 'logged-out' }
	| { kind: 'too-many'; minutes: number }
	| { kind: 'offline' }
	/**
	 * A new name or a new password asked for as on the account's own browser,
	 * which this one is not (any more): the password now is asked for too.
	 */
	| { kind: 'not-home' }
	/**
	 * This browser keeps nothing: the account was made with the game but cannot
	 * be logged in here, or (on the welcome card) nothing is sent, since the
	 * account could not be played here.
	 */
	| { kind: 'storage' };

/**
 * Whether the server still knows this page's account: `unknown` until the
 * page has asked (or while it cannot reach the server), `ended` once it has
 * said the session is over (a password reset, a year unused), and then the
 * game saves only in this browser until the player logs in again.
 */
export type SessionState = 'unknown' | 'live' | 'ended';

/** The save card's choices, in order: keep the game safe, or not now. */
export const PROMPT_CHOICES = ['save', 'later'] as const;
export type PromptChoice = (typeof PROMPT_CHOICES)[number];

class AccountView {
	/** The account this page plays, by its name; null for a guest. Set once, as the page starts. */
	name = $state<string | null>(null);
	session = $state<SessionState>('unknown');
	/**
	 * This browser is the logged-in account's own (the server said so at
	 * start): there a new name or a new password needs nothing more; on any
	 * other, the account's password too.
	 */
	home = $state(false);
	/**
	 * The accounts whose own browser this is, by name, as the server last
	 * said: logging in to one of them takes the name alone.
	 */
	homeNames = $state.raw<readonly string[]>([]);
	/**
	 * The server said, lately, that it can make and keep an account
	 * (`account/ready.ts`). Only then does the game offer one: the save
	 * card, "Make an account" and "Log in" in the menu, "I have an account"
	 * on the title.
	 */
	ready = $state(false);
	/**
	 * The server has answered at least once, yes or no (no answer counts as a
	 * no). Until then the title keeps the place of an offer it would show on a
	 * yes, so the offer fades in there instead of pushing the rows about.
	 */
	readyHeard = $state(false);
	/** The card that is up, or null. It takes every key while it is up. */
	card = $state<AccountCard | null>(null);
	from = $state<AccountFrom>('title');
	nameDraft = $state('');
	passwordDraft = $state('');
	/** The account's password now, typed for a new name or a new password away from home. */
	currentDraft = $state('');
	/** The password shows as typed, not as dots. */
	reveal = $state(false);
	/** The box that takes the typing. */
	field = $state<AccountField>('name');
	problem = $state.raw<AccountProblem | null>(null);
	/** A request is on its way: keys wait, and the card says so. */
	busy = $state(false);
	/** The welcome card's content, while `card` is `welcome`. */
	welcome = $state.raw<WelcomeView>({ phase: 'checking' });
	/** The save card is up (only while exploring, and only for a guest's game). */
	prompt = $state(false);
	/** The lit choice of the save card, an index into `PROMPT_CHOICES`. */
	promptChoice = $state(0);
	/**
	 * Logging out, or following the account's new name, is on its way: the
	 * page starts again soon, and the pause menu waits.
	 */
	leaving = $state(false);
}

export const account = new AccountView();

/**
 * The login card's name is one of this browser's own accounts
 * (`account.homeNames`): the name alone logs in, and the card asks for no
 * password.
 */
export function loginByNameAlone(): boolean {
	if (account.card !== 'login') return false;
	const typed = nameKey(account.nameDraft);
	return typed !== '' && account.homeNames.some((name) => nameKey(name) === typed);
}

/**
 * A change to the account the page plays (a new name, a new password) away
 * from its own browser: the account's password now is asked for too. Never
 * for a guest, whose name is the game's alone.
 */
export function awayFromHome(): boolean {
	return account.name !== null && !account.home;
}

/**
 * The boxes the card up has, in the order Tab walks them: the name and the
 * password; the name alone on the account's own browser's login; the
 * password alone on a welcome link's card (its name is the account's); a new
 * password, with the password now before it away from home; a new name, with
 * the password now after it away from home.
 */
export function cardBoxes(): AccountField[] {
	switch (account.card) {
		case 'register':
			return ['name', 'password'];
		case 'login':
			return loginByNameAlone() ? ['name'] : ['name', 'password'];
		case 'welcome':
			return ['password'];
		case 'password':
			return awayFromHome() ? ['current', 'password'] : ['password'];
		case 'name':
			return awayFromHome() ? ['name', 'current'] : ['name'];
		case null:
			return [];
	}
}
