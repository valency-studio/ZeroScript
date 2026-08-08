<div align="center">

# ⚡ ZeroScript

**Suruh AI Chat favoritmu mengendalikan Roblox Studio — cukup dengan chat biasa.**

[![Release](https://img.shields.io/github/v/release/valency-studio/ZeroScript?label=Release&color=e11d48)](https://github.com/valency-studio/ZeroScript/releases/latest)
[![License](https://img.shields.io/github/license/valency-studio/ZeroScript?color=2eb872)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-✓-0078D6?logo=windows&logoColor=white)](https://github.com/valency-studio/ZeroScript/releases/latest)
[![Platform](https://img.shields.io/badge/macOS-✓-a2aaad?logo=apple&logoColor=white)](https://github.com/valency-studio/ZeroScript/releases/latest)
[![Platform](https://img.shields.io/badge/Linux-✓-fcc624?logo=linux&logoColor=black)](https://github.com/valency-studio/ZeroScript/releases/latest)
[![Chrome](https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?logo=googlechrome&logoColor=white)](zeroscript-extension/)

---

Bayangkan kamu bisa menyuruh **ChatGPT, DeepSeek, Claude, atau Gemini** untuk membuat Part,
menulis script Luau, mengeksekusi kode, hingga mengambil screenshot di Roblox Studio —
langsung dari situs AI chat yang biasa kamu pakai.

**ZeroScript mewujudkannya tanpa build step yang rumit.** Tidak perlu server, tidak perlu
membayar — semuanya berjalan **lokal di komputermu**.

</div>

---

## Daftar Isi

- [Quick Start (untuk pemula)](#quick-start-untuk-pemula)
- [Bagaimana ZeroScript Bekerja](#bagaimana-zeroscript-bekerja)
- [Fitur Utama](#fitur-utama)
- [Situs AI yang Didukung](#situs-ai-yang-didukung)
- [Isi Setiap Rilis](#isi-setiap-rilis)
- [Troubleshooting (FAQ)](#troubleshooting-faq)
- [Log dan Debugging](#log-dan-debugging)
- [Untuk Pengembang](#untuk-pengembang)
- [Lisensi](#lisensi)
- [Kredit dan Kontribusi](#kredit-dan-kontribusi)
- [Support](#support)

---

## Quick Start (untuk pemula)

> 💡 **Istilah singkat**
> | Istilah | Artinya |
> |---|---|
> | **Bridge** | Program kecil di komputermu yang menghubungkan ekstensi browser dengan Roblox Studio. |
> | **Ekstensi** | Add-on Chrome yang menyuntikkan agent ZeroScript ke situs AI chat. |
> | **MCP** | Standar koneksi (Model Context Protocol) yang dipakai untuk mengendalikan Studio. |
> | **Luau** | Bahasa scripting Roblox (varian Lua). |

Ada **dua jalur**. Kalau kamu pemula, pakai **Opsi A** — paling cepat dan tanpa ribet.

### Opsi A — Desktop App (disarankan ⭐)

Tidak perlu menginstal Python, Node.js, atau membuka terminal sama sekali.

**Langkah 1 — Unduh & install aplikasi desktop**
1. Buka halaman [Releases](https://github.com/valency-studio/ZeroScript/releases/latest).
2. Unduh installer untuk sistem operasimu (`<arch>` = `x64`/`aarch64` sesuai prosesormu):
   - **Windows** → `ZeroScript_<versi>_x64-setup.exe`
   - **macOS** → `ZeroScript_<versi>_<arch>.dmg`
   - **Linux** → `ZeroScript_<versi>_amd64.AppImage` (atau `.deb`)
3. Install seperti biasa, lalu buka aplikasi **ZeroScript**.
4. Di dashboard, klik **Start Bridge** — atau aktifkan *auto-start* di menu Settings.

**Langkah 2 — Muat ekstensi di browser**
1. Unduh `ZeroScript-extension-<versi>.zip` dari halaman Releases, lalu **ekstrak**.
2. Buka `chrome://extensions` (atau `edge://extensions`) di Chrome/Edge/Brave.
3. Aktifkan **Developer mode** (pojok kanan atas).
4. Klik **Load unpacked** → pilih folder hasil ekstrak (folder yang berisi `manifest.json`).
5. Ekstensi muncul dengan nama **BetterScript Studio × Roblox Agent** — itu branding lama,
   tetap ZeroScript. ✅

**Langkah 3 — Aktifkan MCP di Roblox Studio**
1. Buka Roblox Studio dan buka salah satu **place** milikmu.
2. Buka `Assistant Settings → MCP Servers`.
3. Aktifkan **"Studio as MCP server"** (nyalakan toggle-nya).

**Langkah 4 — Mulai pakai! 🎉**
1. Buka salah satu [situs AI yang didukung](#situs-ai-yang-didukung).
2. Klik tombol **Start Roblox Agent** di toolbar ZeroScript.
3. Coba minta: *"Buatkan part merah di tengah workspace"* — dan lihat AI mengerjakannya!

> ✅ Jika bridge menampilkan `Roblox Studio connected - N tools ready`, semuanya berfungsi.

### Opsi B — Manual (tanpa installer, butuh Python)

Cocok untuk kamu yang suka menjalankan langsung dari source.

```bash
# 1. Clone repository
git clone https://github.com/valency-studio/ZeroScript.git
cd ZeroScript

# 2. Install dependency bridge (hanya butuh websockets)
pip install websockets

# 3. Jalankan bridge
python bridge.py          # Windows
# atau
bash MacOS_Start.command  # macOS / Linux
```

> ⚠️ **Jangan tutup terminal bridge** selama digunakan — cukup minimalkan.
> Jangan jalankan `start.bat` langsung dari dalam file ZIP (ekstrak dulu).

Selanjutnya ikuti **Langkah 2–4** dari Opsi A (muat ekstensi → aktifkan MCP → mulai pakai).

---

## Bagaimana ZeroScript Bekerja

ZeroScript terdiri dari tiga komponen yang bekerja bersama:

| Komponen | Peran |
|---|---|
| 🌐 **Ekstensi Browser** | Menyuntikkan agent ke situs AI chat; menampilkan status & hasil tool sebagai interactive chips. |
| ⚙️ **Bridge** | Server lokal (`ws://127.0.0.1:17613`) yang menjalankan MCP server, menggabungkan tools, dan merutekan perintah. |
| 🎮 **Roblox Studio MCP** | Jembatan ke Studio (StudioMCP bawaan atau custom) agar AI bisa menyentuh place-mu. |

**Alur komunikasi:**

```text
┌─────────────────────┐      ┌──────────────────────┐
│   AI Chat Site      │      │    Roblox Studio     │
│ ChatGPT · Claude ·  │◀────▶│    Game / Place      │
│ DeepSeek · Gemini   │      └──────────┬───────────┘
└─────────┬───────────┘                 ▲
          │ WebSocket 127.0.0.1:17613   │ MCP / stdio
          ▼                             │
┌─────────────────────┐      ┌──────────┴───────────┐
│  Bridge (lokal)     │──────▶  StudioMCP / custom  │
└─────────────────────┘      └──────────────────────┘
```

Saat kamu menekan **Start Roblox Agent**, AI di chat:
1. Menerima system prompt ZeroScript.
2. Menentukan tindakan yang dibutuhkan (misal: membuat part).
3. Menghasilkan perintah ZeroScript.
4. Menjalankan MCP tool di Studio.
5. Menerima hasil tool & melanjutkan reasoning — hingga selesai.

---

## Fitur Utama

**🤖 Kontrol Roblox Studio real-time**
Buat & modifikasi objek, tulis dan jalankan script Luau (`execute_luau`), baca info place,
dan ambil screenshot Studio — semuanya dari chat.

**🌐 30+ situs AI chat**
ChatGPT, DeepSeek, Claude, Gemini, Kimi, GLM, Qwen, Grok, Copilot, Perplexity, Mistral,
Poe, HuggingChat, dan banyak lagi. [Lihat daftar lengkap](#situs-ai-yang-didukung).

**🔄 Agentic Loop**
AI bisa mengerjakan pekerjaan kompleks **bertahap** di dalam chat: reasoning → eksekusi →
melihat hasil → lanjut, dengan hasil tool ditampilkan sebagai **interactive chips**.

**🧠 Generic Mode**
Situs AI-mu belum didukung? Aktifkan Generic Mode untuk mencoba pada situs AI mana pun.

**🧩 MCP Server Eksternal**
Tambahkan server MCP lain (Blender, filesystem, database, custom) lewat UI ekstensi
atau menu *MCP Servers* di aplikasi desktop — berjalan berdampingan dengan Roblox MCP.

**🛡️ Automatic Recovery**
Restart otomatis saat MCP server crash, pembersihan zombie `StudioMCP.exe`, deteksi konflik
port (termasuk pembajakan seperti `ropilot`), crash-loop diagnostics, dan auto-reconnect.

**🖥️ Desktop App Modern (Tauri)**
Dashboard status, live logs, manajemen MCP server, autostart, tray icon, dan auto-update —
tanpa jendela terminal. Python & Node.js **tidak perlu diinstal** pengguna.

**⬇️ Auto-update**
Bridge & desktop app memeriksa versi terbaru dari GitHub Releases (default setiap 6 jam).

---

## Situs AI yang Didukung

Mendukung **30+ situs**, antara lain:

ChatGPT · DeepSeek · Claude · Gemini · Kimi · GLM/Z.ai · Qwen · Arena · Meta AI · Grok ·
Copilot · Perplexity · Mistral · Poe · HuggingChat · Pi · You.com · Phind · Blackbox ·
LMSYS · Duck.ai · Groq · Google AI Studio · OpenRouter · Cohere · T3 Chat · Together AI ·
v0 · ClickUp · dan berbagai provider lainnya.

> 💡 Provider lain juga bisa ditambahkan — lihat [Menambahkan Provider Baru](#untuk-pengembang).

---

## Isi Setiap Rilis

Setiap rilis di [GitHub Releases](https://github.com/valency-studio/ZeroScript/releases/latest)
dibangun otomatis oleh GitHub Actions dan berisi:

| Asset | Untuk apa |
|---|---|
| **Aplikasi Desktop (Tauri)** — `ZeroScript_<ver>_x64-setup.exe` · `.dmg` · `.AppImage` / `.deb` | Jalur termudah: GUI modern, bridge tersembunyi, tanpa Python/Node. **Disarankan.** |
| **Paket Klasik** — `ZeroScript-Setup-<ver>.exe` · `ZeroScript-<ver>.dmg` · `.AppImage` + portable `.zip` | Paket bridge mandiri (PyInstaller); ekstensi disertakan di dalam paket **Windows & macOS** (Linux: bridge saja) — untuk yang suka versi lama. |
| **Ekstensi** — `ZeroScript-extension-<ver>.zip` | Ekstensi Chrome standalone untuk di-load unpacked. |

> 💡 Ekstensi **tetap diperlukan** di kedua jalur — desktop app menjalankan & mengawasi
> bridge, bukan menggantikan overlay di situs AI chat.

---

## Troubleshooting (FAQ)

| Gejala | Penyebab / Solusi |
|---|---|
| 🔴 **0 tools / Studio tidak terhubung** | Kemungkinan konflik port `13469`: periksa `StudioMCP.exe` lama atau aplikasi lain (mis. `ropilot`). Pastikan MCP server di Studio aktif. |
| 🟡 **Studio terputus setelah update Roblox Studio** | Studio kadang menonaktifkan MCP setelah update. Buka `Assistant Settings → MCP Servers`, toggle MCP **OFF → ON**. |
| 🟠 **Port `17613` sudah digunakan** | Bridge lama masih berjalan. Tutup, lalu jalankan ulang bridge / `start.bat`. |
| ⚫ **Bridge offline di ekstensi** | Pastikan bridge masih berjalan (dashboard desktop: hijau / terminal tidak tertutup). Cek `logs/start.log`. |
| ❌ **`no Studio instance`** | Studio tertutup, place belum dibuka, atau MCP server belum aktif. |
| ❌ **Tool call tidak berjalan** | Pastikan tombol **Start Roblox Agent** sudah ditekan dan koneksi bridge aktif. |
| 🪟 **SmartScreen / Gatekeeper memperingatkan** | Aplikasi belum ditandatangani: Windows klik *More info → Run anyway*; macOS klik kanan → *Open* pada kali pertama. |

### 🔴 ACTION NEEDED

Jika bridge mendeteksi masalah MCP, kamu akan melihat banner merah **ACTION NEEDED** di
Logs (desktop) atau terminal. Ikuti instruksinya sebelum mencoba lagi.

---

## Log dan Debugging

Semua log tersimpan di folder data ZeroScript:

| OS | Lokasi |
|---|---|
| Windows | `%APPDATA%\com.zeroscript.desktop\logs\` |
| macOS | `~/Library/Application Support/com.zeroscript.desktop/logs/` |
| Linux | `~/.local/share/com.zeroscript.desktop/logs/` |

- `logs/start.log` — log launcher.
- `logs/bridge_debug.log` — log detail bridge (append-only).

Saat melaporkan bug, sertakan: screenshot status, isi log yang relevan, versi ZeroScript,
versi Roblox Studio, dan situs AI yang dipakai.

---

## Untuk Pengembang

### Struktur Proyek

```text
├── bridge.py                  # WebSocket bridge (Python, ws://127.0.0.1:17613)
├── launch_studio_mcp.py       # Pencari StudioMCP.exe terbaru
├── config.json                # Daftar MCP server (primary 'roblox' dilindungi)
├── zeroscript-extension/      # Ekstensi Chrome MV3 (tanpa bundler)
│   ├── core/                  #   config, parser, agent loop (provider-agnostic)
│   ├── providers/             #   satu file per situs AI (kimi.js = referensi)
│   └── test-parser.js         #   smoke test parser
└── zeroscript-desktop/        # Desktop GUI (Tauri 2 + Vite + TypeScript)
    └── src-tauri/             #   backend Rust: sidecar bridge, tray, autostart
```

### Menambahkan Provider AI Baru

Sinkronkan **empat tempat** berikut (grep `"Keep in sync"` untuk daftar lain yang mirip):

1. `manifest.json` — tambahkan `content_scripts` **dan** `host_permissions`.
2. `background.js` — tambahkan pola URL ke `PROVIDER_URLS` (dan `KNOWN_EXCLUDE` bila perlu).
3. `core/main.js` — entri `AI_SITES` (nama harus sama dengan `displayName` provider).
4. Buat `providers/<situs>.js` — tiru `providers/kimi.js` (pola global `ZSProvider`).

### Protokol Perintah (Parser)

Model AI mengeluarkan dua format yang diparsing di `core/parser.js`:

```text
###LUA###
print("Hello from ZeroScript")
###END_LUA###
```

Scope opsional: `###LUA###:Edit` (default) · `###LUA###:Client` · `###LUA###:Server`.
Semua blok `###LUA###` dipetakan ke `execute_luau`.

```json
{
  "command": "create_part",
  "params": { "name": "MyPart" }
}
```

### Menjalankan Test

```bash
cd zeroscript-extension
node test-parser.js      # satu-satunya automated test (smoke test parser)
```

### Build Desktop GUI (dev)

```bash
cd zeroscript-desktop
npm install
npm run prepare:sidecars:stub   # placeholder; jalankan `python bridge.py` terpisah
npm run tauri dev
```

### Mengubah Port Bridge

```bash
ZS_BRIDGE_PORT=17614 python bridge.py    # macOS/Linux
# $env:ZS_BRIDGE_PORT="17614"; python bridge.py   # PowerShell
```

> ⚠️ Jika port bridge diubah, sinkronkan juga `PORT` di `background.js`.

---

## Lisensi

**MIT License** — gratis digunakan, dimodifikasi, dan didistribusikan dengan atribusi.

```text
MIT License
Copyright (c) 2026 Rizki Kotet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Kredit dan Kontribusi

**ZeroScript** adalah proyek modernisasi yang terinspirasi dan dikembangkan berdasarkan
kode sumber proyek asli:

- **ZeroScript-Free by sebattfg** → https://github.com/sebattfg/ZeroScript-Free

Kontribusi sangat terbuka:
- 🐛 Temukan bug? Buat [Issue](https://github.com/valency-studio/ZeroScript/issues).
- 🚀 Punya ide fitur? Buka Issue atau ajukan **Pull Request** (jelaskan perubahan,
  sertakan langkah reproduksi & testing).

---

## Support

Jika ZeroScript membantu workflow development Roblox-mu, berikan ⭐ pada repository ini
dan dukung pengembangan di [Trakteer](https://trakteer.id/rtaserver).

**ZeroScript — Connect AI to Roblox Studio.**
