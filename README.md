# ZeroScript

> **💡 Filosofi:** Bayangkan Anda bisa menyuruh ChatGPT, DeepSeek, Claude, atau AI favorit Anda untuk membuat Part, menulis script Luau, mengeksekusi kode, hingga mengambil screenshot di Roblox Studio — cukup melalui situs AI Chat yang biasa Anda gunakan.
>
> **ZeroScript mewujudkannya tanpa proses build yang rumit.**

**ZeroScript** adalah ekosistem yang menghubungkan **AI Chat** dengan **Roblox Studio** melalui **MCP (Model Context Protocol)**.

Dengan ZeroScript, agen AI dapat berinteraksi dengan Roblox Studio secara real-time untuk melakukan berbagai pekerjaan, seperti:

* Membuat dan memodifikasi objek.
* Menulis dan mengedit script Luau.
* Menjalankan `execute_luau`.
* Membaca informasi dari Roblox Studio.
* Mengambil screenshot Studio.
* Menjalankan berbagai MCP tools yang tersedia.
* Menggunakan MCP server tambahan dari pihak ketiga.

---

## 🧩 Arsitektur Sistem

ZeroScript terdiri dari tiga komponen utama yang bekerja bersama:

| Komponen                       | Deskripsi                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🌐 **`zeroscript-extension/`** | Ekstensi Chrome Manifest V3 yang dimuat secara *unpacked*. Menyuntikkan agent ke situs AI Chat yang didukung dan menyediakan UI status serta tool chips.                                         |
| ⚙️ **`bridge.py`**             | WebSocket bridge lokal (`ws://127.0.0.1:17613`) yang mengelola koneksi ekstensi, menjalankan MCP server sebagai proses stdio, menggabungkan tools, dan merutekan perintah berdasarkan nama tool. |
| 🔍 **`launch_studio_mcp.py`**  | Utilitas untuk menemukan `StudioMCP.exe` versi terbaru secara otomatis, termasuk instalasi Roblox Studio melalui Bloxstrap/Fishstrap.                                                            |

### 🔄 Alur Komunikasi

```text
┌─────────────────────┐
│     AI Chat Site    │
│ ChatGPT / Claude /  │
│ DeepSeek / Gemini   │
└──────────┬──────────┘
           │
           │ Browser Extension
           ▼
┌─────────────────────┐
│ ZeroScript Extension│
│      Manifest V3    │
└──────────┬──────────┘
           │
           │ WebSocket
           │ 127.0.0.1:17613
           ▼
┌─────────────────────┐
│     bridge.py       │
│   ZeroScript Bridge │
└──────────┬──────────┘
           │
           │ MCP / stdio
           ▼
┌─────────────────────┐
│   StudioMCP.exe     │
│    Roblox Studio    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│    Roblox Studio    │
│      Game / Place   │
└─────────────────────┘
```

---

## ✨ Fitur Unggulan

### 🌐 Dukungan AI Chat

Mendukung **30+ situs AI Chat**, termasuk:

* ChatGPT
* DeepSeek
* Claude
* Gemini
* Kimi
* GLM / Z.ai
* Qwen
* Arena
* Meta AI
* Grok
* Copilot
* Perplexity
* Mistral
* Poe
* HuggingChat
* Pi
* You.com
* Phind
* Blackbox
* LMSYS
* Duck.ai
* Groq
* Google AI Studio
* OpenRouter
* Cohere
* T3 Chat
* Together AI
* v0
* ClickUp
* Dan berbagai provider lainnya.

### 🧠 Generic Mode

Tidak menemukan situs AI yang Anda gunakan?

Aktifkan **Generic Mode** untuk mencoba menggunakan ZeroScript pada situs AI yang belum memiliki provider resmi.

### 🔄 Agentic Loop

ZeroScript menyediakan **agentic loop langsung di dalam chat**.

Model AI dapat:

1. Menerima system prompt ZeroScript.
2. Menentukan tindakan yang diperlukan.
3. Menghasilkan perintah ZeroScript.
4. Menjalankan MCP tool.
5. Menerima hasil tool.
6. Melanjutkan reasoning dan tindakan berikutnya.
7. Menampilkan hasil tool sebagai **interactive chips** di dalam chat.

