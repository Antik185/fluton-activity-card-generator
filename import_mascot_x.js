/**
 * import_mascot_x.js
 * Imports tweet URLs from json/mascot-competition.json into x_posts table.
 * Safe to run multiple times — INSERT OR IGNORE prevents duplicates.
 *
 * After running this, run:
 *   node fetch_x_metrics.js
 *   node sync_x_to_timedb.js
 *   node generate_leaderboard.js
 *   node snapshot_leaderboard.js
 */

const fs     = require('fs');
const path   = require('path');
const sqlite3 = require('sqlite3').verbose();

const DC_JSON_PATH = path.join(__dirname, 'json', 'mascot-competition.json');
const dbPath       = path.join(__dirname, 'database.sqlite');

const banlist     = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers = new Set(banlist.users);
const bannedPosts = new Set(banlist.posts.map(p => p.split('?')[0]));

const db = new sqlite3.Database(dbPath);

function extractTweetUrl(content) {
    if (!content) return null;
    const m = content.match(/https?:\/\/(?:x\.com|twitter\.com)\/\S+\/status\/\d+/);
    return m ? m[0].split('?')[0] : null;
}

async function run() {
    console.log(`Reading ${DC_JSON_PATH} ...`);
    const data = JSON.parse(fs.readFileSync(DC_JSON_PATH, 'utf8'));
    const messages = data.messages || [];
    console.log(`Total messages in mascot-competition: ${messages.length}`);

    let newPosts = 0;

    await new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            const upsertUser = db.prepare(`
                INSERT INTO users (id, username, nickname, avatar_url, roles, discord_messages, x_posts, total_points)
                VALUES (?, ?, ?, ?, ?, 0, 0, 0)
                ON CONFLICT(id) DO UPDATE SET
                    username   = excluded.username,
                    nickname   = excluded.nickname,
                    avatar_url = excluded.avatar_url,
                    roles      = excluded.roles
            `);

            for (const msg of messages) {
                const author = msg.author;
                if (!author || author.isBot || bannedUsers.has(author.name)) continue;

                const url = extractTweetUrl(msg.content);
                if (!url || bannedPosts.has(url)) continue;

                const roles = JSON.stringify(author.roles || []);
                upsertUser.run(author.id, author.name, author.nickname, author.avatarUrl, roles);

                db.run(
                    `INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)`,
                    [url, author.id, msg.timestamp],
                    function(err) {
                        if (!err && this.changes > 0) newPosts++;
                    }
                );
            }

            upsertUser.finalize(err => {
                if (err) return reject(err);
                db.run('COMMIT', err => err ? reject(err) : resolve());
            });
        });
    });

    console.log(`Inserted ${newPosts} new tweet URLs from mascot-competition.`);

    // Recalculate x_posts count for all users based on actual rows in x_posts table
    await new Promise((resolve, reject) => {
        db.run(`
            UPDATE users SET
                x_posts = (SELECT COUNT(*) FROM x_posts WHERE x_posts.user_id = users.id)
        `, err => {
            if (err) return reject(err);
            console.log('Recalculated x_posts counts for all users.');
            resolve();
        });
    });

    console.log('\nDone. Next steps:');
    console.log('  node fetch_x_metrics.js');
    console.log('  node sync_x_to_timedb.js');
    console.log('  node generate_leaderboard.js');
    console.log('  node snapshot_leaderboard.js');

    db.close();
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
