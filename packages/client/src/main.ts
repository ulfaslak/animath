import './styles.css';
import { mount } from 'svelte';
import { LocalAuthority } from './authority/local';
import { ExploreController } from './explore/controller';
import { Keyboard } from './input/keyboard';
import { GameRenderer } from './render/renderer';
import { game } from './state/game.svelte';
import App from './ui/App.svelte';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const authority = new LocalAuthority();
const renderer = new GameRenderer(canvas);
const keyboard = new Keyboard(window);
const explore = new ExploreController(authority, renderer, keyboard);

authority.subscribe((event) => {
	game.apply(event);
	explore.handle(event);
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
