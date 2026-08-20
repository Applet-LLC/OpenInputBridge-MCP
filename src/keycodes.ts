/**
 * Scan-code tables for the OpenInputBridge wire protocol (docs/PROTOCOL.md).
 *
 * Key names follow the DOM UI Events `KeyboardEvent.code` vocabulary
 * (e.g. "KeyA", "Digit1", "ShiftLeft", "ArrowUp") since that is the
 * physical-key naming scheme test automation engineers already know from
 * Playwright/Selenium. Values are the standard PS/2 Set 1 make codes used
 * by KEYBOARD_INPUT_DATA.MakeCode, with an `extended` flag for the E0
 * prefix. US QWERTY layout only - IME/non-US layouts are out of scope for v1.
 */

export interface ScanCode {
  makeCode: number;
  extended: boolean;
}

function sc(makeCode: number, extended = false): ScanCode {
  return { makeCode, extended };
}

export const KEY_TABLE: Readonly<Record<string, ScanCode>> = Object.freeze({
  // Letter row 1 (Q..P)
  KeyQ: sc(0x10), KeyW: sc(0x11), KeyE: sc(0x12), KeyR: sc(0x13), KeyT: sc(0x14),
  KeyY: sc(0x15), KeyU: sc(0x16), KeyI: sc(0x17), KeyO: sc(0x18), KeyP: sc(0x19),
  // Letter row 2 (A..L)
  KeyA: sc(0x1e), KeyS: sc(0x1f), KeyD: sc(0x20), KeyF: sc(0x21), KeyG: sc(0x22),
  KeyH: sc(0x23), KeyJ: sc(0x24), KeyK: sc(0x25), KeyL: sc(0x26),
  // Letter row 3 (Z..M)
  KeyZ: sc(0x2c), KeyX: sc(0x2d), KeyC: sc(0x2e), KeyV: sc(0x2f), KeyB: sc(0x30),
  KeyN: sc(0x31), KeyM: sc(0x32),

  // Digit row
  Digit1: sc(0x02), Digit2: sc(0x03), Digit3: sc(0x04), Digit4: sc(0x05), Digit5: sc(0x06),
  Digit6: sc(0x07), Digit7: sc(0x08), Digit8: sc(0x09), Digit9: sc(0x0a), Digit0: sc(0x0b),

  // Punctuation (US layout)
  Minus: sc(0x0c), Equal: sc(0x0d),
  BracketLeft: sc(0x1a), BracketRight: sc(0x1b),
  Semicolon: sc(0x27), Quote: sc(0x28), Backquote: sc(0x29),
  Backslash: sc(0x2b), Comma: sc(0x33), Period: sc(0x34), Slash: sc(0x35),

  // Whitespace / control
  Enter: sc(0x1c), Tab: sc(0x0f), Space: sc(0x39), Backspace: sc(0x0e), Escape: sc(0x01),
  CapsLock: sc(0x3a), NumLock: sc(0x45), ScrollLock: sc(0x46),

  // Modifiers
  ControlLeft: sc(0x1d), ControlRight: sc(0x1d, true),
  ShiftLeft: sc(0x2a), ShiftRight: sc(0x36),
  AltLeft: sc(0x38), AltRight: sc(0x38, true),
  MetaLeft: sc(0x5b, true), MetaRight: sc(0x5c, true),
  ContextMenu: sc(0x5d, true),

  // Function keys
  F1: sc(0x3b), F2: sc(0x3c), F3: sc(0x3d), F4: sc(0x3e), F5: sc(0x3f),
  F6: sc(0x40), F7: sc(0x41), F8: sc(0x42), F9: sc(0x43), F10: sc(0x44),
  F11: sc(0x57), F12: sc(0x58),

  // Navigation / editing (extended)
  Insert: sc(0x52, true), Delete: sc(0x53, true),
  Home: sc(0x47, true), End: sc(0x4f, true),
  PageUp: sc(0x49, true), PageDown: sc(0x51, true),
  ArrowUp: sc(0x48, true), ArrowLeft: sc(0x4b, true),
  ArrowRight: sc(0x4d, true), ArrowDown: sc(0x50, true),

  // Numpad
  Numpad0: sc(0x52), Numpad1: sc(0x4f), Numpad2: sc(0x50), Numpad3: sc(0x51),
  Numpad4: sc(0x4b), Numpad5: sc(0x4c), Numpad6: sc(0x4d),
  Numpad7: sc(0x47), Numpad8: sc(0x48), Numpad9: sc(0x49),
  NumpadAdd: sc(0x4e), NumpadSubtract: sc(0x4a), NumpadDecimal: sc(0x53),
  NumpadEnter: sc(0x1c, true), NumpadDivide: sc(0x35, true),
});

export type KeyName = keyof typeof KEY_TABLE;

export function isKnownKey(name: string): name is KeyName {
  return Object.prototype.hasOwnProperty.call(KEY_TABLE, name);
}

export const MODIFIER_KEYS = [
  "ShiftLeft", "ShiftRight",
  "ControlLeft", "ControlRight",
  "AltLeft", "AltRight",
  "MetaLeft", "MetaRight",
] as const;

export type ModifierKey = (typeof MODIFIER_KEYS)[number];

/** One character resolved to the physical key + whether Shift must be held. */
export interface CharKeyEvent {
  key: KeyName;
  shift: boolean;
}

const SHIFTED_DIGIT_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  "!": "Digit1", "@": "Digit2", "#": "Digit3", "$": "Digit4", "%": "Digit5",
  "^": "Digit6", "&": "Digit7", "*": "Digit8", "(": "Digit9", ")": "Digit0",
});

const UNSHIFTED_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  "-": "Minus", "=": "Equal", "[": "BracketLeft", "]": "BracketRight",
  "\\": "Backslash", ";": "Semicolon", "'": "Quote", "`": "Backquote",
  ",": "Comma", ".": "Period", "/": "Slash",
});

const SHIFTED_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  "_": "Minus", "+": "Equal", "{": "BracketLeft", "}": "BracketRight",
  "|": "Backslash", ":": "Semicolon", '"': "Quote", "~": "Backquote",
  "<": "Comma", ">": "Period", "?": "Slash",
});

/**
 * Resolves a single character (US QWERTY layout) to the physical key that
 * types it and whether Shift is required. Returns null for characters that
 * cannot be typed this way (non-ASCII, control characters other than the
 * ones listed here).
 */
export function charToKeyEvent(ch: string): CharKeyEvent | null {
  if (ch === " ") return { key: "Space", shift: false };
  if (ch === "\n" || ch === "\r") return { key: "Enter", shift: false };
  if (ch === "\t") return { key: "Tab", shift: false };

  if (ch.length === 1 && ch >= "a" && ch <= "z") {
    return { key: `Key${ch.toUpperCase()}` as KeyName, shift: false };
  }
  if (ch.length === 1 && ch >= "A" && ch <= "Z") {
    return { key: `Key${ch}` as KeyName, shift: true };
  }
  if (ch.length === 1 && ch >= "0" && ch <= "9") {
    return { key: `Digit${ch}` as KeyName, shift: false };
  }
  if (ch in SHIFTED_DIGIT_SYMBOLS) {
    return { key: SHIFTED_DIGIT_SYMBOLS[ch] as KeyName, shift: true };
  }
  if (ch in UNSHIFTED_SYMBOLS) {
    return { key: UNSHIFTED_SYMBOLS[ch] as KeyName, shift: false };
  }
  if (ch in SHIFTED_SYMBOLS) {
    return { key: SHIFTED_SYMBOLS[ch] as KeyName, shift: true };
  }
  return null;
}
