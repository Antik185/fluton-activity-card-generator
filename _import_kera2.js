/**
 * Full reimport of kera_sakit9 from ALL JSON sources (root + weekly folders).
 * Deduplicates by message ID. Resets and recalculates from scratch.
 */
const fs = require('fs'), path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const db     = new sqlite3.Database('database.sqlite');
const dbTime = new sqlite3.Database('database_time.sqlite');

const EARLY_ROLE_ID = '1460369693725687926';
const X_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/g;
const banlist = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedPosts = new Set(banlist.posts.map(p => p.split('?')[0]));

const rootFiles = fs.readdirSync('json').filter(f => f.endsWith('.json')).map(f => path.join('json', f));
const weekFolders = ['json/26.02 - 01.03','json/02.03 - 08.03','json/09.03 - 15.03','json/16.03-22.03','json/23.03-29.03'];
const weekFiles = weekFolders.flatMap(folder =>
    fs.existsSync(folder) ? fs.readdirSync(folder).filter(f => f.endsWith('.json')).map(f => path.join(folder, f)) : []
);
const allFiles = [...rootFiles, ...weekFiles];

// Collect all unique messages by ID
const msgById = {};
let latestAuthor = null;
let fileIdx = 0;

function scanNext() {
    if (fileIdx >= allFiles.length) {
        processCollected();
        return;
    }
    const fp = allFiles[fileIdx++];
    const pipeline = chain([
        fs.createReadStream(fp),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);
    pipeline.on('data', ({ value: msg }) => {
        if (!msg.author || msg.author.name !== 'kera_sakit9') return;
        const key = msg.id || msg.timestamp; // deduplicate by ID
        if (!msgById[key]) msgById[key] = msg;
        // Track latest author info (for most current roles)
        if (!latestAuthor || msg.timestamp > (latestAuthor._ts || '')) {
            latestAuthor = { ...msg.author, _ts: msg.timestamp };
        }
    });
    pipeline.on('end', () => scanNext());
    pipeline.on('error', () => scanNext());
}

function processCollected() {
    const msgs = Object.values(msgById);
    msgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    console.log('Unique messages after dedup:', msgs.length);

    const roles = (latestAuthor.roles || []).filter(r => r.id !== EARLY_ROLE_ID);
    console.log('Roles:', roles.map(r => r.name).join(', ') || 'none');

    // Per-date count
    const byDate = {};
    msgs.forEach(m => {
        const date = m.timestamp.split('T')[0];
        byDate[date] = (byDate[date] || 0) + 1;
    });
    console.log('Active dates:', Object.keys(byDate).length, '| Total messages:', msgs.length);

    // Unique X links
    const xLinks = new Set();
    msgs.forEach(m => {
        ((m.content || '').match(X_REGEX) || []).forEach(l => {
            const clean = l.split('?')[0];
            if (!bannedPosts.has(clean)) xLinks.add(clean);
        });
    });
    console.log('Unique X links:', xLinks.size, [...xLinks]);

    const userId = latestAuthor.id;

    db.serialize(() => {
        // Reset user record fully
        db.run(`DELETE FROM users WHERE id = ?`, [userId]);
        db.run(`DELETE FROM x_posts WHERE user_id = ?`, [userId]);

        dbTime.serialize(() => {
            dbTime.run(`DELETE FROM user_daily_activity WHERE user_id = ?`, [userId]);
        });

        // Reinsert user
        db.run(`
            INSERT INTO users (id, username, nickname, avatar_url, roles, discord_messages, x_posts, total_points)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `, [userId, latestAuthor.name, latestAuthor.nickname, latestAuthor.avatarUrl,
            JSON.stringify(roles), msgs.length, msgs.length]);

        // Insert X posts
        let xInserted = 0;
        xLinks.forEach(url => {
            const statusId = url.split('/status/')[1];
            const ownerMsg = msgs.find(m => (m.content || '').includes(statusId));
            const ts = ownerMsg ? ownerMsg.timestamp : msgs[0].timestamp;
            db.run(`INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)`,
                [url, userId, ts], function(err) {
                    if (!err && this.changes > 0) {
                        xInserted++;
                        db.run(`UPDATE users SET x_posts = x_posts + 1, total_points = total_points + 10 WHERE id = ?`, [userId]);
                    }
                });
        });

        db.run('SELECT 1', () => {}); // flush

        // Insert daily activity
        dbTime.serialize(() => {
            dbTime.run('BEGIN TRANSACTION');
            Object.entries(byDate).forEach(([date, count]) => {
                dbTime.run(`INSERT INTO user_daily_activity (user_id, date, discord_messages) VALUES (?, ?, ?)`, [userId, date, count]);
            });
            dbTime.run('COMMIT', () => {
                console.log('\nDone! By date:', JSON.stringify(byDate));
                db.close();
                dbTime.close();
            });
        });
    });
}

console.log('Scanning', allFiles.length, 'files...');
scanNext();
