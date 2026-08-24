/**
 * Scan-code tables for the OpenInputBridge wire protocol (docs/PROTOCOL.md).
 *
 * Key names follow the DOM UI Events `KeyboardEvent.code` vocabulary
 * (e.g. "KeyA", "Digit1", "ShiftLeft", "ArrowUp") since that is the
 * physical-key naming scheme test automation engineers already know from
 * Playwright/Selenium. Values are the standard PS/2 Set 1 make codes used
 * by KEYBOARD_INPUT_DATA.MakeCode, with an `extended` flag for the E0
 * prefix.
 *
 * `press_key`/`key_down`/`key_up` name a *physical key* (layout-independent
 * - the scan code is a position, not a character), so they work the same
 * regardless of the OS's active keyboard layout. `type_text` instead takes
 * literal *characters* and must decide which physical key + Shift state
 * produces each one, which genuinely does depend on the active layout -
 * see charToKeyEvent()'s `layout` parameter below. IME-based Japanese text
 * entry (kana/kanji conversion) is out of scope for v1 regardless of layout.
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

  // JIS-only physical keys (109-key Japanese keyboards have 5 keys with no
  // US-layout equivalent; DOM code names per the UI Events spec). Safe to
  // press regardless of active layout - on a non-JIS system the physical
  // key simply doesn't exist, so this is an inert/unmapped scan code.
  IntlRo: sc(0x73), IntlYen: sc(0x7d),
  Convert: sc(0x79), NonConvert: sc(0x7b), KanaMode: sc(0x70),

  // ISO "102nd key" (between LeftShift and KeyZ on European/UK keyboards;
  // absent on US ANSI keyboards). Used by German/French layouts below.
  IntlBackslash: sc(0x56),
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

/**
 * Which physical-key character mapping to use in charToKeyEvent().
 *
 * "us"/"jis"/"de"/"fr"/"ru" are genuine keyboard layouts: every character
 * they can produce comes from a single keypress (+ Shift), no IME
 * involved, so `layout: "auto"` can pick one confidently from the
 * focused window's Windows keyboard layout (LANGID) alone - see
 * LANGID_TO_AUTO_LAYOUT below.
 *
 * "ko"/"tw" are different in kind, not just degree: Hangul/Bopomofo
 * input is IME-composed (jamo/zhuyin keystrokes get combined into
 * syllable blocks or Han characters by an IME, which is out of scope -
 * see the file header). What's tabled here is the *uncomposed* jamo/
 * zhuyin symbol each key sends by itself. Because whether that IME
 * composition is even active isn't visible from the keyboard LANGID
 * alone (the same Korean keyboard layout is active whether Hangul mode
 * is toggled on or off), these two are only reachable by explicitly
 * requesting `layout: "ko"` / `"tw"` - never selected by "auto".
 *
 * None of "de"/"fr"/"ru"/"ko"/"tw" have been confirmed against real
 * hardware (unlike "us"/"jis" - see test/REALWORLD_TESTING.md); they're
 * built from standard published layout references. Treat them as
 * best-effort until verified.
 */
export type KeyboardLayoutId = "us" | "jis" | "de" | "fr" | "ru" | "ko" | "tw";

/** Layouts eligible for `layout: "auto"` detection via LANGID (see AUTO_DETECTABLE_LAYOUTS). */
type AutoDetectableLayoutId = "us" | "jis" | "de" | "fr" | "ru";

/** Windows LANGID (low word of HKL) - see bridge.ts getActiveKeyboardLayout(). */
const LANGID_JAPANESE = 0x0411;
const LANGID_GERMAN = 0x0407;
const LANGID_FRENCH = 0x040c;
const LANGID_RUSSIAN = 0x0419;

/** @deprecated kept for compatibility; prefer resolving via LANGID_TO_AUTO_LAYOUT. */
export const JAPANESE_LANGUAGE_ID = LANGID_JAPANESE;

/** `layout: "auto"` resolution: Windows LANGID -> layout. Unlisted LANGIDs (including Korean/Taiwan) fall back to "us". */
export const LANGID_TO_AUTO_LAYOUT: ReadonlyMap<number, AutoDetectableLayoutId> = new Map([
  [LANGID_JAPANESE, "jis"],
  [LANGID_GERMAN, "de"],
  [LANGID_FRENCH, "fr"],
  [LANGID_RUSSIAN, "ru"],
]);

