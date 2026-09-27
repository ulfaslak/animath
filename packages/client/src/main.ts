import './styles.css';
import type { SavedGame } from '@mathgame/engine';
import { flushSync, mount } from 'svelte';
import {
	SessionCheck,
	accountSaveServer,
	logout as sendLogout,
	type SessionAnswer
} from './account/api';
import { AccountController } from './account/controller';
import { PLAY_HOUR_MS, PlayClock } from './account/playtime';
import { ReadyWatch, keepingCursors } from './account/ready';
import { noteNextStart, restartWith, takeAccountNote } from './account/restart';
import { currentAccount, forgetLogout, gameKeys, logoutPending } from './account/session';
import { forgetWelcome, takeWelcomeToken, welcomeFrom } from './account/welcome';
import { sfx } from './audio/sfx.svelte';
import { LocalAuthority, mintId } from './authority/local';
import { BattleController } from './battle/controller';
import { DoctorController } from './doctor/controller';
import { ExploreController } from './explore/controller';
import { flags } from './flags';
import { Keyboard } from './input/keyboard';
import { press } from './input/press';
import { isSoundKey, typingNow } from './input/sound-key';
import { watchTaps } from './input/taps';
import { touch, watchInput } from './input/touch.svelte';
import { MatchController } from './match/controller';
import { PauseController } from './pause/controller';
import { PresenceController } from './presence/controller';
import { Follower } from './render/follower';
import { GameRenderer } from './render/renderer';
import { TitleScenery } from './render/title-scenery';
import { Zoo } from './render/zoo';
import { httpSaveServer } from './save/api';
import { Autosave } from './save/autosave';
import {
	behindAction,
	behindKey,
	mayReloadNow,
	reloadIntoNewestGame,
	takeCaughtUp
} from './save/behind';
import type { SaveNotice } from './save/notices';
import { ACCOUNT_KEYS, browserStore } from './save/storage';
import { account } from './state/account.svelte';
import { battle } from './state/battle.svelte';
import { behind } from './state/behind.svelte';
import { doctor } from './state/doctor.svelte';
import { game } from './state/game.svelte';
import { hud } from './state/hud.svelte';
import { match } from './state/match.svelte';
import { pause } from './state/pause.svelte';
import { title } from './state/title.svelte';
import { travel } from './state/travel.svelte';
import { TitleController } from './title/controller';
import { TravelController } from './travel/controller';
import App from './ui/App.svelte';

// A welcome link's token leaves the address before anything else runs (`account/welcome.ts`):
// it logs in to an account once. The tab keeps it for its own next starts until it is settled;
// a throwaway page drops it.
const tabStore = browserStore('session');
const welcomeToken = takeWelcomeToken({ session: tabStore, throwaway: flags.throwaway });

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

// Touch controls or keys (`input/touch.svelte.ts`), decided before anything is laid out.
watchInput(window);
// A game, not a page: no pinch zoom (Safari's own gesture events; the CSS
// takes care of the rest), and no long-press menu under a finger — except in
// a name box, where a long press is how a tablet pastes.
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('contextmenu', (e) => {
	if (touch.on && !(e.target instanceof HTMLInputElement)) e.preventDefault();
});
// Safari shows `:active` (a pressed key, a pressed button) only on a page that listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });

const authority = new LocalAuthority({
	party: flags.party ?? undefined,
	tokens: flags.tokens ?? undefined,
	shop: flags.shop ?? undefined
});
const renderer = new GameRenderer(canvas);
const keyboard = new Keyboard(window);
// The lead walks behind the trainer: a view of the party and of the trainer's steps.
const explore = new ExploreController(authority, renderer, keyboard, new Follower(renderer));
const battleController = new BattleController(authority, renderer);
const doctorController = new DoctorController(authority);
// A trip to another world plays its transition, and sends `travel` under its cover.
const travelController = new TravelController(authority, renderer);
// `?zoo` lines up one of every species by the spawn tile (a check for the meshes),
// once for the page; `?zoo=tired` lays them down to rest.
const zoo = flags.zoo ? new Zoo(renderer, flags.zoo === 'tired') : null;

