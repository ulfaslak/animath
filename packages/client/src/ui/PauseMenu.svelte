<script lang="ts">
	import { MAX_NICKNAME_LENGTH, getAnimal, leadIndex, normalizeNickname } from '@mathgame/engine';
	import { flip } from 'svelte/animate';
	import { t } from '../copy';
	import { nameOf, speciesName } from '../names';
	import { game } from '../state/game.svelte';
	import {
		MENU_ITEMS,
		partyOptions,
		pause,
		type MenuItem,
		type PartyOption
	} from '../state/pause.svelte';
	import HpBar from './HpBar.svelte';

	/**
	 * The pause menu: the team in battle order on the left, then the menu
	 * items; on the right, what can be done with the picked animal — the
	 * options, or the name box. It reads `game.party` and `pause`; keys are
	 * `PauseController`'s, so nothing here dispatches. The name box binds
	 * `pause.draft` and keeps the focus while it is open, so typing lands in it.
	 * Every word comes from the copy files (`pause.*`, `hud.*`).
	 */
	const lead = $derived(leadIndex(game.party));
	const pickedIndex = $derived(
		pause.picked === null ? -1 : game.party.findIndex((a) => a.id === pause.picked)
	);
	const picked = $derived(pickedIndex >= 0 ? game.party[pickedIndex]! : null);
	const options = $derived(pickedIndex >= 0 ? partyOptions(game.party, pickedIndex) : []);
	/** The team row that is lit: the cursor, or the picked animal while its options are open. */
	const lit = $derived(pause.screen === 'list' ? pause.cursor : pickedIndex);

	/** What the typed name will turn into, when that is not just what the box shows. */
	const preview = $derived.by(() => {
		if (pause.screen !== 'naming' || !picked) return '';
		const clean = normalizeNickname(pause.draft) ?? speciesName(picked.speciesId);
		return clean === pause.draft.trim().replace(/\s+/g, ' ') ? '' : clean;
	});

	function itemLabel(item: MenuItem): string {
		switch (item) {
			case 'resume':
				return t('pause.resume');
			case 'quit':
				return t('pause.quit');
		}
	}

	function optionLabel(option: PartyOption): string {
		switch (option) {
			case 'first':
				return t('pause.goFirst');
			case 'up':
				return t('pause.moveUp');
			case 'down':
				return t('pause.moveDown');
			case 'name':
				return t('pause.newName');
			case 'back':
				return t('pause.back');
		}
	}

	/** Focus the name box with its text selected (typing replaces it), and keep the focus there. */
	function nameBox(input: HTMLInputElement) {
		input.focus();
		input.select();
		const refocus = () =>
			requestAnimationFrame(() => {
				if (pause.screen === 'naming' && input.isConnected) input.focus();
			});
		input.addEventListener('blur', refocus);
		return () => input.removeEventListener('blur', refocus);
	}
</script>

