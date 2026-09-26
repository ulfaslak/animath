import './styles.css';
import { mount } from 'svelte';
import { LocalAuthority, mintId } from './authority/local';
import { BattleController } from './battle/controller';
import { DoctorController } from './doctor/controller';
import { ExploreController } from './explore/controller';
import { flags } from './flags';
import { Keyboard } from './input/keyboard';
import { PauseController } from './pause/controller';
import { GameRenderer } from './render/renderer';
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
import { browserStore } from './save/storage';
import { battle } from './state/battle.svelte';
import { behind } from './state/behind.svelte';
import { doctor } from './state/doctor.svelte';
import { game } from './state/game.svelte';
import { hud } from './state/hud.svelte';
import { pause } from './state/pause.svelte';
import App from './ui/App.svelte';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const authority = new LocalAuthority({ party: flags.party ?? undefined });
const renderer = new GameRenderer(canvas);
const keyboard = new Keyboard(window);
const explore = new ExploreController(authority, renderer, keyboard);
const battleController = new BattleController(authority, renderer);
const doctorController = new DoctorController(authority);
const pauseController = new PauseController(authority);
// `?new` (and `?party=`, a party to look at) play a throwaway game: nothing is
// loaded or saved, and the saved game is left alone.
const autosave = new Autosave({
	store: browserStore(),
	server: httpSaveServer(),
	snapshot: () => authority.snapshot(),
	catchUp: (counts) => authority.catchUp(counts),
	mintId,
	throwaway: flags.fresh || flags.party !== null
});

authority.subscribe((event) => {
	game.apply(event);
	hud.apply(event);
	explore.handle(event);
	battleController.handle(event);
	doctorController.handle(event);
	pauseController.handle(event);
	autosave.handle(event);
	// `?zoo` lines up one of every species by the spawn tile (a check for the meshes).
	if (flags.zoo && event.type === 'welcome') {
		for (const figure of buildZoo(event.seed, event.pos)) renderer.addFigure(figure);
	}
});

/**
 * Walking reads the keyboard only in explore, once the game has started, with
 * no card or menu open, and never on a page that is behind another window.
 */
const exploreInput = () =>
	game.mode !== 'loading' &&
	!battle.active &&
	!doctor.active &&
	!pause.open &&
	!autosave.wantsReload;

// Keys go to exactly one screen: the battle while it is up, else the doctor's
// card while it is open, else the pause menu while it is open (Escape in
// explore opens it), else explore, which reads them through `keyboard`.
// Explore's own listener runs first and is switched off here at once, so the
// key that opens the menu is the last one walking sees.
window.addEventListener('keydown', (e) => {
	if (autosave.wantsReload) {
		// Behind another window: no key reaches the game. Enter or Space catch up.
		keyboard.setEnabled(false);
		if (!e.ctrlKey && !e.metaKey && !e.altKey && behindKey(e.key) === 'reload') {
			e.preventDefault();
			catchUp(true);
		}
		return;
	}
	if (battle.active) battleController.onKey(e);
	else if (doctor.active) doctorController.onKey(e);
	else if (game.mode === 'explore') pauseController.onKey(e);
	keyboard.setEnabled(exploreInput());
});

// Leaving or hiding the page saves at once and sends the backup with `keepalive`.
window.addEventListener('pagehide', () => autosave.flush());
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') autosave.flush();
});
// Another tab of the game saved: this one may be behind now.
window.addEventListener('storage', (e) => autosave.onStorage(e.key));

mount(App, { target: uiRoot });

/**
 * Reload into the newest game. Asked for by the kid (Enter on the card), it
 * always goes; on its own it goes at most `RELOADS_PER_MINUTE` times a
 * minute (`mayReloadNow`), so no bug can trap a kid in a loop of reloads.
 * False when it may not go: the page shows the card instead.
 */
let reloading = false;
let mayReloadItself = true;
function catchUp(asked: boolean): boolean {
	if (reloading) return true;
	if (!asked && !(mayReloadItself &&= mayReloadNow())) return false;
	reloading = true;
	reloadIntoNewestGame();
	return true;
}

let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	// Another window has played on past this one (`save/behind.ts`): this page takes no
	// play. In use, it reloads into the newest game; on screen but not in use, or after
	// reloading too often, it says so and waits; hidden, it waits to be shown.
	const action = behindAction({
		behind: autosave.wantsReload,
		visible: document.visibilityState === 'visible',
		focused: document.hasFocus(),
		mayReload: mayReloadItself
	});
	const card = action === 'card' || (action === 'reload' && !catchUp(false));
	if (behind.shown !== card) behind.shown = card;
	const loading = game.mode === 'loading';
	keyboard.setEnabled(exploreInput());
	if (!loading) {
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
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const caughtUp = takeCaughtUp();
void autosave.boot().then((plan) => {
	authority.start({ game: plan.game });
	// After `welcome`, which clears the message line. A page that reloaded to catch up
	// with another window says so instead of "Welcome back!".
	const notice = caughtUp && plan.notice === 'save.welcomeBack' ? 'save.caughtUp' : plan.notice;
	if (notice) hud.notice(notice);
	autosave.begin();
});
