<div align="center">
  <h1>🚀 ZeroScript: AI-to-Studio Control Bridge</h1>
  <p><strong>Kendalikan Roblox Studio sepenuhnya melalui percakapan AI Anda.</strong></p>
  <p>
    <a href="https://github.com/sebattfg/ZeroScript-Free"><img src="https://img.shields.io/badge/Credit-Original%20Project%20(ZeroScript--Free)-blue?style=for-the-badge" alt="Original Project"></a>
    <img src="https://img.shields.io/badge/Platform-Roblox%20Studio-red?style=for-the-badge&logo=roblox" alt="Roblox Studio">
    <img src="https://img.shields.io/badge/Protocol-MCP%20(Model%20Context%20Protocol)-purple?style=for-the-badge" alt="MCP">
    <img src="https://img.shields.io/badge/License-MIT License-success?style=for-the-badge" alt="License">
  </p>
</div>

---

> **💡 Filosofi:** Bayangkan Anda bisa menyuruh ChatGPT, DeepSeek, atau Claude untuk membuat part, menulis script Luau, mengeksekusi kode, hingga mengambil screenshot di Roblox Studio—hanya dengan mengetik di situs chat AI favorit Anda. ZeroScript mewujudkan itu tanpa proses *build* yang rumit.

ZeroScript adalah ekosistem yang menghubungkan situs AI Chat dengan Roblox Studio melalui **MCP (Model Context Protocol)**. Agen AI dapat melakukan *spawning* objek, menulis script Luau, menjalankan `execute_luau`, mengambil screenshot Studio, dan banyak lagi secara real-time.

## 🧩 Arsitektur Sistem

ZeroScript terdiri dari tiga komponen utama yang saling terhubung secara mulus:

| Komponen | Deskripsi |
| --- | --- |
| 🌐 **`zeroscript-extension/`** | Ekstensi Chrome (MV3) yang dimuat secara *unpacked*. Berfungsi menyuntikkan "agen" ke situs AI chat dan menampilkan UI status/chips yang elegan. |
| ⚙️ **`bridge.py`** | Server WebSocket lokal (`ws://127.0.0.1:17613`). Menjalankan MCP server sebagai proses stdio anak, menggabungkan *tool*-nya, dan merutekan perintah berdasarkan nama *tool*. |
| 🔍 **`launch_studio_mcp.py`** | Utilitas pencari otomatis untuk `StudioMCP.exe` versi terbaru (mendukung Bloxstrap/Fishstrap) milik Roblox Studio. |

## ✨ Fitur Unggulan

- **🌐 Dukungan 30+ Situs AI Chat:** DeepSeek, Kimi, ChatGPT, Claude, Gemini, GLM (Z.ai), Qwen, Arena, Meta AI, Grok, Copilot, Perplexity, Mistral, Poe, HuggingChat, Pi, You.com, Phind, Blackbox, LMSYS, Duck.ai, Groq, Google AI Studio, OpenRouter, Cohere, T3 Chat, Together AI, v0, ClickUp, dan lainnya.
- **🧠 Mode Generic:** Aktifkan di pengaturan untuk digunakan di situs AI apa pun yang belum didukung secara resmi.
- **🔄 Agentic Loop In-Chat:** Model AI akan menerima sistem prompt, memancarkan perintah ZeroScript, dan menampilkan hasil *tool* sebagai *chips* yang rapi di dalam balasan chat.
- **🛡️ Penanganan Kegagalan Otomatis:** MCP server yang mati akan di-*restart* otomatis. *Tool call* yang terputus akan dicoba ulang. Port yang dibajak (seperti oleh *ropilot*) akan dideteksi dan dibersihkan.
- **🧩 Dukungan MCP Tambahan:** Tambah atau hapus MCP server eksternal (mis. Blender) langsung melalui menu ekstensi—tanpa perlu mengedit kode!
- **⬇️ Auto-Update:** Pengecekan versi terbaru otomatis dari GitHub Releases (setiap 6 jam).
- **💻 Cross-Platform Launcher:** Tersedia peluncur otomatis untuk **Windows** (`start.bat`) dan **macOS/Linux** (`MacOS_Start.command`).

## 📋 Persyaratan Sistem

- **Browser:** Chrome / Edge / Brave (atau browser Chromium lainnya) — dimuat secara *unpacked*.
- **Python:** Versi **3.9+** (beserta `pip`).
- **Software:** Roblox Studio dengan fitur MCP server aktif: `Assistant Settings → MCP Servers → Enable "Studio as MCP server"`.

## 🚀 Panduan Instalasi & Penggunaan

1. **Unduh & Ekstrak:** Unduh seluruh folder ZIP dan ekstrak di lokasi tetap (Jangan jalankan `start.bat` langsung dari dalam arsip).
2. **Jalankan Bridge:**
   - **Windows:** Jalankan `start.bat`.
   - **macOS/Linux:** Jalankan `MacOS_Start.command`.
   
   *(Launcher akan otomatis mencari Python 3.9+, menginstal `websockets`, membersihkan port 17613, dan menjalankan `bridge.py`)*.
   > ⚠️ **Catatan:** Jangan tutup jendela terminal yang terbuka. Bridge akan berhenti berjalan jika terminal ditutup. Cukup minimalkan saja.
