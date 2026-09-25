import './styles.css';
import { mount } from 'svelte';
import { LocalAuthority, mintId } from './authority/local';
import { BattleController } from './battle/controller';
import { ExploreController } from './explore/controller';
import { Keyboard } from './input/keyboard';
import { GameRenderer } from './render/renderer';
import { buildZoo } from './render/zoo';
import { httpSaveServer } from './save/api';
import { Autosave } from './save/autosave';
import { browserStore } from './save/storage';
import { battle } from './state/battle.svelte';
import { game } from './state/game.svelte';
import App from './ui/App.svelte';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);
// `?zoo` lines up one of every species by the spawn tile (a check for the meshes).
const zoo = params.has('zoo');

const authority = new LocalAuthority();
const renderer = new GameRenderer(canvas);
const keyboard = new Keyboard(window);
const explore = new ExploreController(authority, renderer, keyboard);
const battleController = new BattleController(authority, renderer);
// `?new` plays a throwaway game: nothing is loaded or saved, and the saved game is left alone.
const autosave = new Autosave({
	store: browserStore(),
	server: httpSaveServer(),
	snapshot: () => authority.snapshot(),
	mintId,
	throwaway: params.has('new')
});

authority.subscribe((event) => {
	game.apply(event);
	explore.handle(event);
	battleController.handle(event);
	autosave.handle(event);
	if (zoo && event.type === 'welcome') {
		for (const figure of buildZoo(event.seed, event.pos)) renderer.addFigure(figure);
	}
});

// Keys go to exactly one mode: the battle screen while it is up, explore otherwise.
window.addEventListener('keydown', (e) => {
	if (battle.active) battleController.onKey(e);
});

// Leaving or hiding the page saves at once and sends the backup with `keepalive`.
window.addEventListener('pagehide', () => autosave.flush());
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') autosave.flush();
});
// Another tab of the game saved: this one may be behind now.
window.addEventListener('storage', (e) => autosave.onStorage(e.key, e.newValue));

mount(App, { target: uiRoot });

let reloading = false;
let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	// Another tab took the game further: pick up the newest save, once this tab is looked at.
	if (autosave.wantsReload && !reloading && document.visibilityState === 'visible') {
		reloading = true;
		location.reload();
	}
	const loading = game.mode === 'loading';
	keyboard.setEnabled(!loading && !battle.active);
	if (!loading) {
		// While a battle is entering, the world keeps drawing so the step into the
		// grass can land; explore input is already off, so no new step starts.
		if (!battle.active || battle.entering) explore.update(dt);
		if (battle.active) battleController.update(dt);
		renderer.render();
	}
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void autosave.boot().then((plan) => {
	authority.start(plan);
	autosave.begin();
});
