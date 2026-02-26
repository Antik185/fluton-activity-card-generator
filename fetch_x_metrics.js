const axios = require('axios');
const db = require('./db');

const API_KEY = '4948|CQ4cozl2G0GCVVLZhRhfXsv9DMHzjPHnL4aE7mK9d7093fab';
const API_URL = 'https://api.socialdata.tools/twitter/tweets-by-ids';

function initDbColumns() {
    return new Promise((resolve) => {
        db.serialize(() => {
            // Add columns to x_posts and users if they don't exist
            // SQLite gracefully errors if columns already exist, so we catch errors
            db.run("ALTER TABLE x_posts ADD COLUMN likes INTEGER DEFAULT 0", () => { });
            db.run("ALTER TABLE x_posts ADD COLUMN reposts INTEGER DEFAULT 0", () => { });
            db.run("ALTER TABLE x_posts ADD COLUMN views INTEGER DEFAULT 0", () => { });
            db.run("ALTER TABLE x_posts ADD COLUMN replies INTEGER DEFAULT 0", () => { });

            db.run("ALTER TABLE users ADD COLUMN x_likes INTEGER DEFAULT 0", () => { });
            db.run("ALTER TABLE users ADD COLUMN x_reposts INTEGER DEFAULT 0", () => { });
            db.run("ALTER TABLE users ADD COLUMN x_views INTEGER DEFAULT 0", () => { });
            db.run("ALTER TABLE users ADD COLUMN x_replies INTEGER DEFAULT 0", () => {
                resolve();
            });
        });
    });
}

function chunkArray(myArray, chunk_size) {
    let index = 0;
    const arrayLength = myArray.length;
    let tempArray = [];

    for (index = 0; index < arrayLength; index += chunk_size) {
        let myChunk = myArray.slice(index, index + chunk_size);
        tempArray.push(myChunk);
    }
    return tempArray;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function start() {
    await initDbColumns();
    await sleep(500); // Give SQLite a moment strictly for safe altering

    console.log("Starting X metrics fetcher for all posts using bulk API...");

    // We'll scrape all items whose 'likes' is supposedly missing or we want to refresh all
    db.all("SELECT url FROM x_posts", async (err, rows) => {
        if (err) {
            console.error("Database error", err);
            process.exit(1);
        }

        console.log(`Found ${rows.length} total posts. Extracting IDs...`);

        const validPosts = [];
        for (const row of rows) {
            const match = row.url.match(/\/status\/(\d+)/);
            if (match) {
                validPosts.push({ url: row.url, id: match[1] });
            }
        }

        // We fetch in chunks of 50 to prevent URI too long or API limits
        const chunks = chunkArray(validPosts, 50);
        let processed = 0;
        let errors = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const ids = chunk.map(c => c.id);

            console.log(`Fetching chunk ${i + 1}/${chunks.length} (${ids.length} tweets)...`);

            try {
                const response = await axios.post(API_URL, { ids }, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 20000
                });

                if (response.data && response.data.tweets) {
                    await new Promise((resolveStmt, rejectStmt) => {
                        db.serialize(() => {
                            db.run("BEGIN TRANSACTION");
                            const updateStmt = db.prepare(`
                                UPDATE x_posts 
                                SET likes = ?, reposts = ?, views = ?, replies = ?
                                WHERE url = ?
                            `);

                            const fetchedData = {};
                            for (const t of response.data.tweets) {
                                fetchedData[t.id_str] = {
                                    likes: t.favorite_count || 0,
                                    reposts: t.retweet_count || 0,
                                    views: t.views_count || 0,
                                    replies: t.reply_count || 0
                                };
                            }

                            for (const post of chunk) {
                                const t = fetchedData[post.id];
                                if (t) {
                                    updateStmt.run(t.likes, t.reposts, t.views, t.replies, post.url);
                                    processed++;
                                } else {
                                    // Missing tweets get a baseline zero so they aren't totally lost
                                    updateStmt.run(0, 0, 0, 0, post.url);
                                }
                            }

                            updateStmt.finalize();
                            db.run("COMMIT", err => {
                                if (err) rejectStmt(err);
                                else resolveStmt();
                            });
                        });
                    });
                }
            } catch (error) {
                errors += chunk.length;
                console.error(`Error processing chunk:`, error.response ? JSON.stringify(error.response.data) : error.message);
            }

            // Respect rate limits
            await sleep(500);
        }

        console.log(`Finished API fetching: ${processed} successful updates, failed ${errors}.`);
        console.log("Recalculating global user points...");

        db.serialize(() => {
            db.run(`
                UPDATE users SET 
                    x_likes = (SELECT COALESCE(SUM(likes), 0) FROM x_posts WHERE x_posts.user_id = users.id),
                    x_reposts = (SELECT COALESCE(SUM(reposts), 0) FROM x_posts WHERE x_posts.user_id = users.id),
                    x_views = (SELECT COALESCE(SUM(views), 0) FROM x_posts WHERE x_posts.user_id = users.id),
                    x_replies = (SELECT COALESCE(SUM(replies), 0) FROM x_posts WHERE x_posts.user_id = users.id)
            `);

            const xScoreSql = `(
                ((x_posts * 10) + (x_views * 0.1) + x_likes + (x_replies * 3) + (x_reposts * 3))
                *
                MIN(1.5, 1 + (
                    CASE WHEN x_views > 0 
                    THEN (CAST((x_likes + x_reposts + x_replies) AS FLOAT) / x_views * 10.0)
                    ELSE 0 END
                ))
            )`;

            db.run(`
                UPDATE users SET 
                    total_points = discord_messages + ${xScoreSql}
            `, (err) => {
                if (err) console.error("Error recalcing points", err);
                else {
                    console.log("Done updating user totals! Total points have been updated with the new X scoring formula (ER multiplier).");
                }
                process.exit(0);
            });
        });
    });
}

// Ensure database connection starts up
setTimeout(start, 500);
