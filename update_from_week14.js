/**
 * update_from_week14.js
 * Imports messages from json/25.05-31.05/ into both databases.
 * Automatically uses last timestamps from json/18.05-24.05/ to avoid duplicates.
 * NOTE: Some channels were renamed — handled via FILENAME_MAP.
 */

const fs      = require('fs');
const path    = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain }       = require('stream-chain');
const { parser }      = require('stream-json');
const { pick }        = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const jsonDirNew = path.join(__dirname, 'json', '25.05-31.05');
const jsonDirOld = path.join(__dirname, 'json', '18.05-24.05');
const dbPath     = path.join(__dirname, 'database.sqlite');
const dbTimePath = path.join(__dirname, 'database_time.sqlite');

const banlist        = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers    = new Set(banlist.users);
const bannedPosts    = new Set(banlist.posts.map(p => p.split('?')[0]));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(a => a.toLowerCase()));

// Map: new filename → old filename (for renamed channels)
const FILENAME_MAP = {
    'bangladesh.json':              'Bangladesh.json',
    'indian-chat.json':             'indian.json',
    'indonesian-chat.json':         'indonesian.json',
    'nigerian-chat.json':           'nigerian.json',
    'tro-chuyen-tieng-viet.json':   'Vietnam.json',
    'turkey.json':                  'Turkey.json',
    'ukraine.json':                 'Ukraine.json',
};

function getThresholds() {
    const thresholds = {};
    if (!fs.existsSync(jsonDirOld)) return thresholds;

    const prevFiles = fs.readdirSync(jsonDirOld).filter(f => f.endsWith('.json'));
    for (const file of prevFiles) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(jsonDirOld, file), 'utf8'));
            const msgs = data.messages || (Array.isArray(data) ? data : []);
            let maxTs = '';
            for (const m of msgs) {
                if (m.timestamp && m.timestamp > maxTs) maxTs = m.timestamp;
            }
            if (maxTs) thresholds[file] = maxTs;
        } catch (e) {}
    }
    return thresholds;
}

const oldThresholds = getThresholds();

// Resolve threshold for a new filename (handles renames)
function getThreshold(newFile) {
    // Direct match (same name)
    if (oldThresholds[newFile]) return new Date(oldThresholds[newFile]);
    // Via rename map
    const oldFile = FILENAME_MAP[newFile];
    if (oldFile && oldThresholds[oldFile]) return new Date(oldThresholds[oldFile]);
    return new Date(0);
}

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
    if (!fs.existsSync(jsonDirNew)) {
        console.error(`Папка не найдена: ${jsonDirNew}`);
        process.exit(1);
    }
    files = fs.readdirSync(jsonDirNew)
        .filter(f => f.endsWith('.json') && !SKIP_FILES.has(f));
    console.log(`Starting update from "25.05-31.05". Found ${files.length} files.`);

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
    const threshold = getThreshold(file);
    const filePath  = path.join(jsonDirNew, file);
    const oldName   = FILENAME_MAP[file] || file;
    console.log(`\nProcessing ${file} (← ${oldName}, threshold: ${threshold.toISOString()})`);

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

        // 3. Update time DB
        const dateOnly = msg.timestamp.split('T')[0];
        dbTime.run(`
            INSERT INTO user_daily_activity (user_id, date, discord_messages)
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET discord_messages = discord_messages + 1
        `, [author.id, dateOnly]);
    });

    pipeline.on('end', () => {
        console.log(`  → Processed: ${processed}, Skipped (overlap): ${skipped}`);
        results[file] = lastTs || 'N/A';
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