const store = browserStore();
// The account this page plays: the one this browser is logged in to, else none (a guest).
// A throwaway game is nobody's.
const current = flags.throwaway ? null : currentAccount(store);
account.name = current?.name ?? null;

/**
 * The server's word on the account, asked once as the page starts, before
 * anything else that reads the session goes to the account routes (only
 * `/ready`, which reads no cookie and sends none, may go first;
 * [[INVARIANTS]] § Server): the account's save goes to the server only
 * while it says the session is this account's.
 */
const sessionCheck = current ? new SessionCheck(current.name, heardSession) : null;

/** The session ended before there was anywhere to say so: the title says it when it opens. */
let sessionEndedUnsaid = false;

/**
 * The server said whether this page's account is logged in. When it is not
 * (a new password, a year unused), the game saves only in this browser until
 * the player logs in again, and the page says so once: on the title, or on the
 * message line mid-game.
 */
function heardSession(answer: SessionAnswer): void {
	if (answer === 'offline' || account.session === answer) return;
	account.session = answer;
	if (answer !== 'ended') return;
	if (title.open) title.notice = 'save.sessionEnded';
	else if (game.mode === 'explore') hud.notice('save.sessionEnded');
	else sessionEndedUnsaid = true;
}

// `?new`, `?party=` (a party to look at), `?zoo`, `?tokens=` and `?shop` play a
// throwaway game: nothing is loaded or saved, and the saved game is left alone.
// A guest's game is backed up anonymously in development only; an account's goes to
// the account.
const autosave = new Autosave({
	store,
	keys: gameKeys(current),
	server: sessionCheck
		? accountSaveServer(sessionCheck)
		: import.meta.env.PROD
			? null
			: httpSaveServer(),
	loggedOut: () => heardSession('ended'),
	snapshot: () => authority.snapshot(),
	catchUp: (counts) => authority.catchUp(counts),
	mintId,
	throwaway: flags.throwaway
});
// Friendly matches (`match/`): the Challenge button, the invite and the match, which the
// server plays; they ride on presence's socket, and draw the match on the battle's screen.
const matchController: MatchController = new MatchController({
	send: (message): boolean => presenceController.send(message),
	renderer,
	// A match picked up after a reload takes the screen from the pause menu and the hourly
	// card, which comes back the next time the player is exploring.
	stepAside: () => {
		pauseController.close();
		account.prompt = false;
	},
	count: (events, side) => authority.countMatchAnswers(events, side)
});
// The other players in this world (`presence/`): never behind the title, never in a
// throwaway game, never on a page behind the save; nothing waits on it.
const presenceController: PresenceController = new PresenceController({
	authority,
	renderer,
	store: browserStore(),
	session: browserStore('session'),
	throwaway: flags.throwaway,
	behind: () => autosave.behind !== null,
	flush: () => autosave.flush(),
	reload: () => location.reload(),
	match: matchController
});

/** A guest's play, counted while the page is on screen: every hour the card offers an account. */
const playClock = new PlayClock(store, flags.hourSeconds ? flags.hourSeconds * 1000 : PLAY_HOUR_MS);

const accountController = new AccountController({
	store,
	flush: () => autosave.flush(),
	currentSave: () => autosave.newest,
	pushNow: () => autosave.pushNow(3000),
	playerName: () => (title.open ? (title.saved?.name ?? null) : game.name),
	answered: () => {
		const lineage = autosave.playing;
		if (lineage) playClock.answered(lineage);
	},
	restart: (note) => {
		playClock.flush();
		reloading = true;
		restartWith(note);
	},
	forgetWelcome: () => forgetWelcome(tabStore)
});

const pauseController = new PauseController(authority, {
	travel: (world) => travelController.go(world),
	goTo: (pid) => presenceController.goTo(pid),
	makeAccount: () => accountController.openRegister('pause'),
	logIn: () => accountController.openLogin('pause'),
	logOut: () => void accountController.logOut()
});

/**
 * The server said whether it can keep an account now (`account/ready.ts`):
 * the rows that offer one come or go, each menu's cursor staying on the row
 * it lit, and an hourly card that is up goes, unanswered, until it can.
 */
