<script lang="ts">
	/**
	 * Who's here's picture, flat and chunky as the animal book's `BookIcon`:
	 * two trainers side by side, a friend behind in a green shirt and an
	 * orange cap (two of `TRAINER_LOOKS`) and the kid's own in front, coral
	 * shirt and blue cap, their caps' peaks turned away from each other.
	 * Always beside the row's name, so it is decoration
	 * (`aria-hidden`).
	 */
	let { size = 28 }: { size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<!-- The friend, behind on the right, the cap's peak to the right. -->
	<path class="friend-shirt" d="M14.5 30v-4.4a7 7 0 0 1 14 0V30z" />
	<circle class="skin" cx="21.5" cy="11.4" r="5.2" />
	<path class="friend-cap" d="M16.3 10.6a5.2 5.2 0 0 1 10.4 0z" />
	<rect class="friend-cap" x="21" y="9.4" width="9" height="2.4" rx="1.2" />
	<!-- The kid, in front on the left, the cap's peak to the left. -->
	<path class="shirt" d="M2 31v-4.6a8 8 0 0 1 16 0V31z" />
	<circle class="skin" cx="10" cy="13" r="6" />
	<path class="cap" d="M4 12.2a6 6 0 0 1 12 0z" />
	<rect class="cap" x="1" y="10.8" width="10" height="2.6" rx="1.3" />
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.skin {
		fill: #ffcfb0;
	}
	.shirt {
		fill: var(--coral);
	}
	.cap {
		fill: var(--blue);
	}
	.friend-shirt {
		fill: var(--good);
	}
	.friend-cap {
		fill: var(--accent);
	}
</style>
