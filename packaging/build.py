# SPDX-License-Identifier: GPL-3.0-or-later
# build.py
# ---------------------------------------------------------------------------
#  Builds the ZeroScript DESKTOP packages (Windows / macOS / Linux) so end
#  users never need to install Python, pip or Node.js.
#
#  PyInstaller cannot cross-compile, so this script must run on the matching
#  OS - normally inside GitHub Actions (.github/workflows/build-desktop.yml).
#  It produces, per platform, a portable package AND a native installer:
#
#    Windows  ZeroScript-Setup-<version>.exe   (NSIS, per-user install)
#    macOS    ZeroScript-<version>.dmg         (drag-to-Applications)
#    Linux    ZeroScript-<version>-x86_64.AppImage
#
#  Every output lands in dist/packages/ for upload to a GitHub Release.
#  Console output stays plain ASCII (same rule as the bridge itself).
# ---------------------------------------------------------------------------
import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DIR = ROOT / "zeroscript-extension"
DIST = ROOT / "dist"
PYI = DIST / "pyi"                 # raw PyInstaller output
STAGE = DIST / "ZeroScript"        # portable staging folder (Windows)
PACKAGES = DIST / "packages"       # final artifacts, uploaded to the Release
ICON = EXTENSION_DIR / "icon.png"
SYSTEM = platform.system()

DESKTOP_ENTRY = (
    "[Desktop Entry]\n"
    "Type=Application\n"
    "Name=ZeroScript\n"
    "Comment=Connect AI chat to Roblox Studio via MCP\n"
    "Exec=ZeroScriptBridge\n"
    "Icon=zeroscript\n"
    "Terminal=false\n"
    "Categories=Development;Utility;\n"
)

APPRUN = (
    "#!/bin/sh\n"
    "set -e\n"
    "HERE=\"$(dirname \"$(readlink -f \"$0\")\")\"\n"
    "exec \"$HERE/usr/bin/ZeroScriptBridge\" \"$@\"\n"
)


def log(msg):
    print(f"[build] {msg}", flush=True)


def run(cmd, cwd=None):
    log("+ " + " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, cwd=cwd)


def version_from_manifest():
    with open(EXTENSION_DIR / "manifest.json", encoding="utf-8") as f:
        return json.load(f)["version"]


def pyinstaller(name, script, mode="--onefile", extra=()):
    """mode must be given explicitly: PyInstaller DEFAULTS to onedir, and this
    script copies single binaries out of PYI afterwards (a onedir build is a
    folder whose missing _internal/ deps would break the copied exe)."""
    args = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", mode,
        "--distpath", str(PYI),
        "--workpath", str(DIST / "build"),
        "--specpath", str(DIST / "spec"),
        "--name", name,
        *extra,
        str(ROOT / script),
    ]
    run(args, cwd=ROOT)


def copy_extension(dest):
    """Bundle the unpacked Chrome extension so users can 'Load unpacked' it
    straight from the installed folder - no separate download."""
    shutil.copytree(EXTENSION_DIR, dest, dirs_exist_ok=True)


def write_readme(stage, ver):
    (stage / "README.txt").write_text(
        f"ZeroScript v{ver}\n"
        "================\n"
        "\n"
        "1. Start ZeroScript Bridge (double-click ZeroScriptBridge).\n"
        "   Keep it running while you work.\n"
        "\n"
        "2. Load the browser extension:\n"
        "   - Open chrome://extensions (or edge://extensions)\n"
        "   - Enable 'Developer mode' (top right)\n"
        "   - Click 'Load unpacked' and pick the 'zeroscript-extension' folder\n"
        "     that ships next to this file.\n"
        "\n"
        "3. Open Roblox Studio with a place loaded, then:\n"
        "   Assistant Settings > MCP Servers > enable 'Studio as MCP server'.\n"
        "\n"
        "4. Open a supported AI chat site and click 'Start Roblox Agent'.\n"
        "\n"
        "Notes:\n"
        " - config.json next to this file lists the MCP servers. The Roblox\n"
        "   server normally runs the custom Node.js-based MCP; if Node.js is\n"
        "   NOT installed, the bridge automatically falls back to Roblox\n"
        "   Studio's own built-in StudioMCP server (no install needed).\n"
        " - Logs: logs/start.log and logs/bridge_debug.log.\n",
        encoding="utf-8",
    )


def zip_portable(folder, name):
    """Zip a staging folder so its top-level folder name survives extraction."""
    out = PACKAGES / f"{name}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(folder.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(folder.parent))
    return out