function heardReady(ready: boolean): void {
	if (account.ready === ready) return;
	keepingCursors(() => accountController.heardReady(ready));
}
// A throwaway game offers no account, so it never asks.
const readyWatch = flags.throwaway ? null : new ReadyWatch(heardReady);
readyWatch?.start();

/**
 * What start-up found about the save, said on the message line once the
 * first game is under way: "Welcome back!" (or, after a reload that caught up
 * with another window, "You were playing in another window…") when the saved
 * game is picked up, anything else when a new game starts. Said once, then
 * forgotten.
 */
let startNotice: SaveNotice | undefined;
function sayStartNotice(newGame: boolean): void {
	const notice = startNotice;
	startNotice = undefined;
	const onContinue = notice === 'save.welcomeBack' || notice === 'save.caughtUp';
	if (notice && onContinue !== newGame) hud.notice(notice);
}

/**
 * Pick the saved game up: as it is now, not as the title found it, because
 * another tab may have walked on meanwhile, and its step count must not go back.
 * `name`: the player's name, just given on the title for a game saved without
 * one; it goes to the authority once the game is under way and saving has
 * begun, so it is saved at once.
 */
function continueGame(saved: SavedGame, name?: string): void {
	authority.start({ game: autosave.resumable() ?? saved });
	// After `welcome`, which clears the message line.
	sayStartNotice(false);
	autosave.begin();
	if (name !== undefined) authority.dispatch({ type: 'choose-name', name });
}

const titleController = new TitleController(authority, new TitleScenery(renderer), {
	continueGame,
	logIn: () => accountController.openLogin('title')
});

authority.subscribe((event) => {
	game.apply(event);
	hud.apply(event);
	explore.handle(event);
	battleController.handle(event);
	doctorController.handle(event);
	pauseController.handle(event);
	travelController.handle(event);
	titleController.handle(event);
	accountController.handle(event);
	autosave.handle(event);
	presenceController.handle(event);
	matchController.handle(event);
	// A new game from the title: after `welcome`, which clears the message line.
	if (event.type === 'welcome' && event.newGame) sayStartNotice(true);
	// Quit to title: the game just left is the one Continue picks up. A page that cannot
	// keep it says so on this title too.
	if (event.type === 'game-left') {
		titleController.open(
			autosave.resumable() ?? authority.snapshot(),
			autosave.titleNotice,
			autosave.keeps
		);
	}
	// The first game of the page puts the `?zoo` line-up up; Continue after the
	// Start screen, or a new game from the title, finds it standing.
	if (event.type === 'welcome') zoo?.welcome(event.seed, event.pos);
});

/**
 * The screen that takes keys now, one at a time: an account card while one
 * is up, else the title while it is up, else a friendly match while it has the
 * screen (asking, starting, the match on the battle's screen, its result, the
 * update card), else the battle while it is up, else the doctor's card while
 * it is open, else the pause menu while it is open, else explore (Escape there
 * opens the pause menu; an invite's card over it takes Enter and Escape
 * first). None while the page loads, nor while a trip to another world covers
 * the screen.
 */
type KeyScreen = 'account' | 'title' | 'match' | 'battle' | 'doctor' | 'pause' | 'explore';
function keyScreen(): KeyScreen | null {
	// The account card, over the title, the pause menu or the game, and the hourly card.
	if (account.card !== null || account.prompt) return 'account';
	if (title.open) return 'title';
	if (game.mode === 'loading' || game.mode === 'title') return null;
	if (travel.active) return null;
	if (matchController.onScreen) return 'match';
	if (battle.active) return 'battle';
	if (doctor.active) return 'doctor';
	if (pause.open) return 'pause';
	return game.mode === 'explore' ? 'explore' : null;
}

/**
 * Walking reads the keyboard only in explore, while a game is under way, with
 * no card or menu open, and never on a page that is behind the save.
 */
const exploreInput = () => keyScreen() === 'explore' && autosave.behind === null;

/**
 * Counts every change of what takes keys, down to the screen inside a screen
 * (the battle's menu, its turn playing, its result card), so a tap counts only
 * on the screen it began on (`input/taps.ts`): a finger that went down on a
 * row while the turn played does nothing when it lifts over the menu. One
 * animal's options in the pause menu are a screen apart from another's: a tap
 * on the team beside them swaps them in place, and a finger resting on the
 * first one's Move up must not move the second. A tablet turned upright is a
 * screen of its own, which takes no taps.
 */