function k(key: KeyName, shift = false): CharKeyEvent {
  return { key, shift };
}

/** Full char -> physical-key table for one layout (every character it can type without dead keys/AltGr/IME). */
type LayoutTable = Readonly<Record<string, CharKeyEvent>>;

/** a-z -> KeyA..KeyZ (shift=false), A-Z -> same keys (shift=true) - true for every layout below except "fr" (AZERTY moves several letters) and the partial "de" swap, both overridden explicitly in their own tables. */
function usAsciiLetters(): Record<string, CharKeyEvent> {
  const out: Record<string, CharKeyEvent> = {};
  for (let c = 0; c < 26; c++) {
    const upper = String.fromCharCode(65 + c);
    const key = `Key${upper}` as KeyName;
    out[upper.toLowerCase()] = k(key, false);
    out[upper] = k(key, true);
  }
  return out;
}

/** 0-9 -> Digit0..Digit9, unshifted - true for every layout below except "fr" (AZERTY digits need Shift). */
function usAsciiDigits(): Record<string, CharKeyEvent> {
  const out: Record<string, CharKeyEvent> = {};
  for (let d = 0; d <= 9; d++) {
    out[String(d)] = k(`Digit${d}` as KeyName, false);
  }
  return out;
}

const US_TABLE: LayoutTable = Object.freeze({
  ...usAsciiLetters(),
  ...usAsciiDigits(),
  "!": k("Digit1", true), "@": k("Digit2", true), "#": k("Digit3", true), "$": k("Digit4", true), "%": k("Digit5", true),
  "^": k("Digit6", true), "&": k("Digit7", true), "*": k("Digit8", true), "(": k("Digit9", true), ")": k("Digit0", true),
  "-": k("Minus"), "=": k("Equal"), "[": k("BracketLeft"), "]": k("BracketRight"),
  "\\": k("Backslash"), ";": k("Semicolon"), "'": k("Quote"), "`": k("Backquote"),
  ",": k("Comma"), ".": k("Period"), "/": k("Slash"),
  "_": k("Minus", true), "+": k("Equal", true), "{": k("BracketLeft", true), "}": k("BracketRight", true),
  "|": k("Backslash", true), ":": k("Semicolon", true), '"': k("Quote", true), "~": k("Backquote", true),
  "<": k("Comma", true), ">": k("Period", true), "?": k("Slash", true),
});

/*
 * JIS (106/109-key Japanese) layout. The digit-row Shift symbols diverge
 * from US starting at "2", and most punctuation keys produce entirely
 * different characters since JIS reassigns several positions and adds
 * IntlRo (no US equivalent) to the layout. Every mapping below (including
 * the one exception noted at the "¥" omission) is confirmed against real
 * JIS keyboard hardware - see test/REALWORLD_TESTING.md and
 * test/realworld_jis_layout_test.mjs.
 */
const JIS_TABLE: LayoutTable = Object.freeze({
  ...usAsciiLetters(),
  ...usAsciiDigits(),
  "!": k("Digit1", true), '"': k("Digit2", true), "#": k("Digit3", true), "$": k("Digit4", true), "%": k("Digit5", true),
  "&": k("Digit6", true), "'": k("Digit7", true), "(": k("Digit8", true), ")": k("Digit9", true),
  // Digit0 has no standard Shift symbol on JIS - omitted (unsupported).
  "-": k("Minus"), "^": k("Equal"), "@": k("BracketLeft"), "[": k("BracketRight"),
  "]": k("Backslash"), ";": k("Semicolon"), ":": k("Quote"),
  ",": k("Comma"), ".": k("Period"), "/": k("Slash"),
  "\\": k("IntlRo"),
  // No mapping for "¥" (U+00A5): confirmed on real hardware that pressing
  // IntlYen unshifted sends ASCII backslash (U+005C), the same character
  // IntlRo unshifted already produces - a long-standing Windows JIS-driver
  // quirk (the Yen key has never sent the true yen sign character, for
  // historical Shift-JIS/CP932 compatibility reasons), not a bug here.
  // There is no key combination that types an actual U+00A5 on this
  // layout, so it's simply unsupported here; the physical key can still
  // be pressed directly via press_key({key:"IntlYen"}).
  "=": k("Minus", true), "~": k("Equal", true), "`": k("BracketLeft", true), "{": k("BracketRight", true),
  "}": k("Backslash", true), "+": k("Semicolon", true), "*": k("Quote", true),
  "<": k("Comma", true), ">": k("Period", true), "?": k("Slash", true),
  "_": k("IntlRo", true), "|": k("IntlYen", true),
});

