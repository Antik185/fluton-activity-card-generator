/**
 * Imports one weekly JSON export after the previous weekly export.
 * Files are matched by Discord channel ID so channel renames do not duplicate data.
 * Override the default folders with NEW_PERIOD and PREVIOUS_PERIOD.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const NEW_PERIOD = process.env.NEW_PERIOD || '28.09-04.10';
const PREVIOUS_PERIOD = process.env.PREVIOUS_PERIOD || '21.09-27.09';
const jsonDirNew = path.join(__dirname, 'json', NEW_PERIOD);
const jsonDirOld = path.join(__dirname, 'json', PREVIOUS_PERIOD);
const dbPath = path.join(__dirname, 'database.sqlite');
const dbTimePath = path.join(__dirname, 'database_time.sqlite');

const SHARE_CONTENT_CHANNEL_ID = '1459068999664140453';
const banlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'banlist.json'), 'utf8'));
const bannedUsers = new Set(banlist.users);
const bannedPosts = new Set(banlist.posts.map(post => post.split('?')[0]));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(account => account.toLowerCase()));

function getChannelId(filename) {
    const match = filename.match(/\[(\d+)\]/);
    return match ? match[1] : filename;
}

function getThresholds() {
    const thresholds = new Map();
    if (!fs.existsSync(jsonDirOld)) return thresholds;

    const files = fs.readdirSync(jsonDirOld).filter(file => file.endsWith('.json'));
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(jsonDirOld, file), 'utf8'));
            const messages = data.messages || (Array.isArray(data) ? data : []);
            let maxTimestamp = '';
            for (const message of messages) {
                if (message.timestamp && message.timestamp > maxTimestamp) {
                    maxTimestamp = message.timestamp;
                }
            }
            if (maxTimestamp) thresholds.set(getChannelId(file), maxTimestamp);
        } catch (error) {
            console.warn(`Could not read previous export ${file}: ${error.message}`);
        }
    }
    return thresholds;
}

function extractXLinks(content) {
    if (!content) return [];
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/g;
    return content.match(regex) || [];
}

const oldThresholds = getThresholds();
const db = new sqlite3.Database(dbPath);
const dbTime = new sqlite3.Database(dbTimePath);
const results = {};
let files = [];
let currentFileIndex = 0;

function finish() {
    db.run('COMMIT', dbError => {
        if (dbError) throw dbError;
        dbTime.run('COMMIT', timeError => {
            if (timeError) throw timeError;
            console.log('\nMessages imported.');
            console.log('\nFinal timestamps per channel:');
            for (const [channel, timestamp] of Object.entries(results)) {
                console.log(`  ${channel}: ${timestamp}`);
            }
            db.close();
            dbTime.close();
        });
    });
}

function processNextFile() {
    if (currentFileIndex >= files.length) {
        finish();
        return;
    }

    const file = files[currentFileIndex];
    const channelId = getChannelId(file);
    const threshold = new Date(oldThresholds.get(channelId) || 0);
    const filePath = path.join(jsonDirNew, file);
    let processed = 0;
    let skipped = 0;
    let lastTimestamp = null;

    console.log(`\nProcessing ${file}`);
    console.log(`  Channel: ${channelId}, threshold: ${threshold.toISOString()}`);

    const pipeline = chain([
        fs.createReadStream(filePath),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);

    pipeline.on('data', data => {
        const message = data.value;
        const author = message.author;
        if (!author || author.isBot || bannedUsers.has(author.name)) return;

        const messageDate = new Date(message.timestamp);
        if (messageDate <= threshold) {
            skipped++;
            return;
        }

        processed++;
        lastTimestamp = message.timestamp;
        const roles = author.roles || [];
        const rolesJson = JSON.stringify(roles);
        const hasRoles = roles.length > 0 ? 1 : 0;

        db.run(`
            INSERT INTO users (id, username, nickname, avatar_url, roles, discord_messages, total_points)
            VALUES (?, ?, ?, ?, ?, 1, 1)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                nickname = excluded.nickname,
                avatar_url = excluded.avatar_url,
                roles = CASE WHEN ? = 1 THEN excluded.roles ELSE roles END,
                discord_messages = discord_messages + 1,
                total_points = total_points + 1
        `, [author.id, author.name, author.nickname, author.avatarUrl, rolesJson, hasRoles]);

        if (channelId === SHARE_CONTENT_CHANNEL_ID) {
            for (const link of extractXLinks(message.content)) {
                const cleanLink = link.split('?')[0];
                const accountMatch = cleanLink.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status/);
                const account = accountMatch ? accountMatch[1].toLowerCase() : '';
                if (bannedPosts.has(cleanLink) || bannedAccounts.has(account)) continue;

                db.run(
                    'INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)',
                    [cleanLink, author.id, message.timestamp],
                    function onInsert(error) {
                        if (error) throw error;
                        if (this.changes > 0) {
                            db.run(
                                'UPDATE users SET x_posts = x_posts + 1, total_points = total_points + 10 WHERE id = ?',
                                [author.id]
                            );
                        }
                    }
                );
            }
        }

        const dateOnly = message.timestamp.split('T')[0];
        dbTime.run(`
            INSERT INTO user_daily_activity (user_id, date, discord_messages)
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET
                discord_messages = discord_messages + 1
        `, [author.id, dateOnly]);
    });

    pipeline.on('end', () => {
        console.log(`  Processed: ${processed}, skipped overlap: ${skipped}`);
        results[channelId] = lastTimestamp || 'N/A';
        currentFileIndex++;
        processNextFile();
    });

    pipeline.on('error', error => {
        console.error(`Error in ${file}:`, error);
        process.exitCode = 1;
        db.run('ROLLBACK');
        dbTime.run('ROLLBACK');
    });
}

function start() {
    if (!fs.existsSync(jsonDirNew)) {
        throw new Error(`Export folder not found: ${jsonDirNew}`);
    }
    files = fs.readdirSync(jsonDirNew).filter(file => file.endsWith('.json'));
    console.log(`Starting ${NEW_PERIOD} import. Found ${files.length} files.`);
    db.run('BEGIN TRANSACTION');
    dbTime.run('BEGIN TRANSACTION', processNextFile);
}

start();
