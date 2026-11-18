# 🌊 SIMBA — Sistem Informasi & Monitoring Banjir Berbasis IoT SCADA

Sistem monitoring tinggi muka air (TMA) dan peringatan dini banjir (*Early Warning System*) berbasis **Internet of Things (IoT)**, telemetri real-time **SCADA**, dan integrasi kecerdasan buatan (**AI Predictive Evacuation**).

---

## 📁 Struktur Repositori & Pemisahan Tim (Frontend vs Backend)

Untuk mempermudah kolaborasi pengembangan dan penilaian Capstone Project, repositori ini memisahkan subsistem **Frontend (Eka)** dan **Backend (Iqbal)** secara terstruktur:

```text
SIMBA-SCADA/
│
├── 🎨 FRONTEND SUBSYSTEM (PIC: Eka)
│   ├── src/                          # Seluruh Source Code Antarmuka Pengguna
│   │   ├── components/               # Komponen Modular React SCADA
│   │   │   ├── SCADADashboard.tsx    # Dashboard Utama (Gauge, Chart, Status RTU)
│   │   │   └── AdminPanel.tsx        # Panel Kontrol & Kalibrasi Ambang Batas
│   │   ├── firebaseConfig.ts         # Client SDK Listener Firestore
│   │   ├── types.ts                  # Interface & Model Data TypeScript
│   │   ├── index.css                 # Styling Global Tailwind CSS
│   │   ├── App.tsx                   # Root Component & Navigasi
│   │   ├── main.tsx                  # React DOM Entry Point
│   │   └── README.md                 # Dokumentasi Khusus Frontend
│   ├── public/                       # Aset Statis (Audio Alarm Siaga/Bahaya, Ikon)
│   └── index.html                    # Single Page Application HTML Entry Point
│
├── 🖥️ BACKEND & CLOUD SUBSYSTEM (PIC: Iqbal)
│   ├── server.ts                     # Entry Point Server Express & REST API
│   ├── backend/                      # Dokumentasi & Modul Servis Backend
│   │   └── README.md                 # Spesifikasi REST API & Arsitektur Server
│   ├── firebase-applet-config.json   # Kredensial Database Cloud Firestore
│   ├── firestore.rules               # Security Rules & Hak Akses Database
│   └── .env.example                  # Konfigurasi Variabel Lingkungan & API Key
│
└── ⚙️ KONFIGURASI PROYEK (Shared)
    ├── package.json                  # Dependensi Fullstack & Script Build
    ├── tsconfig.json                 # Konfigurasi Compiler TypeScript
    ├── vite.config.ts                # Bundler & Build Optimizer
    └── README.md                     # Dokumentasi Utama Proyek
```

---

## 📋 1. Bidang Hardware (Perangkat Keras & Komponen)

### A. Bill of Materials (BoM) & Spesifikasi Komponen

| No | Nama Komponen | Spesifikasi / Model | Fungsi dalam Sistem | Status / Ketersediaan |
|---|---|---|---|---|
| 1 | **Mikrokontroler (RTU)** | **ESP32 DevKit V1 (30-pin / 38-pin)**<br>- Dual Core Tensilica 240 MHz<br>- Built-in Wi-Fi 2.4 GHz & BLE<br>- Flash Memory 4MB | Membaca data sensor, melakukan kalkulasi ketinggian air, mengendalikan aktuator alarm lokal, dan mentransmisikan data ke Firebase via HTTPS/REST. | Tersedia (Ready) |
| 2 | **Sensor Jarak Air (TMA)** | **JSN-SR04T Waterproof Ultrasonic Sensor**<br>- Jarak ukur: 20 cm s/d 450 cm (4.5 m)<br>- Tegangan kerja: 5V DC<br>- Transduser kedap air (IP67) | Mengukur jarak antara sensor (posisi di atas jembatan/tiang) ke permukaan air sungai secara *contactless* dan tahan cuaca. | Tersedia (Ready) |
| 3 | **Sensor Suhu & Kelembaban** | **DHT22 / AM2302 Sensor**<br>- Range suhu: -40°C ~ 80°C (akurasi ±0.5°C)<br>- Range RH: 0-100% | Mengukur suhu ambien untuk kompensasi otomatis kecepatan rambat gelombang ultrasonik di udara ($v = 331.4 + 0.6 \times T$). | Tersedia (Ready) |
| 4 | **Indikator Audio (Buzzer/Sirine)** | **Active Buzzer 5V / Mini Siren Alarm DC 12V** | Memberikan bunyi peringatan dini secara fisik di titik pantau RTU saat status air mencapai ambang **Siaga** atau **Bahaya**. | Tersedia (Ready) |
| 5 | **Indikator Visual (LED)** | **LED Indicator Tri-Color (Hijau, Kuning, Merah)** + Resistor 220Ω | Indikator visual langsung status level air di box panel RTU (Hijau = Normal, Kuning = Siaga, Merah = Bahaya). | Tersedia (Ready) |
| 6 | **Modul Driver Aktuator** | **Relay Module 1-Channel 5V Optocoupler** | Mengisolasi dan memicu penyalaan sirine berdaya tinggi (12V) secara aman dari pin GPIO mikrokontroler 3.3V/5V. | Tersedia (Ready) |
| 7 | **Sistem Catu Daya (Power)** | **Power Supply Adaptor DC 5V/2A atau 12V/2A** + **Step-Down Buck Converter (LM2596)** | Menyuplai daya stabil ke ESP32, sensor ultrasonik, dan sirine dari sumber listrik 220V AC atau aki/baterai Li-Ion 18650. | Tersedia (Ready) |
| 8 | **Enclosure / Casing** | **Waterproof Junction Box Box Panel IP65/IP66 (Ukuran 150x100x70 mm)** | Melindungi rangkaian mikrokontroler, modul converter, dan kabel dari cipratan air, hujan, dan debu luar ruangan. | Siap Fabrikasi |
| 9 | **Aksesoris & Mekanik** | - Bracket Sensor Akrilik / Plat Besi L<br>- Kabel Shielded 3-Core / 4-Core<br>- PCB Dot Matrix / Terminal Screw Block | Dudukan sensor menghadap tegak lurus permukaan air dan mempermudah perapihan jalur kabel instalasi lapangan. | Tersedia (Ready) |

