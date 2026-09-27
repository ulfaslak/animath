import './styles.css';
import { mount } from 'svelte';
import NoWebGL from './ui/NoWebGL.svelte';

/**
 * The page's entry (`index.html`). The game draws its world with WebGL 2,
 * which three.js needs: a browser without it gets a kind card in the
 * language on screen instead of a blank page, and the game never starts.
 * Every other browser loads the game (`main.ts`).
 */

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
	mount(NoWebGL, { target: document.getElementById('ui') as HTMLElement });
}

if (hasWebGL2()) {
	import('./main').catch((error: unknown) => {
		// A context can still be refused for the renderer's own settings; three.js says WebGL.
		if (String(error).includes('WebGL')) cannotDraw();
		throw error;
	});
} else {
	cannotDraw();
}
