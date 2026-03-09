/**
 * sync_x_to_timedb.js
 * Resets X metric columns in database_time.sqlite and re-populates
 * them from database.sqlite (x_posts table).
 * Safe to run multiple times — always does a full reset + rebuild.
 */

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const dbTimePath = path.join(__dirname, 'database_time.sqlite');
const dbMainPath = path.join(__dirname, 'database.sqlite');

const dbTime = new sqlite3.Database(dbTimePath);
const dbMain = new sqlite3.Database(dbMainPath, sqlite3.OPEN_READONLY);

async function run() {
    console.log('Syncing X metrics from database.sqlite → database_time.sqlite ...');

    // Step 1: Reset all X columns to 0
    await new Promise((res, rej) => {
        dbTime.run(`
            UPDATE user_daily_activity
            SET x_posts = 0, x_likes = 0, x_reposts = 0, x_views = 0, x_replies = 0
        `, err => err ? rej(err) : res());
    });
    console.log('Reset X columns to 0.');

    // Step 2: Load all x_posts with metrics
    const posts = await new Promise((res, rej) => {
        dbMain.all('SELECT user_id, timestamp, likes, reposts, views, replies FROM x_posts', (err, rows) => {
            err ? rej(err) : res(rows);
        });
    });
    console.log(`Loaded ${posts.length} x_posts. Inserting into time DB...`);

    // Step 3: Upsert X data per user per day
    await new Promise((res, rej) => {
        dbTime.serialize(() => {
            dbTime.run('BEGIN TRANSACTION');

            const stmt = dbTime.prepare(`
                INSERT INTO user_daily_activity (user_id, date, x_posts, x_likes, x_reposts, x_views, x_replies)
                VALUES (?, ?, 1, ?, ?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET
                    x_posts   = x_posts   + 1,
                    x_likes   = x_likes   + excluded.x_likes,
                    x_reposts = x_reposts + excluded.x_reposts,
                    x_views   = x_views   + excluded.x_views,
                    x_replies = x_replies + excluded.x_replies
            `);

            for (const post of posts) {
                if (!post.timestamp) continue;
                const dateStr = new Date(post.timestamp).toISOString().split('T')[0];
                stmt.run(
                    post.user_id, dateStr,
                    post.likes || 0, post.reposts || 0, post.views || 0, post.replies || 0
                );
            }

            stmt.finalize(err => {
                if (err) return rej(err);
                dbTime.run('COMMIT', err => err ? rej(err) : res());
            });
        });
    });

    console.log('✅ X metrics synced successfully.');
    dbTime.close();
    dbMain.close();
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
