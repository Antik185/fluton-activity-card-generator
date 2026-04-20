/**
 * update_from_week9.js
 * Imports messages from json/13.04-19.04/ into both databases.
 * Uses last timestamps from json/06.04-12.04/ as thresholds to avoid duplicates.
 * Note: indian.json (was indian-chat.json last week), share-content.json returned.
 */

const fs      = require('fs');
const path    = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain }       = require('stream-chain');
const { parser }      = require('stream-json');
const { pick }        = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const jsonDirNew = path.join(__dirname, 'json', '13.04-19.04');
const dbPath     = path.join(__dirname, 'database.sqlite');
const dbTimePath = path.join(__dirname, 'database_time.sqlite');

const banlist        = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers    = new Set(banlist.users);
const bannedPosts    = new Set(banlist.posts.map(p => p.split('?')[0]));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(a => a.toLowerCase()));

// Last timestamps from json/06.04-12.04/
// indian.json threshold = indian-chat.json from previous week (channel renamed back)
// share-content.json threshold = last known from 09.03-15.03 (was absent weeks 7-8)
const lastTimestamps = {
    'art-memes.json':    '2026-04-12T21:49:02.693+02:00',
    'bangladesh.json':   '2026-04-12T20:53:37.089+02:00',
    'fluton-pets.json':  '2026-04-12T19:24:04.374+02:00',
    'general.json':      '2026-04-12T23:57:04.61+02:00',
    'gm.json':           '2026-04-12T13:55:40.656+02:00',
    'indian.json':       '2026-04-12T23:24:14.414+02:00',   // was indian-chat.json last week
    'indonesian.json':   '2026-04-12T23:57:54.929+02:00',
    'nigerian.json':     '2026-04-12T23:58:29.691+02:00',
    'pakistani.json':    '2026-04-12T22:26:27.894+02:00',
    'russian.json':      '2026-04-12T23:36:38.379+02:00',
    'share-content.json':'2026-03-10T19:05:59.893+03:00',   // returned after weeks 7-8 absence
    'turkey.json':       '2026-04-12T12:33:33.872+02:00',
    'ukraine.json':      '2026-04-12T19:25:20.404+02:00',
    'vietnamese.json':   '2026-04-12T19:50:48.756+02:00',
};

const SKIP_FILES    = new Set(['mascot-competition.json']);
const CONTENT_FILES = new Set(['content.json', 'share-content.json', 'mascot-competition.json']);

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
    console.log(`Starting update from "13.04-19.04". Found ${files.length} files.`);

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