<div class="backdrop">
	<div class="menu">
		<div class="title">{t('pause.title')}</div>
		<div class="columns">
			<div class="team">
				<div class="heading">{t('pause.team')}</div>
				{#each game.party as animal, i (animal.id)}
					{@const spec = getAnimal(animal.speciesId)}
					{@const name = nameOf(animal)}
					<div
						class="row animal"
						class:lit={lit === i}
						class:picked={pickedIndex === i}
						class:tired={animal.hp === 0}
						animate:flip={{ duration: 180 }}
					>
						<span class="slot">{i + 1}</span>
						<span class="who">
							<span class="name">{name}</span>
							{#if name !== speciesName(animal.speciesId)}
								<span class="species">{speciesName(animal.speciesId)}</span>
							{/if}
						</span>
						<span class="bar"><HpBar hp={animal.hp} max={spec.maxHp} /></span>
						<span class="tags">
							{#if animal.hp === 0}
								<span class="tag">{t('party.tired')}</span>
							{:else if i === lead && game.party.length > 1}
								<span class="tag lead">{t('hud.goesFirst')}</span>
							{/if}
						</span>
					</div>
				{/each}
				{#each MENU_ITEMS as item, j (item)}
					<div
						class="row item"
						class:lit={pause.screen === 'list' && lit === game.party.length + j}
					>
						<span class="button" class:secondary={item !== 'resume'}>{itemLabel(item)}</span>
					</div>
				{/each}
			</div>

			<div class="side">
				{#if pause.screen === 'options' && picked}
					<div class="side-title">{nameOf(picked)}</div>
					{#each options as option, i (option.id)}
						<div class="row option" class:lit={pause.option === i} class:off={!option.enabled}>
							<span class="caret">▸</span>{optionLabel(option.id)}
						</div>
					{/each}
					{#if picked.hp === 0}
						<div class="note">{t('pause.tiredHelp', { name: nameOf(picked) })}</div>
					{/if}
				{:else if pause.screen === 'naming' && picked}
					<div class="side-title">{t('pause.nameTitle', { name: nameOf(picked) })}</div>
					<input
						class="name-box"
						type="text"
						bind:value={pause.draft}
						maxlength={MAX_NICKNAME_LENGTH}
						placeholder={speciesName(picked.speciesId)}
						autocomplete="off"
						spellcheck="false"
						aria-label={t('pause.newName')}
						{@attach nameBox}
					/>
					<div class="note">{t('pause.nameRule', { max: MAX_NICKNAME_LENGTH })}</div>
					{#if preview}
						<div class="note preview">{t('pause.willBe', { name: preview })}</div>
					{/if}
				{:else}
					<div class="soft">{t('pause.pick')}</div>
					<div class="note">{t('pause.pickHelp')}</div>
				{/if}
			</div>
		</div>
		<div class="keys">
			{#if pause.screen === 'list'}
				{t('pause.keysList')}
			{:else if pause.screen === 'options'}
				{t('pause.keysOptions')}
			{:else}
				{t('pause.keysNaming')}
			{/if}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.3);
	}
	.menu {
		width: min(920px, calc(100vw - 32px));
		max-height: calc(100vh - 32px);
		box-sizing: border-box;
		overflow: auto;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 18px 22px 16px;
	}
	.title {
		font-weight: 800;
		font-size: 32px;
		line-height: 1.1;
		margin-bottom: 12px;
	}
	.columns {
		display: grid;
		grid-template-columns: 3fr 2fr;
		gap: 16px;
		align-items: start;
	}
	.heading {
		font-weight: 800;
		font-size: 18px;
		opacity: 0.7;
		margin: 0 0 6px 12px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 0 12px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
	}
	.row.lit {
		background: rgba(255, 159, 67, 0.22);
	}
	.row.picked {
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	.animal.tired .who,
	.animal.tired .bar {
		opacity: 0.55;
		filter: grayscale(1);
	}
	.slot {
		width: 18px;
		text-align: right;
		opacity: 0.6;
		font-variant-numeric: tabular-nums;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.species {
		flex: none;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}
	.bar {
		width: 150px;
		flex: none;
	}
	.tags {
		width: 104px;
		flex: none;
		display: flex;
		justify-content: flex-end;
	}
	.tag {
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
	.item {
		margin-top: 6px;
	}
	.button {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 22px;
		border-radius: 20px;
		background: var(--accent);
		color: white;
	}
	/* The primary action is Keep playing; the others are quieter pills. */
	.button.secondary {
		background: rgba(0, 0, 0, 0.08);
		color: var(--panel-ink);
	}
	.side {
		background: rgba(0, 0, 0, 0.04);
		border-radius: 12px;
		padding: 12px 14px 14px;
		min-height: 180px;
		box-sizing: border-box;
	}
	.side-title {
		font-weight: 800;
		font-size: 22px;
		margin: 0 0 8px 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.option {
		gap: 6px;
		padding-left: 6px;
	}
	.option.off {
		opacity: 0.35;
	}
	.caret {
		width: 16px;
		visibility: hidden;
		color: var(--accent);
	}
	.option.lit .caret {
		visibility: visible;
	}
	.name-box {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-weight: 800;
		font-size: 28px;
		color: var(--panel-ink);
		padding: 8px 14px;
		border: 3px solid var(--accent);
		border-radius: 12px;
		background: white;
		outline: none;
	}
	.name-box::placeholder {
		color: var(--panel-ink);
		opacity: 0.35;
	}
	.soft {
		font-weight: 800;
		font-size: 24px;
		opacity: 0.45;
		margin: 6px 0 8px 2px;
	}
	.note {
		font-weight: 600;
		font-size: 16px;
		margin: 10px 2px 0;
	}
	.preview {
		font-weight: 800;
	}
	.keys {
		margin-top: 14px;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
		text-align: center;
	}
</style>