let screenSeen = '';
let screenCount = 0;
function noteScreen(): void {
	const now =
		autosave.behind !== null
			? 'behind'
			: touch.on && touch.portrait
				? 'portrait'
				: account.card !== null
					? `account:${account.card}:${account.card === 'welcome' ? account.welcome.phase : ''}`
					: account.prompt
						? 'prompt'
						: title.open
							? `title:${title.screen}`
							: travel.active
								? 'travel'
								: matchController.onScreen
									? `match:${match.stage}:${battle.screen}`
									: battle.active
										? `battle:${battle.screen}`
										: doctor.active
											? `doctor:${doctor.screen}:${doctor.tab}`
											: pause.open
												? `pause:${pause.screen}:${pause.species ?? ''}:${pause.picked ?? ''}`
												: game.mode;
	if (now !== screenSeen) {
		screenSeen = now;
		screenCount++;
	}
}

// Browsers let a page make sound only after a key press, click or touch; each
// one wakes the sound (the first makes it), before any screen plays a cue. A
// finger's tap presses its key as it lifts, which is when the browser counts it.
for (const type of ['keydown', 'pointerdown', 'pointerup', 'touchend']) {
	window.addEventListener(type, () => sfx.unlock(), { capture: true });
}

// A tap on a button is the key it stands for (`input/taps.ts`), drawn before
// the tap is over: a tablet brings up its keyboard for a name box only when
// the box takes the focus inside the tap itself.
watchTaps(
	window,
	() => screenCount,
	(key) => {
		press(key);
		flushSync();
	}
);

// Each key goes to exactly one screen, chosen before any screen acts on it
// (`keyScreen`), so a key that closes a screen is used up there: the Enter on
// Continue or on the result card is never also a step or a word with the
// doctor. Explore reads its keys through `keyboard`, which hears only what is
// handed to it here. M turns the sound on or off on every screen, the title's
// too, except while an answer or a name is being typed. A page that is behind
// the save takes no key at all. A click or a tap arrives here too, as a key
// press (`input/press.ts`).
window.addEventListener('keydown', (e) => {
	if (autosave.behind !== null) {
		// Behind (`save/behind.ts`): no key reaches the game, nor a letter the name box.
		// The browser's own keys (with Ctrl, Alt or Cmd, and F1–F12) still work. Enter,
		// or Space while nothing is being typed, catches up.
		keyboard.setEnabled(false);
		if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
		e.preventDefault();
		// Behind a newer build's save of an account's game, Escape (the card's Log out) plays
		// the guest game meanwhile: a reload into the same old version cannot load it.
		const canLeave = autosave.behind === 'newer' && account.name !== null && !account.leaving;
		const act = behindKey(e.key, typingNow(e.target), canLeave);
		if (act === 'reload') catchUp(false);
		else if (act === 'logOut') void accountController.logOut();
		return;
	}
	const screen = keyScreen();
	keyboard.setEnabled(screen === 'explore');
	if (isSoundKey(e) && (title.open || game.mode !== 'loading') && !typingNow(e.target)) {
		e.preventDefault();
		if (!e.repeat) sfx.flip();
	} else if (screen === 'account') accountController.onKey(e);
	else if (screen === 'title') titleController.onKey(e);
	else if (screen === 'match') matchController.onKey(e);
	else if (screen === 'battle') battleController.onKey(e);
	else if (screen === 'doctor') doctorController.onKey(e);
	else if (screen === 'pause') pauseController.onKey(e);
	else if (screen === 'explore' && !matchController.exploreKey(e)) {
		keyboard.keydown(e);
		pauseController.onKey(e);
	}
	keyboard.setEnabled(exploreInput());
	noteScreen();
});

// Leaving or hiding the page saves at once and sends the backup with `keepalive`.
window.addEventListener('pagehide', () => {
	autosave.flush();
	playClock.flush();
});
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') {
		autosave.flush();
		playClock.flush();
	}
});
/**
 * Another tab logged in or out (or the site's data was cleared): the game
 * this browser plays is another one now, so this page is behind and starts
 * again in it.
 */