3. **Siapkan Roblox Studio:** Buka Studio, pastikan *place* sudah terbuka, dan aktifkan `Assistant Settings → MCP Servers → "Enable Studio as MCP server"`.
4. **Muat Ekstensi:**
   - Buka `chrome://extensions` di browser Anda.
   - Aktifkan **Developer mode** (Mode pengembang) di kanan atas.
   - Klik **Load unpacked** (Muat yang belum dikemas) → Pilih folder `zeroscript-extension`.
5. **Mulai Beraksi:** Buka situs AI chat yang didukung, lalu klik tombol **Start Roblox agent** di *toolbar* ZeroScript.

🎉 Terminal bridge akan berubah **hijau** saat Studio terhubung (`Roblox Studio connected - N tools ready`).

## 🛠️ Pemecahan Masalah (Troubleshooting)

| Gejala | Solusi & Penyebab Umum |
| --- | --- |
| 🔴 **0 tools / Status tidak pernah terhubung** | Konflik port 13469. Sisa `StudioMCP.exe` dari sesi lama, atau aplikasi pihak ketiga (seperti *ropilot*) menempati port. Pastikan panel MCP di Studio sudah terbuka. Bridge akan menampilkan kotak merah "ACTION NEEDED" di terminal. |
| 🟡 **Studio terputus setelah update** | Studio sering mematikan toggle MCP sendiri pasca-update. Buka `Assistant Settings → MCP Servers`, lalu toggle **OFF** dan **ON** kembali. |
| 🟠 **Port 17613 sudah dipakai** | Bridge lama masih berjalan di latar belakang. Jalankan ulang `start.bat` (launcher akan membunuh proses lama otomatis), atau jalankan `taskkill /F /PID <pid>` setelah mengecek via `netstat -ano \| findstr 17613`. |
| ⚫ **"Bridge offline" di ekstensi** | Pastikan terminal bridge tidak *crash* atau tertutup. Cek log di `logs/start.log` dan `logs/bridge_debug.log`. |
| ❌ **Tool call gagal: "no Studio instance"** | Studio tertutup, *place* belum dibuka, atau toggle MCP mati. Ini adalah masalah lingkungan lokal, bukan bug ekstensi. |

> 📄 **Log Lengkap:** Tersimpan di folder `logs/` (`bridge_debug.log` bersifat *append-only*). Saat melaporkan *bug*, mohon sertakan **screenshot seluruh jendela terminal** agar kami bisa menganalisisnya.

## 💻 Pengembangan (Development)

Struktur direktori ekstensi:

```text
zeroscript-extension/
├── manifest.json        # Daftar content_scripts + host_permissions
├── background.js        # Service worker: koneksi WebSocket tunggal + auto-reconnect
├── core/
│   ├── config.js        # Sistem prompt, feedback, kategori tool (provider-agnostic)
│   ├── parser.js        # Parser perintah ZeroScript (Logika string murni, tanpa DOM)
│   └── main.js          # Loop agen + UI (TIDAK boleh menyentuh DOM situs host)
├── providers/*.js       # Script per situs AI (interface ZSProvider)
├── overlay.css          # Styling UI (bar, chips, menu)
└── test-parser.js      # Smoke test parser
```

### Perintah Terminal

```bash
# Jalankan smoke test parser
cd zeroscript-extension
node test-parser.js

# Jalankan bridge secara manual (Windows/macOS/Linux)
pip install websockets
python bridge.py
```
*Note:* Environment variable `ZS_BRIDGE_PORT` dapat digunakan untuk mengganti port default (17613). Pastikan juga mengubah `PORT` di `background.js` jika port diubah.

### Menambahkan Dukungan Situs AI Baru

Setiap `providers/<situs>.js` harus mengekspos global `ZSProvider`. Content script dimuat dalam urutan: `core/config.js` → `core/parser.js` → `providers/<situs>.js` → `core/main.js` + `overlay.css`. 

Untuk menambah situs baru, sinkronkan **4 tempat** berikut:
1. `manifest.json` — Tambahkan entri `content_scripts` dan `host_permissions`.
2. `background.js` — Tambahkan pola URL ke `PROVIDER_URLS` dan `KNOWN_EXCLUDE`.
3. `core/main.js` — Tambahkan entri `AI_SITES` (nama harus sama dengan `displayName` provider).
4. Buat file `providers/<situs>.js` baru (Gunakan `kimi.js` sebagai referensi terbaik).

**Format Perintah Parser** (Didefinisikan di `core/config.js`):
- `###LUA### … ###END_LUA###` (Opsional: `:Edit|:Client|:Server`, default: Edit)
- JSON: `{"command": …, "params": {…}}`
- `###LUA###` selalu dipetakan ke fungsi `execute_luau`.

## 📜 Lisensi & Kredit

Proyek ini dilisensikan di bawah **[MIT License](LICENSE)**.

**ZeroScript** adalah proyek improvisasi dan modernisasi yang terinspirasi dan berdasarkan kode sumber dari proyek asli:
👉 **[ZeroScript-Free by sebattfg](https://github.com/sebattfg/ZeroScript-Free)**

Terkait pengembangan, pelaporan bug, atau kontribusi lebih lanjut, silakan buka *issue* atau *pull request* di repositori ini.