Dengan demikian, AI dapat melakukan pekerjaan kompleks secara bertahap tanpa pengguna harus menjalankan setiap perintah secara manual.

### 🛡️ Automatic Recovery

ZeroScript memiliki berbagai mekanisme recovery:

* MCP server otomatis di-restart ketika crash.
* Tool call yang terputus dapat dicoba kembali.
* Zombie `StudioMCP.exe` dapat dibersihkan.
* Konflik port dapat dideteksi.
* Port yang dibajak oleh aplikasi lain, seperti `ropilot`, dapat diidentifikasi.
* Bridge memiliki crash-loop diagnostics.
* Koneksi WebSocket menggunakan mekanisme auto-reconnect.

### 🧩 External MCP Servers

ZeroScript dapat menggunakan MCP server tambahan.

Server eksternal dapat:

* Ditambahkan melalui UI ekstensi.
* Dihapus melalui UI ekstensi.
* Dikelola melalui konfigurasi ZeroScript.
* Berjalan bersamaan dengan MCP server Roblox.

Contoh penggunaan:

```text
ZeroScript
├── Roblox MCP
├── Blender MCP
├── File System MCP
├── Database MCP
└── Custom MCP
```

### ⬇️ Automatic Update

ZeroScript secara berkala memeriksa versi terbaru melalui **GitHub Releases**.

Interval pemeriksaan default:

```text
Every 6 hours
```

### 💻 Cross-Platform Launcher

Launcher tersedia untuk:

* **Windows** — `start.bat`
* **macOS/Linux** — `MacOS_Start.command`

Launcher secara otomatis membantu:

* Menemukan Python.
* Memastikan dependency tersedia.
* Menginstal `websockets` jika diperlukan.
* Membersihkan bridge lama.
* Menangani port `17613`.
* Menjalankan `bridge.py`.

---

## 📋 Persyaratan Sistem

### Browser

Browser berbasis Chromium yang mendukung ekstensi Manifest V3:

* Google Chrome
* Microsoft Edge
* Brave
* Chromium
* Browser Chromium lainnya

Ekstensi saat ini dimuat menggunakan mode **Load unpacked**.

### Python

Diperlukan:

```text
Python 3.9+
pip
```

### Roblox Studio

Roblox Studio harus memiliki MCP server yang aktif.

Buka:

```text
Assistant Settings
    └── MCP Servers
        └── Enable "Studio as MCP server"
```

Pastikan **place sudah terbuka** sebelum menggunakan ZeroScript.

---

# 🚀 Instalasi

## 1. Unduh ZeroScript

Unduh repository atau release ZeroScript, kemudian ekstrak seluruh folder ke lokasi permanen.

> ⚠️ **Jangan menjalankan `start.bat` langsung dari dalam file ZIP.**

Contoh:

```text
C:\Tools\ZeroScript\
```

atau:

```text
~/Applications/ZeroScript/
```

---

## 2. Jalankan Bridge

### Windows

Jalankan:

```text
start.bat
```

### macOS / Linux

Jalankan:

```text
MacOS_Start.command
```

Launcher akan membantu:

1. Mendeteksi Python 3.9+.
2. Memastikan `pip` tersedia.
3. Menginstal dependency `websockets`.
4. Membersihkan bridge lama jika diperlukan.
5. Memastikan port `17613` tersedia.
6. Menjalankan `bridge.py`.

> ⚠️ **Penting:** Jangan menutup terminal bridge selama ZeroScript digunakan. Jika terminal ditutup, bridge juga akan berhenti.

Anda cukup meminimalkan terminal tersebut.

---

## 3. Aktifkan Roblox Studio MCP

Buka Roblox Studio dan pastikan place sudah terbuka.

Kemudian buka:

```text
Assistant Settings
    → MCP Servers
    → Enable "Studio as MCP server"
```

Pastikan MCP server berhasil aktif.

---

## 4. Install Browser Extension

Buka:

```text
chrome://extensions
```

Kemudian:

1. Aktifkan **Developer mode**.
2. Klik **Load unpacked**.
3. Pilih folder:

```text
zeroscript-extension/
```

Chrome akan memuat ekstensi ZeroScript.

---

## 5. Mulai ZeroScript Agent

Buka salah satu situs AI Chat yang didukung.

Kemudian klik:

```text
Start Roblox Agent
```

