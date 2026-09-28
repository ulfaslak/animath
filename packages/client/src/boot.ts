// First: the error reports listen before anything else runs (`error-reports.ts`).
import { errorReports } from './error-reports';
import './styles.css';
import { mount, unmount } from 'svelte';
import { pointsHome } from './moved';
import MovedCard from './ui/MovedCard.svelte';
import NoWebGL from './ui/NoWebGL.svelte';

/**
 * The page's entry (`index.html`). On an old
 * address of the game (the tunnel's, `moved.ts`), the moved card comes first,
 * and the game only if a grown-up stays. The game draws its world with WebGL
 * 2, which three.js needs: a browser without it gets a kind card in the
 * language on screen instead of a blank page, and the game never starts.
 * Every other browser loads the game (`main.ts`). An error report says which
 * of these the page showed (`showing`) until the game says what it shows.
 */

const ui = document.getElementById('ui') as HTMLElement;

function showing(mode: 'boot' | 'moved' | 'no-webgl'): void {
	errorReports?.setContext({ mode: () => mode, words: () => [] });
}

/** Whether this browser gives a page a WebGL 2 context. The test context is let go at once. */
function hasWebGL2(): boolean {
	try {
		const gl = document.createElement('canvas').getContext('webgl2');
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
		return gl !== null;
	} catch {
		return false;
	}
}

function cannotDraw(): void {
	showing('no-webgl');
	mount(NoWebGL, { target: ui });
}

function startGame(): void {
	if (hasWebGL2()) {
		import('./main').catch((error: unknown) => {
			// A context can still be refused for the renderer's own settings; three.js says WebGL.
			if (String(error).includes('WebGL')) cannotDraw();
			throw error;
		});
	} else {
		cannotDraw();
	}
}

/** The game's domain, deploy.env's (`vite.config.ts`); empty when the build was given none. */
const domain: string = import.meta.env.VITE_GAME_DOMAIN ?? '';

if (pointsHome(location.hostname, domain)) {
	showing('moved');
	const card = mount(MovedCard, {
		target: ui,
		props: {
			domain,
			stay: () => {
				void unmount(card);
				showing('boot');
				startGame();
			}
		}
	});
} else {
	startGame();
}
