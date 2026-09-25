import './styles.css';
import { mount } from 'svelte';
import { sfx } from './audio/sfx.svelte';
import { LocalAuthority } from './authority/local';
import { BattleController } from './battle/controller';
import { DoctorController } from './doctor/controller';
import { ExploreController } from './explore/controller';
import { flags } from './flags';
import { Keyboard } from './input/keyboard';
import { PauseController } from './pause/controller';
import { GameRenderer } from './render/renderer';
import { buildZoo } from './render/zoo';
import { battle } from './state/battle.svelte';
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

authority.subscribe((event) => {
	game.apply(event);
	hud.apply(event);
	explore.handle(event);
	battleController.handle(event);
	doctorController.handle(event);
	pauseController.handle(event);
	// `?zoo` lines up one of every species by the spawn tile (a check for the meshes).
	if (flags.zoo && event.type === 'welcome') {
		for (const figure of buildZoo(event.seed, event.pos)) renderer.addFigure(figure);
	}
});

/** Walking reads the keyboard only in explore with no card or menu open. */
const exploreInput = () => !battle.active && !doctor.active && !pause.open;

/** Typing an answer or a name: M is a letter there, not the sound key. */
const typing = (e: KeyboardEvent) =>
	e.target instanceof HTMLInputElement ||
	(battle.active && battle.screen === 'puzzle') ||
	(doctor.active && doctor.screen === 'puzzle') ||
	(pause.open && pause.screen === 'naming');

// Browsers let a page make sound only after a key press, click or touch; each
// one wakes the sound (the first makes it), before any screen plays a cue.
for (const type of ['keydown', 'pointerdown', 'touchend']) {
	window.addEventListener(type, () => sfx.unlock(), { capture: true });
}

// Keys go to exactly one screen: the battle while it is up, else the doctor's
// card while it is open, else the pause menu while it is open (Escape in
// explore opens it), else explore, which reads them through `keyboard`.
// Explore's own listener runs first and is switched off here at once, so the
// key that opens the menu is the last one walking sees. M turns the sound on
// or off on every screen, except while an answer or a name is being typed.
window.addEventListener('keydown', (e) => {
	const soundKey = (e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey;
	if (soundKey && game.mode !== 'loading' && !typing(e)) {
		e.preventDefault();
		if (!e.repeat) sfx.flip();
	} else if (battle.active) battleController.onKey(e);
	else if (doctor.active) doctorController.onKey(e);
	else if (game.mode === 'explore') pauseController.onKey(e);
	keyboard.setEnabled(exploreInput());
});

mount(App, { target: uiRoot });

let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	keyboard.setEnabled(exploreInput());
	// While a battle is entering, the world keeps drawing so the step into the
	// grass can land; explore input is already off, so no new step starts.
	// The doctor's card is drawn over the world, which keeps drawing under it.
	if (!battle.active || battle.entering) explore.update(dt);
	if (battle.active) battleController.update(dt);
	if (doctor.active) doctorController.update(dt);
	// The message line's clock runs only while the explore HUD is on screen.
	if (!battle.active && !doctor.active && !pause.open) hud.tick(dt);
	renderer.render();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

authority.start();
