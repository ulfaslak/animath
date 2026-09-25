import './styles.css';
import { mount } from 'svelte';
import { LocalAuthority } from './authority/local';
import { ExploreController } from './explore/controller';
import { Keyboard } from './input/keyboard';
import { GameRenderer } from './render/renderer';
import { buildZoo } from './render/zoo';
import { game } from './state/game.svelte';
import App from './ui/App.svelte';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
// `?zoo` lines up one of every species by the spawn tile (a check for the meshes).
const zoo = new URLSearchParams(location.search).has('zoo');

const authority = new LocalAuthority();
const renderer = new GameRenderer(canvas);
const keyboard = new Keyboard(window);
const explore = new ExploreController(authority, renderer, keyboard);

authority.subscribe((event) => {
	game.apply(event);
	explore.handle(event);
	if (zoo && event.type === 'welcome') {
		for (const figure of buildZoo(event.seed, event.pos)) renderer.addFigure(figure);
	}
});

mount(App, { target: uiRoot });

let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	explore.update(dt);
	renderer.render();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

authority.start();
