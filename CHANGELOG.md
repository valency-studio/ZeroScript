# Changelog

Semua perubahan penting pada **ZeroScript** didokumentasikan di sini.

Format changelog mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/), dan versi mengikuti [Semantic Versioning](https://semver.org/).

---

## [1.0.3] — Redesktop Desktop GUI

**Desain ulang menyeluruh antarmuka desktop — lebih modern, responsif, dan punya identitas visual tersendiri.**

### Added

* **Peta koneksi animasi di Dashboard**

  * Visualisasi tiga node (AI Chat → ZeroScript Bridge → Roblox Studio) dengan partikel bergerak sepanjang koneksi saat link aktif.
  * Setiap node menyala cyan saat online, redup saat offline.
  * Status bar menampilkan bridge/MCP/place/tools sekilas.

* **Pilihan tema Cyan ↔ Crimson**

  * Toggle di Settings untuk berganti aksen utama antara electric cyan (default) dan crimson.
  * Preferensi disimpan perangkat lokal dan diterapkan sebelum first paint.

* **Tipografi khas**

  * Space Grotesk untuk judul, Inter untuk body, JetBrains Mono untuk data — dipuat dari Google Fonts.

### Changed

* **Palet warna baru**

  * Canvas midnight-navy (`#060a14`) menggantikan dark hangat — terasa seperti command console.
  * Aksen electric cyan (`#22d3ee`) sebagai warna utama — memberi sinyal "data in motion" dan identitas terpisah dari ekstensi browser.
  * Kartu menggunakan glass morphism: semi-transparan dengan `backdrop-filter: blur(12px)`.

* **Sidebar compact**

  * Navigasi lebih rapat dengan accent bar bercahaya pada item aktif.
  * Status dot dengan animasi pulse berwarna.

* **Tombol & micro-interactions**

  * Tombol primary bercahaya cyan, scale kecil saat ditekan.
  * Kartu lift dengan shadow lebih kuat saat hover.
  * Toast dengan indikator ikon (✓ / ✕ / ○).

* **Responsivitas diperbaiki**

  * Sidebar collapse ke ikon di bawah 960px.
  * Peta koneksi stack vertikal di bawah 860px.
  * Grid otomatis single-column di layar kecil.

* **Background watermark lebih terang**

  * Opnais naik dari 0.06 ke 0.12 — lebih terang tapi tetap tidak mengganggu konten.

* **Renderer release notes diperbaiki**

  * Parsing inline (bold, italic, code span, link) sekarang berjalan pada teks raw sebelum HTML escape.
  * Code block di-escape dengan benar — tidak lagi merusak layout.
  * Dukungan ordered list (`1.`, `2.`) dan italic (`*teks*`).

---

## [1.0.1] — Perbaikan Bug

**Perbaikan bug pada tombol Start Bridge di Desktop GUI.**

### Fixed

* **Tombol Start Bridge tidak bisa diklik**

  * Logika `disabled` pada tombol Start Bridge terbalik — tombol justru disabled ketika bridge berhenti.
  * Perbaikan: tombol sekarang enabled ketika bridge berhenti dan tidak sedang busy.
  * Tombol Stop dan Restart tetap berfungsi dengan benar.

---

## [1.0.0] — Rilis Terbaru

**Rilis perdana ZeroScript dengan sistem penomoran versi terpadu.**

Versi ini menyatukan penomoran dari versi sebelumnya, yaitu **Ekstensi 2.4.0** dan **Bridge 1.5.0**, menjadi **ZeroScript 1.0.0**.

### Added

#### Branding & Project

* **Rebranding ke ValencyStudio**

  * Nama dan ikon baru.
  * Penambahan aset `assets/ValencyStudio-*.png`.
  * `GITHUB_URL` diarahkan ke repository `valency-studio/ZeroScript`.
* Dokumentasi awal proyek:

  * `README.md`
  * `CHANGELOG.md`
  * `AGENTS.md`

#### User Interface

* Tema **Crimson** diterapkan secara konsisten di seluruh UI.
* Dukungan tema Crimson untuk **Light Mode**.
* Pembaruan elemen visual:

  * Stripe.
  * Version badge.
  * Start button.
  * Menu dan setup tag.
  * Active-site highlight.
  * Focus ring.
* Popup menggunakan `assets/background.png`.
* Penambahan lapisan overlay transparan pada background untuk meningkatkan keterbacaan teks.

#### AI & Agent

* Dukungan **ClickUp AI**.
* Preferensi mode:

  * **Brain2**
  * **Super Agents**
* Penambahan **Done SFX** ketika agent loop berhasil selesai.
* Penambahan mode **ForgeGUI / Make UI**.
* Penambahan **Advanced Animation Kit**.

#### Platform

* Penambahan launcher untuk **macOS**:

  * `MacOS_Start.command`

---

## Bridge 1.5.0

Bridge `1.5.0` merupakan bagian dari rilis **ZeroScript 1.0.0**.

### Added

#### Process & Port Management

* Pembersihan otomatis proses zombie **`StudioMCP.exe`** yang masih menahan port `13469`.
* Pencegahan status **"Studio connected"** palsu akibat proses MCP yang tertinggal.
* Zombie process hanya dihentikan apabila tidak terdapat Roblox Studio yang benar-benar aktif.
* Deteksi penyalahgunaan atau pembajakan port oleh proses lain, termasuk kasus seperti `ropilot`.
* Analisis stderr dari child process untuk mengidentifikasi proses yang mengambil alih port.
* Proses yang terdeteksi sebagai penyebab konflik port dapat dihentikan secara otomatis.
* Ditambahkan informasi mengenai cara mencegah konflik tersebut terjadi kembali.

#### Crash & Diagnostics

* Penambahan **Crash-loop forensics**.
* Banner merah ditampilkan ketika MCP server mengalami crash berulang.
* Informasi diagnostik mencakup:

  * Exit code.
  * Baris stderr terakhir.
  * Proses yang sedang menggunakan port terkait.

#### MCP Server

* Seluruh MCP server diluncurkan secara **paralel**.
* MCP server yang lambat tidak lagi memblokir server lainnya.
* Dukungan untuk menambah dan menghapus MCP server tambahan langsung dari ekstensi.
* `config.json` diperbarui secara otomatis ketika konfigurasi MCP berubah.
* Bridge melakukan restart otomatis setelah perubahan konfigurasi.
* MCP server utama **`roblox`** dilindungi agar tidak dapat dihapus secara tidak sengaja.

#### Tool Execution

* Tool call dijalankan sebagai **background task**.
* Ping dan status bridge tetap dapat diproses ketika terdapat tool call yang membutuhkan waktu lama.

#### Roblox Studio Connection

* Penambahan sistem status Studio dua tingkat:

  1. Aplikasi Roblox Studio terhubung.
  2. Place benar-benar terbuka dan aktif.
* Menggunakan:

  * `list_roblox_studios`
  * `get_studio_state`
* Transisi status membutuhkan konfirmasi ulang sebelum dianggap valid untuk mengurangi false positive.

#### Auto Recovery

* Proxy dapat melakukan restart otomatis ketika koneksi terputus secara berkelanjutan akibat bug StudioMCP yang telah diketahui.
* Ditambahkan panduan **"toggle MCP"** ketika Roblox Studio sedang berjalan tetapi belum terdaftar oleh bridge.

#### Status Broadcasting

* `broadcast_status` dipusatkan sehingga perubahan status dikirim secara konsisten ke seluruh tab ekstensi yang sedang terhubung.

#### User Feedback

* Penambahan banner awal **"ACTION NEEDED"**.
* Banner menggunakan kotak merah dan muncul segera tanpa menunggu grace loop selama 48 detik.

### Changed

* Log per-call dipindahkan dari terminal ke:

  `logs/bridge_debug.log`

* `bridge_debug.log` menggunakan mode **append-only** untuk mempermudah pemeriksaan riwayat dan debugging.

* Output terminal sekarang difokuskan hanya pada informasi yang penting bagi pengguna.

* Warna ANSI untuk pesan **ACTION** diubah menjadi:

  * Sebelumnya: kuning.
  * Sekarang: putih di atas latar merah.

  Perubahan ini dibuat agar instruksi yang membutuhkan tindakan pengguna lebih mudah terlihat.

### Fixed

* Peningkatan stabilitas **agent loop**.
* Perbaikan masalah loop yang dapat menyebabkan proses agen tidak stabil.
* Peningkatan reliabilitas komunikasi antara ekstensi, bridge, MCP server, dan Roblox Studio.
* Pengurangan false positive pada status koneksi Roblox Studio.

---

## Legacy Versions

Versi sebelum `1.0.0` menggunakan sistem penomoran terpisah:

* **Extension:** `2.4.0`
* **Bridge:** `1.5.0`

Catatan: `BRIDGE_VERSION` di `bridge.py` sebelumnya adalah `1.5.0`, kini disinkronkan menjadi `1.0.1`.

Perubahan dari versi-versi tersebut belum terdokumentasi secara lengkap dalam changelog ini.

Untuk melihat riwayat lengkap versi sebelumnya, perubahan commit, tag, dan release, silakan periksa halaman **GitHub Releases** dan repository ZeroScript.

---

## Versioning

Mulai dari `1.0.0`, versi ZeroScript menggunakan **satu nomor versi terpadu** untuk komponen utama proyek.

Format:

`MAJOR.MINOR.PATCH`

Contoh:

* `1.0.0` — Initial unified release.
* `1.1.0` — Penambahan fitur baru yang kompatibel.
* `1.1.1` — Perbaikan bug tanpa perubahan fitur besar.
* `2.0.0` — Perubahan besar yang dapat memerlukan migrasi atau breaking changes.
