/**
 * Whether the player's system asks for less motion (`prefers-reduced-motion:
 * reduce`), kept current as the setting changes. The Three.js layer and the
 * battle screen's transition read it every frame and tone their movement
 * down (UI_SPEC § Sound and juice); the Svelte overlay's CSS reads the same
 * media query itself.
 */
export const motion = { reduced: false };

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
	const query = window.matchMedia('(prefers-reduced-motion: reduce)');
	motion.reduced = query.matches;
	query.addEventListener?.('change', (e) => {
		motion.reduced = e.matches;
	});
}
