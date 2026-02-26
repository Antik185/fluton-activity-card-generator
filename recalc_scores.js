const db = require('./db');

console.log("Recalculating all user scores based on the new X formula...");

const xScoreSql = `CAST(
    ((x_posts * 10) + (x_views * 0.1) + x_likes + (x_replies * 3) + (x_reposts * 3))
    *
    MIN(1.5, 1 + (
        CASE WHEN x_views > 0 
        THEN (CAST((x_likes + x_reposts + x_replies) AS FLOAT) / x_views * 10.0)
        ELSE 0 END
    ))
AS INTEGER)`;

db.serialize(() => {
    db.run(`
        UPDATE users SET 
            total_points = discord_messages + ${xScoreSql}
    `, (err) => {
        if (err) {
            console.error("Error updating scores:", err.message);
            process.exit(1);
        } else {
            console.log("✅ All user scores recalculated successfully!");
            process.exit(0);
        }
    });
});
