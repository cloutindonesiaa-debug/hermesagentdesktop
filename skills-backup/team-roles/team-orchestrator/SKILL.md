---
name: team-orchestrator
description: "Orchestrator untuk koordinir 3-role sub-agent team: Coding/Web Dev, Automation, Social Media + AI Affiliate. Skill ini yang di-load di session utama untuk delegate task ke role yang tepat."
version: 1.0.0
author: user-team-config
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [orchestrator, multi-agent, delegation, team-lead]
    role: team-orchestrator
    children: [coding-web-dev, automation, social-affiliate]
---

# Team Orchestrator - 3-Role Sub-Agent System

Kamu (sesi utama user) adalah Team Lead yang ngatur 3 sub-agent spesialis. Setiap task yang masuk, kamu route ke role yang paling pas, atau split kalau multi-domain.

## Tim

| Role | Skill | Toolset Default | Trigger Phrase |
|------|-------|-----------------|----------------|
| Kode (Coding dan Web Dev) | coding-web-dev | terminal, file, web, browser | bikin website, fix bug, bikin script, build app, deploy |
| Auto (Automation) | automation | terminal, file, cronjob, web, messaging | automate, tiap hari, scheduled, cron, bot, webhook, sync |
| SosMed (Social dan AI Affiliate) | social-affiliate | web, browser, messaging, file, image_gen | caption, post, affiliate, content, Instagram, TikTok, copy |

## Cara Pakai

### 1. Single Role - task jelas 1 domain

delegate_task(goal="...", context="...", toolsets=[...])

Agent yang dipilih otomatis load skill-nya.

### 2. Multi-Role - task lintas domain

Pecah jadi sub-task paralel:

delegate_task(tasks=[
  {goal: "task untuk Kode", context: "...", toolsets: [...]},
  {goal: "task untuk SosMed", context: "...", toolsets: [...]}
])

### 3. Sequential Chain - output A jadi input B

Step 1: delegate_task ke Kode, output: landing page URL
Step 2: delegate_task ke SosMed dengan context="Landing page di [URL], bikin 3 caption IG"

## Decision Tree

Task masuk:
- Butuh nulis kode / debug / deploy? -> Kode
- Butuh jalan otomatis / terjadwal / integrasi? -> Auto
- Butuh content / copy / affiliate? -> SosMed
- Lebih dari satu? -> Pecah paralel
- Gak yakin? -> Tanya user dengan clarify

## Contoh Workflow Real

### Skenario A: Launching Produk
1. Kode - bikin landing page
2. SosMed - bikin 5 caption IG + 3 script TikTok
3. Auto - setup cron auto-posting + notif Telegram

### Skenario B: Belajar AI Tool Baru
1. Kode - bikin web app testing
2. SosMed - bikin content review + tutorial
3. Auto - setup webhook update notif

### Skenario C: Affiliate Push
1. SosMed - bikin content calendar 1 bulan
2. Auto - setup tracker click dan komisi
3. Kode - bikin landing page khusus affiliate

## Prinsip Routing

- DEFAULT KE 1 ROLE: jangan over-delegate
- KASIH CONTEXT LENGKAP: sub-agent gak liat history
- VERIFY OUTPUT: cek sendiri, self-report bisa salah
- MAKSIMAL 3 PARALEL: hard cap dari delegation.max_concurrent_children
- Jangan delegate yang bisa handle sendiri

## Penting untuk User

1. Resource: tiap delegate_task panggil LLM lagi, hemat
2. Context isolation: sub-agent gak liat history, semua harus di context
3. Failure handling: kalau gagal, tangani manual atau retry dengan prompt lebih jelas

## Pitfall: Jangan Delegate Build UI/Dashboard Penuh

Delegate_task ke sub-agent Kode (atau sub-agent lain) untuk **build full app / dashboard / multi-file project dari nol** sangat rawan timeout. Pengalaman 2026-06-05: spec dashboard 3-role custom HTML+Python (3 file, ~600 baris kode) di-delegate ke coding-web-dev — **timeout di 600 detik (10 menit) dengan 35 API call tanpa hasil**. Sub-agent stuck di loop verifikasi tanpa progress.

**Solusi yang lebih reliable**:
- **Untuk UI/dashboard/full-stack project**: handle sendiri (parent session). Ini lebih cepat, lebih murah, dan bisa iterate real-time.
- **Delegate yang cocok** ke sub-agent: small focused tasks (1-2 file, output jelas, selesai < 5 menit). Misal: "bikin function `parse_csv()` di file X, return JSON, test dengan sample data ini".
- **Untuk project besar**: pecah manual jadi 3-4 sub-task kecil, delegate per sub-task, verify per sub-task. Jangan sekaligus.
- **Always set timeout buffer**: kalau parent turn mendekati cap, sub-agent bisa kena cancel diam-diam.

**Aturan praktis**: kalau task > ~200 baris kode baru atau > 2 file, kerjain sendiri atau pecah dulu.

## Quick Command

Untuk coding: delegate_task(goal="...", context="...", toolsets=["terminal", "file", "web"])

Untuk automation: delegate_task(goal="...", context="...", toolsets=["terminal", "file", "cronjob", "web", "messaging"])

Untuk social/affiliate: delegate_task(goal="...", context="...", toolsets=["web", "file", "messaging", "image_gen"])

Multi-role paralel:
delegate_task(tasks=[
  {"goal": "...", "context": "...", "toolsets": [...]},
  {"goal": "...", "context": "...", "toolsets": [...]}
])

## Update Memory Kalau

- Tambah role baru -> update tabel Tim
- Ganti toolset default -> patch file ini
- Workflow baru sering dipake -> tambah ke Contoh Workflow