/*
 * German (QWERTZ, "Germany" layout, LANGID 0x0407). NOT confirmed against
 * real hardware - see the KeyboardLayoutId doc comment above. Base +
 * Shift levels only; dead keys (´ on Equal, ^ on Backquote) and AltGr-
 * level characters (@ € etc.) are unsupported.
 */
const DE_TABLE: LayoutTable = Object.freeze({
  ...usAsciiLetters(),
  ...usAsciiDigits(),
  // Y/Z swapped relative to US (physical position, not character).
  y: k("KeyZ"), Y: k("KeyZ", true), z: k("KeyY"), Z: k("KeyY", true),
  "!": k("Digit1", true), '"': k("Digit2", true), "§": k("Digit3", true), "$": k("Digit4", true), "%": k("Digit5", true),
  "&": k("Digit6", true), "/": k("Digit7", true), "(": k("Digit8", true), ")": k("Digit9", true), "=": k("Digit0", true),
  "ß": k("Minus"), "?": k("Minus", true),
  "ü": k("BracketLeft"), "Ü": k("BracketLeft", true),
  "+": k("BracketRight"), "*": k("BracketRight", true),
  "ö": k("Semicolon"), "Ö": k("Semicolon", true),
  "ä": k("Quote"), "Ä": k("Quote", true),
  "°": k("Backquote", true), // Backquote unshifted is the dead "^" (circumflex) - unsupported.
  "#": k("Backslash"), "'": k("Backslash", true),
  "<": k("IntlBackslash"), ">": k("IntlBackslash", true),
  ",": k("Comma"), ";": k("Comma", true),
  ".": k("Period"), ":": k("Period", true),
  "-": k("Slash"), "_": k("Slash", true),
});

/*
 * French (AZERTY, "France" layout, LANGID 0x040C). NOT confirmed against
 * real hardware. Base + Shift levels only; dead keys (^ on BracketLeft, ¨
 * AltGr) and AltGr-level characters (€ etc.) are unsupported. Note the
 * AZERTY-specific quirk that digits require Shift (the unshifted digit
 * row types symbols instead).
 */
const FR_TABLE: LayoutTable = Object.freeze({
  // Letters: mostly QWERTY positions, but A<->Q and W<->Z swap, and "M"
  // moves to the Semicolon position (French has no letter at KeyM).
  a: k("KeyQ"), A: k("KeyQ", true), q: k("KeyA"), Q: k("KeyA", true),
  z: k("KeyW"), Z: k("KeyW", true), w: k("KeyZ"), W: k("KeyZ", true),
  m: k("Semicolon"), M: k("Semicolon", true),
  e: k("KeyE"), E: k("KeyE", true), r: k("KeyR"), R: k("KeyR", true), t: k("KeyT"), T: k("KeyT", true),
  y: k("KeyY"), Y: k("KeyY", true), u: k("KeyU"), U: k("KeyU", true), i: k("KeyI"), I: k("KeyI", true),
  o: k("KeyO"), O: k("KeyO", true), p: k("KeyP"), P: k("KeyP", true),
  s: k("KeyS"), S: k("KeyS", true), d: k("KeyD"), D: k("KeyD", true), f: k("KeyF"), F: k("KeyF", true),
  g: k("KeyG"), G: k("KeyG", true), h: k("KeyH"), H: k("KeyH", true), j: k("KeyJ"), J: k("KeyJ", true),
  k: k("KeyK"), K: k("KeyK", true), l: k("KeyL"), L: k("KeyL", true),
  x: k("KeyX"), X: k("KeyX", true), c: k("KeyC"), C: k("KeyC", true), v: k("KeyV"), V: k("KeyV", true),
  b: k("KeyB"), B: k("KeyB", true), n: k("KeyN"), N: k("KeyN", true),
  // Digits require Shift on AZERTY; unshifted digit row types symbols.
  "&": k("Digit1"), "1": k("Digit1", true),
  "é": k("Digit2"), "2": k("Digit2", true),
  '"': k("Digit3"), "3": k("Digit3", true),
  "'": k("Digit4"), "4": k("Digit4", true),
  "(": k("Digit5"), "5": k("Digit5", true),
  "-": k("Digit6"), "6": k("Digit6", true),
  "è": k("Digit7"), "7": k("Digit7", true),
  "_": k("Digit8"), "8": k("Digit8", true),
  "ç": k("Digit9"), "9": k("Digit9", true),
  "à": k("Digit0"), "0": k("Digit0", true),
  ")": k("Minus"), "°": k("Minus", true),
  "=": k("Equal"), "+": k("Equal", true),
  "$": k("BracketRight"), // BracketLeft unshifted is the dead "^" circumflex - unsupported.
  "ù": k("Quote"), "%": k("Quote", true),
  "*": k("Backslash"), "µ": k("Backslash", true),
  ",": k("KeyM"), "?": k("KeyM", true),
  ";": k("Comma"), ".": k("Comma", true),
  ":": k("Period"), "/": k("Period", true),
  "!": k("Slash"), "§": k("Slash", true),
  "<": k("IntlBackslash"), ">": k("IntlBackslash", true),
});

