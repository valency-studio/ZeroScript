// SPDX-License-Identifier: GPL-3.0-or-later
// Keeps the desktop GUI version in sync with zeroscript-extension/manifest.json
// (the single source of truth, matching the extension's own update logic).
//
// Writes the version into:
//   - src-tauri/tauri.conf.json ("version")   -> drives the installer metadata
//   - src-tauri/Cargo.toml   (version)        -> baked into the binary at compile
//   - package.json           (version)
//
// Hooked into beforeDevCommand / beforeBuildCommand in tauri.conf.json, so
// `tauri dev` and `tauri build` always pick up the manifest version.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const ROOT = path.resolve(DESKTOP, "..");

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "zeroscript-extension", "manifest.json"), "utf-8"),
);
const version = String(manifest.version || "").trim();
if (!version) {
  console.error("sync-version: no version found in zeroscript-extension/manifest.json");
  process.exit(1);
}

// 1. tauri.conf.json
const confPath = path.join(DESKTOP, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(fs.readFileSync(confPath, "utf-8"));
conf.version = version;
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n", "utf-8");

// 2. Cargo.toml (keep comments/formatting, only touch the [package] version).
const cargoPath = path.join(DESKTOP, "src-tauri", "Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf-8");
const VERSION_RE = /^(version\s*=\s*")[^"]*(")/m;
if (!VERSION_RE.test(cargo)) {
  console.error(`sync-version: could not find the version line in ${cargoPath}`);
  process.exit(1);
}
// Note: when Cargo already carries the manifest version the replace is a
// no-op - that is success, not a failure.
fs.writeFileSync(cargoPath, cargo.replace(VERSION_RE, `$1${version}$2`), "utf-8");

// 3. package.json + package-lock.json (npm ci enforces they stay in sync).
const pkgPath = path.join(DESKTOP, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

const lockPath = path.join(DESKTOP, "package-lock.json");
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  if (lock.version !== version) {
    lock.version = version;
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
  }
}

console.log(`[sync-version] ZeroScript v${version} (from zeroscript-extension/manifest.json)`);
