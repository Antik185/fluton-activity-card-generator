const fs = require('fs');
const path = require('path');
const db = require('./db');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const jsonDir = path.join(__dirname, 'json');
const banlist = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers = new Set(banlist.users);
const bannedPosts = new Set(banlist.posts.map(p => p.split('?')[0]));

function extractXLinks(content) {
    if (!content) return [];
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/g;
    const matches = content.match(regex);
    return matches || [];
}

let files = [];
let currentFileIndex = 0;
let insertUserStmt, insertXPostStmt, updateXPostCountStmt;
let processedMessages = 0;

function startParsing() {
    if (!fs.existsSync(jsonDir)) {
        console.error("JSON directory not found: " + jsonDir);
        return;
    }

    files = fs.readdirSync(jsonDir).filter(file => file.endsWith('.json'));
    console.log("Found " + files.length + " JSON files to process.");

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        insertUserStmt = db.prepare(`
            INSERT INTO users (id, username, nickname, avatar_url, roles, discord_messages, x_posts, total_points)
            VALUES (?, ?, ?, ?, ?, 1, 0, 1)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                nickname = excluded.nickname,
                avatar_url = excluded.avatar_url,
                roles = excluded.roles,
                discord_messages = discord_messages + 1,
                total_points = total_points + 1
        `);

        insertXPostStmt = db.prepare(`
            INSERT OR IGNORE INTO x_posts (url, user_id, timestamp)
            VALUES (?, ?, ?)
        `);

        updateXPostCountStmt = db.prepare(`
            UPDATE users 
            SET x_posts = x_posts + 1,
                total_points = total_points + 10
            WHERE id = ?
        `);

        processNextFile();
    });
}

function processNextFile() {
    if (currentFileIndex >= files.length) {
        // All done
        insertUserStmt.finalize();
        insertXPostStmt.finalize();
        updateXPostCountStmt.finalize();

        db.run('COMMIT', (err) => {
            if (err) console.error("Commit failed:", err);
            else console.log("✅ Parsing complete! Database is ready.");
            process.exit(0);
        });
        return;
    }

    const file = files[currentFileIndex];
    const filePath = path.join(jsonDir, file);

    console.log("Reading file: " + file);
    processedMessages = 0;

    const pipeline = chain([
        fs.createReadStream(filePath),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);

    pipeline.on('data', data => {
        const msg = data.value;
        const author = msg.author;
        // Skip banned users and bots
        if (!author || author.isBot || bannedUsers.has(author.name)) {
            return;
        }

        processedMessages++;
        const roles = JSON.stringify(author.roles || []);

        // Queue user upsert
        insertUserStmt.run(author.id, author.name, author.nickname, author.avatarUrl, roles);

        // Queue X links
        const xLinks = extractXLinks(msg.content);
        for (const link of xLinks) {
            const cleanLink = link.split('?')[0];
            if (!bannedPosts.has(cleanLink)) {
                insertXPostStmt.run(cleanLink, author.id, msg.timestamp, function (err) {
                    if (!err && this.changes > 0) {
                        updateXPostCountStmt.run(author.id);
                    }
                });
            }
        }
    });

    pipeline.on('end', () => {
        console.log("Finished " + file + ". Processed " + processedMessages + " messages.");
        currentFileIndex++;
        processNextFile(); // Queue recursion to process next sequentially without max stack
    });

    pipeline.on('error', err => {
        console.error("Error streaming file " + file + ":", err);
        currentFileIndex++;
        processNextFile();
    });
}

// Timeout to ensure DB schema is created
setTimeout(startParsing, 1000);
