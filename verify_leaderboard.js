const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbTimePath = './database_time.sqlite';
const dbMainPath = './database.sqlite';
const jsonPath = './public/data/leaderboard_all.json';

const db = new sqlite3.Database(dbTimePath);

async function runTest() {
    console.log("=== Leaderboard Verification Test ===\n");

    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const leaderboard = jsonData.leaderboard;

    await new Promise((resolve) => {
        db.run(`ATTACH DATABASE '${dbMainPath}' AS mainDb`, resolve);
    });

    const testUsers = [
        'biswaff',
        'satishskda',
        'vladislavbulldozer',
        'alpina0230',
        'knowledgetechid',
        '0xrivalz'
    ];

    for (const username of testUsers) {
        console.log(`Checking user: ${username}`);

        const jsonUser = leaderboard.find(u => u.username === username);
        if (!jsonUser) {
            console.log(`- ERROR: User ${username} not found in leaderboard JSON!`);
            continue;
        }

        const sql = `
            SELECT 
                SUM(uda.discord_messages) as discord_messages,
                SUM(uda.x_posts) as x_posts,
                SUM(uda.x_likes) as x_likes,
                SUM(uda.x_reposts) as x_reposts,
                SUM(uda.x_views) as x_views,
                SUM(uda.x_replies) as x_replies
            FROM user_daily_activity uda
            JOIN mainDb.users u ON u.id = uda.user_id
            WHERE u.username = ?
            GROUP BY uda.user_id
        `;

        const dbUser = await new Promise((res) => {
            db.get(sql, [username], (err, row) => res(row));
        });

        if (!dbUser) {
            console.log(`- ERROR: User ${username} not found in database!`);
            continue;
        }

        // Scoring Logic (from generate_leaderboard.js)
        const posts = dbUser.x_posts || 0;
        const views = dbUser.x_views || 0;
        const likes = dbUser.x_likes || 0;
        const reposts = dbUser.x_reposts || 0;
        const replies = dbUser.x_replies || 0;

        const rawScore = (posts * 10) + (views * 0.1) + likes + (replies * 3) + (reposts * 3);
        const erPercent = views > 0 ? ((likes + reposts + replies) / views) * 100 : 0;
        const erMult = Math.min(1 + (erPercent * 0.1), 1.5);
        const xScoreCalculated = Math.floor(rawScore * erMult);
        const totalPointsCalculated = xScoreCalculated + (dbUser.discord_messages || 0);

        // Comparisons
        const checks = [
            { label: 'Discord Messages', json: jsonUser.discordMessages, db: dbUser.discord_messages },
            { label: 'X Posts', json: jsonUser.xPosts, db: dbUser.x_posts },
            { label: 'X Views', json: jsonUser.xViews, db: dbUser.x_views },
            { label: 'X Likes', json: jsonUser.xLikes, db: dbUser.x_likes },
            { label: 'X Reposts', json: jsonUser.xReposts, db: dbUser.x_reposts },
            { label: 'X Replies', json: jsonUser.xReplies, db: dbUser.x_replies },
            { label: 'X Score', json: jsonUser.xScore, db: xScoreCalculated },
            { label: 'Total Points', json: jsonUser.totalPoints, db: totalPointsCalculated },
        ];

        let hasError = false;
        checks.forEach(c => {
            if (c.json !== c.db) {
                console.log(`  [Mismatch] ${c.label}: JSON=${c.json}, DB(Calculated)=${c.db}`);
                hasError = true;
            } else {
                // console.log(`  [OK] ${c.label}: ${c.json}`);
            }
        });

        if (!hasError) {
            console.log(`  [SUCCESS] All metrics for ${username} match!`);
            console.log(`    Total Points: ${jsonUser.totalPoints}, Discord: ${jsonUser.discordMessages}, X: ${jsonUser.xScore}`);
        }
        console.log("");
    }

    db.close();
}

runTest();
