import './styles.css';
import { mount } from 'svelte';
import { LocalAuthority, mintId } from './authority/local';
import { BattleController } from './battle/controller';
import { DoctorController } from './doctor/controller';
import { ExploreController } from './explore/controller';
import { flags } from './flags';
import { Keyboard } from './input/keyboard';
import { touch, watchInput } from './input/touch.svelte';
import { PauseController } from './pause/controller';
import { GameRenderer } from './render/renderer';
import { buildZoo } from './render/zoo';
import { httpSaveServer } from './save/api';
import { Autosave } from './save/autosave';
import { browserStore } from './save/storage';
import { battle } from './state/battle.svelte';
import { doctor } from './state/doctor.svelte';
import { game } from './state/game.svelte';
import { hud } from './state/hud.svelte';
import { pause } from './state/pause.svelte';
import App from './ui/App.svelte';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

// Touch controls or keys (`input/touch.svelte.ts`), decided before anything is laid out.
watchInput(window);
// A game, not a page: no pinch zoom (Safari's own gesture events; the CSS
// takes care of the rest), and no long-press menu under a finger.
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('contextmenu', (e) => {
	if (touch.on) e.preventDefault();
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

/** Walking reads the keyboard only in explore, once the game has started, with no card or menu open. */
const exploreInput = () =>
	game.mode !== 'loading' && !battle.active && !doctor.active && !pause.open;

// Keys go to exactly one screen: the battle while it is up, else the doctor's
// card while it is open, else the pause menu while it is open (Escape in
// explore opens it), else explore, which reads them through `keyboard`. A
// click or a tap arrives here too, as a key press (`input/press.ts`).
// Explore's own listener runs first and is switched off here at once, so the
// key that opens the menu is the last one walking sees.
window.addEventListener('keydown', (e) => {
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
 * Whether the page may reload itself now: at most 3 times a minute, so no
 * bug can trap a kid in a reload loop. A page that may not stays as it is,
 * behind and no longer saving, until the kid reloads it.
 */
function mayReload(): boolean {
	try {
		const now = Date.now();
		const recent = (
			JSON.parse(sessionStorage.getItem('animath.reloads') ?? '[]') as number[]
		).filter((t) => now - t < 60_000);
		if (recent.length >= 3) {
			console.warn('Animath: not reloading again so soon; this tab has stopped saving.');
			return false;
		}
		sessionStorage.setItem('animath.reloads', JSON.stringify([...recent, now]));
	} catch {
		// No session storage: reload anyway.
	}
	return true;
}

let reloading = false;
let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	// Another tab took the game further: pick up the newest save, once this tab is looked at.
	if (autosave.wantsReload && !reloading && document.visibilityState === 'visible') {
		reloading = true;
		if (mayReload()) location.reload();
	}
	const loading = game.mode === 'loading';
	keyboard.setEnabled(exploreInput());
	if (!loading) {
		// While a battle is entering, the world keeps drawing so the step into the
		// grass can land; explore input is already off, so no new step starts.
		// The doctor's card is drawn over the world, which keeps drawing under it.
		if (!battle.active || battle.entering) explore.update(dt);
		if (battle.active) battleController.update(dt);
		if (doctor.active) doctorController.update(dt);
		// The message line's clock runs only while the explore HUD is on screen.
		if (!battle.active && !doctor.active && !pause.open) hud.tick(dt);
		renderer.render();
	}
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void autosave.boot().then((plan) => {
	authority.start({ game: plan.game });
	// After `welcome`, which clears the message line.
	if (plan.notice) hud.notice(plan.notice);
	autosave.begin();
});
