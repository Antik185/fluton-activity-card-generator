/**
 * update_from_week7.js
 * Imports messages from json/30.03 - 05.04/ into both databases.
 * Uses last timestamps from json/23.03-29.03/ as thresholds to avoid duplicates.
 */

const fs      = require('fs');
const path    = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain }       = require('stream-chain');
const { parser }      = require('stream-json');
const { pick }        = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const jsonDirNew = path.join(__dirname, 'json', '30.03 - 05.04');
const dbPath     = path.join(__dirname, 'database.sqlite');
const dbTimePath = path.join(__dirname, 'database_time.sqlite');

const banlist        = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers    = new Set(banlist.users);
const bannedPosts    = new Set(banlist.posts.map(p => p.split('?')[0]));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(a => a.toLowerCase()));

// Last timestamps from json/23.03-29.03/
const lastTimestamps = {
    'art-memes.json':   '2026-03-29T23:51:14.428+02:00',
    'bangladesh.json':  '2026-03-29T23:07:38.514+02:00',
    'chinese.json':     '2026-03-29T22:22:51.149+02:00',
    'content.json':     '2026-03-29T23:49:37.223+02:00',
    'fluton-pets.json': '2026-03-29T22:26:58.063+02:00',
    'general.json':     '2026-03-29T23:54:41.339+02:00',
    'gm.json':          '2026-03-29T23:50:15.824+02:00',
    'indian.json':      '2026-03-29T21:26:44.886+02:00',   // was india.json
    'indonesian.json':  '2026-03-29T23:50:10.293+02:00',
    'nigerian.json':    '2026-03-29T23:57:48.489+02:00',
    'pakistani.json':   '2026-03-29T21:15:28.218+02:00',
    'portugues.json':   '2026-03-29T17:00:31.102+02:00',
    'russian.json':     '2026-03-29T22:30:28.388+02:00',   // was Russian.json
    'turkey.json':      '2026-03-29T07:04:14.881+02:00',
    'ukraine.json':     '2026-03-29T22:56:46.404+02:00',
    'vietnamese.json':  '2026-03-29T21:22:50.343+02:00',
};

const SKIP_FILES     = new Set(['mascot-competition.json']);
const CONTENT_FILES  = new Set(['content.json', 'share-content.json', 'mascot-competition.json']);

const db     = new sqlite3.Database(dbPath);
const dbTime = new sqlite3.Database(dbTimePath);

function extractXLinks(content) {
    if (!content) return [];
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/g;
    return content.match(regex) || [];
}

let files            = [];
let currentFileIndex = 0;
const results        = {};
const userBestRoles  = {};

function start() {
    files = fs.readdirSync(jsonDirNew)
        .filter(f => f.endsWith('.json') && !SKIP_FILES.has(f));
    console.log(`Starting update from "30.03 - 05.04". Found ${files.length} files.`);

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        dbTime.run('BEGIN TRANSACTION');
        processNextFile();
    });
}

function processNextFile() {
    if (currentFileIndex >= files.length) {
        db.run('COMMIT');
        dbTime.run('COMMIT', () => {
            console.log('\n✅ Messages imported.');
            console.log('\n📋 Final timestamps per channel:');
            for (const [chan, ts] of Object.entries(results)) {
                console.log(`  ${chan}: ${ts}`);
            }
            db.close();
            dbTime.close();
            process.exit(0);
        });
        return;
    }

    const file      = files[currentFileIndex];
    const threshold = lastTimestamps[file] ? new Date(lastTimestamps[file]) : new Date(0);
    const filePath  = path.join(jsonDirNew, file);
    console.log(`\nProcessing ${file} (threshold: ${threshold.toISOString()})`);

    let processed = 0;
    let skipped   = 0;
    let lastTs    = null;

    const pipeline = chain([
        fs.createReadStream(filePath),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);

    pipeline.on('data', data => {
        const msg    = data.value;
        const author = msg.author;
        if (!author || author.isBot || bannedUsers.has(author.name)) return;

        const msgDate = new Date(msg.timestamp);
        if (msgDate <= threshold) { skipped++; return; }

        processed++;
        lastTs = msg.timestamp;

        // Track best roles
        const newRoles = author.roles || [];
        const existing = userBestRoles[author.id];
        if (!existing || newRoles.length > existing.length) {
            userBestRoles[author.id] = newRoles;
        }

        // 1. Update main DB
        const rolesJson = JSON.stringify(newRoles);
        const hasRoles  = newRoles.length > 0 ? 1 : 0;
        db.run(`
            INSERT INTO users (id, username, nickname, avatar_url, roles, discord_messages, total_points)
            VALUES (?, ?, ?, ?, ?, 1, 1)
            ON CONFLICT(id) DO UPDATE SET
                username         = excluded.username,
                nickname         = excluded.nickname,
                avatar_url       = excluded.avatar_url,
                roles            = CASE WHEN ? = 1 THEN excluded.roles ELSE roles END,
                discord_messages = discord_messages + 1,
                total_points     = total_points + 1
        `, [author.id, author.name, author.nickname, author.avatarUrl, rolesJson, hasRoles]);

        // 2. Extract X links — only from content channels
        if (CONTENT_FILES.has(file)) {
            const xLinks = extractXLinks(msg.content);
            for (const link of xLinks) {
                const cleanLink  = link.split('?')[0];
                const urlAccount = (cleanLink.match(/x\.com\/([^/]+)\/status/) || [])[1] || '';
                if (bannedPosts.has(cleanLink) || bannedAccounts.has(urlAccount.toLowerCase())) continue;
                db.run(
                    `INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)`,
                    [cleanLink, author.id, msg.timestamp],
                    function (err) {
                        if (!err && this.changes > 0) {
                            db.run(`UPDATE users SET x_posts = x_posts + 1, total_points = total_points + 10 WHERE id = ?`, [author.id]);
                        }
                    }
                );
            }
        }

        // 3. Update time DB (always — not just for content channels)
        const dateOnly = msg.timestamp.split('T')[0];
        dbTime.run(`
            INSERT INTO user_daily_activity (user_id, date, discord_messages)
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET discord_messages = discord_messages + 1
        `, [author.id, dateOnly]);
    });

    pipeline.on('end', () => {
        console.log(`  → Processed: ${processed}, Skipped (overlap): ${skipped}`);
        results[file] = lastTs || lastTimestamps[file] || 'N/A';
        currentFileIndex++;
        processNextFile();
    });

    pipeline.on('error', err => {
        console.error(`Error in ${file}:`, err);
        currentFileIndex++;
        processNextFile();
    });
}

start();
