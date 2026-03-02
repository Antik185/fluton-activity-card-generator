const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const jsonDir2 = path.join(__dirname, 'json', '2');
const dbPath = path.join(__dirname, 'database.sqlite');
const dbTimePath = path.join(__dirname, 'database_time.sqlite');

const banlist = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers = new Set(banlist.users);
const bannedPosts = new Set(banlist.posts.map(p => p.split('?')[0]));

const lastTimestamps = {
    "art-memes.json": "2026-02-24T22:49:25.104+03:00",
    "bug-report.json": "2026-02-20T13:19:26.976+03:00",
    "feedback.json": "2026-02-20T13:29:28.975+03:00",
    "fluton-pets.json": "2026-02-20T12:50:02.254+03:00",
    "gm.json": "2026-02-24T23:24:14.572+03:00",
    "indian.json": "2026-02-24T23:20:54.551+03:00",
    "indonesian.json": "2026-02-24T23:28:14.201+03:00",
    "nigerian.json": "2026-02-24T22:06:08.253+03:00",
    "russian.json": "2026-02-24T23:16:13.985+03:00",
    "suggestions.json": "2026-02-24T14:25:53.182+03:00",
    "vietnamese.json": "2026-02-24T21:20:23.3+03:00",
    "general.json": "2026-02-25T13:23:14.188+03:00",
    "content.json": "2026-02-24T22:59:05.73+03:00"
};

const db = new sqlite3.Database(dbPath);
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
    files = fs.readdirSync(jsonDir2).filter(f => f.endsWith('.json'));
    console.log(`Starting update from folder 2. Found ${files.length} files.`);

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
            console.log("\n✅ Database update complete!");
            console.log("\nFinal Timestamps per channel:");
            for (const [chan, ts] of Object.entries(results)) {
                console.log(`${chan}: ${ts}`);
            }
            db.close();
            dbTime.close();
            process.exit(0);
        });
        return;
    }

    const file = files[currentFileIndex];
    const threshold = lastTimestamps[file] ? new Date(lastTimestamps[file]) : new Date(0);
    const filePath = path.join(jsonDir2, file);
    console.log(`Processing ${file} (threshold: ${threshold.toISOString()})`);

    let processed = 0;
    let skipped = 0;
    let lastTs = null;

    const pipeline = chain([
        fs.createReadStream(filePath),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);

    pipeline.on('data', data => {
        const msg = data.value;
        const author = msg.author;
        if (!author || author.isBot || bannedUsers.has(author.name)) return;

        const msgDate = new Date(msg.timestamp);
        if (msgDate <= threshold) {
            skipped++;
            return;
        }

        processed++;
        lastTs = msg.timestamp;

        // 1. Update main DB (Discord count + Base point)
        const roles = JSON.stringify(author.roles || []);
        db.run(`
            INSERT INTO users (id, username, nickname, avatar_url, roles, discord_messages, total_points)
            VALUES (?, ?, ?, ?, ?, 1, 1)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                nickname = excluded.nickname,
                avatar_url = excluded.avatar_url,
                roles = excluded.roles,
                discord_messages = discord_messages + 1,
                total_points = total_points + 1
        `, [author.id, author.name, author.nickname, author.avatarUrl, roles]);

        // 2. Extract X info
        const xLinks = extractXLinks(msg.content);
        for (const link of xLinks) {
            const cleanLink = link.split('?')[0];
            if (!bannedPosts.has(cleanLink)) {
                db.run(`INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)`,
                    [cleanLink, author.id, msg.timestamp],
                    function (err) {
                        if (!err && this.changes > 0) {
                            // Successful new post insert -> add 10 points
                            db.run(`UPDATE users SET x_posts = x_posts + 1, total_points = total_points + 10 WHERE id = ?`, [author.id]);
                        }
                    }
                );
            }
        }

        // 3. Update Time DB (Daily stats)
        const dateOnly = msg.timestamp.split('T')[0];
        dbTime.run(`
            INSERT INTO user_daily_activity (user_id, date, discord_messages)
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET
                discord_messages = discord_messages + 1
        `, [author.id, dateOnly]);
    });

    pipeline.on('end', () => {
        console.log(`Finished ${file}. Processed: ${processed}, Skipped (overlap): ${skipped}`);
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
