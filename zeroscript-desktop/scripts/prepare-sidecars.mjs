// SPDX-License-Identifier: GPL-3.0-or-later
// Copies the PyInstaller-built bridge binaries into src-tauri/binaries/ with
// the target-triple suffix Tauri requires for externalBin sidecars.
//
//   node scripts/prepare-sidecars.mjs           # real binaries from ../dist/pyi
//   node scripts/prepare-sidecars.mjs --stub    # empty placeholders (local dev)
//
// Tauri looks for <name>-<host-triple>[.exe] and strips the suffix at runtime,
// so the bridge's _sibling_exe() glob still finds launch_studio_mcp next to it.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const BIN_DIR = path.join(DESKTOP, "src-tauri", "binaries");
const STUB = process.argv.includes("--stub");

let triple;
try {
  triple = execSync("rustc --print host-tuple").toString().trim();
} catch {
  console.error("Could not determine the Rust host target triple (is rustc installed?).");
  process.exit(1);
}
if (!triple) process.exit(1);

const ext = process.platform === "win32" ? ".exe" : "";
const names = ["ZeroScriptBridge", "launch_studio_mcp"];

fs.mkdirSync(BIN_DIR, { recursive: true });
for (const name of names) {
  const dst = path.join(BIN_DIR, `${name}-${triple}${ext}`);
  if (STUB) {
    fs.writeFileSync(dst, "");
    console.log(`[stub] ${path.basename(dst)} (placeholder - run packaging/build.py --binaries-only for real sidecars)`);
  } else {
    const src = path.join(DESKTOP, "..", "dist", "pyi", `${name}${ext}`);
    if (!fs.existsSync(src)) {
      console.error(`Missing PyInstaller binary: ${src}\nBuild it first:  python packaging/build.py --binaries-only`);
      process.exit(1);
    }
    fs.copyFileSync(src, dst);
    console.log(`[ok] ${path.basename(src)} -> ${path.relative(DESKTOP, dst)}`);
  }
}
console.log(`Host triple: ${triple}`);