/*
 * Russian (ЙЦУКЕН layout, LANGID 0x0419). NOT confirmed against real
 * hardware - letter positions are the well-standardized part; some
 * punctuation-key details (marked below) are lower-confidence.
 */
const RU_TABLE: LayoutTable = Object.freeze({
  ...usAsciiDigits(),
  "!": k("Digit1", true), '"': k("Digit2", true), "№": k("Digit3", true), ";": k("Digit4", true), "%": k("Digit5", true),
  ":": k("Digit6", true), "?": k("Digit7", true), "*": k("Digit8", true), "(": k("Digit9", true), ")": k("Digit0", true),
  "-": k("Minus"), "_": k("Minus", true), "=": k("Equal"), "+": k("Equal", true),
  й: k("KeyQ"), Й: k("KeyQ", true), ц: k("KeyW"), Ц: k("KeyW", true), у: k("KeyE"), У: k("KeyE", true),
  к: k("KeyR"), К: k("KeyR", true), е: k("KeyT"), Е: k("KeyT", true), н: k("KeyY"), Н: k("KeyY", true),
  г: k("KeyU"), Г: k("KeyU", true), ш: k("KeyI"), Ш: k("KeyI", true), щ: k("KeyO"), Щ: k("KeyO", true),
  з: k("KeyP"), З: k("KeyP", true), х: k("BracketLeft"), Х: k("BracketLeft", true),
  ъ: k("BracketRight"), Ъ: k("BracketRight", true),
  ф: k("KeyA"), Ф: k("KeyA", true), ы: k("KeyS"), Ы: k("KeyS", true), в: k("KeyD"), В: k("KeyD", true),
  а: k("KeyF"), А: k("KeyF", true), п: k("KeyG"), П: k("KeyG", true), р: k("KeyH"), Р: k("KeyH", true),
  о: k("KeyJ"), О: k("KeyJ", true), л: k("KeyK"), Л: k("KeyK", true), д: k("KeyL"), Д: k("KeyL", true),
  ж: k("Semicolon"), Ж: k("Semicolon", true), э: k("Quote"), Э: k("Quote", true),
  "\\": k("Backslash"), "/": k("Backslash", true), // lower confidence
  я: k("KeyZ"), Я: k("KeyZ", true), ч: k("KeyX"), Ч: k("KeyX", true), с: k("KeyC"), С: k("KeyC", true),
  м: k("KeyV"), М: k("KeyV", true), и: k("KeyB"), И: k("KeyB", true), т: k("KeyN"), Т: k("KeyN", true),
  ь: k("KeyM"), Ь: k("KeyM", true), б: k("Comma"), Б: k("Comma", true), ю: k("Period"), Ю: k("Period", true),
  ".": k("Slash"), ",": k("Slash", true), // lower confidence
});

/*
 * Korean 2-beolsik (2-set) jamo keyboard, LANGID 0x0412 - explicit-only,
 * never auto-detected (see KeyboardLayoutId doc comment). Produces
 * standalone Hangul Compatibility Jamo (U+3131-U+318E), NOT IME-composed
 * syllable blocks - typing "r" + "k" gives "ㄱㅏ" (two separate jamo
 * characters), not the composed syllable "가". Composing jamo into
 * syllables is IME work, out of scope. Digits pass through unshifted
 * like every other layout; punctuation is not tabled (Korean keyboards
 * use the same punctuation regardless of Hangul/English mode, so callers
 * needing ASCII punctuation alongside jamo should switch `layout` per
 * call, or a future version could merge in US's punctuation directly).
 */
