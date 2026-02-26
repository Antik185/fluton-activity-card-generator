const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const banlist = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));

async function applyBans() {
    const db = new sqlite3.Database('database.sqlite');
    const dbTime = new sqlite3.Database('database_time.sqlite');

    console.log("Applying bans to databases...");

    // 1. Get IDs for banned usernames
    const usernames = banlist.users;
    db.all(`SELECT id, username FROM users WHERE username IN (${usernames.map(() => '?').join(',')})`, usernames, (err, users) => {
        if (err) return console.error(err);

        const bannedIds = users.map(u => u.id);
        console.log(`Found ${bannedIds.length} user IDs to ban.`);

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            // Delete users from main DB
            for (const id of bannedIds) {
                db.run("DELETE FROM users WHERE id = ?", [id]);
            }
            // Delete posts for these users
            for (const id of bannedIds) {
                db.run("DELETE FROM x_posts WHERE user_id = ?", [id]);
            }
            // Delete specific banned posts
            for (const postUrl of banlist.posts) {
                const cleanUrl = postUrl.split('?')[0];
                db.run("DELETE FROM x_posts WHERE url LIKE ?", [cleanUrl + '%']);
            }
            db.run("COMMIT", (err) => {
                if (err) console.error("Main DB commit error:", err);
                else console.log("Main DB cleaned.");

                // Now clean Time DB
                dbTime.serialize(() => {
                    dbTime.run("BEGIN TRANSACTION");
                    for (const id of bannedIds) {
                        dbTime.run("DELETE FROM user_daily_activity WHERE user_id = ?", [id]);
                    }
                    dbTime.run("COMMIT", (err) => {
                        if (err) console.error("Time DB commit error:", err);
                        else console.log("Time DB cleaned.");

                        // Recalculate
                        recalculate(db, () => {
                            db.close();
                            dbTime.close();
                            console.log("Ban application finished sync.");
                        });
                    });
                });
            });
        });
    });
}

function recalculate(db, callback) {
    console.log("Recalculating totals...");
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
        db.run(`UPDATE users SET total_points = discord_messages + ${xScoreSql}`, callback);
    });
}

applyBans();
