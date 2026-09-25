/**
 * Words on screen. Every player-facing string lives in `copy/<code>.yaml`
 * and is shown with `t('group.key', params)`; see ARCHITECTURE § Copy and
 * DEVELOPMENT § Copy and languages. Import from here: `import { t } from '../copy'`.
 */
export {
	FALLBACK_LANGUAGE,
	LANGUAGES,
	isLanguage,
	language,
	languageName,
	t,
	type Language
} from './language.svelte';
export type { ParamValue, Params } from './translate';
