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
import { TitleScenery } from './render/title-scenery';
import { buildZoo } from './render/zoo';
import { httpSaveServer } from './save/api';
import { Autosave } from './save/autosave';
import type { SaveNotice } from './save/notices';
import { browserStore } from './save/storage';
import { battle } from './state/battle.svelte';
import { doctor } from './state/doctor.svelte';
import { game } from './state/game.svelte';
import { hud } from './state/hud.svelte';
import { pause } from './state/pause.svelte';
import { title } from './state/title.svelte';
import { TitleController } from './title/controller';
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
 * first game is under way: "Welcome back!" when Continue picks the saved game
 * up, anything else when a new game starts. Said once, then forgotten.
 */
let startNotice: SaveNotice | undefined;
function sayStartNotice(newGame: boolean): void {
	const notice = startNotice;
	startNotice = undefined;
	if (notice && (notice === 'save.welcomeBack') !== newGame) hud.notice(notice);
}

const titleController = new TitleController(authority, new TitleScenery(renderer), {
	continueGame(saved) {
		// The save as it is now, not as the title found it: another tab may have
		// walked on meanwhile, and its step count must not go back.
		authority.start({ game: autosave.resumable() ?? saved });
		// After `welcome`, which clears the message line.
		sayStartNotice(false);
		autosave.begin();
	}
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

/** Walking reads the keyboard only in explore, while a game is under way, with no card or menu open. */
const exploreInput = () =>
	!title.open &&
	game.mode !== 'loading' &&
	game.mode !== 'title' &&
	!battle.active &&
	!doctor.active &&
	!pause.open;

// Keys go to exactly one screen: the title while it is up, else the battle
// while it is up, else the doctor's card while it is open, else the pause
// menu while it is open (Escape in explore opens it), else explore, which
// reads them through `keyboard`. Explore's own listener runs first and is
// switched off here at once, so the key that opens the menu is the last one
// walking sees, and the key that closes the title is not a step.
window.addEventListener('keydown', (e) => {
	if (title.open) titleController.onKey(e);
	else if (battle.active) battleController.onKey(e);
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
	keyboard.setEnabled(exploreInput());
	if (title.open) {
		// The title's world drifts, or its starter stage is drawn instead.
		titleController.update(dt);
		renderer.render();
	} else if (game.mode !== 'loading' && game.mode !== 'title') {
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

// The title comes first: nothing is started, rolled or saved behind it. A
// throwaway game (`?new`, `?party=`, `?zoo`) goes straight into explore.
void autosave.boot().then((plan) => {
	if (flags.throwaway) {
		authority.start();
		autosave.begin();
		return;
	}
	startNotice = plan.notice;
	// A save this page can't pick up is worth saying before a starter is chosen.
	const onTitle =
		plan.notice === 'save.newerGame' || plan.notice === 'save.cannotSave' ? plan.notice : null;
	titleController.open(plan.game ?? null, onTitle);
});
