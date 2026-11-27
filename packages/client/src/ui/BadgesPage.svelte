<script lang="ts">
	import { BADGE_FAMILIES, badgeTarget, groupKinds, type BadgeFamily } from '@mathgame/engine';
	import { MediaQuery } from 'svelte/reactivity';
	import { badgeGoal, badgeLine, badgeName, familyTitle } from '../badges/words';
	import { t } from '../copy';
	import { optionKey, unfocusable } from '../input/press';
	import { badges } from '../state/badges.svelte';
	import { game } from '../state/game.svelte';
	import { pause } from '../state/pause.svelte';
	import BadgeMedal from './BadgeMedal.svelte';
	import Tick from './Tick.svelte';

	/**
	 * "My badges", in the pause menu's place, under its title line ([[UI_SPEC]]
	 * § Pause menu, "My badges"): on the left a medal for every badge there is,
	 * family by family in `BADGE_FAMILIES`' order, each family under its
	 * heading and starting a row of its own, in one grid that scrolls; the
	 * badges earned lit in gold, the rest grey with a question mark. On the
	 * right, the lit one's card: its medal big, its name and the piece of
	 * biology it is named after (a badge not earned yet keeps both a secret:
	 * "???"), what it asks for, and whether the kid has it, or how far they
	 * have come (a ladder's number against the one it asks for, a
	 * collection's kinds caught against the kinds it asks for; a first has no
	 * numbers). It reads `pause.option` (the lit medal, by its place in
	 * `BADGE_IDS`), `badges` (the authority's, from `welcome` and
	 * `badges-changed`) and `game.caught`; a medal is its `option:<i>` key,
	 * and the grid tells `pause.badgeColumns` how many medals it lays to a
	 * row, which the keys walk by. Nothing here changes the game.
	 */

	/** Every badge in the page's order (`BADGE_IDS`'), with its family and its place in it. */
	const MEDALS = BADGE_FAMILIES.flatMap((family) =>
		family.badges.map((badge, index) => ({ family, id: badge.id, index }))
	);
	/** Each badge's place on the page, by id. */
	const PLACE: ReadonlyMap<string, number> = new Map(MEDALS.map((m, i) => [m.id, i]));

	/** A phone held sideways: smaller medals, as the book's smaller cards ([[UI_SPEC]] § Frame). */
	const short = new MediaQuery('max-height: 500px');

	const earned = $derived(new Set(badges.earned));
	const lit = $derived(MEDALS[Math.min(pause.option, MEDALS.length - 1)]!);
	const got = $derived(earned.has(lit.id));
	/** How far the lit badge is, while it is not earned: numbers for a ladder or a collection. */
	const progress = $derived(got ? null : progressOf(lit.family, lit.index));

	/**
	 * How far a kid has come towards the badge at `index` of `family`: a
	 * ladder's number now, capped at what the badge asks for; a collection's
	 * kinds caught, of the kinds it asks for (any one of a list counts for
	 * it); a first has nothing to count.
	 */
	function progressOf(family: BadgeFamily, index: number): { count: number; goal: number } | null {
		if (family.kind === 'ladder') {
			const goal = badgeTarget(family.badges[index]!);
			return { count: Math.min(badges.counts[family.id] ?? 0, goal), goal };
		}
		if (family.kind === 'collection') {
			const have = new Set(game.caught);
			const kinds = groupKinds(family.badges[index]!.group);
			return {
				count: kinds.filter((any) => any.some((id) => have.has(id))).length,
				goal: kinds.length
			};
		}
		return null;
	}

	/**
	 * The grid: how many medals it lays to a row, told to `pause.badgeColumns`
	 * as the screen's width changes it, so up and down go a row.
	 */
	function medalGrid(grid: HTMLElement) {
		const measure = () => {
			const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
			if (columns > 0 && columns !== pause.badgeColumns) pause.badgeColumns = columns;
		};
		const watch = new ResizeObserver(measure);
		watch.observe(grid);
		measure();
		return () => watch.disconnect();
	}
</script>

