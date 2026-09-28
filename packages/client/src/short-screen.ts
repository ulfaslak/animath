/**
 * The tallest screen that is a short one, in CSS pixels: a phone held
 * sideways (360 to 430 px tall; the supported tablets start at 768, a
 * laptop at 720). Under it the battle's panel and status boxes take their
 * compact sizes, and the explore HUD packs its corners for a phone
 * ([[UI_SPEC]] § Explore mode, "The corners"). Mirrors every
 * `(max-height: 560px)` media query of the battle's styles and the explore
 * HUD's; change them together (`battle-scene.test.ts` and `edges.test.ts`
 * hold them to it).
 */
export const SHORT_SCREEN = 560;
