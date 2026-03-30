/**
 * update_from_week5.js
 * Imports messages from json/16.03-22.03/ into both databases.
 * Uses last timestamps from json/09.03 - 15.03/ as thresholds to avoid duplicates.
 */

const fs   = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const jsonDirNew = path.join(__dirname, 'json', '16.03-22.03');
const dbPath     = path.join(__dirname, 'database.sqlite');
const dbTimePath = path.join(__dirname, 'database_time.sqlite');

const banlist     = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers = new Set(banlist.users);
const bannedPosts    = new Set(banlist.posts.map(p => p.split('?')[0]));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(a => a.toLowerCase()));

// Last timestamps from json/09.03 - 15.03/
// pakistani.json maps to Pakistani.json threshold, portugues.json to Portuguese.json threshold
const lastTimestamps = {
    'art-memes.json':   '2026-03-15T23:15:58.746+03:00',
    'content.json':     '2026-03-15T23:35:00.046+03:00',
    'fluton-pets.json': '2026-03-15T21:36:07.825+03:00',
    'general.json':     '2026-03-15T23:55:39.679+03:00',
    'gm.json':          '2026-03-15T23:52:23.229+03:00',
    'indian.json':      '2026-03-15T23:13:38.438+03:00',
    'indonesian.json':  '2026-03-15T23:58:55.388+03:00',
    'nigerian.json':    '2026-03-15T22:14:26.147+03:00',
    'russian.json':     '2026-03-15T23:14:07.543+03:00',
    'vietnamese.json':  '2026-03-15T23:02:18.679+03:00',
    'Chinese.json':     '2026-03-15T11:50:58.998+03:00',
    'pakistani.json':   '2026-03-15T22:54:16.521+03:00',
    'portugues.json':   '2026-03-15T14:18:12.925+03:00',
    'Turkey.json':      '2026-03-15T20:35:25.757+03:00',
    // Bangladeshi and ukraine had no data — no threshold
};

// Skip mascot-competition.json — handled separately
const SKIP_FILES = new Set(['mascot-competition.json']);
// Only extract X links from content channels (not general, gm, regional, etc.)
const CONTENT_FILES = new Set(['content.json', 'share-content.json', 'mascot-competition.json']);

const db     = new sqlite3.Database(dbPath);
const dbTime = new sqlite3.Database(dbTimePath);

function extractXLinks(content) {
    if (!content) return [];
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/g;
    return content.match(regex) || [];
}

let files = [];
let currentFileIndex = 0;
const results = {};

function start() {
    files = fs.readdirSync(jsonDirNew)
        .filter(f => f.endsWith('.json') && !SKIP_FILES.has(f));
    console.log(`Starting update from "16.03-22.03". Found ${files.length} files.`);

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
            console.log('\n✅ Database update complete!');
            console.log('\nFinal Timestamps per channel:');
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

        // 1. Update main DB — don't overwrite non-empty roles with empty ones
        const roles   = JSON.stringify(author.roles || []);
        const hasRoles = (author.roles || []).length > 0 ? 1 : 0;
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
        `, [author.id, author.name, author.nickname, author.avatarUrl, roles, hasRoles]);

        // 2. Extract X links — only from content/share-content/mascot-competition channels
        if (!CONTENT_FILES.has(file)) return;
        const xLinks = extractXLinks(msg.content);
        for (const link of xLinks) {
            const cleanLink = link.split('?')[0];
            const urlAccount = (cleanLink.match(/x\.com\/([^/]+)\/status/) || [])[1] || '';
            if (!bannedPosts.has(cleanLink) && !bannedAccounts.has(urlAccount.toLowerCase())) {
                db.run(
                    `INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)`,
                    [cleanLink, author.id, msg.timestamp],
                    function (err) {
                        if (!err && this.changes > 0) {
                            db.run(
                                `UPDATE users SET x_posts = x_posts + 1, total_points = total_points + 10 WHERE id = ?`,
                                [author.id]
                            );
                        }
                    }
                );
            }
        }

        // 3. Update time DB
        const dateOnly = msg.timestamp.split('T')[0];
        dbTime.run(`
            INSERT INTO user_daily_activity (user_id, date, discord_messages)
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET
                discord_messages = discord_messages + 1
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
