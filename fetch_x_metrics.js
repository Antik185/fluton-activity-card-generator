const https = require('https');
const db = require('./db');
const API_KEYS = [
    '516367a421mshf5470b37ddc8e01p187fbbjsn51f2df6a378c',
    'ae506a5874msh0f985321fd7cd3fp1e20a3jsnaf51765f3e7b',
    '296c59f634msh05f1bfc9b0e0646p172ff2jsnfc09eb161258',
    'ef75287ed7msh0b2d56d045c2473p19598ejsn8ca1b3021121' // The previous one just in case
];
let currentKeyIndex = 0;
const HOST = 'twitter-api45.p.rapidapi.com';

function fetchTweetMetrics(tweetId) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            hostname: HOST,
            port: null,
            path: '/tweet.php?id=' + tweetId,
            headers: {
                'x-rapidapi-key': API_KEYS[currentKeyIndex],
                'x-rapidapi-host': HOST
            }
        };

        const req = https.request(options, function (res) {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                try {
                    // Check if it's hitting limits
                    if (res.statusCode !== 200) {
                        return reject(new Error("HTTP " + res.statusCode + ": " + body));
                    }
                    const json = JSON.parse(body);
                    if (json.message) {
                        return reject(new Error(json.message));
                    }
                    resolve({
                        likes: parseInt(json.likes || 0),
                        reposts: parseInt(json.retweets || json.reposts || 0),
                        views: parseInt(json.views || 0)
                    });
                } catch (e) {
                    reject(new Error("Failed to parse API response: " + e.message));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function start() {
    console.log("Starting X metrics fetcher for Top 1000 unprocessed posts...");

    db.all("SELECT url FROM x_posts WHERE likes IS NULL LIMIT 4000", async (err, rows) => {
        if (err) {
            console.error("Database error", err);
            process.exit(1);
        }

        console.log("Found " + rows.length + " posts to process.");

        let processed = 0;
        let errors = 0;

        for (const row of rows) {
            const url = row.url;
            const match = url.match(/\/status\/(\d+)/);
            if (!match) continue;

            const tweetId = match[1];
            try {
                process.stdout.write("Fetching " + tweetId + "... ");
                const metrics = await fetchTweetMetrics(tweetId);

                await new Promise((resolve, reject) => {
                    db.run(
                        "UPDATE x_posts SET likes = ?, reposts = ?, views = ? WHERE url = ?",
                        [metrics.likes, metrics.reposts, metrics.views, url],
                        (err) => err ? reject(err) : resolve()
                    );
                });

                console.log("OK (" + metrics.likes + " likes, " + metrics.views + " views)");
                processed++;
            } catch (e) {
                console.log("Error: " + e.message);

                if (e.message && (e.message.includes("limit") || e.message.includes("429"))) {
                    console.log("API limit reached for key index " + currentKeyIndex + ".");
                    currentKeyIndex++;
                    if (currentKeyIndex >= API_KEYS.length) {
                        console.log("All API keys exhausted. Breaking early.");
                        break;
                    } else {
                        console.log("Switching to next API key index: " + currentKeyIndex);
                        // Retry the current post with the new key
                        const retryMetrics = await fetchTweetMetrics(tweetId).catch(err => null);
                        if (retryMetrics) {
                            await new Promise((resolve, reject) => {
                                db.run(
                                    "UPDATE x_posts SET likes = ?, reposts = ?, views = ? WHERE url = ?",
                                    [retryMetrics.likes, retryMetrics.reposts, retryMetrics.views, url],
                                    (err) => err ? reject(err) : resolve()
                                );
                            });
                            console.log("Retry OK (" + retryMetrics.likes + " likes, " + retryMetrics.views + " views)");
                            processed++;
                        } else {
                            errors++;
                        }
                    }
                } else {
                    errors++;
                }
            }

            // Sleep 350ms to respect rate limits
            await sleep(350);
        }

        console.log("Finished API fetching: " + processed + " successful, " + errors + " failures.");
        console.log("Recalculating global user points...");

        db.serialize(() => {
            db.run(`
                UPDATE users SET 
                    x_likes = (SELECT COALESCE(SUM(likes), 0) FROM x_posts WHERE x_posts.user_id = users.id),
                    x_reposts = (SELECT COALESCE(SUM(reposts), 0) FROM x_posts WHERE x_posts.user_id = users.id),
                    x_views = (SELECT COALESCE(SUM(views), 0) FROM x_posts WHERE x_posts.user_id = users.id)
            `);

            // Formula: Discord msg (1) + X post (1) + X like (1) + X repost (3) + X view (0.1)
            db.run(`
                UPDATE users SET 
                    total_points = discord_messages + x_posts + x_likes + (x_reposts * 3) + CAST((x_views / 10) AS INTEGER)
            `, (err) => {
                if (err) console.error("Error recalcing points", err);
                else console.log("Done updating user totals! You can check the website now.");
                process.exit(0);
            });
        });
    });
}

// wait for db connection
setTimeout(start, 500);
