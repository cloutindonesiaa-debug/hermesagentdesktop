---
name: shopee-csv-importer-playbie
description: Build and use a Shopee Seller Centre CSV → Playbie website importer. Use when the user has a Playbie/Seller-Centre-style e-commerce site and wants to push product data from a Shopee CSV export (Indonesian or English headers) into the website's API in bulk. Covers column auto-detection, IDR/Indonesian number format, Shopee CDN image download, and a bulk-import endpoint pattern.
---

# Shopee CSV Importer for Playbie E-Commerce

Pipeline for one-time or recurring imports of Shopee Seller Centre product CSVs into a single-tenant Playbie/Seller-Centre-style PHP+SQLite site (e.g. asientoplaybie.com).

## When to use
- User has a Playbie or similar e-commerce site with a PHP API + SQLite backend
- User wants to bulk-import or sync products from a Shopee Seller Centre CSV
- User has tried direct scraping and hit Shopee anti-bot (error 90309999) — fall back to CSV export
- Need to handle Indonesian CSV format (Rp 2.599.000, "Gambar 1/2/3", etc.)

## Architecture

```
[Shopee Seller Centre] → Export CSV → C:\tmp\shopee_export\
                                            ↓
                              [import_shopee.bat] double-click
                                            ↓
                              [import_shopee.py] (Python 3.11+)
                                            ↓
                              POST /api.php?path=products/import
                                            ↓
                              [api.php] SQLite upsert
                                            ↓
                              Live on website
```

The PHP API needs a **bulk import endpoint** that accepts an array of products and upserts (INSERT OR REPLACE / INSERT or UPDATE by id). Without it, only single-product POST is supported and the script is slow.

## Step 1: Add bulk import endpoint to api.php

Find the single-product POST handler and add a new branch for `path=products/import`:

```php
if ($method === 'POST' && $id === 'import') {
    require_admin();
    $rows = $body['products'] ?? null;
    if (!is_array($rows)) err(400, 'Array products wajib diisi.');
    $pdo = db();
    $inserted = 0; $updated = 0; $errors = [];
    $stmt = $pdo->prepare('INSERT INTO products
        (id, name, category, categoryLabel, price, imageUrl, imageUrls, badge, badgeType, description, size, stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $upd = $pdo->prepare('UPDATE products SET
        name=?, category=?, categoryLabel=?, price=?, imageUrl=?, imageUrls=?,
        badge=?, badgeType=?, description=?, size=?, stock=?
        WHERE id=?');
    $check = $pdo->prepare('SELECT id FROM products WHERE id = ?');
    foreach ($rows as $i => $p) {
        try {
            $id_v = (string)($p['id'] ?? '');
            if ($id_v === '') { $errors[] = "Row $i: missing id"; continue; }
            $name = (string)($p['name'] ?? '');
            $cat  = (string)($p['category'] ?? '');
            $price = (float)($p['price'] ?? 0);
            $stock = (int)($p['stock'] ?? 0);
            $catLabel = $cat === 'bumper' ? 'Bumper Bed' : ($cat === 'playmat' ? 'Playmat' : ($cat === 'custom' ? 'Custom Series' : 'Produk Playbie'));
            $img = (string)($p['imageUrl'] ?? 'assets/pastel_bumper_bed.png');
            $imgs = isset($p['imageUrls']) && is_array($p['imageUrls']) ? json_encode($p['imageUrls'], JSON_UNESCAPED_UNICODE) : null;
            $check->execute([$id_v]);
            $exists = $check->fetch(PDO::FETCH_ASSOC);
            $params = [
                $name, $cat, $catLabel, $price, $img, $imgs,
                (string)($p['badge'] ?? ''),
                (string)($p['badgeType'] ?? 'favorite'),
                (string)($p['description'] ?? ''),
                (string)($p['size'] ?? ''),
                $stock,
            ];
            if ($exists) {
                $upd->execute([...$params, $id_v]);
                $updated++;
            } else {
                $stmt->execute([$id_v, ...$params]);
                $inserted++;
            }
        } catch (Throwable $e) {
            $errors[] = "Row $i (" . ($p['id'] ?? '?') . "): " . $e->getMessage();
        }
    }
    ok([
        'message' => "Import selesai. $inserted produk baru, $updated produk diupdate.",
        'inserted' => $inserted,
        'updated'  => $updated,
        'errors'   => $errors,
    ]);
}
```