let accountSwitched = false;
function checkAccount(): void {
	if (flags.throwaway || accountSwitched) return;
	if ((currentAccount(store)?.name ?? null) === account.name) return;
	accountSwitched = true;
	autosave.fallBehind();
}
// Another tab of the game saved, logged in or out: this one may be behind now.
window.addEventListener('storage', (e) => {
	autosave.onStorage(e.key, e.newValue);
	if (e.key === null || e.key === ACCOUNT_KEYS.current) checkAccount();
});
// A welcome link opened in a tab already on the game changes only what is after `#`, which starts
// no page: the tab keeps the token (out of the address) and starts again, which opens its card.
// The game is saved as the page goes, as at any reload.
window.addEventListener('hashchange', () => {
	if (flags.throwaway || !welcomeFrom(location.href)?.token) return;
	takeWelcomeToken({ session: tabStore });
	playClock.flush();
	reloading = true;
	location.reload();
});
// A page back from the back/forward cache, or resumed after the browser froze it, gets
// no `storage` events for the time it was away: it checks the save again, and so does
// a window the kid comes to.
function recheck(): void {
	autosave.recheck();
	checkAccount();
}
window.addEventListener('pageshow', (e) => {
	if (e.persisted) recheck();
});
document.addEventListener('resume', recheck);
window.addEventListener('focus', recheck);
// The kid is back at this window, or the network is: presence tries again at once.
for (const type of ['focus', 'online', 'pageshow']) {
	window.addEventListener(type, () => presenceController.wake());
}
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState !== 'visible') return;
	presenceController.wake();
	// Whether the server can keep an account may have changed while the page was away.
	readyWatch?.shown();
});
// Behind: nothing typed (AltGr and Option letters too), pasted or dropped reaches a text
// box either. Only an input method's composition cannot be cancelled.
window.addEventListener(
	'beforeinput',
	(e) => {
		if (autosave.behind !== null) e.preventDefault();
	},
	true
);

mount(App, { target: uiRoot });

/**
 * Reload into the newest game, once. A reload the page makes on its own counts
 * against `RELOADS_PER_MINUTE`; one the kid asked for (Enter, Space, the card's
 * button, which presses Enter) does not. Behind another window in the middle of a game, the reloaded
 * page skips the title and says so; on the title, it opens the title again.
 */
let reloading = false;
function catchUp(onItsOwn: boolean): void {
	if (reloading) return;
	reloading = true;
	const midGame = !title.open && game.mode !== 'title' && game.mode !== 'loading';
	// An account's game that another device got further in: the newer one, and a kind word.
	if (account.name !== null && autosave.behind === 'replaced' && midGame && !accountSwitched) {
		noteNextStart('movedAhead');
	}
	reloadIntoNewestGame({ onItsOwn, caughtUp: autosave.behind === 'window' && midGame });
}

/**
 * A guest's game, played with the page on screen: its hour of play is
 * counted, and once another hour has passed, the card offers to keep the
 * game safe, while exploring (never in a battle, at the doctor, in the menu,
 * in a friendly match or its invite, or on a trip to another world), and only
 * while the server can keep an account (`openPrompt`): until then the hour
 * stays due. Not for an account's game, a throwaway one, or a page that keeps
 * nothing.
 */
function countPlay(dt: number): void {
	const lineage = autosave.playing;
	if (account.name !== null || flags.throwaway || !autosave.keeps || lineage === null) return;
	if (document.visibilityState !== 'visible') return;
	playClock.tick(lineage, dt);
	const exploring =
		game.mode === 'explore' &&
		!battle.active &&
		!doctor.active &&
		!pause.open &&
		!title.open &&
		!travel.active &&
		match.stage === 'none';
	if (!exploring || account.prompt || account.card !== null || autosave.behind !== null) return;
	if (playClock.due(lineage)) accountController.openPrompt();
}

