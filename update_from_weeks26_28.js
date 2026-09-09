/**
 * Imports the 17.08-06.09 export and keeps every message on its original day.
 * Exporter filenames include the guild/category/channel prefix, so content
 * channels are detected by channel name within the filename.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const SOURCE_DIR = path.join(__dirname, 'json', '17.08-06.09');
const RANGE_START = '2026-08-17';
const RANGE_END = '2026-09-06';

const banlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'banlist.json'), 'utf8'));
const bannedUsers = new Set(banlist.users || []);
const bannedPosts = new Set((banlist.posts || []).map(p => p.split('?')[0]));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(a => a.toLowerCase()));

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));
const dbTime = new sqlite3.Database(path.join(__dirname, 'database_time.sqlite'));

const run = (database, sql, params = []) => new Promise((resolve, reject) => {
    database.run(sql, params, function (err) {
        if (err) reject(err); else resolve(this);
    });
});

const get = (database, sql, params = []) => new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const finalize = stmt => new Promise((resolve, reject) => {
    stmt.finalize(err => err ? reject(err) : resolve());
});

function isContentChannel(file) {
    const normalized = file.toLowerCase();
    return normalized.includes('share-content') ||
        normalized.includes('mascot-competition') ||
        normalized.includes('content.json');
}

function extractXLinks(content) {
    if (!content) return [];
    return content.match(/(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/g) || [];
}

function processFile(file, statements) {
    return new Promise((resolve, reject) => {
        let processed = 0;
        let outsideRange = 0;
        let xLinks = 0;
        let lastTimestamp = null;

        const pipeline = chain([
            fs.createReadStream(path.join(SOURCE_DIR, file)),
            parser(),
            pick({ filter: 'messages' }),
            streamArray()
        ]);

        pipeline.on('data', ({ value: msg }) => {
            const author = msg.author;
            if (!author || author.isBot || bannedUsers.has(author.name) || !msg.timestamp) return;

            const dateOnly = msg.timestamp.slice(0, 10);
            if (dateOnly < RANGE_START || dateOnly > RANGE_END) {
                outsideRange++;
                return;
            }

            processed++;
            lastTimestamp = msg.timestamp;
            const roles = author.roles || [];
            statements.user.run(
                author.id,
                author.name,
                author.nickname,
                author.avatarUrl,
                JSON.stringify(roles),
                roles.length > 0 ? 1 : 0
            );
            statements.daily.run(author.id, dateOnly);

            if (isContentChannel(file)) {
                for (const link of extractXLinks(msg.content)) {
                    const cleanLink = link.split('?')[0];
                    const accountMatch = cleanLink.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status/i);
                    const account = accountMatch ? accountMatch[1].toLowerCase() : '';
                    if (bannedPosts.has(cleanLink) || bannedAccounts.has(account)) continue;
                    statements.xPost.run(cleanLink, author.id, msg.timestamp);
                    xLinks++;
                }
            }
        });

        pipeline.on('end', () => resolve({ file, processed, outsideRange, xLinks, lastTimestamp }));
        pipeline.on('error', reject);
    });
}

async function main() {
    if (!fs.existsSync(SOURCE_DIR)) throw new Error(`Source folder not found: ${SOURCE_DIR}`);

    const current = await get(dbTime, 'SELECT MAX(date) AS maxDate FROM user_daily_activity');
    if (current.maxDate && current.maxDate >= RANGE_START) {
        throw new Error(`Import aborted: database already contains ${current.maxDate}. Expected latest date before ${RANGE_START}.`);
    }

    const files = fs.readdirSync(SOURCE_DIR).filter(file => file.endsWith('.json')).sort();
    console.log(`Importing ${files.length} files for ${RANGE_START} -> ${RANGE_END}`);

    await run(db, 'BEGIN IMMEDIATE TRANSACTION');
    await run(dbTime, 'BEGIN IMMEDIATE TRANSACTION');

    const statements = {
        user: db.prepare(`
            INSERT INTO users (id, username, nickname, avatar_url, roles, discord_messages, total_points)
            VALUES (?, ?, ?, ?, ?, 1, 1)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                nickname = excluded.nickname,
                avatar_url = excluded.avatar_url,
                roles = CASE WHEN ? = 1 THEN excluded.roles ELSE roles END,
                discord_messages = discord_messages + 1,
                total_points = total_points + 1
        `),
        xPost: db.prepare('INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)'),
        daily: dbTime.prepare(`
            INSERT INTO user_daily_activity (user_id, date, discord_messages)
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET discord_messages = discord_messages + 1
        `)
    };

    try {
        for (const file of files) {
            const result = await processFile(file, statements);
            console.log(`${file}: ${result.processed} messages, ${result.xLinks} X links, last ${result.lastTimestamp || 'n/a'}`);
        }

        await Promise.all(Object.values(statements).map(finalize));
        await run(db, `
            UPDATE users SET x_posts = (
                SELECT COUNT(*) FROM x_posts WHERE x_posts.user_id = users.id
            )
        `);
        await run(db, 'COMMIT');
        await run(dbTime, 'COMMIT');
        console.log('Import completed successfully.');
    } catch (err) {
        await Promise.allSettled([run(db, 'ROLLBACK'), run(dbTime, 'ROLLBACK')]);
        throw err;
    } finally {
        db.close();
        dbTime.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
