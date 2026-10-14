# Backend 1v1 Online — Asian Drag Bike 2D

## Arsitektur

```text
APK / Browser (Phaser)
        │ HTTPS + WebSocket
        ▼
Node.js API + WebSocket server
        │
        ▼
PostgreSQL online
```

### Komponen

- **REST API**: register, login, profil, membuat/join room, history pertandingan.
- **JWT session**: password di-hash dengan bcrypt; token tidak menyimpan password.
- **WebSocket**: lobby room, ready state, start race, progress relay, finish result.
- **PostgreSQL**: sumber data akun dan match; bukan `localStorage`.
- **Server authority tahap awal**: server memvalidasi peserta, room, ready state, dan finish time yang dikirim. Untuk anti-cheat penuh, physics race berikutnya perlu dipindahkan/ditiru di server.

## Yang perlu Anda siapkan

1. **Database PostgreSQL online**: URL `DATABASE_URL`.
2. **Hosting Node.js** yang mendukung WebSocket dan HTTPS.
3. Domain/subdomain opsional, misalnya `api.namadomain.com`.
4. Secret JWT acak yang hanya disimpan sebagai environment variable.
5. Jangan mengaktifkan mode WebView incognito atau clear data otomatis pada APK.

Tidak perlu PHPMyAdmin. Dashboard provider database atau migrasi SQL sudah cukup.

## Menjalankan sendiri

```bash
cd backend
cp .env.example .env
npm install
# jalankan schema.sql di database PostgreSQL
npm start
```

Health check: `GET /health`

## Endpoint awal

- `POST /api/auth/register` — `{ username, password, displayName? }`
- `POST /api/auth/login` — `{ username, password }`
- `GET /api/me` — Bearer token
- `POST /api/matches` — membuat room, Bearer token
- `POST /api/matches/:roomCode/join` — join room
- `GET /api/matches/:roomCode` — status room
- WebSocket `/ws?token=<JWT>&room=<ROOM_CODE>` — realtime 1v1

## Deployment

Backend siap dipasang ke Render, Railway, Fly.io, VPS Docker, atau server managed lain. Saya bisa menyiapkan file Docker dan konfigurasi provider setelah Anda memilih/menyediakan provider. Untuk membuat database dan URL publik atas nama Anda, saya membutuhkan akses akun/provider tersebut; saya tidak bisa menebak atau membuat kredensial cloud pribadi tanpa otorisasi.
