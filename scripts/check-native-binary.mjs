// Runs as `prepublishOnly`. `npm publish` only packs files matched by
// package.json's "files" list (dist/, bin/) - it does NOT build the C
// helper. Without this check, running `npm publish` on a machine that only
// ever did `npm run build` (TypeScript only) would silently ship a package
// with no bin/oib_bridge.exe, which fails at runtime (see bridge.ts's
// resolveHelperPath) with no compile-time or publish-time warning at all.
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binExe = join(repoRoot, "bin", "oib_bridge.exe");

if (!existsSync(binExe)) {
  console.error(
    "prepublishOnly: bin/oib_bridge.exe is missing.\n" +
      "npm publish packs dist/ and bin/ only; it does not build the C helper.\n" +
      "Build it first, e.g.:\n" +
      "  cl.exe /nologo /W4 /utf-8 /Fe:helper\\oib_bridge.exe helper\\oib_bridge.c\n" +
      "  New-Item -ItemType Directory -Force bin | Out-Null\n" +
      "  Copy-Item helper\\oib_bridge.exe bin\\oib_bridge.exe\n" +
      "(the release GitHub Actions workflow, .github/workflows/release.yml, does this automatically)",
  );
  process.exit(1);
}

console.log("prepublishOnly: bin/oib_bridge.exe present, OK.");
