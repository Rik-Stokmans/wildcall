// Pure HUD visibility rules (spec 29.1).
/**
 * @returns 'hidden' | 'essential' | 'dim' | 'full'
 *  hidden    main menu / boot / any screen open
 *  essential binocular, camera or recorder raised: only the instrument readouts remain
 *  dim       focused listening: everything fades except the clue cards
 */
export function hudLevel({ mode, focus = false, tool = 'none', raised = false }) {
  if (mode !== 'play') return 'hidden';
  if (raised && tool && tool !== 'none') return 'essential';
  if (focus) return 'dim';
  return 'full';
}

/** Toasts hide only before play begins. */
export function toastsVisible(mode) { return mode !== 'mainmenu' && mode !== 'boot'; }
