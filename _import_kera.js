/**
 * Import kera_sakit9 from all JSON folders (was in banlist, now unbanned).
 * Removes Early role since server purge happened.
 */
const fs = require('fs'), path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db     = new sqlite3.Database('database.sqlite');
const dbTime = new sqlite3.Database('database_time.sqlite');

const EARLY_ROLE_ID = '1460369693725687926';
const X_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/g;
const banlist = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedPosts = new Set(banlist.posts.map(p => p.split('?')[0]));

const folders = [
    'json/26.02 - 01.03',
    'json/02.03 - 08.03',
    'json/09.03 - 15.03',
    'json/16.03-22.03',
    'json/23.03-29.03',
];

// Collect all messages from kera_sakit9 across all folders
const allMsgs = [];
folders.forEach(folder => {
    if (!fs.existsSync(folder)) return;
    fs.readdirSync(folder).filter(f => f.endsWith('.json')).forEach(file => {
        const data = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
        const msgs = data.messages || data;
        if (!Array.isArray(msgs)) return;
        msgs.filter(m => m.author && m.author.name === 'kera_sakit9')
            .forEach(m => allMsgs.push(m));
    });
});

allMsgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
console.log('Total messages found:', allMsgs.length);

if (!allMsgs.length) { console.log('No messages found.'); process.exit(0); }

// Use latest author info, remove Early (server purge)
const latestAuthor = allMsgs[allMsgs.length - 1].author;
const roles = (latestAuthor.roles || []).filter(r => r.id !== EARLY_ROLE_ID);
console.log('Roles (Early removed):', roles.map(r => r.name).join(', ') || 'none');

// Per-date message count
const byDate = {};
allMsgs.forEach(m => {
    const date = m.timestamp.split('T')[0];
    byDate[date] = (byDate[date] || 0) + 1;
});

// Unique X links
const xLinks = new Set();
allMsgs.forEach(m => {
    const links = (m.content || '').match(X_REGEX) || [];
    links.forEach(l => { const clean = l.split('?')[0]; if (!bannedPosts.has(clean)) xLinks.add(clean); });
});
console.log('Unique X links:', xLinks.size, [...xLinks]);

db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    dbTime.run('BEGIN TRANSACTION');

    // Insert user
    db.run(`
        INSERT INTO users (id, username, nickname, avatar_url, roles, discord_messages, x_posts, total_points)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
            username         = excluded.username,
            nickname         = excluded.nickname,
            avatar_url       = excluded.avatar_url,
            roles            = excluded.roles,
            discord_messages = excluded.discord_messages,
            total_points     = excluded.total_points
    `, [
        latestAuthor.id,
        latestAuthor.name,
        latestAuthor.nickname,
        latestAuthor.avatarUrl,
        JSON.stringify(roles),
        allMsgs.length,
        allMsgs.length   // 1pt per message, X will be recalculated by fetch_x_metrics
    ], err => { if (err) console.error('user insert:', err.message); });

    // Insert X posts
    xLinks.forEach(url => {
        // Find first occurrence timestamp
        let ts = null;
        for (const m of allMsgs) {
            if ((m.content || '').includes(url.split('/status/')[1])) { ts = m.timestamp; break; }
        }
        db.run(`INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)`,
            [url, latestAuthor.id, ts || allMsgs[0].timestamp], function (err) {
                if (!err && this.changes > 0) {
                    db.run(`UPDATE users SET x_posts = x_posts + 1, total_points = total_points + 10 WHERE id = ?`, [latestAuthor.id]);
                }
            });
    });

    // Insert daily activity
    Object.entries(byDate).forEach(([date, count]) => {
        dbTime.run(`
            INSERT INTO user_daily_activity (user_id, date, discord_messages)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET discord_messages = discord_messages + excluded.discord_messages
        `, [latestAuthor.id, date, count]);
    });

    db.run('COMMIT', err => { if (err) console.error('commit:', err.message); });
    dbTime.run('COMMIT', err => {
        if (err) console.error('timedb commit:', err.message);
        console.log('Done. Messages by date:', byDate);
        db.close(); dbTime.close();
    });
});
