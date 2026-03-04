/**
 * fetch_mascot.js
 * ───────────────
 * Standalone script for the Fluton Mascot Contest.
 * Does NOT touch any main-project tables or files.
 *
 * What it does:
 *  1. Reads json/mascot-competition.json (Discord channel export)
 *  2. Extracts unique tweet URLs (deduplicates by tweet ID)
 *  3. Fetches real-time metrics + all media from socialdata.tools API
 *  4. Writes public/cards/mascot/mascot-data.json  ← consumed by the website
 *
 * Usage:
 *  node fetch_mascot.js
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const API_KEY     = '4948|CQ4cozl2G0GCVVLZhRhfXsv9DMHzjPHnL4aE7mK9d7093fab';
const API_URL     = 'https://api.socialdata.tools/twitter/tweets-by-ids';
const CHUNK_SIZE  = 50;
const RATE_DELAY  = 600; // ms between chunks

const DC_JSON_PATH  = path.join(__dirname, 'json', 'mascot-competition.json');
const OUT_JSON_PATH = path.join(__dirname, 'public', 'cards', 'mascot', 'mascot-data.json');

// ── Helpers ─────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/** Extract tweet numeric ID from any x.com / twitter.com URL */
function tweetIdFromUrl(url) {
    const m = url.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
}

/** Normalise image URL: strip Discord CDN proxy, keep canonical pbs.twimg.com */
function canonicalImg(img) {
    if (!img) return null;
    // prefer canonicalUrl when available
    if (img.canonicalUrl) return img.canonicalUrl;
    // strip Discord proxy wrapper if present
    const decoded = decodeURIComponent(img.url || '');
    const m = decoded.match(/https:\/\/pbs\.twimg\.com\/[^\s?]+/);
    return m ? m[0] : (img.url || null);
}

// ── Step 1: Parse Discord JSON ───────────────────────────────────────────────
function parseDcJson() {
    console.log(`Reading ${DC_JSON_PATH} …`);
    const raw  = fs.readFileSync(DC_JSON_PATH, 'utf8');
    const data = JSON.parse(raw);

    // Map: tweetId → entry (deduplicate, keep first occurrence)
    const map = new Map();

    for (const msg of data.messages) {
        const rawUrl = (msg.content || '').trim();
        const tweetId = tweetIdFromUrl(rawUrl);
        if (!tweetId) continue;          // skip non-tweet messages
        if (map.has(tweetId)) continue;  // deduplicate

        // Try to extract data from Discord embed (may be absent / partial)
        const embed = msg.embeds && msg.embeds[0];
        const embedAuthor = embed && embed.author;

        // "Display Name (@handle)" → split
        let authorName = '';
        let handle     = '';
        if (embedAuthor && embedAuthor.name) {
            const m = embedAuthor.name.match(/^(.*?)\s+\(@([^)]+)\)$/);
            if (m) { authorName = m[1].trim(); handle = '@' + m[2].trim(); }
            else    { authorName = embedAuthor.name; }
        }

        // Discord avatar of the person who posted (fallback)
        const discordAvatar = msg.author && msg.author.avatarUrl
            ? msg.author.avatarUrl
            : null;

        // Images from Discord embed (at most 1 preview, we'll enrich via API)
        const dcImages = embed && embed.images
            ? embed.images.map(canonicalImg).filter(Boolean)
            : [];

        const tweetDate = embed && embed.timestamp
            ? embed.timestamp.slice(0, 10)
            : msg.timestamp.slice(0, 10);

        map.set(tweetId, {
            tweetId,
            url:          rawUrl,
            author:       authorName,
            handle:       handle,
            discordName:  msg.author ? (msg.author.nickname || msg.author.name) : '',
            discordAvatar,
            likes:        0,      // filled by API
            images:       dcImages,  // fallback; API will overwrite with full set
            date:         tweetDate,
        });
    }

    console.log(`Parsed ${map.size} unique tweet entries.`);
    return [...map.values()];
}

