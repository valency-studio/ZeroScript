# Changelog

Riwayat perubahan ZeroScript. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/).

Versi yang tidak terdokumentasi di sini tidak disebutkan — riwayat rilis lengkap sebelum versi terbaru tidak tersedia di repo (tidak ada tag/riwayat commit).

## [Unreleased]

### Added
- POPUP: latar belakang popup menggunakan `assets/background.png` (dengan lapisan penggelap transparan agar teks tetap terbaca).
- Tema **crimson** di seluruh UI (popup + UI dalam halaman): stripe, badge versi, tombol Start, tag menu/setup, sorotan situs aktif, focus ring — termasuk varian light mode.

### Changed
- README.md lengkap dan AGENTS.md (instruksi untuk pengembang yang bekerja di repo ini).

## 2.4.0 — Ekstensi (rilis terbaru)

Dikutip dari `manifest.json` `description` + verifikasi kode:

### Added
- Dukungan **ClickUp AI** (`providers/clickup.js`) — preferensi mode Brain2 / Super Agents.
- **Effect suara selesai** ("done SFX") saat loop agen selesai.
- Mode **ForgeGUI / Make UI**.
- **Animasi kit lanjutan**.
- Launcher **macOS** (`MacOS_Start.command`).

### Fixed
- Stabilitas loop agen (loop stability).

## Bridge 1.5.0 — `bridge.py`

### Added
- Pembersihan otomatis **zombie `StudioMCP.exe`** yang menahan port 13469 (menyebabkan status "Studio connected" palsu) — hanya jika tidak ada Studio asli yang berjalan.
- Penanganan **penyabot port** (mis. ropilot): bukti pembajakan dari stderr anak, bunuh otomatis + petunjuk cara mencegahnya muncul lagi.
- **Crash-loop forensics**: banner merah saat MCP server mati berulang — menampilkan exit code, baris stderr terakhir, dan siapa yang menempati port.
- Peluncuran **paralel** semua MCP server (server lambat tidak menahan server lain).
- Tool call dijalankan sebagai **task latar** sehingga ping/status tetap terlayani selama tool lama berjalan.
- Status Studio **dua tingkat**: aplikasi terhubung vs. place benar-benar terbuka (`list_roblox_studios` + `get_studio_state`), dengan konfirmasi-ulang sebelum meyakini transisi.
- **Auto-recovery**: proxy di-restart pada putus sambung berkelanjutan (bug StudioMCP yang dikenal), dengan panduan "toggle MCP" bila Studio berjalan tetapi tidak terdaftar.
- Banner awal "ACTION NEEDED" (kotak merah) yang muncul segera, tanpa menunggu grace loop 48 detik.
- Tambah/hapus MCP server tambahan dari ekstensi (config.json ditulis ulang, bridge restart sendiri); server utama `roblox` dilindungi.
- `broadcast_status` dipusatkan ke semua tab yang terhubung setelah perubahan status.

### Changed
- Log per-call dipindahkan ke `logs/bridge_debug.log` (append-only) — terminal tetap hanya menampilkan hal yang perlu dibaca.
- Warna ANSI "action" menjadi putih di atas latar merah agar langkah pengguna tidak terlewat (bukan kuning).

## Sebelumnya

Versi-versi sebelum 2.4.0 ekstensi / 1.5.0 bridge tidak terdokumentasi. Periksa riwayat tag/rilis di halaman GitHub Releases.