### B. Diagram Pinout & Pengkabelan (Wiring Diagram)

```text
       ┌────────────────────────────────────────────────────────┐
       │                      ESP32 DEVKIT                      │
       │                                                        │
       │    [VIN / 5V] ───────────────┬────── VCC (JSN-SR04T)   │
       │    [GND]      ───────────────┼────── GND (JSN-SR04T)   │
       │    [GPIO 5]   ───────────────┴────── TRIG (JSN-SR04T)  │
       │    [GPIO 18]  ────────────────────── ECHO (JSN-SR04T)  │
       │                                                        │
       │    [3V3]      ────────────────────── VCC (DHT22)       │
       │    [GND]      ────────────────────── GND (DHT22)       │
       │    [GPIO 4]   ────────────────────── DATA (DHT22)      │
       │                                                        │
       │    [GPIO 19]  ────────────────────── Relay / Buzzer IN │
       │    [GPIO 21]  ────────────────────── LED Kuning (Siaga)│
       │    [GPIO 22]  ────────────────────── LED Merah (Bahaya)│
       │    [GPIO 23]  ────────────────────── LED Hijau (Normal)│
       └────────────────────────────────────────────────────────┘
```

---

## 💻 2. Bidang Software (Perangkat Lunak, Database & Tools)

### A. Daftar Tool & Lingkungan Pengembangan (Development Environment)

| Komponen Software | Tool / Teknologi | Fungsi / Keterangan |
|---|---|---|
| **Code Editor / IDE** | **Visual Studio Code (VS Code)** | Editor utama penulisan kode frontend, backend server, konfigurasi database, dan dokumentasi. |
| **Firmware IDE** | **Arduino IDE 2.x / PlatformIO** | Menulis, mengompilasi, dan mengunggah kode firmware C/C++ ke mikrokontroler ESP32. |
| **Runtime Environment** | **Node.js (v20+ / v22+) & npm** | Lingkungan eksekusi runtime JavaScript/TypeScript server backend dan dependency manager. |
| **TypeScript Engine** | **TSX (`tsx`) & esbuild** | Menjalankan TypeScript server secara langsung tanpa pre-compilation lambat serta bundling production super cepat. |
| **Version Control** | **Git & GitHub** | Manajemen repositori, pelacakan histori revisi kode, dan kolaborasi tim proyek. |

### B. Stack Teknologi Aplikasi (Web SCADA & Backend)

| Lapisan (Layer) | Teknologi / Pustaka | Peran dalam Sistem SIMBA |
|---|---|---|
| **Frontend Framework** | **React 19 + Vite 6** | Framework antarmuka komponen reaktif, modern, dan berkinerja tinggi. |
| **Language** | **TypeScript (~5.8)** | Menjamin keamanan tipe data (type-safety) pada data telemetri hidrologi dan konfigurasi SCADA. |
| **Styling & UI** | **Tailwind CSS v4** | Desain dashboard modern industrial SCADA, mode gelap (*Dark Mode*) & terang (*Light Mode*), serta responsive layout. |
| **Iconography** | **Lucide React** | Ikon visual telemetri (sensor, radar, sirene, water drop, cloud weather, terminal, lock). |
| **Data Visualization** | **Recharts & HTML5 Canvas** | Menampilkan grafik tren kenaikan air 24 jam, batas ambang Siaga/Bahaya, dan visualisasi hidrograf sungai. |
| **Immersive Alarm** | **Web Audio API** | Audio reactive visualizer dan alarm loop darurat terintegrasi pada status Siaga dan Bahaya. |
| **Backend Server** | **Express.js (Node.js)** | Menyediakan REST API: simulasi hidrologi mandiri (`/api/sim-data`), crawling cuaca/berita (`/api/search-news`), dan prediksi bencana. |
| **Cloud Database** | **Google Firebase Firestore** | Database NoSQL real-time cloud untuk sinkronisasi seketika antara RTU ESP32, Dashboard SCADA, dan Admin Panel. |
| **Weather Telemetry** | **Open-Meteo API** | Mengambil data cuaca, probabilitas presipitasi, dan curah hujan aktual di DAS sungai yang dimonitor. |
| **Kecerdasan Buatan** | **Google Gemini AI SDK (`@google/genai`)** | Asisten cerdas pembuat prediksi hidrologi, estimasi debit banjir, dan rekomendasi langkah evakuasi BPBD. |

