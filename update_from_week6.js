/**
 * update_from_week6.js
 * Imports messages from json/23.03-29.03/ into both databases.
 * Uses last timestamps from json/16.03-22.03/ as thresholds to avoid duplicates.
 *
 * Also handles Early role purge: users who appear in new JSON without the Early role
 * will have it removed from the database (server purged it).
 */

const fs      = require('fs');
const path    = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain }       = require('stream-chain');
const { parser }      = require('stream-json');
const { pick }        = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const jsonDirNew = path.join(__dirname, 'json', '23.03-29.03');
const dbPath     = path.join(__dirname, 'database.sqlite');
const dbTimePath = path.join(__dirname, 'database_time.sqlite');

const banlist     = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers = new Set(banlist.users);
const bannedPosts    = new Set(banlist.posts.map(p => p.split('?')[0]));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(a => a.toLowerCase()));

const EARLY_ROLE_ID = '1460369693725687926';

// Last timestamps from json/16.03-22.03/ (used as thresholds)
// File names changed in the new folder — map new filenames to old thresholds
const lastTimestamps = {
    'art-memes.json':   '2026-03-22T22:26:31.14+02:00',
    'content.json':     '2026-03-22T22:52:56.942+02:00',
    'fluton-pets.json': '2026-03-22T23:18:09.307+02:00',
    'general.json':     '2026-03-22T23:53:18.66+02:00',
    'gm.json':          '2026-03-22T23:13:13.163+02:00',
    'india.json':       '2026-03-22T21:42:21.22+02:00',    // was indian.json
    'indonesian.json':  '2026-03-22T23:39:06.529+02:00',
    'nigerian.json':    '2026-03-22T23:17:47.708+02:00',
    'pakistani.json':   '2026-03-22T23:28:25.202+02:00',
    'portugues.json':   '2026-03-22T15:11:59.24+02:00',
    'Russian.json':     '2026-03-22T23:53:52.777+02:00',   // was russian.json
    'turkey.json':      '2026-03-22T21:38:09.738+02:00',   // was Turkey.json
    'ukraine.json':     '2026-03-22T22:54:11.14+02:00',
    'vietnamese.json':  '2026-03-22T21:52:46.107+02:00',
    'bangladesh.json':  '2026-03-22T21:32:06.173+02:00',   // was Bangladeshi.json
    'chinese.json':     '2026-03-22T19:27:43.294+02:00',   // was Chinese.json
};

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

let files            = [];
let currentFileIndex = 0;
const results        = {};

// Track best roles per user across all new JSON files
// user_id -> roles array (prefer non-empty, most entries wins)
const userBestRoles  = {};

function start() {
    files = fs.readdirSync(jsonDirNew)
        .filter(f => f.endsWith('.json') && !SKIP_FILES.has(f));
    console.log(`Starting update from "23.03-29.03". Found ${files.length} files.`);

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
            runPostProcessing();
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

        // Track best roles for this user
        const newRoles = author.roles || [];
        const existing = userBestRoles[author.id];
        if (!existing || newRoles.length > existing.length) {
            userBestRoles[author.id] = newRoles;
        }

        // 1. Update main DB (CASE WHEN: don't overwrite non-empty roles with empty)
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

/* ── Post-processing: Early role purge ─────────────────────── */
function runPostProcessing() {
    console.log('\n🔧 Post-processing: Early role purge...');

    // Users seen in new JSON with best roles that DON'T include Early
    const usersToRemoveEarly = Object.entries(userBestRoles)
        .filter(([, roles]) => roles.length > 0 && !roles.some(r => r.id === EARLY_ROLE_ID))
        .map(([id]) => id);

    if (usersToRemoveEarly.length === 0) {
        console.log('  No users to remove Early role from.');
        finalReport();
        return;
    }

    console.log(`  Checking ${usersToRemoveEarly.length} users for Early role removal...`);

    let removed = 0;
    let pending = usersToRemoveEarly.length;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        usersToRemoveEarly.forEach(userId => {
            db.get('SELECT id, roles FROM users WHERE id = ?', [userId], (err, row) => {
                if (!row) { if (--pending === 0) commitAndFinish(); return; }
                let roles = [];
                try { roles = JSON.parse(row.roles) || []; } catch (_) {}
                const hadEarly = roles.some(r => r.id === EARLY_ROLE_ID);
                if (!hadEarly) { if (--pending === 0) commitAndFinish(); return; }
                const newRoles = roles.filter(r => r.id !== EARLY_ROLE_ID);
                db.run('UPDATE users SET roles = ? WHERE id = ?', [JSON.stringify(newRoles), userId], () => {
                    removed++;
                    if (--pending === 0) commitAndFinish();
                });
            });
        });

        function commitAndFinish() {
            db.run('COMMIT', () => {
                console.log(`  → Early role removed from ${removed} users.`);
                finalReport();
            });
        }
    });
}

function finalReport() {
    console.log('\n📋 Final timestamps per channel:');
    for (const [chan, ts] of Object.entries(results)) {
        console.log(`  ${chan}: ${ts}`);
    }
    console.log('\n✅ All done!');
    db.close();
    dbTime.close();
    process.exit(0);
}

start();
