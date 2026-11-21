// First: the error reports listen before anything else runs (`error-reports.ts`).
import { errorReports } from './error-reports';
import './styles.css';
import { mount, unmount } from 'svelte';
import { failureOf, forgetReload, readsTheGame, reloadOnce } from './boot-failure';
import { pointsHome } from './moved';
import MovedCard from './ui/MovedCard.svelte';
import NoWebGL from './ui/NoWebGL.svelte';
import NotLoaded from './ui/NotLoaded.svelte';

/**
 * The page's entry (`index.html`). On an old
 * address of the game (the tunnel's, `moved.ts`), the moved card comes first,
 * and the game only if a grown-up stays. The game draws its world with WebGL
 * 2, which three.js needs: a browser without it gets a kind card in the
 * language on screen instead of a blank page, and the game never starts.
 * Every other browser loads the game (`main.ts`). An error report says which
 * of these the page showed (`showing`) until the game says what it shows.
 *
 * A browser too old to read the game's scripts (Safari before 15) never gets
 * here: `index.html` shows its too-old card to a page this script has not
 * marked as started. One that reads this script but not the game's gets the
 * same card (`tooOld`). A game whose code did not download gets one more try,
 * then a card to try again from (`notLoaded`, `boot-failure.ts`).
 */

document.documentElement.setAttribute('data-started', '');

const ui = document.getElementById('ui') as HTMLElement;

function showing(mode: 'boot' | 'moved' | 'no-webgl' | 'too-old' | 'not-loaded'): void {
	errorReports?.setContext({ mode: () => mode, words: () => [] });
}

/** `index.html`'s too-old card, in both languages: this browser cannot read the game's code. */
function tooOld(): void {
	showing('too-old');
	document.dispatchEvent(new Event('animath:too-old'));
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

const tab = () => sessionStorage;

/**
 * The game's code did not load: reported once (a reload's same error is not
 * sent again, `error-reports.ts`), then the page loads again by itself, or,
 * when it already did, the card's button does.
 */
function notLoaded(error: unknown): void {
	errorReports?.report(error, true);
	if (reloadOnce(tab, navigator.onLine !== false)) {
		location.reload();
		return;
	}
	showing('not-loaded');
	mount(NotLoaded, { target: ui, props: { retry: () => location.reload() } });
}

/** Loads the game (or the puzzle preview), and says why when it does not start. */
function load(game: () => Promise<unknown>, draws: boolean): void {
	game().then(
		() => forgetReload(tab),
		(error: unknown) => {
			const failure = failureOf(error, readsTheGame());
			if (failure === 'not-loaded') return notLoaded(error);
			// A context can still be refused for the renderer's own settings; three.js says WebGL.
			if (failure === 'no-webgl' && draws) cannotDraw();
			// The game's code is syntax this browser cannot read.
			else if (failure === 'too-old') tooOld();
			throw error;
		}
	);
}

function startGame(): void {
	// `?puzzle=`: the puzzle preview, a page of its own for looking at puzzles (`flags.ts`), no game behind it.
	if (new URLSearchParams(location.search).has('puzzle'))
		load(() => import('./preview/main'), false);
	else if (hasWebGL2()) load(() => import('./main'), true);
	else cannotDraw();
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
