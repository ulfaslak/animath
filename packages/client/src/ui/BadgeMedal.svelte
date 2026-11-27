<script lang="ts">
	import { badgePicture } from '../badges/pictures';

	/**
	 * A badge's medal ([[DESIGN]]; [[UI_SPEC]] § Pause menu, "My badges"): a
	 * faceted gold hexagon, a lighter one inside it, and the badge's picture
	 * in the middle. `lit` is false for a badge not earned yet: the medal is
	 * grey with a question mark in the picture's place, so the page shows a
	 * badge is to come and never which one. `size` is its width in px.
	 * Decoration only: the words beside or under it say which badge it is.
	 */
	let { id, size = 56, lit = true }: { id: string; size?: number; lit?: boolean } = $props();
</script>

<span class="medal" class:lit style:--size="{size}px" aria-hidden="true">
	<span class="face">
		{#if lit}
			<span class="picture">{badgePicture(id)}</span>
		{:else}
			<span class="secret">?</span>
		{/if}
	</span>
</span>

<style>
	.medal {
		/* A hexagon standing on a point, as wide as `size`: its height is 2/√3 of that. */
		--hex: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--size);
		height: calc(var(--size) * 1.1547);
		clip-path: var(--hex);
		background: linear-gradient(160deg, #d9dde3, #9aa3ad);
	}
	.medal.lit {
		background: linear-gradient(160deg, #fbd67a 0%, #f0b43c 45%, #c98a12 100%);
	}
	.face {
		display: grid;
		place-items: center;
		width: 80%;
		height: 80%;
		clip-path: var(--hex);
		background:
			linear-gradient(200deg, rgb(255 255 255 / 0.55) 0 38%, transparent 38%),
			linear-gradient(160deg, #eef1f4, #c3cad1);
	}
	.lit .face {
		background:
			linear-gradient(200deg, rgb(255 255 255 / 0.5) 0 38%, transparent 38%),
			linear-gradient(160deg, #fff3cf, #fbd67a);
	}
	.picture {
		font-size: calc(var(--size) * 0.46);
		line-height: 1;
	}
	/* Not earned yet: a question mark in the grey rim's darker grey, so nothing gives the badge away. */
	.secret {
		font-size: calc(var(--size) * 0.5);
		font-weight: 900;
		line-height: 1;
		color: #7d8792;
	}
</style>
