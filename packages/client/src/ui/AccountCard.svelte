<script lang="ts">
	import { MAX_NAME_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@mathgame/engine';
	import { t } from '../copy';
	import { REVEAL_KEY, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { nameRefusal } from '../names';
	import { account, type AccountField, type AccountProblem } from '../state/account.svelte';

	/**
	 * The account card ([[UI_SPEC]] § Accounts): make an account with the
	 * game on screen (`register`), or log in to one (`login`). Two boxes, the
	 * name and a secret password, a button that shows the password as typed,
	 * and under them the password rule, or kindly why the card did not go on.
	 * It reads `account`; keys are `AccountController`'s, so nothing here
	 * dispatches. The boxes bind the drafts; the one that takes the typing
	 * (`account.field`) keeps the focus while the card is up, and a finger or
	 * a click on the other one moves it there. On a touch screen the card is
	 * at the top, clear of the tablet's keyboard.
	 */

	/** Well past the longest name, so a name a character too long is typed out and told, never cut. */
	const MAX_TYPED_NAME = 2 * MAX_NAME_LENGTH;
	/** The same for a password. */
	const MAX_TYPED_PASSWORD = 2 * PASSWORD_MAX_LENGTH;

	const registering = $derived(account.card === 'register');

	function problemWords(problem: AccountProblem): string {
		switch (problem.kind) {
			case 'name':
				return nameRefusal(problem.reason);
			case 'taken':
				return t('account.problem.taken');
			case 'password':
				return problem.reason === 'short'
					? t('account.problem.passwordShort', { min: PASSWORD_MIN_LENGTH })
					: t('account.problem.passwordLong', { max: PASSWORD_MAX_LENGTH });
			case 'wrong':
				return t('account.problem.wrong');
			case 'too-many':
				return t('account.problem.tooMany', { count: problem.minutes });
			case 'offline':
				return t('account.problem.offline');
		}
	}

	/**
	 * The box for `field`: focused while it takes the typing (and again if it
	 * loses the focus, so a tablet's keyboard stays up), and made the one that
	 * takes it when a finger or a click focuses it.
	 */
	const box = (field: AccountField) => (input: HTMLInputElement) => {
		if (account.field === field) input.focus();
		const take = () => {
			if (account.field !== field) account.field = field;
		};
		const refocus = () =>
			requestAnimationFrame(() => {
				if (account.card !== null && account.field === field && input.isConnected) input.focus();
			});
		input.addEventListener('focus', take);
		input.addEventListener('blur', refocus);
		return () => {
			input.removeEventListener('focus', take);
			input.removeEventListener('blur', refocus);
		};
	};

	/** A tablet's keyboard may have slid the page up to show a box; put it back when the card goes. */
	const card = () => () => window.scrollTo(0, 0);
</script>

<div class="shade" class:typing={touch.on}>
	<div class="card account-card" role="dialog" aria-labelledby="account-heading" {@attach card}>
		<div class="heading" id="account-heading">
			{registering ? t('account.register.title') : t('account.login.title')}
		</div>
		<p>{registering ? t('account.register.text') : t('account.login.text')}</p>
		<label class="field">
			<span class="label">{t('account.name')}</span>
			<input
				class="box"
				class:active={account.field === 'name'}
				type="text"
				bind:value={account.nameDraft}
				maxlength={MAX_TYPED_NAME}
				autocomplete="username"
				autocapitalize="words"
				autocorrect="off"
				spellcheck="false"
				enterkeyhint="next"
				readonly={account.busy}
				{@attach box('name')}
			/>
		</label>
		<label class="field">
			<span class="label">{t('account.password')}</span>
			<span class="secret">
				<input
					class="box"
					class:active={account.field === 'password'}
					type={account.reveal ? 'text' : 'password'}
					bind:value={account.passwordDraft}
					maxlength={MAX_TYPED_PASSWORD}
					autocomplete={registering ? 'new-password' : 'current-password'}
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
					enterkeyhint={registering ? 'done' : 'go'}
					readonly={account.busy}
					{@attach box('password')}
				/>
				<button
					type="button"
					class="reveal"
					aria-pressed={account.reveal}
					data-press={REVEAL_KEY}
					{@attach unfocusable}
				>
					{account.reveal ? t('account.hide') : t('account.show')}
				</button>
			</span>
		</label>
		{#if account.problem}
			<div class="note refused" role="alert">{problemWords(account.problem)}</div>
		{:else if account.busy}
			<div class="note">{t('account.busy')}</div>
		{:else if registering}
			<div class="note">{t('account.passwordRule', { min: PASSWORD_MIN_LENGTH })}</div>
		{:else}
			<div class="note">{t('account.login.forgot')}</div>
		{/if}
		<div class="card-buttons">
			<button type="button" class="pill" data-press="Escape" {@attach unfocusable}>
				{t('account.back')}
			</button>
			<button
				type="button"
				class="pill go"
				class:waiting={account.busy}
				data-press="Enter"
				{@attach unfocusable}
			>
				{registering ? t('account.register.go') : t('account.login.go')}
			</button>
		</div>
		{#if !touch.on}
			<div class="keys">{registering ? t('account.register.keys') : t('account.login.keys')}</div>
		{/if}
	</div>
</div>

<style>
	.shade {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.45);
		padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right))
			calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
		pointer-events: auto;
	}
	/* On a touch screen the card is at the top, so a tablet's keyboard leaves the boxes in view. */
	.shade.typing {
		place-items: start center;
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
	}
	.account-card {
		width: min(560px, 100%);
		padding: 18px 22px 14px;
		text-align: center;
		color: var(--panel-ink);
	}
	.heading {
		font-weight: 800;
		font-size: 28px;
		line-height: 1.2;
		margin: 0 0 6px;
	}
	p {
		margin: 0 0 10px;
		font-weight: 600;
		font-size: 18px;
	}
	.field {
		display: block;
		text-align: left;
		margin-top: 8px;
	}
	.label {
		display: block;
		font-weight: 800;
		font-size: 16px;
		margin: 0 0 4px 4px;
	}
	.secret {
		display: flex;
		gap: 8px;
		align-items: stretch;
	}
	.box {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		font: inherit;
		font-weight: 800;
		font-size: 24px;
		color: var(--panel-ink);
		padding: 6px 12px;
		min-height: var(--tap);
		border: 3px solid rgba(0, 0, 0, 0.15);
		border-radius: 12px;
		background: white;
		outline: none;
	}
	.box.active {
		border-color: var(--accent);
	}
	/* While the server is asked: read-only, not disabled, so the box keeps the focus (a
	   disabled box drops it, and the kid's next try would type into nothing). */
	.box:read-only {
		opacity: 0.6;
	}
	.reveal {
		flex: none;
		min-width: 88px;
		min-height: var(--tap);
		padding: 0 14px;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.08);
		font-weight: 800;
		font-size: 16px;
	}
	.reveal[aria-pressed='true'] {
		background: rgba(255, 159, 67, 0.3);
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	/* The rule under the boxes, and in its place why the card did not go on: the same box, so
	   the card keeps its height; the reason in ink on a soft tint of the "not quite" red. */
	.note {
		margin: 10px 0 0;
		padding: 6px 10px;
		border-radius: 10px;
		font-weight: 600;
		font-size: 16px;
	}
	.refused {
		font-weight: 800;
		background: rgba(242, 95, 92, 0.16);
	}
	.card-buttons {
		display: flex;
		justify-content: center;
		gap: 12px;
		margin-top: 12px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 22px;
		border-radius: 24px;
		background: rgba(0, 0, 0, 0.08);
		font-weight: 800;
		font-size: 18px;
	}
	.pill.go {
		background: var(--accent);
		color: white;
	}
	.pill.waiting {
		opacity: 0.6;
	}
	.pill:active {
		transform: scale(0.97);
	}
	.keys {
		margin-top: 12px;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}
</style>
