const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const API_KEY = '4948|CQ4cozl2G0GCVVLZhRhfXsv9DMHzjPHnL4aE7mK9d7093fab';
const OFFICIAL_USER_IDS = ['1714720911725674496', '858308472', '44196397'];

async function cleanOfficialPosts() {
    const db = new sqlite3.Database('database.sqlite');
    const officialTweetIds = new Set();

    console.log("Fetching official tweets to identify blacklisted status IDs...");

    for (const userId of OFFICIAL_USER_IDS) {
        try {
            console.log(`Processing user: ${userId}`);
            const response = await axios.get(`https://api.socialdata.tools/twitter/user/${userId}/tweets`, {
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' }
            });

            if (response.data && response.data.tweets) {
                response.data.tweets.forEach(t => {
                    officialTweetIds.add(t.id_str);
                });
                console.log(`Found ${response.data.tweets.length} tweets for user ${userId}`);
            }
        } catch (err) {
            console.error(`Error fetching tweets for ${userId}:`, err.message);
        }
    }

    console.log(`Total unique official tweet IDs found: ${officialTweetIds.size}`);

    if (officialTweetIds.size === 0) {
        console.log("No tweets found. Aborting cleanup to be safe.");
        return;
    }

    // Now delete from database
    db.serialize(() => {
        db.all("SELECT url FROM x_posts", (err, rows) => {
            if (err) return console.error(err);

            let deletedCount = 0;
            const stmt = db.prepare("DELETE FROM x_posts WHERE url = ?");

            rows.forEach(row => {
                // Extract status ID from URL (e.g., https://x.com/user/status/12345)
                const match = row.url.match(/status\/(\d+)/);
                if (match && officialTweetIds.has(match[1])) {
                    stmt.run(row.url);
                    deletedCount++;
                }
            });

            stmt.finalize(() => {
                console.log(`Successfully deleted ${deletedCount} official/fraudulent post logs from database.`);

                // Recalculate totals
                console.log("Recalculating user points after cleanup...");
                db.serialize(() => {
                    db.run('UPDATE users SET x_likes = 0, x_reposts = 0, x_views = 0, x_replies = 0, x_posts = 0');
                    db.run('UPDATE users SET x_posts = (SELECT COUNT(*) FROM x_posts WHERE x_posts.user_id = users.id)');
                    db.run('UPDATE users SET x_likes = (SELECT COALESCE(SUM(likes), 0) FROM x_posts WHERE x_posts.user_id = users.id)');
                    db.run('UPDATE users SET x_reposts = (SELECT COALESCE(SUM(reposts), 0) FROM x_posts WHERE x_posts.user_id = users.id)');
                    db.run('UPDATE users SET x_views = (SELECT COALESCE(SUM(views), 0) FROM x_posts WHERE x_posts.user_id = users.id)');
                    db.run('UPDATE users SET x_replies = (SELECT COALESCE(SUM(replies), 0) FROM x_posts WHERE x_posts.user_id = users.id)');
                    const xScoreSql = `(
                        ((x_posts * 10) + (x_views * 0.1) + x_likes + (x_replies * 3) + (x_reposts * 3))
                        *
                        MIN(1.5, 1 + (
                            CASE WHEN x_views > 0 
                            THEN (CAST((x_likes + x_reposts + x_replies) AS FLOAT) / x_views * 10.0)
                            ELSE 0 END
                        ))
                    )`;
                    db.run(`UPDATE users SET total_points = discord_messages + ${xScoreSql}`, (err) => {
                        if (!err) console.log("Cleanup and Recalculation Complete!");
                        db.close();
                    });
                });
            });
        });
    });
}

cleanOfficialPosts();
