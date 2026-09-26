<script lang="ts">
	import { getAnimal, type AnimalInstance } from '@mathgame/engine';
	import type { HTMLAttributes } from 'svelte/elements';
	import { t } from '../copy';
	import { stackHealth, stackSummary } from '../hp';
	import { unfocusable } from '../input/press';
	import { nameOf, speciesName } from '../names';
	import HpBar from './HpBar.svelte';

	/**
	 * One card of the party: every animal of one species, stacked (UI_SPEC §
	 * Explore mode, "Party cards"). One animal shows as itself, its name and
	 * its HP bar. Several show as a stack, with cards peeking out behind: the
	 * species' name, how many ("×4"), how they are ("3 ready · 1 tired soon ·
	 * 1 tired", `stackSummary`), and a slim bar of all their HP together;
	 * their names and HP are on the open card (`BundleAnimals`). The card is
	 * marked "goes first" when the lead is one of its animals, and "tired"
	 * when all of them are.
	 *
	 * A reader, like every card: a click or a tap is the key it names in
	 * `press` (`data-press`, `input/taps.ts`); without one it is not a button.
	 * Anything else given to it — a class, a style, pointer handlers, an
	 * attachment — goes on the card itself, so a list can drag it.
	 */
	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		/** The bundle: animals of one species, in party order; at least one. */
		animals: readonly AnimalInstance[];
		/** The lead's id: the card goes first when the lead is one of its animals. */
		leadId?: string | null;
		/** Whether to mark the lead at all: with one card there is nobody to choose between. */
		showLead?: boolean;
		/** The key cap on the card: the key that picks it ('1'…'9'), or none. */
		keyCap?: string | null;
		/** The key a click or a tap presses; with none the card is not a button. */
		press?: string | null;
		/** Its animals are shown beside it (the card is open). */
		open?: boolean;
	}
	let {
		animals,
		leadId = null,
		showLead = true,
		keyCap = null,
		press = null,
		open = false,
		class: className = '',
		...rest
	}: Props = $props();

	const first = $derived(animals[0]!);
	const single = $derived(animals.length === 1);
	const allTired = $derived(animals.every((a) => a.hp === 0));
	const leads = $derived(showLead && leadId !== null && animals.some((a) => a.id === leadId));
	/** A stack's HP, all of it together, for its slim bar. */
	const health = $derived(single ? null : stackHealth(animals));
</script>

<svelte:element
	this={press ? 'button' : 'div'}
	type={press ? 'button' : undefined}
	class="bundle {className}"
	class:stack={!single}
	class:lead={leads}
	class:tired={allTired}
	class:open
	data-press={press ?? undefined}
	{@attach press ? unfocusable : undefined}
	{...rest}
>
	<span class="top">
		{#if keyCap}<kbd class="slot">{keyCap}</kbd>{/if}
		<span class="name">{single ? nameOf(first) : speciesName(first.speciesId)}</span>
		{#if !single}<span class="count">{t('team.count', { count: animals.length })}</span>{/if}
		{#if allTired}
			<span class="tag">{t('party.tired')}</span>
		{:else if leads}
			<span class="tag lead">{t('hud.goesFirst')}</span>
		{/if}
	</span>
	{#if single}
		<span class="hp"><HpBar hp={first.hp} max={getAnimal(first.speciesId).maxHp} /></span>
	{:else}
		<span class="summary">
			{#each stackSummary(animals) as part, i (i)}
				{#if i > 0}{' · '}{/if}<span class="part">{part}</span>
			{/each}
		</span>
		{#if health}<span class="hp all"><HpBar hp={health.hp} max={health.max} thin /></span>{/if}
	{/if}
</svelte:element>

<style>
	/*
	 * As wide as the widest card needs (from 260 px), so a nickname of twelve
	 * of the widest letters shows whole; a tag that no longer fits beside the
	 * name goes under it.
	 */
	.bundle {
		position: relative;
		display: block;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 7px 14px 8px 10px;
		min-width: 260px;
		max-width: 320px;
		box-sizing: border-box;
		font-weight: 800;
		text-align: left;
	}
	/*
	 * A stack: two cards peek out below and to the right of it, so it reads as
	 * a pile of cards whatever it says.
	 */
	.bundle.stack {
		box-shadow:
			5px 5px 0 -1px var(--panel-cream),
			5px 5px 0 0 rgba(45, 42, 50, 0.16),
			10px 10px 0 -2px var(--panel-cream),
			10px 10px 0 -1px rgba(45, 42, 50, 0.14),
			var(--hud-shadow);
	}
	.bundle.lead {
		box-shadow:
			0 0 0 3px var(--accent),
			var(--hud-shadow);
	}
	.bundle.stack.lead {
		box-shadow:
			0 0 0 3px var(--accent),
			5px 5px 0 -1px var(--panel-cream),
			5px 5px 0 0 rgba(45, 42, 50, 0.16),
			10px 10px 0 -2px var(--panel-cream),
			10px 10px 0 -1px rgba(45, 42, 50, 0.14),
			var(--hud-shadow);
	}
	/* Open: its animals are beside it. */
	.bundle.open {
		background: color-mix(in srgb, var(--accent) 16%, var(--panel-bg));
	}
	/* A mouse over a card it can press. Never on touch, where hover sticks. */
	@media (hover: hover) and (pointer: fine) {
		button.bundle:not(.open):hover {
			background: color-mix(in srgb, var(--accent) 12%, var(--panel-bg));
		}
	}
	.bundle.tired .name,
	.bundle.tired .count,
	.bundle.tired .hp,
	.bundle.tired .summary {
		opacity: 0.55;
		filter: grayscale(1);
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		margin-bottom: 4px;
		font-size: 18px;
	}
	.name {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		flex: none;
		font-size: 16px;
		padding: 0 7px;
		border-radius: 8px;
		background: rgba(45, 42, 50, 0.08);
		font-variant-numeric: tabular-nums;
	}
	.tag {
		flex: none;
		margin-left: auto;
		font-size: 16px;
		font-weight: 800;
		padding: 1px 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.1);
		white-space: nowrap;
	}
	.tag.lead {
		background: color-mix(in srgb, var(--accent) 40%, white);
	}
	.hp {
		display: block;
	}
	.summary {
		display: block;
		font-weight: 600;
		font-size: 16px;
		line-height: 20px;
		opacity: 0.8;
	}
	/* A line that runs out of room breaks between the parts, never inside one ("2 tired soon"). */
	.part {
		white-space: nowrap;
	}
	/* A stack's HP, all of it together: a slim bar under its words. */
	.hp.all {
		margin-top: 4px;
	}
	kbd {
		display: inline-block;
		min-width: 12px;
		font-family: inherit;
		font-size: 16px;
		line-height: 1.3;
		text-align: center;
		padding: 0 6px;
		border-radius: 7px;
		background: rgba(0, 0, 0, 0.1);
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.12);
	}
	.slot {
		flex: none;
	}
	.bundle.lead .slot {
		background: var(--accent);
	}
</style>
