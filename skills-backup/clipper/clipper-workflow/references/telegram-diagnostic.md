# Telegram Bot Diagnostic Reference

## Problem: Bot tidak reply / tidak merespons

### 0. Cek gateway status (PALING AWAL — sering terlewat!)
```bash
hermes gateway status
```
- Gateway running → lanjut ke step 1
- Gateway NOT running → langsung start, jangan liat yang lain dulu

**Start gateway:**
```bash
# Foreground (untuk debug — lihat log realtime di terminal):
hermes gateway run

# Background service:
hermes gateway install && hermes gateway start
```

**Kenapa ini langkah 0?** Jika gateway tidak jalan, bot token valid, config benar, getUpdates shows messages — tetap tidak akan ada respons. Ini penyebab #1 yang paling sering terlewat. Selalu cek gateway status duluan sebelum troubleshooting lain.

**Bukti dari insiden ini:**
- `gateway.log` terakhir jam 12:35 (2 jam sebelum chat terakhir jam 14:40)
- `hermes gateway status` → "Gateway is not running"
- `hermes gateway run` → Telegram Connected dalam 3 detik, bot langsung bisa reply

---

### 1. Test bot token validity
```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```
Response OK: `{"ok":true,"result":{"id":...,"is_bot":true,...}}`
Response error: `{"ok":false,"error_code":401,"description":"Unauthorized"}` → token invalid

---

### 2. Cek getUpdates (message queue)
```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"
```
- Returns `{"ok":true,"result":[]}` → no messages pending, bot IS polling (Telegram consumed the offset)
- Returns messages → messages exist but Hermes is NOT consuming them

---

### 3. Identifikasi penyebab dari hasil getUpdates

| Kondisi | Penyebab | Solusi |
|---------|---------|--------|
| `result` kosong, getMe OK | Hermes aktif polling tapi belum ada pesan user | Wait — user perlu kirim pesan ke bot |
| `result` ada pesan dari user, getMe OK | Hermes TIDAK polling/getUpdates tidak terkonsumsi | Hermes tidak terhubung ke bot polling |
| 401 di getMe | Token invalid | Cek token, generate baru dari @BotFather |
| timeout/connection refused | Firewall blokir koneksi keluar | Cek outbound rule untuk api.telegram.org |

---

### 4. Penyebab umum Hermes tidak polling

1. **Config mismatch** — `telegram.allowed_chats` di config.yaml kosong tapi .env punya `TELEGRAM_ALLOWED_USERS`. Hermes membaca config.yaml, bukan .env untuk runtime settings.
2. **Hermes tidak punya built-in Telegram polling** — hanya setup webhook eksternal. Cek apakah ada process Telegram listener yang running: `ps aux | grep -i telegram`

3. **allowed_chats filter** — kalau Hermes DOs polling, pesan dari chat ID tidak ada di allowed list akan di-skip.

---

### 5. Test kirim pesan secara manual (verifikasi API works)
```bash
curl -s -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d "chat_id=<USER_CHAT_ID>" \
  -d "text=Test pesan dari server"
```
Berhasil → API works, masalah di sisi Hermes polling. Gagal → masalah di token/chat_id.

---

## Clipper Team Group Info

- Group: "Clipper Team" (supergroup, topic-enabled)
- Chat ID: `-1003930772943`
- Thread IDs aktif: 321 (Broly topic), dll

## Bot Info

- Bot name: `@mazeric88_bot`
- Token: `8846563294:AAFiwZ0b80nArkkIs0dCdM-xSIgYDzpTyzE`
- Owner: Erik (ID: 5416939315)
