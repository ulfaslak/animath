import './styles.css';
import type { SavedGame } from '@mathgame/engine';
import { flushSync, mount } from 'svelte';
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
import { PauseController } from './pause/controller';
import { GameRenderer } from './render/renderer';
import { TitleScenery } from './render/title-scenery';
import { buildZoo } from './render/zoo';
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
import { browserStore } from './save/storage';
import { battle } from './state/battle.svelte';
import { behind } from './state/behind.svelte';
import { doctor } from './state/doctor.svelte';
import { game } from './state/game.svelte';
import { hud } from './state/hud.svelte';
import { pause } from './state/pause.svelte';
import { title } from './state/title.svelte';
import { TitleController } from './title/controller';
import App from './ui/App.svelte';

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

const authority = new LocalAuthority({ party: flags.party ?? undefined });
const renderer = new GameRenderer(canvas);
const keyboard = new Keyboard(window);
const explore = new ExploreController(authority, renderer, keyboard);
const battleController = new BattleController(authority, renderer);
const doctorController = new DoctorController(authority);
const pauseController = new PauseController(authority);
// `?new`, `?party=` (a party to look at) and `?zoo` play a throwaway game:
// nothing is loaded or saved, and the saved game is left alone.
const autosave = new Autosave({
	store: browserStore(),
	server: httpSaveServer(),
	snapshot: () => authority.snapshot(),
	catchUp: (counts) => authority.catchUp(counts),
	mintId,
	throwaway: flags.throwaway
});

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
 */
function continueGame(saved: SavedGame): void {
	authority.start({ game: autosave.resumable() ?? saved });
	// After `welcome`, which clears the message line.
	sayStartNotice(false);
	autosave.begin();
}

const titleController = new TitleController(authority, new TitleScenery(renderer), {
	continueGame
});

authority.subscribe((event) => {
	game.apply(event);
	hud.apply(event);
	explore.handle(event);
	battleController.handle(event);
	doctorController.handle(event);
	pauseController.handle(event);
	titleController.handle(event);
	autosave.handle(event);
	// A new game from the title: after `welcome`, which clears the message line.
	if (event.type === 'welcome' && event.newGame) sayStartNotice(true);
	// Quit to title: the game just left is the one Continue picks up.
	if (event.type === 'game-left') {
		titleController.open(autosave.resumable() ?? authority.snapshot());
	}
	// `?zoo` lines up one of every species by the spawn tile (a check for the meshes).
	if (flags.zoo && event.type === 'welcome') {
		for (const figure of buildZoo(event.seed, event.pos)) renderer.addFigure(figure);
	}
});

/**
 * The screen that takes keys now, one at a time: the title while it is up,
 * else the battle while it is up, else the doctor's card while it is open,
 * else the pause menu while it is open, else explore (Escape there opens the
 * pause menu). None while the page loads.
 */
type KeyScreen = 'title' | 'battle' | 'doctor' | 'pause' | 'explore';
function keyScreen(): KeyScreen | null {
	if (title.open) return 'title';
	if (game.mode === 'loading' || game.mode === 'title') return null;
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
 * row while the turn played does nothing when it lifts over the menu. A
 * tablet turned upright is a screen of its own, which takes no taps.
 */
let screenSeen = '';
let screenCount = 0;
function noteScreen(): void {
	const now =
		autosave.behind !== null
			? 'behind'
			: touch.on && touch.portrait
				? 'portrait'
				: title.open
					? `title:${title.screen}`
					: battle.active
						? `battle:${battle.screen}`
						: doctor.active
							? `doctor:${doctor.screen}`
							: pause.open
								? `pause:${pause.screen}`
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
		if (behindKey(e.key, typingNow(e.target)) === 'reload') catchUp(false);
		return;
	}
	const screen = keyScreen();
	keyboard.setEnabled(screen === 'explore');
	if (isSoundKey(e) && (title.open || game.mode !== 'loading') && !typingNow(e.target)) {
		e.preventDefault();
		if (!e.repeat) sfx.flip();
	} else if (screen === 'title') titleController.onKey(e);
	else if (screen === 'battle') battleController.onKey(e);
	else if (screen === 'doctor') doctorController.onKey(e);
	else if (screen === 'pause') pauseController.onKey(e);
	else if (screen === 'explore') {
		keyboard.keydown(e);
		pauseController.onKey(e);
	}
	keyboard.setEnabled(exploreInput());
	noteScreen();
});

// Leaving or hiding the page saves at once and sends the backup with `keepalive`.
window.addEventListener('pagehide', () => autosave.flush());
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') autosave.flush();
});
// Another tab of the game saved: this one may be behind now.
window.addEventListener('storage', (e) => autosave.onStorage(e.key));
// A page back from the back/forward cache, or resumed after the browser froze it, gets
// no `storage` events for the time it was away: it checks the save again, and so does
// a window the kid comes to.
window.addEventListener('pageshow', (e) => {
	if (e.persisted) autosave.recheck();
});
document.addEventListener('resume', () => autosave.recheck());
window.addEventListener('focus', () => autosave.recheck());
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
	reloadIntoNewestGame({ onItsOwn, caughtUp: autosave.behind === 'window' && midGame });
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
		mayReload: cause !== null && mayReloadNow()
	});
	if (action === 'reload') catchUp(true);
	const card = action === 'card' && !reloading;
	if (cause !== null && behind.cause !== cause) behind.cause = cause;
	if (behind.shown !== card) behind.shown = card;
	keyboard.setEnabled(exploreInput());
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
			if (battle.active) battleController.update(dt);
			if (doctor.active) doctorController.update(dt);
			// The message line's clock runs only while the explore HUD is on screen.
			if (!battle.active && !doctor.active && !pause.open) hud.tick(dt);
		}
		renderer.render();
	}
	noteScreen();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// The title comes first: nothing is started, rolled or saved behind it. A
// throwaway game (`?new`, `?party=`, `?zoo`) goes straight into explore, and so
// does a page that reloaded itself mid-game to catch up with another window: it
// picks the newest game up at once and says so, instead of "Welcome back!".
const caughtUp = takeCaughtUp();
void autosave.boot().then((plan) => {
	if (flags.throwaway) {
		authority.start();
		autosave.begin();
		return;
	}
	startNotice = plan.notice;
	if (caughtUp && plan.game && plan.notice === 'save.welcomeBack') {
		startNotice = 'save.caughtUp';
		continueGame(plan.game);
		return;
	}
	// A save this page can't pick up is worth saying before a starter is chosen.
	const onTitle =
		plan.notice === 'save.newerGame' || plan.notice === 'save.cannotSave' ? plan.notice : null;
	titleController.open(plan.game ?? null, onTitle);
});