let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	// Behind (`save/behind.ts`): this page takes no play. It reloads into the newest
	// game as soon as it may; until then it shows the card, or, hidden, waits.
	const cause = autosave.behind;
	const action = behindAction({
		behind: cause,
		visible: document.visibilityState === 'visible',
		focused: document.hasFocus(),
		mayReload: cause !== null && mayReloadNow(),
		holding: account.busy || account.leaving
	});
	if (action === 'reload') catchUp(true);
	const card = action === 'card' && !reloading;
	if (cause !== null && behind.cause !== cause) behind.cause = cause;
	if (behind.shown !== card) behind.shown = card;
	keyboard.setEnabled(exploreInput());
	if (action === 'play') accountController.update(dt);
	if (title.open) {
		// The title's world drifts, or its starter stage is drawn instead.
		if (action === 'play') titleController.update(dt);
		renderer.render();
	} else if (game.mode !== 'loading' && game.mode !== 'title') {
		if (action === 'play') {
			// While a battle is entering, the world keeps drawing so the step into the
			// grass can land; explore input is already off, so no new step starts.
			// The doctor's card is drawn over the world, which keeps drawing under it.
			if (!battle.active || battle.entering) explore.update(dt);
			// A friendly match plays on the battle's screen, but it is the match's to run.
			if (battle.active && !battle.vs) battleController.update(dt);
			matchController.update(dt);
			if (doctor.active) doctorController.update(dt);
			// A trip to another world: the cover closes, the world changes under it, and it opens.
			travelController.update(dt);
			// The message line's clock runs only while the explore HUD is on screen.
			if (!battle.active && !doctor.active && !pause.open) hud.tick(dt);
			countPlay(dt);
		}
		renderer.render();
	}
	// Where the player is goes to the others; theirs comes back as names over their heads.
	presenceController.update();
	presenceController.overlay();
	noteScreen();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// The title comes first: nothing is started, rolled or saved behind it. A
// throwaway game (`?new`, `?party=`, `?zoo`, `?tokens=`, `?shop`) goes straight into explore, and so
// does a page that reloaded itself mid-game to catch up with another window: it
// picks the newest game up at once and says so, instead of "Welcome back!".
const caughtUp = takeCaughtUp();
const accountNote = takeAccountNote();
// A logout the server could not hear before: it hears it now.
const waitingLogout = store && !current ? logoutPending(store) : null;
if (store && waitingLogout !== null) {
	void sendLogout(waitingLogout).then((heard) => {
		if (heard === 'done' && logoutPending(store) === waitingLogout) forgetLogout(store);
	});
}
// The first request about the session this page makes (only `/ready`, which reads none, goes before it).
void sessionCheck?.check();
void autosave.boot().then((plan) => {
	if (flags.throwaway) {
		authority.start();
		autosave.begin();
		return;
	}
	// A newer version of the game saved the game (`autosave.behind` is `newer`): nothing starts,
	// not even the title. The page reloads for the new version, or its card says so.
	if (autosave.behind !== null) return;
	startNotice = plan.notice;
	// A welcome link: the title, with the game this browser plays behind the welcome card, which
	// asks whose account the link opens and takes the password the kid picks for it.
	if (welcomeToken !== null) {
		titleController.open(plan.game ?? null, autosave.titleNotice, autosave.keeps);
		accountController.openWelcome(welcomeToken);
		return;
	}
	// Just logged out: the title, saying so, with the guest game if there is one.
	if (accountNote === 'loggedOut') {
		titleController.open(plan.game ?? null, 'save.loggedOut', autosave.keeps);
		return;
	}
	// Just logged in, or an account just made, or another device's newer save taken: straight
	// back into the game, with the account's own words instead of "Welcome back!".
	if (accountNote !== null && plan.game && plan.game.name !== null) {
		startNotice = undefined;
		continueGame(plan.game);
		hud.accountNotice(accountNote);
		return;
	}
	// A game with no name yet goes through the title, which asks for it first.
	if (caughtUp && plan.game && plan.game.name !== null && plan.notice === 'save.welcomeBack') {
		startNotice = 'save.caughtUp';
		continueGame(plan.game);
		return;
	}
	// A page that cannot keep the game says so before a starter is chosen; a page whose
	// account was logged out elsewhere says that.
	titleController.open(
		plan.game ?? null,
		sessionEndedUnsaid ? 'save.sessionEnded' : autosave.titleNotice,
		autosave.keeps
	);
	sessionEndedUnsaid = false;
});
