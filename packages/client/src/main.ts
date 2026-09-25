import './styles.css';
import { mount } from 'svelte';
import { LocalAuthority, partyFromParam } from './authority/local';
import { BattleController } from './battle/controller';
import { ExploreController } from './explore/controller';
import { Keyboard } from './input/keyboard';
import { PauseController } from './pause/controller';
import { GameRenderer } from './render/renderer';
import { buildZoo } from './render/zoo';
import { battle } from './state/battle.svelte';
import { game } from './state/game.svelte';
import { pause } from './state/pause.svelte';
import App from './ui/App.svelte';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);
// `?zoo` lines up one of every species by the spawn tile (a check for the meshes).
const zoo = params.has('zoo');
// `?party=rabbit,fox:0` starts with that party instead of one squirrel (a check for the party screens).
const party = params.get('party');

const authority = new LocalAuthority({ party: party ? partyFromParam(party) : undefined });
const renderer = new GameRenderer(canvas);
const keyboard = new Keyboard(window);
const explore = new ExploreController(authority, renderer, keyboard);
const battleController = new BattleController(authority, renderer);
const pauseController = new PauseController(authority);

authority.subscribe((event) => {
	game.apply(event);
	explore.handle(event);
	battleController.handle(event);
	pauseController.handle(event);
	if (zoo && event.type === 'welcome') {
		for (const figure of buildZoo(event.seed, event.pos)) renderer.addFigure(figure);
	}
});

/** Walking reads the keyboard only in explore with no menu open. */
const exploreInput = () => !battle.active && !pause.open;

// Keys go to exactly one screen: the battle while it is up; otherwise the
// pause menu while it is open (Escape opens it), and explore when it is not.
// Explore's own listener runs first and is switched off here at once, so the
// key that opens the menu is the last one walking sees.
window.addEventListener('keydown', (e) => {
	if (battle.active) battleController.onKey(e);
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
	if (!battle.active || battle.entering) explore.update(dt);
	if (battle.active) battleController.update(dt);
	renderer.render();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

authority.start();
