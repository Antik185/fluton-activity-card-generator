const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

// Update the 3rd post that had null metrics
db.run(
    "UPDATE x_posts SET likes = ?, reposts = ?, views = ? WHERE url = ?",
    [20, 2, 267, 'https://x.com/Makssay_eth/status/2024474096147349527'],
    function (err) {
        if (err) console.error(err);
        else console.log("Updated post metrics. Changes:", this.changes);

        // Recalculate user totals
        db.run(`
            UPDATE users SET 
                x_likes = (SELECT COALESCE(SUM(likes), 0) FROM x_posts WHERE x_posts.user_id = users.id),
                x_reposts = (SELECT COALESCE(SUM(reposts), 0) FROM x_posts WHERE x_posts.user_id = users.id),
                x_views = (SELECT COALESCE(SUM(views), 0) FROM x_posts WHERE x_posts.user_id = users.id)
            WHERE id = '335358847013224450'
        `, function (err) {
            if (err) console.error(err);
            else console.log("Updated user x_likes/x_reposts/x_views.");

            // Recalculate total_points
            db.run(`
                UPDATE users SET 
                    total_points = discord_messages + x_posts + x_likes + (x_reposts * 3) + CAST((x_views / 10) AS INTEGER)
                WHERE id = '335358847013224450'
            `, function (err) {
                if (err) console.error(err);
                else console.log("Recalculated total_points.");

                // Verify
                db.get("SELECT x_likes, x_reposts, x_views, x_posts, total_points FROM users WHERE id = '335358847013224450'", (err, row) => {
                    console.log("\nFinal user stats:", row);
                    db.close();
                });
            });
        });
    }
);