// ── Step 2: Fetch metrics + full media from API ──────────────────────────────
async function enrichEntries(entries) {
    const chunks = chunkArray(entries, CHUNK_SIZE);
    console.log(`Fetching metrics in ${chunks.length} chunk(s) …`);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const ids   = chunk.map(e => e.tweetId);

        console.log(`  Chunk ${i + 1}/${chunks.length} (${ids.length} tweets) …`);

        try {
            const resp = await axios.post(
                API_URL,
                { ids },
                {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Content-Type':  'application/json',
                        'Accept':        'application/json',
                    },
                    timeout: 25000,
                }
            );

            if (!resp.data || !resp.data.tweets) {
                console.warn('  Warning: unexpected API response shape');
                continue;
            }

            // Build lookup id → tweet data
            const apiMap = {};
            for (const t of resp.data.tweets) {
                apiMap[t.id_str] = t;
            }

            for (const entry of chunk) {
                const t = apiMap[entry.tweetId];
                if (!t) {
                    console.warn(`  Tweet ${entry.tweetId} not found in API response`);
                    continue;
                }

                // Metrics
                entry.likes    = t.favorite_count    || 0;
                entry.reposts  = t.retweet_count      || 0;
                entry.views    = t.views_count         || 0;
                entry.replies  = t.reply_count         || 0;

                // Author info from Twitter (more reliable than Discord embed)
                if (t.user) {
                    if (!entry.author)  entry.author = t.user.name        || '';
                    if (!entry.handle)  entry.handle = '@' + (t.user.screen_name || '');
                    entry.twitterAvatar = t.user.profile_image_url_https  || null;
                }

                // Full image set from tweet media
                // extended_entities.media contains all photos/videos
                const media = (t.extended_entities || t.entities || {}).media || [];

                const photos = media
                    .filter(m => m.type === 'photo')
                    .map(m => m.media_url_https || m.media_url)
                    .filter(Boolean);

                // For video/gif — use thumbnail as preview image
                const videoThumbs = media
                    .filter(m => m.type === 'video' || m.type === 'animated_gif')
                    .map(m => m.media_url_https || m.media_url)
                    .filter(Boolean);

                const allMedia = [...photos, ...videoThumbs];
                const uniquePhotos = [...new Set(allMedia)];

                if (uniquePhotos.length > 0) {
                    entry.images = uniquePhotos;
                }
                // Mark entries that contain video (for UI play icon)
                entry.hasVideo = videoThumbs.length > 0;
                // else: keep Discord preview images as fallback

                // Date from tweet if available
                if (t.created_at) {
                    entry.date = new Date(t.created_at).toISOString().slice(0, 10);
                }
            }
        } catch (err) {
            const msg = err.response ? JSON.stringify(err.response.data) : err.message;
            console.error(`  Error in chunk ${i + 1}:`, msg);
        }

        if (i < chunks.length - 1) await sleep(RATE_DELAY);
    }

    return entries;
}

// ── Step 3: Write output JSON ────────────────────────────────────────────────
function writeOutput(entries) {
    // Assign sequential IDs after sorting by likes desc
    const sorted = [...entries].sort((a, b) => b.likes - a.likes);
    sorted.forEach((e, i) => { e.id = i + 1; });

    const out = {
        generatedAt: new Date().toISOString(),
        count: sorted.length,
        entries: sorted,
    };

    fs.mkdirSync(path.dirname(OUT_JSON_PATH), { recursive: true });
    fs.writeFileSync(OUT_JSON_PATH, JSON.stringify(out, null, 2), 'utf8');
    console.log(`\nSaved ${sorted.length} entries → ${OUT_JSON_PATH}`);

    // Quick summary
    console.log('\nTop 5 by likes:');
    sorted.slice(0, 5).forEach((e, i) =>
        console.log(`  ${i + 1}. ${e.handle} — ${e.likes} likes — ${e.images.length} image(s)`)
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('=== Mascot Contest Fetcher ===\n');

    const entries  = parseDcJson();
    const enriched = await enrichEntries(entries);
    writeOutput(enriched);

    console.log('\nDone.');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
