/**
 * Haptic feedback on every platform that has it.
 *
 *  - Android app (Tauri): the native haptics plugin.
 *  - Android browsers: navigator.vibrate.
 *  - iPhone (Safari / Home Screen app, iOS 18+): Safari has no vibrate API, but toggling a native
 *    `<input type="checkbox" switch>` produces a system haptic. We toggle a hidden one, inside the
 *    user's own tap, which is the only time iOS allows it.
 *  - Windows / desktop browsers: nothing.
 */
import { isTauri, platformName } from './index';

export type HapticKind = 'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error';

let enabled = true;
export function setHapticsEnabled(v: boolean) {
  enabled = v;
}

const IOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const SWITCH_ATTR = 'data-notavi-haptic';
let iosLabel: HTMLLabelElement | null = null;

function iosTick() {
  if (!iosLabel) {
    iosLabel = document.createElement('label');
    iosLabel.setAttribute(SWITCH_ATTR, '');
    iosLabel.setAttribute('aria-hidden', 'true');
    iosLabel.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    iosLabel.appendChild(input);
    document.body.appendChild(iosLabel);
  }
  iosLabel.click();
}

const VIBRATE: Record<HapticKind, number | number[]> = {
  selection: 6,
  light: 10,
  medium: 18,
  success: [12, 60, 18],
  warning: [20, 80, 20],
  error: [30, 60, 30, 60, 30],
};

export function haptic(kind: HapticKind = 'light') {
  if (!enabled) return;
  try {
    if (isTauri() && platformName() === 'android') {
      void import('@tauri-apps/plugin-haptics').then((h) => {
        if (kind === 'selection') return h.selectionFeedback();
        if (kind === 'light' || kind === 'medium') return h.impactFeedback(kind);
        return h.notificationFeedback(kind);
      }).catch(() => navigator.vibrate?.(VIBRATE[kind]));
      return;
    }
    if (IOS) {
      iosTick();
      return;
    }
    navigator.vibrate?.(VIBRATE[kind]);
  } catch {
    /* haptics are a nicety; never let them break anything */
  }
}

/** True for the hidden element used for iOS haptics, so click listeners can ignore it. */
export function isHapticElement(el: EventTarget | null): boolean {
  return el instanceof Element && !!el.closest(`[${SWITCH_ATTR}]`);
}

const SELECTION = '[role="tab"], [role="radio"], [role="switch"], [role="menuitemcheckbox"], input[type="checkbox"], select, .chip--button, .segmented__opt';
const PRESS = 'button, a[href], [role="menuitem"], .keypad__key';

/**
 * One listener for the whole app: a light tick for buttons and links, a softer
 * selection tick for tabs, toggles and choices. Components can still call
 * haptic('success') etc. for moments that deserve more.
 */
export function installGlobalHaptics() {
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as Element | null;
      if (!t || isHapticElement(t) || !(e as MouseEvent).isTrusted) return;
      if ((t as HTMLElement).closest?.('[disabled], [aria-disabled="true"]')) return;
      if (t.closest(SELECTION)) haptic('selection');
      else if (t.closest(PRESS)) haptic('light');
    },
    true,
  );
}
