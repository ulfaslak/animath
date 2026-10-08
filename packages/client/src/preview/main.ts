import { mount } from 'svelte';
import { flags } from '../flags';
import { watchInput } from '../input/touch.svelte';
import PuzzlePreview from './PuzzlePreview.svelte';
import { preview } from './preview.svelte';

/**
 * The puzzle preview's page (`?puzzle=`, `boot.ts` loads it instead of the
 * game): the kind and difficulty from the address, the keys to the preview,
 * and the address kept up to date, so a reload shows the same kind and
 * difficulty. See `preview.svelte.ts`.
 */

preview.kind = flags.puzzle?.kind ?? 'thermometer';
preview.difficulty = flags.puzzle?.difficulty ?? 1;
preview.next();

watchInput(window);
document.addEventListener('gesturestart', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
	if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
	if (preview.key(e.key)) e.preventDefault();
	const url = new URL(location.href);
	url.searchParams.set('puzzle', preview.kind);
	url.searchParams.set('d', String(preview.difficulty));
	history.replaceState(null, '', url);
});

mount(PuzzlePreview, { target: document.getElementById('ui') as HTMLElement });