The endpoint requires admin JWT (`require_admin()`).

## Step 2: Python importer

Put these in `C:\tmp\shopee_export\`:

### `import_shopee.bat` (double-click launcher)
```bat
@echo off
title Playbie Shopee Importer
cd /d "C:\tmp\shopee_export"
python import_shopee.py
pause
```

### `import_shopee.py` (main script)
Key sections:
- **Config block** at top: `API_BASE`, `ADMIN_USER`, `ADMIN_PASS`, `DA_HOST/USER/PASS`, `SCRIPT_DIR`
- **COLUMN_PATTERNS** dict: regex patterns for each known Shopee header (Indonesian + English)
- **detect_columns()**: case-insensitive regex match against headers
- **normalize_price()**: handles `Rp 2.599.000` (dot=thousand, comma=decimal — Indonesian)
- **normalize_category()**: maps "Bumper Bed"/"Playmat"/"Custom"/etc to slugs `bumper`/`playmat`/`custom`
- **upload_image_to_playbie()**: downloads image bytes (with Shopee Referer header), uploads to DA `/api/filemanager/upload` endpoint with multipart envelope, returns `assets/filename` or None
- **main()**: argparse with `--dry-run` and `--no-images` flags; batches products at 50 per push

## Step 3: Pitfalls

1. **Shopee CDN image URLs expire** — they have tokens in the path that change. Always download and re-upload to the destination server, never reference Shopee URLs directly.
2. **Indonesian number format**: `Rp 2.599.000` = 2,599,000. Dot is thousand separator, comma is decimal. Naive `re.sub('[^\d]', ...)` gives wrong result.
3. **Filenames from upload** get multipart-wrapped by the upload endpoint (the `envelope` issue from earlier sessions). The PHP file needs to be cleaned post-upload, or — better — for binary uploads this is fine since the bytes are not interpreted as code.
4. **DA Evolution API returns 409 on overwrite**. Use a unique filename each upload (e.g. `api_{uuid}.php`), then a separate PHP script to swap `old → old.bak` and `new → old`.
5. **PHP files uploaded via multipart have an envelope around the real PHP code** (about 200 bytes header + footer). After upload, run a small PHP cleaner that finds `<?php` and last `?>` and writes the slice in between. Otherwise the response gets `Content-Disposition: form-data; name="file"; filename="..."` lines echoed before PHP starts.
6. **auto-detect must match Indonesian + English**. Shopee Seller Centre export in Indonesia uses Indonesian headers. Don't hard-code English.
7. **Category fallback**: if Shopee category is unknown, default to `custom` so products still import (better than skipping).
8. **CSV with multi-line cells** (descriptions with newlines): use `csv.reader` not naive splitlines.

## Step 4: Testing flow

1. Place a sample CSV in `C:\tmp\shopee_export\`
2. Run `python import_shopee.py --dry-run` to verify column detection and parsing
3. Run `python import_shopee.py --no-images` to verify push to API (no image upload)
4. Inspect browser to confirm products appear
5. Delete test products via admin panel
6. Run full importer (no flags) to test image download

## Step 5: Cron / schedule (optional)

User can run `import_shopee.bat` weekly via Windows Task Scheduler. Or just remind them manually once a week. CSV export from Seller Centre is the manual step.

## Reference: Shopee CSV column header variations

| Field | Indonesian | English |
|---|---|---|
| id | ID Produk, ID Variasi, SKU Induk | Product ID, Item ID, Parent SKU, SKU Reference No |
| name | Nama Produk | Product Name |
| description | Deskripsi Produk, Deskripsi | Product Description, Description |
| category | Kategori | Category |
| price | Harga Normal, Harga Jual | Normal Price, Sale Price, Price |
| stock | Stok, Stok Tersisa, Stok Total | Stock, Available Stock, Total Stock, Quantity |
| image | Gambar 1, Gambar 2, ...; Gambar Utama | Image 1, Image 2, ...; Main Image, Cover Image, Image URL |
| variation | Variasi | Variation, Model |
| weight | Berat (kg) | Weight |

The header has `Gambar 1, Gambar 2, Gambar 3, ...` columns with multiple image URLs per product. Detect these with `r'^(gambar|image|foto|picture|photo|cover)\s*(\d+)?$'` regex.
