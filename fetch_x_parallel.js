/**
 * fetch_x_parallel.js
 * Runs fetch_x_metrics logic in N parallel workers, splitting posts by index range.
 * Usage: node fetch_x_parallel.js [workers=5]
 */

const { Worker, isMainThread, workerData } = require('worker_threads');
const path    = require('path');
const axios   = require('axios');
const sqlite3 = require('sqlite3').verbose();
const fs      = require('fs');

const API_KEY = '4948|CQ4cozl2G0GCVVLZhRhfXsv9DMHzjPHnL4aE7mK9d7093fab';
const API_URL = 'https://api.socialdata.tools/twitter/tweets-by-ids';
const CHUNK_SIZE = 50;
const CONCURRENCY = parseInt(process.argv[2] || '5');

const banlist        = JSON.parse(fs.readFileSync(path.join(__dirname, 'banlist.json'), 'utf8'));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(a => a.toLowerCase()));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function fetchChunk(ids) {
    const res = await axios.post(API_URL, { ids }, {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        timeout: 20000
    });
    return res.data && res.data.tweets ? res.data.tweets : [];
}

async function saveResults(db, chunk, tweets) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const stmt = db.prepare(`
                UPDATE x_posts SET likes=?, reposts=?, views=?, replies=?, author_handle=? WHERE url=?
            `);

            const fetched = {};
            for (const t of tweets) {
                const handle = (t.user && t.user.screen_name || '').toLowerCase();
                if (bannedAccounts.has(handle)) {
                    db.run('UPDATE users SET x_posts=MAX(0,x_posts-1) WHERE id=(SELECT user_id FROM x_posts WHERE url LIKE ? LIMIT 1)', ['%/status/' + t.id_str]);
                    db.run('DELETE FROM x_posts WHERE url LIKE ?', ['%/status/' + t.id_str]);
                    continue;
                }
                fetched[t.id_str] = {
                    likes: t.favorite_count || 0,
                    reposts: (t.retweet_count || 0) + (t.quote_count || 0),
                    views: t.views_count || 0,
                    replies: t.reply_count || 0,
                    author_handle: t.user && t.user.screen_name || null
                };
            }

            for (const post of chunk) {
                const t = fetched[post.id];
                if (t) stmt.run(t.likes, t.reposts, t.views, t.replies, t.author_handle, post.url);
                else    stmt.run(0, 0, 0, 0, null, post.url);
            }

            stmt.finalize();
            db.run('COMMIT', err => err ? reject(err) : resolve());
        });
    });
}

async function run() {
    const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

    // Init columns
    await new Promise(res => {
        db.serialize(() => {
            db.run("ALTER TABLE x_posts ADD COLUMN likes INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE x_posts ADD COLUMN reposts INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE x_posts ADD COLUMN views INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE x_posts ADD COLUMN replies INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE x_posts ADD COLUMN author_handle TEXT DEFAULT NULL", () => {});
            db.run("ALTER TABLE users ADD COLUMN x_likes INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE users ADD COLUMN x_reposts INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE users ADD COLUMN x_views INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE users ADD COLUMN x_replies INTEGER DEFAULT 0", () => res());
        });
    });
    await sleep(300);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const rows = await new Promise((res, rej) =>
        db.all("SELECT url FROM x_posts WHERE timestamp >= ?", [cutoff.toISOString()], (e, r) => e ? rej(e) : res(r))
    );

    const validPosts = rows
        .map(r => { const m = r.url.match(/\/status\/(\d+)/); return m ? { url: r.url, id: m[1] } : null; })
        .filter(Boolean);

    const allChunks = chunkArray(validPosts, CHUNK_SIZE);
    console.log(`Found ${validPosts.length} posts → ${allChunks.length} chunks, running ${CONCURRENCY} at a time`);

    let processed = 0, errors = 0, done = 0;

    // Process chunks in parallel batches of CONCURRENCY
    for (let i = 0; i < allChunks.length; i += CONCURRENCY) {
        const batch = allChunks.slice(i, i + CONCURRENCY);
        console.log(`Batch ${Math.floor(i/CONCURRENCY)+1}/${Math.ceil(allChunks.length/CONCURRENCY)} — chunks ${i+1}–${i+batch.length}`);

        // Fetch all in parallel
        const results = await Promise.allSettled(
            batch.map(chunk => fetchChunk(chunk.map(c => c.id)).then(tweets => ({ chunk, tweets })))
        );

        // Write to DB sequentially (SQLite doesn't like concurrent writes)
        for (const result of results) {
            if (result.status === 'fulfilled') {
                const { chunk, tweets } = result.value;
                await saveResults(db, chunk, tweets);
                processed += chunk.length;
            } else {
                console.error('Chunk error:', result.reason?.message || result.reason);
                errors += CHUNK_SIZE;
            }
            done++;
        }
    }

    console.log(`\nFinished: ${processed} updated, ${errors} failed.`);
    console.log('Recalculating global user points...');

    const xScoreSql = `(
        ((x_posts*10)+(x_views*0.1)+x_likes+(x_replies*3)+(x_reposts*3))
        * MIN(1.5, 1+(CASE WHEN x_views>0 THEN (CAST((x_likes+x_reposts+x_replies) AS FLOAT)/x_views*10.0) ELSE 0 END))
    )`;

    await new Promise((res, rej) => {
        db.serialize(() => {
            db.run(`UPDATE users SET
                x_likes   = (SELECT COALESCE(SUM(likes),0)   FROM x_posts WHERE x_posts.user_id=users.id),
                x_reposts = (SELECT COALESCE(SUM(reposts),0) FROM x_posts WHERE x_posts.user_id=users.id),
                x_views   = (SELECT COALESCE(SUM(views),0)   FROM x_posts WHERE x_posts.user_id=users.id),
                x_replies = (SELECT COALESCE(SUM(replies),0) FROM x_posts WHERE x_posts.user_id=users.id)
            `);
            db.run(`UPDATE users SET total_points = discord_messages + ${xScoreSql}`,
                err => err ? rej(err) : res()
            );
        });
    });

    console.log('✅ Done! Points updated.');
    db.close();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