const KO_TABLE: LayoutTable = Object.freeze({
  ...usAsciiDigits(),
  ㅂ: k("KeyQ"), ㅃ: k("KeyQ", true), ㅈ: k("KeyW"), ㅉ: k("KeyW", true),
  ㄷ: k("KeyE"), ㄸ: k("KeyE", true), ㄱ: k("KeyR"), ㄲ: k("KeyR", true),
  ㅅ: k("KeyT"), ㅆ: k("KeyT", true), ㅛ: k("KeyY"), ㅕ: k("KeyU"), ㅑ: k("KeyI"),
  ㅐ: k("KeyO"), ㅒ: k("KeyO", true), ㅔ: k("KeyP"), ㅖ: k("KeyP", true),
  ㅁ: k("KeyA"), ㄴ: k("KeyS"), ㅇ: k("KeyD"), ㄹ: k("KeyF"), ㅎ: k("KeyG"),
  ㅗ: k("KeyH"), ㅓ: k("KeyJ"), ㅏ: k("KeyK"), ㅣ: k("KeyL"),
  ㅋ: k("KeyZ"), ㅌ: k("KeyX"), ㅊ: k("KeyC"), ㅍ: k("KeyV"),
  ㅠ: k("KeyB"), ㅜ: k("KeyN"), ㅡ: k("KeyM"),
});

/*
 * Taiwan Zhuyin/Bopomofo standard keyboard, LANGID 0x0404 (zh-TW) -
 * explicit-only, never auto-detected, for the same reason as Korean
 * above. Produces standalone Bopomofo symbols (U+3105-U+312F range) and
 * tone marks, NOT IME-composed Han characters - composing these into
 * actual Chinese characters is IME work, out of scope.
 */
const TW_TABLE: LayoutTable = Object.freeze({
  ...usAsciiDigits(),
  ㄅ: k("Digit1"), ㄉ: k("Digit2"), ˇ: k("Digit3"), ˋ: k("Digit4"), ㄓ: k("Digit5"),
  ˊ: k("Digit6"), "˙": k("Digit7"), ㄚ: k("Digit8"), ㄞ: k("Digit9"), ㄢ: k("Digit0"),
  ㄦ: k("Minus"),
  ㄆ: k("KeyQ"), ㄊ: k("KeyW"), ㄍ: k("KeyE"), ㄐ: k("KeyR"), ㄔ: k("KeyT"),
  ㄗ: k("KeyY"), ㄧ: k("KeyU"), ㄛ: k("KeyI"), ㄟ: k("KeyO"), ㄣ: k("KeyP"),
  ㄇ: k("KeyA"), ㄋ: k("KeyS"), ㄎ: k("KeyD"), ㄑ: k("KeyF"), ㄕ: k("KeyG"),
  ㄖ: k("KeyH"), ㄨ: k("KeyJ"), ㄜ: k("KeyK"), ㄠ: k("KeyL"), ㄤ: k("Semicolon"),
  ㄈ: k("KeyZ"), ㄌ: k("KeyX"), ㄏ: k("KeyC"), ㄒ: k("KeyV"), ㄘ: k("KeyB"),
  ㄙ: k("KeyN"), ㄩ: k("KeyM"), ㄝ: k("Comma"), ㄡ: k("Period"), ㄥ: k("Slash"),
});

const LAYOUT_TABLES: Readonly<Record<KeyboardLayoutId, LayoutTable>> = Object.freeze({
  us: US_TABLE,
  jis: JIS_TABLE,
  de: DE_TABLE,
  fr: FR_TABLE,
  ru: RU_TABLE,
  ko: KO_TABLE,
  tw: TW_TABLE,
});

/**
 * Resolves a single character to the physical key that types it and
 * whether Shift is required, for the given keyboard layout (default
 * "us"). Returns null for characters that cannot be typed this way
 * (dead-key/AltGr/IME-composed characters, or anything outside that
 * layout's table).
 */
export function charToKeyEvent(ch: string, layout: KeyboardLayoutId = "us"): CharKeyEvent | null {
  if (ch === " ") return { key: "Space", shift: false };
  if (ch === "\n" || ch === "\r") return { key: "Enter", shift: false };
  if (ch === "\t") return { key: "Tab", shift: false };

  const entry = LAYOUT_TABLES[layout][ch];
  return entry ?? null;
}