<div class="badges">
	<div class="medals" {@attach medalGrid}>
		{#each BADGE_FAMILIES as family (family.id)}
			<div class="family">{familyTitle(family.id)}</div>
			{#each family.badges as badge (badge.id)}
				{@const i = PLACE.get(badge.id)!}
				<button
					type="button"
					class="medal"
					class:lit={pause.option === i}
					data-press={optionKey(i)}
					{@attach unfocusable}
					{@attach (el) => {
						if (pause.option === i) el.scrollIntoView({ block: 'nearest' });
					}}
				>
					<BadgeMedal id={badge.id} size={short.current ? 44 : 52} lit={earned.has(badge.id)} />
				</button>
			{/each}
		{/each}
	</div>
	<div class="card" class:got>
		<BadgeMedal id={lit.id} size={short.current ? 48 : 96} lit={got} />
		{#if got}
			<div class="name">{badgeName(lit.id)}</div>
			<div class="line">{badgeLine(lit.id)}</div>
		{:else}
			<!-- Not earned yet: its name and line stay a surprise until it is. -->
			<div class="name">{t('badges.secret')}</div>
		{/if}
		<div class="goal">{badgeGoal(lit.id)}</div>
		{#if got}
			<div class="status"><Tick size={26} />{t('badges.got')}</div>
		{:else}
			<div class="status not-yet">
				<span>{t('badges.notYet')}</span>
				{#if progress}
					<span class="numbers">{t('badges.progress', progress)}</span>
				{/if}
			</div>
			{#if progress}
				<span class="bar" aria-hidden="true">
					<span class="so-far" style:width="{(100 * progress.count) / progress.goal}%"></span>
				</span>
			{/if}
		{/if}
	</div>
</div>

<style>
	/* The medals on the left, the lit one's card on the right; the menu's whole height. */
	.badges {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 16px;
	}
	.medals {
		min-height: 0;
		overflow-y: auto;
		/* A finger scrolls it; nothing else on the page moves. */
		touch-action: pan-y;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
		/* Every row as tall as its medals: the grid scrolls, it never squeezes them. */
		grid-auto-rows: max-content;
		align-content: start;
		gap: 6px;
		padding: 8px;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.04);
	}
	/* A family's heading, across the grid: its medals start a row of their own under it. */
	.family {
		grid-column: 1 / -1;
		padding: 8px 4px 0;
		font-weight: 800;
		font-size: 18px;
		opacity: 0.75;
	}
	.family:first-child {
		padding-top: 0;
	}
	.medal {
		display: grid;
		place-items: center;
		min-height: var(--tap);
		padding: 6px 0;
		border-radius: 14px;
		outline: 3px solid transparent;
		outline-offset: -3px;
		/* Kept in view with its family's heading over it when it is in the family's first row. */
		scroll-margin-top: 34px;
		scroll-margin-bottom: 8px;
	}
	.medal.lit {
		background: white;
		outline-color: var(--accent);
		box-shadow: 0 3px 0 var(--edge);
	}
	@media (hover: hover) and (pointer: fine) {
		.medal:not(.lit):hover {
			background: rgba(255, 159, 67, 0.12);
		}
	}
	/* The lit badge: a white card lifted on the toy button's edge, as a caught card in the book is. */
	.card {
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 16px 16px 18px;
		box-sizing: border-box;
		border-radius: 14px;
		background: white;
		box-shadow: 0 3px 0 var(--edge);
		text-align: center;
		align-self: start;
		max-height: 100%;
	}
	.name {
		font-weight: 800;
		font-size: 24px;
		line-height: 1.15;
		overflow-wrap: anywhere;
		hyphens: auto;
	}
	/* The piece of biology the badge is named after: a quieter line under its name. */
	.line {
		font-weight: 600;
		font-size: 16px;
		line-height: 1.3;
		opacity: 0.75;
	}
	/* What it asks for. */
	.goal {
		font-weight: 800;
		font-size: 18px;
		line-height: 1.25;
		margin-top: 4px;
	}
	.status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 4px 10px;
		margin-top: 4px;
		font-weight: 800;
		font-size: 18px;
	}
	.not-yet {
		opacity: 0.8;
	}
	.numbers {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* How far, as My puzzles' bars: green from the left. */
	.bar {
		width: 100%;
		height: 14px;
		border-radius: 7px;
		background: rgba(0, 0, 0, 0.08);
		overflow: hidden;
	}
	.so-far {
		display: block;
		height: 100%;
		border-radius: 7px;
		background: var(--good);
	}
	/* A phone held sideways: smaller medals, a narrower card, so two rows and the card's words show. */
	@media (max-height: 500px) {
		.badges {
			grid-template-columns: minmax(0, 1fr) 250px;
			gap: 10px;
		}
		.medals {
			grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
			gap: 4px;
			padding: 6px;
		}
		.family {
			font-size: 16px;
			padding-top: 4px;
		}
		.medal {
			padding: 4px 0;
			scroll-margin-top: 28px;
		}
		.card {
			gap: 4px;
			padding: 8px 12px 10px;
		}
		.name {
			font-size: 20px;
		}
		.goal,
		.status {
			font-size: 16px;
			margin-top: 2px;
		}
	}
</style>
