# Design: App Background Icon Watermark (Dark Transparent)

Date: 2026-08-08
Status: Approved by user
Scope: ZeroScript Desktop (Tauri v2 + Vite + TypeScript)

## Goal

Setelah ikon aplikasi diseragamkan ke `assets/icon-1024.png` (diserve di
`/icon-1024.png` via `publicDir: "assets"` di `vite.config.ts`), icon tadi
hanya tampil sebagai *mark* di sidebar dan hero About. Pengguna ingin icon
yang sama juga menjadi **background halus di seluruh aplikasi**, dengan
nuansa "gelap transparan" agar konten tetap terbaca.

## Keputusan yang Disepakati (hasil brainstorming)

- **Cakupan**: satu layer background di belakang seluruh UI — sidebar dan
  semua view (dashboard, logs, servers, settings, about) sama-sama
  memperlihatkan watermark secara samar.
- **Gaya: tengah samar (centered watermark)** — icon besar di tengah,
  opacity rendah, ditimpa scrim gelap radial.
- **Ketentuan gelap-transparan**: overlay gelap + icon pudar sehingga teks
  tetap kontras di semua posisi.

## Desain

### 1. DOM (`zeroscript-desktop/index.html`)

Tambahkan satu layer di dalam `.app`, sebelum `<aside>` dan `<main>`:

```html
<div class="app-bg" aria-hidden="true">
  <img src="/icon-1024.png" alt="" aria-hidden="true" />
</div>
```

### 2. CSS (`zeroscript-desktop/src/styles.css`)

- `.app-bg`:
  - `position: fixed; inset: 0; z-index: 0;`
  - `overflow: hidden; pointer-events: none;`
  - Background `radial-gradient` gelap pekat di tepi, sedikit lebih terang
    di tengah, sebagai scrim pendukung keterbacaan.
- `.app-bg img`:
  - `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);`
  - `width: min(70vh, 60vw); height: auto; opacity: 0.12;`
  - `object-fit: contain;`
- `.sidebar` dan `.main` diberi `position: relative; z-index: 1;` sehingga
  berada di atas layer background (periksa nilai `z-index` yang sudah ada
  dan pilih nilai tidak bertabrakan).
- Sidebar tetap memakai lapisan glass (blur + transparan) — watermark akan
  tembus samar, sesuai keinginan pengguna.

### Perilaku

- Murni dekoratif: `aria-hidden` + `pointer-events: none`; tidak menerima
  interaksi dan tidak dibaca screen reader.
- Gambar statis, sekali dimuat dari `dist/` — tanpa perubahan JavaScript
  runtime, tanpa state baru.

## Out of Scope

- Ikon window/tray/installer — sudah benar.
- Tanpa animasi/parallax.
- Tidak mengubah tema warna atau struktur view.

## Verifikasi

1. `npm run build` (tsc + vite build) lulus tanpa error.
2. `dist/icon-1024.png` tetap ada dan `dist/index.html` memuat elemen
   `.app-bg`.
3. Window ukuran minimum (780x520) tetap rapi — watermark tengah tidak
   perlu khawatir terpotong aneh.

## Files

- `zeroscript-desktop/index.html` — menyisipkan div `.app-bg`.
- `zeroscript-desktop/src/styles.css` — block `.app-bg` (+ sentuhan
   `z-index` bila diperlukan).