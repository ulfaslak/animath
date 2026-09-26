<script lang="ts">
	import { getAnimal, isItemId, leadIndex, type AnimalInstance } from '@mathgame/engine';
	import { fade } from 'svelte/transition';
	import { t } from '../copy';
	import { flags } from '../flags';
	import { unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { nameOf } from '../names';
	import { game } from '../state/game.svelte';
	import { hud } from '../state/hud.svelte';
	import { itemName } from '../items';
	import Coin from './Coin.svelte';
	import HpBar from './HpBar.svelte';
	import ItemIcon from './ItemIcon.svelte';

	/**
	 * The explore HUD. One card per animal in battle order: the number key that
	 * makes it go first, its name, an HP bar with numbers, and "tired" when it
	 * is knocked out. The lead — the engine's `leadIndex`, the first animal
	 * standing, the one a battle sends out — is outlined and tagged "goes
	 * first". Under the cards, the keys for choosing and for the menu; at the
	 * bottom, the message line (`state/hud.svelte.ts`), which also says who goes
	 * first after a party edit. A card is its number key and "Esc Menu" is
	 * Escape, for a click or a tap (`input/press.ts`); with the touch controls
	 * on, the panel under the cards says to tap them, and Menu is a button of
	 * its own (`TouchControls`). At the top right, the player's tokens, and
	 * under them the tools they own, each with its name.
	 */
	const lead = $derived(leadIndex(game.party));
	/** With one animal there is nobody to choose between: no numbers, no tag. */
	const choosing = $derived(game.party.length > 1);
	/** The tools owned, in the order bought; an id this build doesn't know shows nothing. */
	const tools = $derived(game.items.filter(isItemId));
</script>

{#snippet card(animal: AnimalInstance, i: number)}
	<div class="top">
		{#if choosing}<kbd class="slot">{i + 1}</kbd>{/if}
		<span class="name">{nameOf(animal)}</span>
		{#if animal.hp === 0}
			<span class="tag">{t('party.tired')}</span>
		{:else if choosing && i === lead}
			<span class="tag lead">{t('hud.goesFirst')}</span>
		{/if}
	</div>
	<div class="hp"><HpBar hp={animal.hp} max={getAnimal(animal.speciesId).maxHp} /></div>
{/snippet}

<div class="party">
	<div class="cards">
		{#each game.party as animal, i (animal.id)}
			<!-- With more than one animal a card is a button: its number key, which puts it first. -->
			{#if choosing}
				<button
					type="button"
					class="member"
					class:tired={animal.hp === 0}
					class:lead={i === lead}
					data-press={String(i + 1)}
					{@attach unfocusable}
				>
					{@render card(animal, i)}
				</button>
			{:else}
				<div class="member" class:tired={animal.hp === 0}>{@render card(animal, i)}</div>
			{/if}
		{/each}
	</div>
	{#if touch.on}
		{#if choosing}
			<div class="keys">{t('hud.pickLeadTouch')}</div>
		{/if}
	{:else}
		<div class="keys">
			{#if choosing}
				<span><kbd>1</kbd>–<kbd>{game.party.length}</kbd> {t('hud.pickLead')}</span>
			{/if}
			<button type="button" class="esc" data-press="Escape" {@attach unfocusable}>
				<kbd>{t('keys.esc')}</kbd>
				{t('hud.menu')}
			</button>
		</div>
	{/if}
</div>

<!-- The player's tokens, and the tools they own. -->
<!-- With `?debug` the position and the cues have the corner; these go under them. -->
<div class="belongings" class:below-debug={flags.debug}>
	<div class="purse"><Coin />{t('hud.tokens', { count: game.tokens })}</div>
	{#each tools as id (id)}
		<div class="tool"><ItemIcon {id} size={24} />{itemName(id)}</div>
	{/each}
</div>

<!-- The message line: the latest message while it is fresh, then the doctor
     prompt or the controls hint (see `state/hud.svelte.ts`). -->
{#if hud.message || hud.hint}
	<div class="hint" transition:fade={{ duration: 400 }}>
		{#if hud.message}
			<div class="message" transition:fade={{ duration: 400 }}>{hud.message}</div>
		{/if}
		{#if hud.hint}
			<div class="prompt">{hud.hint}</div>
		{/if}
	</div>
{/if}

<style>
	.party {
		position: absolute;
		top: 16px;
		left: 16px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
	/*
	 * The cards are as wide as the widest of them needs (from 260 px), all the
	 * same, so a nickname of twelve of the widest letters shows whole; a tag
	 * that no longer fits beside it goes under it.
	 */
	.cards {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
	}
	.member {
		display: block;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 7px 14px 8px 10px;
		min-width: 260px;
		max-width: 320px;
		box-sizing: border-box;
		font-weight: 800;
	}
	/* A mouse over a card that can be picked: it is a button. Never on touch, where hover sticks. */
	@media (hover: hover) and (pointer: fine) {
		button.member:hover {
			background: color-mix(in srgb, var(--accent) 12%, var(--panel-bg));
		}
		.esc:hover {
			text-decoration: underline;
		}
	}
	.esc {
		display: flex;
		align-items: center;
		gap: 4px;
		font-weight: 800;
	}
	.member.lead {
		box-shadow:
			0 0 0 3px var(--accent),
			var(--hud-shadow);
	}
	.member.tired .name,
	.member.tired .hp {
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
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.keys {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 6px 12px 6px 8px;
		font-weight: 800;
		font-size: 16px;
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
	.member.lead .slot {
		background: var(--accent);
	}
	.hint {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		max-width: calc(100vw - 32px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 8px 16px;
		font-weight: 600;
		text-align: center;
	}
	.prompt {
		font-weight: 800;
	}
	/* With the touch controls on, the line stays between the D-pad and the buttons. */
	:global(.touch) .hint {
		max-width: calc(100vw - 2 * (20px + var(--tap) * 4 + 20px));
	}
	.message + .prompt {
		margin-top: 2px;
	}
	/* The top right: the tokens, and the tools under them. */
	.belongings {
		position: absolute;
		top: 16px;
		right: 16px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		pointer-events: none;
	}
	.belongings.below-debug {
		top: 100px;
	}
	.purse,
	.tool {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		font-weight: 800;
		white-space: nowrap;
	}
	.purse {
		padding: 6px 14px 6px 8px;
		font-size: 18px;
	}
	.tool {
		padding: 3px 12px 3px 6px;
		font-size: 16px;
	}
</style>
