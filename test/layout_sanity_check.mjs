// Pure-logic sanity check for src/keycodes.ts's per-layout character
// tables - no driver/hardware required, safe to run in CI. This is NOT a
// substitute for real-hardware verification (only "us"/"jis" have that,
// see test/REALWORLD_TESTING.md); it only catches internal
// transcription bugs (typos, wrong key names) in the layout tables
// themselves.
import { charToKeyEvent } from "../dist/keycodes.js";

let failures = 0;

function check(layout, ch, expected) {
  const result = charToKeyEvent(ch, layout);
  const resultKey = result ? `${result.key}${result.shift ? "+Shift" : ""}` : null;
  const expectedKey = expected ? `${expected.key}${expected.shift ? "+Shift" : ""}` : null;
  const ok = resultKey === expectedKey;
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} layout=${layout} char=${JSON.stringify(ch)} -> ${resultKey} (expected ${expectedKey})`);
}

// German: y/z swap, ü/ö/ä, ß
check("de", "y", { key: "KeyZ", shift: false });
check("de", "z", { key: "KeyY", shift: false });
check("de", "ü", { key: "BracketLeft", shift: false });
check("de", "ß", { key: "Minus", shift: false });
check("de", "!", { key: "Digit1", shift: true });

// French: a<->q, digits need shift, m at Semicolon
check("fr", "a", { key: "KeyQ", shift: false });
check("fr", "q", { key: "KeyA", shift: false });
check("fr", "1", { key: "Digit1", shift: true });
check("fr", "&", { key: "Digit1", shift: false });
check("fr", "m", { key: "Semicolon", shift: false });
check("fr", ",", { key: "KeyM", shift: false });

// Russian: й at KeyQ
check("ru", "й", { key: "KeyQ", shift: false });
check("ru", "Й", { key: "KeyQ", shift: true });
check("ru", "ф", { key: "KeyA", shift: false });

// Korean jamo (uncomposed - see src/keycodes.ts KO_TABLE doc comment)
check("ko", "ㄱ", { key: "KeyR", shift: false });
check("ko", "ㄲ", { key: "KeyR", shift: true });
check("ko", "ㅏ", { key: "KeyK", shift: false });
check("ko", "a", null); // no Latin letters in the jamo table

// Taiwan zhuyin (uncomposed - see src/keycodes.ts TW_TABLE doc comment)
check("tw", "ㄅ", { key: "Digit1", shift: false });
check("tw", "ㄆ", { key: "KeyQ", shift: false });

// Characters no table can produce
check("us", "ñ", null);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
