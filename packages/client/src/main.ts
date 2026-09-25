import './styles.css';
import { mount } from 'svelte';
import { LocalAuthority } from './authority/local';
import { BattleController } from './battle/controller';
import { DoctorController } from './doctor/controller';
import { ExploreController } from './explore/controller';
import { flags } from './flags';
import { Keyboard } from './input/keyboard';
import { GameRenderer } from './render/renderer';
import { buildZoo } from './render/zoo';
import { battle } from './state/battle.svelte';
import { doctor } from './state/doctor.svelte';
import { game } from './state/game.svelte';
import { hud } from './state/hud.svelte';
import App from './ui/App.svelte';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const authority = new LocalAuthority({ party: flags.party ?? undefined });
const renderer = new GameRenderer(canvas);
const keyboard = new Keyboard(window);
const explore = new ExploreController(authority, renderer, keyboard);
const battleController = new BattleController(authority, renderer);
const doctorController = new DoctorController(authority);

authority.subscribe((event) => {
	game.apply(event);
	hud.apply(event);
	explore.handle(event);
	battleController.handle(event);
	doctorController.handle(event);
	// `?zoo` lines up one of every species by the spawn tile (a check for the meshes).
	if (flags.zoo && event.type === 'welcome') {
		for (const figure of buildZoo(event.seed, event.pos)) renderer.addFigure(figure);
	}
});

// Keys go to exactly one screen: the battle while it is up, else the doctor's
// card while it is open, else explore (which reads them through `keyboard`).
window.addEventListener('keydown', (e) => {
	if (battle.active) battleController.onKey(e);
	else if (doctor.active) doctorController.onKey(e);
});

mount(App, { target: uiRoot });

let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	keyboard.setEnabled(!battle.active && !doctor.active);
	// While a battle is entering, the world keeps drawing so the step into the
	// grass can land; explore input is already off, so no new step starts.
	// The doctor's card is drawn over the world, which keeps drawing under it.
	if (!battle.active || battle.entering) explore.update(dt);
	if (battle.active) battleController.update(dt);
	if (doctor.active) doctorController.update(dt);
	// The message line's clock runs only while the explore HUD is on screen.
	if (!battle.active && !doctor.active) hud.tick(dt);
	renderer.render();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

authority.start();