def mac_default_config(dest):
    """macOS/Linux default config: use Roblox Studio's own StudioMCP binary
    (launch_studio_mcp, no Node.js required). The frozen bridge maps the bare
    'launch_studio_mcp.py' command to the bundled sibling executable."""
    dest.write_text(
        json.dumps(
            {"mcpServers": {"roblox": {"command": "launch_studio_mcp.py", "args": []}}},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


# ── platform builds ────────────────────────────────────────────────────────
def build_windows(ver):
    log("building Windows package")
    pyinstaller("ZeroScriptBridge", "bridge.py")
    pyinstaller("launch_studio_mcp", "launch_studio_mcp.py")

    shutil.rmtree(STAGE, ignore_errors=True)
    STAGE.mkdir(parents=True)
    shutil.copy2(PYI / "ZeroScriptBridge.exe", STAGE / "ZeroScriptBridge.exe")
    shutil.copy2(PYI / "launch_studio_mcp.exe", STAGE / "launch_studio_mcp.exe")
    # Windows ships the repo's config.json (custom Roblox MCP via npx, with the
    # bridge's built-in Node.js fallback to StudioMCP).
    shutil.copy2(ROOT / "config.json", STAGE / "config.json")
    copy_extension(STAGE / "zeroscript-extension")
    write_readme(STAGE, ver)

    PACKAGES.mkdir(parents=True, exist_ok=True)
    zip_portable(STAGE, f"ZeroScript-portable-{ver}-windows")

    nsis = shutil.which("makensis")
    if nsis:
        run([nsis, f"/DVERSION={ver}", "installers/windows.nsi"],
            cwd=ROOT / "packaging")
    else:
        log("WARNING: makensis (NSIS) not found - skipping the Windows installer")


def build_macos(ver):
    log("building macOS package")
    # Windowed .app bundle: no terminal pops open for non-technical users.
    # Logs still land in logs/ next to the binary inside the bundle.
    pyinstaller(
        "ZeroScriptBridge", "bridge.py", mode="--onedir",
        extra=["--windowed", "--osx-bundle-identifier", "com.zeroscript.bridge"],
    )
    pyinstaller("launch_studio_mcp", "launch_studio_mcp.py")

    app = PYI / "ZeroScriptBridge.app"
    macos_dir = app / "Contents" / "MacOS"
    shutil.copy2(PYI / "launch_studio_mcp", macos_dir / "launch_studio_mcp")
    mac_default_config(macos_dir / "config.json")
    copy_extension(macos_dir / "zeroscript-extension")

    PACKAGES.mkdir(parents=True, exist_ok=True)
    # DMG staging: the .app + an Applications symlink + the extension folder.
    staging = DIST / "dmg-staging"
    shutil.rmtree(staging, ignore_errors=True)
    shutil.copytree(app, staging / "ZeroScript.app")
    copy_extension(staging / "zeroscript-extension")
    (staging / "Applications").mkdir()
    os.symlink("/Applications", staging / "Applications" / "Applications")
    write_readme(staging, ver)

    run([
        "hdiutil", "create", "-volname", "ZeroScript",
        "-srcfolder", str(staging), "-ov", "-format", "UDZO",
        str(PACKAGES / f"ZeroScript-{ver}.dmg"),
    ])
    zip_portable(staging, f"ZeroScript-portable-{ver}-macos")


def build_linux(ver):
    log("building Linux package (AppImage)")
    pyinstaller("ZeroScriptBridge", "bridge.py")
    pyinstaller("launch_studio_mcp", "launch_studio_mcp.py")

    appdir = DIST / f"ZeroScript-{ver}-x86_64.AppDir"
    shutil.rmtree(appdir, ignore_errors=True)
    usr_bin = appdir / "usr" / "bin"
    usr_bin.mkdir(parents=True)
    shutil.copy2(PYI / "ZeroScriptBridge", usr_bin / "ZeroScriptBridge")
    shutil.copy2(PYI / "launch_studio_mcp", usr_bin / "launch_studio_mcp")

    (appdir / "AppRun").write_text(APPRUN, encoding="utf-8")
    (appdir / "AppRun").chmod(0o755)
    (appdir / "ZeroScriptBridge.desktop").write_text(DESKTOP_ENTRY, encoding="utf-8")

    icons = appdir / "usr" / "share" / "icons" / "hicolor" / "256x256" / "apps"
    icons.mkdir(parents=True)
    if ICON.is_file():
        shutil.copy2(ICON, icons / "zeroscript.png")
    apps = appdir / "usr" / "share" / "applications"
    apps.mkdir(parents=True)
    shutil.copy2(appdir / "ZeroScriptBridge.desktop", apps / "zeroscript.desktop")

    PACKAGES.mkdir(parents=True, exist_ok=True)
    tool = DIST / "appimagetool-x86_64.AppImage"
    if not tool.exists():
        log("downloading appimagetool...")
        run([
            "curl", "-L", "-o", str(tool),
            "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage",
        ])
        # Verify the download succeeded and file is not empty
        if not tool.exists() or tool.stat().st_size == 0:
            sys.exit(f"Failed to download appimagetool: {tool}")
    
    tool.chmod(0o755)
    
    # Verify the tool is executable
    if not os.access(tool, os.X_OK):
        log("WARNING: appimagetool is not executable, attempting to fix permissions")
        tool.chmod(0o755)
    
    try:
        # --appimage-extract-and-run avoids requiring FUSE on the CI runner.
        run([str(tool), "--appimage-extract-and-run", str(appdir),
             str(PACKAGES / f"ZeroScript-{ver}-x86_64.AppImage")])
    except subprocess.CalledProcessError as e:
        log(f"ERROR: appimagetool failed with exit code {e.returncode}")
        log("This may be due to missing system dependencies or FUSE support.")
        sys.exit(f"AppImage creation failed: {e}")


def main():
    ap = argparse.ArgumentParser(description="Build the ZeroScript desktop package for this OS.")
    ap.add_argument("--version", help="Override the version (default: zeroscript-extension/manifest.json).")
    args = ap.parse_args()

    ver = (args.version or "").lstrip("v") or version_from_manifest()
    log(f"building ZeroScript v{ver} on {SYSTEM}")

    if SYSTEM == "Windows":
        build_windows(ver)
    elif SYSTEM == "Darwin":
        build_macos(ver)
    elif SYSTEM == "Linux":
        build_linux(ver)
    else:
        sys.exit(f"unsupported platform: {SYSTEM}")

    log(f"done. packages in {PACKAGES}:")
    for p in sorted(PACKAGES.iterdir()):
        log(f"  - {p.name} ({p.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
