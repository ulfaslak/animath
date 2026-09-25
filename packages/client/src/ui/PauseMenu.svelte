<script lang="ts">
	import { MAX_NICKNAME_LENGTH, getAnimal, leadIndex, normalizeNickname } from '@mathgame/engine';
	import { flip } from 'svelte/animate';
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
	 */

	/** Every word this screen shows, in one place for translation. */
	const COPY = {
		title: 'Paused',
		team: 'Your team',
		tired: 'tired',
		lead: 'goes first',
		items: { resume: 'Keep playing' } satisfies Record<MenuItem, string>,
		options: {
			first: 'Go first',
			up: 'Move up',
			down: 'Move down',
			name: 'New name',
			back: 'Back'
		} satisfies Record<PartyOption, string>,
		pick: 'Pick an animal',
		pickHelp: 'Choose who goes first, move it, or give it a name.',
		tiredHelp: (name: string) => `${name} is tired, so it can't go first.`,
		nameTitle: (species: string) => `Name your ${species}`,
		nameRule: `Letters and numbers, up to ${MAX_NICKNAME_LENGTH}.`,
		willBe: (name: string) => `It will be called ${name}.`,
		keys: {
			list: '↑ ↓ choose · Enter pick · Esc close',
			options: '↑ ↓ choose · Enter do it · Esc back',
			naming: 'Enter save · Esc back'
		}
	};

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
		return clean === pause.draft.trim().replace(/\s+/g, ' ') ? '' : COPY.willBe(clean);
	});

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
		<div class="title">{COPY.title}</div>
		<div class="columns">
			<div class="team">
				<div class="heading">{COPY.team}</div>
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
								<span class="tag">{COPY.tired}</span>
							{:else if i === lead && game.party.length > 1}
								<span class="tag lead">{COPY.lead}</span>
							{/if}
						</span>
					</div>
				{/each}
				{#each MENU_ITEMS as item, j (item)}
					<div
						class="row item"
						class:lit={pause.screen === 'list' && lit === game.party.length + j}
					>
						<span class="button">{COPY.items[item]}</span>
					</div>
				{/each}
			</div>

			<div class="side">
				{#if pause.screen === 'options' && picked}
					<div class="side-title">{nameOf(picked)}</div>
					{#each options as option, i (option.id)}
						<div class="row option" class:lit={pause.option === i} class:off={!option.enabled}>
							<span class="caret">▸</span>{COPY.options[option.id]}
						</div>
					{/each}
					{#if picked.hp === 0}
						<div class="note">{COPY.tiredHelp(nameOf(picked))}</div>
					{/if}
				{:else if pause.screen === 'naming' && picked}
					<div class="side-title">{COPY.nameTitle(speciesName(picked.speciesId))}</div>
					<input
						class="name-box"
						type="text"
						bind:value={pause.draft}
						maxlength={MAX_NICKNAME_LENGTH}
						placeholder={speciesName(picked.speciesId)}
						autocomplete="off"
						spellcheck="false"
						aria-label={COPY.options.name}
						{@attach nameBox}
					/>
					<div class="note">{COPY.nameRule}</div>
					{#if preview}<div class="note preview">{preview}</div>{/if}
				{:else}
					<div class="soft">{COPY.pick}</div>
					<div class="note">{COPY.pickHelp}</div>
				{/if}
			</div>
		</div>
		<div class="keys">{COPY.keys[pause.screen]}</div>
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