pada toolbar ZeroScript.

Jika Roblox Studio berhasil terhubung, bridge akan menampilkan status seperti:

```text
Roblox Studio connected - N tools ready
```

🎉 ZeroScript siap digunakan.

---

# 🛠️ Troubleshooting

| Gejala                                              | Penyebab / Solusi                                                                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 **0 tools / Studio tidak terhubung**             | Kemungkinan terdapat konflik pada port `13469`. Periksa apakah ada `StudioMCP.exe` lama atau aplikasi pihak ketiga seperti `ropilot` yang menggunakan port tersebut. Pastikan MCP server di Roblox Studio aktif. |
| 🟡 **Studio terputus setelah update Roblox Studio** | Roblox Studio terkadang menonaktifkan MCP setelah update. Buka `Assistant Settings → MCP Servers`, kemudian toggle MCP **OFF → ON**.                                                                             |
| 🟠 **Port `17613` sudah digunakan**                 | Kemungkinan bridge lama masih berjalan. Jalankan kembali `start.bat`, atau cari proses yang menggunakan port tersebut melalui `netstat -ano \| findstr 17613`.                                                   |
| ⚫ **Bridge offline di ekstensi**                    | Pastikan terminal bridge masih berjalan dan tidak mengalami crash. Periksa `logs/start.log` dan `logs/bridge_debug.log`.                                                                                         |
| ❌ **`no Studio instance`**                          | Roblox Studio tertutup, place belum terbuka, atau MCP server belum aktif.                                                                                                                                        |
| ❌ **Tool call tidak berjalan**                      | Pastikan agent sudah diaktifkan melalui tombol **Start Roblox Agent** dan koneksi bridge masih aktif.                                                                                                            |

### 🔴 ACTION NEEDED

Jika bridge mendeteksi masalah MCP, terminal akan menampilkan banner:

```text
ACTION NEEDED
```

Ikuti instruksi yang diberikan bridge sebelum mencoba menjalankan agent kembali.

---

## 📄 Log & Debugging

Semua log tersedia di:

```text
logs/
├── start.log
└── bridge_debug.log
```

`bridge_debug.log` menggunakan mode **append-only** untuk mempertahankan riwayat debugging.

### 🐛 Melaporkan Bug

Saat melaporkan bug, sertakan:

1. Screenshot seluruh jendela terminal bridge.
2. Screenshot Roblox Studio jika berkaitan dengan MCP.
3. Screenshot UI ZeroScript jika berkaitan dengan ekstensi.
4. Isi log yang relevan dari:

   * `logs/start.log`
   * `logs/bridge_debug.log`
5. Versi ZeroScript.
6. Versi Roblox Studio.
7. Situs AI Chat yang digunakan.

Semakin lengkap informasi yang diberikan, semakin mudah masalah direproduksi dan diperbaiki.

---

# 💻 Development

## Struktur Ekstensi

```text
zeroscript-extension/
├── manifest.json
│
├── background.js
│   └── Service worker
│       ├── WebSocket connection
│       ├── Auto reconnect
│       └── Provider URL routing
│
├── core/
│   ├── config.js
│   │   └── System prompt, feedback,
│   │       tool categories, configuration
│   │
│   ├── parser.js
│   │   └── ZeroScript command parser
│   │
│   └── main.js
│       └── Agent loop & ZeroScript UI
│
├── providers/
│   ├── chatgpt.js
│   ├── claude.js
│   ├── deepseek.js
│   ├── kimi.js
│   └── ...
│
├── overlay.css
│   └── ZeroScript UI styling
│
└── test-parser.js
    └── Parser smoke tests
```

### Prinsip Arsitektur

ZeroScript memisahkan tanggung jawab antara:

* **Core**
* **Provider**
* **Background service**
* **UI**
* **Parser**
* **Bridge**

Provider AI tidak seharusnya mencampurkan logic inti ZeroScript.

---

# 🧪 Testing

Untuk menjalankan smoke test parser:

```bash
cd zeroscript-extension
node test-parser.js
```

---

# ⚙️ Menjalankan Bridge Secara Manual

Install dependency:

```bash
pip install websockets
```

Kemudian jalankan:

```bash
python bridge.py
```

Bridge secara default menggunakan:

```text
ws://127.0.0.1:17613
```

---