---

## ⚙️ 3. Konfigurasi Lingkungan Pengembangan (Setup Guide)

### Prasyarat:
1. Pastikan sudah menginstal **Node.js (versi 20 atau lebih baru)**:
   ```bash
   node -v
   npm -v
   ```
2. Pastikan sudah menginstal **Git**:
   ```bash
   git --version
   ```

### Langkah Instalasi & Menjalankan Proyek:

1. **Clone Repositori:**
   ```bash
   git clone https://github.com/username-anda/simba-scada-flood-monitoring.git
   cd simba-scada-flood-monitoring
   ```

2. **Instalasi Dependencies:**
   ```bash
   npm install
   ```

3. **Konfigurasi Environment Variable (`.env`):**
   Buat file `.env` di direktori root dengan menyalin template:
   ```env
   # Google Gemini AI API Key (untuk fitur Analisis Prediksi Hidrologi)
   GEMINI_API_KEY=your_gemini_api_key_here

   # (Opsional) Port Server (Default: 3000)
   PORT=3000
   ```

4. **Menjalankan Server Pengembangan (Dev Server):**
   ```bash
   npm run dev
   ```
   Aplikasi akan berjalan di: `http://localhost:3000`

5. **Build untuk Production:**
   ```bash
   npm run build
   npm start
   ```

---

## 🗄️ 4. Struktur Koleksi Database (Firebase Firestore)

Sistem SIMBA menggunakan struktur koleksi Firestore berikut:

- **`sensor_readings`**: Riwayat rekaman sensor (timestamp, water_level, distance, temperature, humidity, alert_status).
- **`system_config`**: Parameter operasional SCADA (reference_height, threshold_siaga, threshold_bahaya, status_alat, auto_simulation, simulation_mode).
- **`system_logs`**: Log aktivitas, log peringatan RTU, dan status kalibrasi sensor.
- **`scada_credentials`**: Akses keamanan dan otentikasi login Admin SCADA.

---

## 📡 5. Dokumentasi REST API Integrasi Hardware (ESP32 / RTU)

Aplikasi SIMBA menyediakan endpoint REST API terpadu agar mikrokontroler (ESP32 / Arduino / Raspberry Pi) dapat bertukar data dan tersinkronisasi secara real-time:

### A. Kirim Telemetri Sensor (`POST /api/telemetry`)
Mengirim pembacaan sensor JSN-SR04T & DHT22 dari lapangan ke server SCADA.

* **Endpoint:** `POST /api/telemetry` (atau `/api/sensor-data`)
* **Headers:** `Content-Type: application/json`
* **Request Body (JSON):**
```json
{
  "node_id": "node-kukusan-01",
  "distance": 185.5,
  "temperature": 29.4,
  "humidity": 72.0,
  "local_rain": 0
}
```
*(Catatan: Anda cukup mengirim `distance` (jarak pantul pantulan sensor ke air dalam cm), server akan otomatis menghitung elevasi air dengan formula kompensasi suhu $v = 331.3 + 0.606 \times T$).*

* **Response (JSON):**
```json
{
  "success": true,
  "timestamp": 1725324500000,
  "node_id": "node-kukusan-01",
  "water_level": 114.5,
  "alert_status": "Bahaya",
  "should_alarm": true,
  "alarm_type": "Bahaya",
  "threshold_siaga": 60,
  "threshold_bahaya": 90,
  "sampling_rate_seconds": 60
}
```
*(Keunggulan: ESP32 dapat langsung membaca nilai `should_alarm` dan `alarm_type` untuk menyalakan buzzer atau LED merah secara otomatis tanpa perlu hardcode ambang batas).*

---

### B. Ambil Konfigurasi SCADA Terbaru (`GET /api/config`)
Digunakan oleh hardware saat booting atau secara berkala untuk mengambil nilai ambang batas terkini yang diubah oleh admin via dashboard web.

* **Endpoint:** `GET /api/config`
* **Response (JSON):**
```json
{
  "node_id": "node-kukusan-01",
  "reference_height": 300,
  "threshold_siaga": 60,
  "threshold_bahaya": 90,
  "sampling_rate_seconds": 60,
  "status_alat": "Online",
  "auto_simulation": false,
  "timestamp": 1725324500000
}
```

---

### C. Heartbeat & Diagnostik Alat (`POST /api/heartbeat`)
Mengirim sinyal detak jantung berkala dari lapangan (kondisi baterai & kekuatan sinyal Wi-Fi).

* **Endpoint:** `POST /api/heartbeat`
* **Request Body (JSON):**
```json
{
  "node_id": "node-kukusan-01",
  "rssi": -65,
  "battery_pct": 92,
  "uptime_sec": 3600,
  "firmware_version": "1.0.0"
}
```

---