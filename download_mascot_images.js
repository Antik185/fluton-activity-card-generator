/**
 * download_mascot_images.js
 * ─────────────────────────
 * Downloads all mascot images locally and patches mascot-data.json
 * so the website serves them from disk instead of pbs.twimg.com.
 *
 * Usage:  node download_mascot_images.js
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_PATH  = path.join(__dirname, 'public', 'cards', 'mascot', 'mascot-data.json');
const IMG_DIR    = path.join(__dirname, 'public', 'cards', 'mascot', 'images');
const CONCURRENCY = 5;   // parallel downloads
const DELAY_MS    = 80;  // ms between batches

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a stable filename from a URL */
function urlToFilename(url) {
  // Extract the media ID part from pbs.twimg.com/media/<ID>.<ext>
  const m = url.match(/\/media\/([A-Za-z0-9_\-]+)(?:\.(\w+))?/);
  if (m) {
    const ext = m[2] || 'jpg';
    return `${m[1]}.${ext}`;
  }
  // Fallback: hash the URL
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
  const ext  = url.includes('.png') ? 'png' : 'jpg';
  return `${hash}.${ext}`;
}

/** Download a single URL to destPath, returns true on success */
function downloadFile(url, destPath) {
  return new Promise((resolve) => {
    // Add quality param for Twitter media
    const fetchUrl = url.includes('pbs.twimg.com')
      ? url.replace(/:large$/, '') + '?format=jpg&name=large'
      : url;

    const protocol = fetchUrl.startsWith('https') ? https : http;

    const req = protocol.get(fetchUrl, { timeout: 15000 }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve);
      }
      if (res.statusCode !== 200) {
        console.warn(`  [skip] ${res.statusCode} → ${url}`);
        return resolve(false);
      }

      const ext = res.headers['content-type'] === 'image/png' ? 'png' : 'jpg';
      // Fix extension based on actual content type
      const finalPath = destPath.replace(/\.\w+$/, '.' + ext);

      const ws = fs.createWriteStream(finalPath);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(finalPath); });
      ws.on('error', (e) => { console.warn(`  [err] write: ${e.message}`); resolve(false); });
    });

    req.on('error', (e) => { console.warn(`  [err] fetch: ${e.message} → ${url}`); resolve(false); });
    req.on('timeout', () => { req.destroy(); console.warn(`  [timeout] ${url}`); resolve(false); });
  });
}

/** Run promises in batches of `size` */
async function batchRun(tasks, size) {
  const results = [];
  for (let i = 0; i < tasks.length; i += size) {
    const batch = tasks.slice(i, i + size).map(fn => fn());
    results.push(...await Promise.all(batch));
    if (i + size < tasks.length) await sleep(DELAY_MS);
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Mascot Image Downloader ===\n');

  fs.mkdirSync(IMG_DIR, { recursive: true });

  const dataRaw = fs.readFileSync(DATA_PATH, 'utf8');
  const data    = JSON.parse(dataRaw);

  // Collect all unique remote URLs
  const urlSet = new Set();
  for (const entry of data.entries) {
    for (const img of entry.images) {
      if (img.startsWith('http')) urlSet.add(img);
    }
  }

  const urls = [...urlSet];
  console.log(`Found ${urls.length} unique image URLs across ${data.entries.length} entries.`);
  console.log(`Saving to: ${IMG_DIR}\n`);

  // Build url → localPath map, skip already downloaded
  const urlToLocal = {};
  let skipped = 0;

  const tasks = urls.map(url => async () => {
    const filename  = urlToFilename(url);
    const destPath  = path.join(IMG_DIR, filename);

    // Skip if already on disk (any extension variant)
    const base = filename.replace(/\.\w+$/, '');
    const existing = fs.readdirSync(IMG_DIR).find(f => f.startsWith(base));
    if (existing) {
      urlToLocal[url] = 'images/' + existing;
      skipped++;
      return;
    }

    const result = await downloadFile(url, destPath);
    if (result) {
      const localName = path.basename(result);
      urlToLocal[url] = 'images/' + localName;
      process.stdout.write('.');
    } else {
      // Keep original URL as fallback
      urlToLocal[url] = url;
      process.stdout.write('x');
    }
  });

  await batchRun(tasks, CONCURRENCY);
  console.log('\n');

  // Patch entries with local paths
  let patched = 0;
  for (const entry of data.entries) {
    entry.images = entry.images.map(img => {
      const local = urlToLocal[img];
      if (local && !local.startsWith('http')) { patched++; return local; }
      return img; // fallback to remote
    });
  }

  data.downloadedAt = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');

  console.log(`Done.`);
  console.log(`  Downloaded: ${Object.values(urlToLocal).filter(v => !v.startsWith('http')).length - skipped} new files`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Patched image refs: ${patched}`);
  console.log(`  mascot-data.json updated with local paths.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