## 🔧 Mengubah Port Bridge

Port dapat dikustomisasi menggunakan environment variable:

```text
ZS_BRIDGE_PORT
```

Contoh:

### Windows PowerShell

```powershell
$env:ZS_BRIDGE_PORT="17614"
python bridge.py
```

### Linux / macOS

```bash
ZS_BRIDGE_PORT=17614 python bridge.py
```

> ⚠️ Jika port bridge diubah, pastikan konfigurasi port pada `background.js` juga diperbarui agar extension tetap dapat terhubung ke bridge.

---

# 🌐 Menambahkan Provider AI Baru

ZeroScript menggunakan sistem provider untuk menangani perbedaan struktur setiap situs AI.

Setiap provider harus mengekspos:

```javascript
ZSProvider
```

Provider kemudian dimuat dalam urutan:

```text
core/config.js
      ↓
core/parser.js
      ↓
providers/<site>.js
      ↓
core/main.js
      ↓
overlay.css
```

## Langkah Menambahkan Provider

Untuk menambahkan situs AI baru, sinkronkan **empat bagian** berikut:

### 1. `manifest.json`

Tambahkan:

* `content_scripts`
* `host_permissions`

### 2. `background.js`

Tambahkan pola URL ke:

```javascript
PROVIDER_URLS
```

dan jika diperlukan:

```javascript
KNOWN_EXCLUDE
```

### 3. `core/main.js`

Tambahkan situs ke:

```javascript
AI_SITES
```

Nama situs harus konsisten dengan:

```javascript
displayName
```

pada provider.

### 4. Buat Provider

Buat file:

```text
providers/<site>.js
```

Gunakan:

```text
providers/kimi.js
```

sebagai referensi implementasi.

---

# 📡 ZeroScript Command Protocol

Parser ZeroScript mendukung dua format utama.

## Luau Execution

Format:

```text
###LUA###
print("Hello from ZeroScript")
###END_LUA###
```

Secara default, kode akan dijalankan pada:

```text
Edit
```

Scope dapat ditentukan secara eksplisit:

```text
###LUA###:Edit
...
###END_LUA###
```

```text
###LUA###:Client
...
###END_LUA###
```

```text
###LUA###:Server
...
###END_LUA###
```

Semua blok `###LUA###` dipetakan ke:

```text
execute_luau
```

---

## JSON Command

Format:

```json
{
  "command": "command_name",
  "params": {}
}
```

Contoh:

```json
{
  "command": "create_part",
  "params": {
    "name": "MyPart"
  }
}
```

Command akan diteruskan berdasarkan nama tool yang tersedia pada MCP server.

---

# 🏗️ Development Principles

Kontribusi ke ZeroScript diharapkan mengikuti prinsip berikut:

* **Modular**
* **Maintainable**
* **Readable**
* **Testable**
* **Provider-agnostic**
* **Error-resilient**
* **Backward-compatible** jika memungkinkan
* Hindari coupling antara provider dan core.
* Hindari manipulasi DOM situs AI dari modul core.
* Jangan menambahkan dependency tanpa alasan yang jelas.
* Perubahan besar harus disertai dokumentasi dan testing yang sesuai.

---

# 📜 License

ZeroScript dilisensikan di bawah:

**MIT License**

Lihat file:

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

untuk informasi lengkap mengenai ketentuan lisensi.

---

# 🙏 Credits

**ZeroScript** merupakan proyek improvisasi dan modernisasi yang terinspirasi serta dikembangkan berdasarkan kode sumber proyek asli:

**ZeroScript-Free by sebattfg**

Repository:

https://github.com/sebattfg/ZeroScript-Free

---

# 🤝 Contributing

Kontribusi sangat terbuka.

Jika menemukan bug, memiliki ide fitur, atau ingin meningkatkan ZeroScript:

* Buat **Issue** untuk bug atau feature request.
* Buat **Pull Request** untuk perubahan kode.
* Jelaskan perubahan yang dilakukan.
* Sertakan langkah reproduksi untuk bug.
* Sertakan testing yang relevan jika memungkinkan.

---

## ⭐ Support

Jika ZeroScript membantu workflow development Roblox Anda, pertimbangkan untuk memberikan ⭐ pada repository ini.

**ZeroScript — Connect AI to Roblox Studio.**
