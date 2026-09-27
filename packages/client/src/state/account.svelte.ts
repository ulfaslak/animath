import type { NameRejection, PasswordRefusal } from '@mathgame/engine';

/**
 * What the account screens show ([[UI_SPEC]] § Accounts): who this page
 * plays as, the card that makes an account or logs in, and the hourly card
 * that offers to keep a guest's animals safe. Written only by
 * `AccountController` and `main.ts`, except the drafts, which the card's
 * boxes bind as the player types, and `field`, which follows the box a
 * finger or a click focuses.
 */

/** The card: make an account with the guest game, or log in to one. */
export type AccountCard = 'register' | 'login';

/** The card's two boxes. */
export type AccountField = 'name' | 'password';

/** Where the card was opened: where Back returns. */
export type AccountFrom = 'title' | 'pause' | 'prompt';

/** Why the card did not go on, said kindly under its boxes until the player types again. */
export type AccountProblem =
	| { kind: 'name'; reason: NameRejection }
	| { kind: 'taken' }
	| { kind: 'password'; reason: PasswordRefusal }
	| { kind: 'wrong' }
	| { kind: 'too-many'; minutes: number }
	| { kind: 'offline' }
	/** The account was made with the game, but this browser keeps nothing: it cannot be logged in here. */
	| { kind: 'storage' };

/**
 * Whether the server still knows this page's account: `unknown` until the
 * page has asked (or while it cannot reach the server), `ended` once it has
 * said the session is over (a password reset, a year unused), and then the
 * game saves only in this browser until the player logs in again.
 */
export type SessionState = 'unknown' | 'live' | 'ended';

/** The hourly card's choices, in order: keep the game safe, or not now. */
export const PROMPT_CHOICES = ['save', 'later'] as const;
export type PromptChoice = (typeof PROMPT_CHOICES)[number];

class AccountView {
	/** The account this page plays, by its name; null for a guest. Set once, as the page starts. */
	name = $state<string | null>(null);
	session = $state<SessionState>('unknown');
	/**
	 * The server said, lately, that it can make and keep an account
	 * (`account/ready.ts`). Only then does the game offer one: the hourly
	 * card, "Make an account" and "Log in" in the menu, "I have an account"
	 * on the title.
	 */
	ready = $state(false);
	/** The card that is up, or null. It takes every key while it is up. */
	card = $state<AccountCard | null>(null);
	from = $state<AccountFrom>('title');
	nameDraft = $state('');
	passwordDraft = $state('');
	/** The password shows as typed, not as dots. */
	reveal = $state(false);
	/** The box that takes the typing. */
	field = $state<AccountField>('name');
	problem = $state.raw<AccountProblem | null>(null);
	/** A request is on its way: keys wait, and the card says so. */
	busy = $state(false);
	/** The hourly card is up (only while exploring, and only for a guest's game). */
	prompt = $state(false);
	/** The lit choice of the hourly card, an index into `PROMPT_CHOICES`. */
	promptChoice = $state(0);
	/** Logging out is on its way: the pause menu waits. */
	leaving = $state(false);
}

export const account = new AccountView();
