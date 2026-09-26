/**
 * The doctor's card's tabs, left to right ([[UI_SPEC]] § Doctor): **heal**
 * the hurt animals, help animals **home** to the wild for tokens, and the
 * **shop**.
 */
export type DoctorTab = 'heal' | 'home' | 'shop';

export const DOCTOR_TABS: readonly DoctorTab[] = ['heal', 'home', 'shop'];
