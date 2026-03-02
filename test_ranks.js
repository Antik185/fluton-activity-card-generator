const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbTime = new sqlite3.Database('database_time.sqlite', sqlite3.OPEN_READWRITE);

// Period: Week 1 (2026-02-12 to 2026-02-18)
const startDate = '2026-02-12';
const endDate = '2026-02-18';

async function verify() {
    console.log(`--- Verifying Period: ${startDate} to ${endDate} ---`);

    dbTime.run("ATTACH DATABASE 'database.sqlite' AS mainDb", (err) => {
        if (err) throw err;

        const query = `
            SELECT uda.user_id, u.username,
                SUM(uda.discord_messages) as discord_messages,
                SUM(uda.x_posts)    as x_posts,
                SUM(uda.x_likes)    as x_likes,
                SUM(uda.x_reposts)  as x_reposts,
                SUM(uda.x_views)    as x_views,
                SUM(uda.x_replies)  as x_replies
            FROM user_daily_activity uda
            LEFT JOIN mainDb.users u ON u.id = uda.user_id
            WHERE uda.date >= ? AND uda.date <= ?
            GROUP BY uda.user_id
            HAVING SUM(uda.discord_messages) + SUM(uda.x_posts) + SUM(uda.x_views) > 0
        `;

        dbTime.all(query, [startDate, endDate], (err, rows) => {
            if (err) throw err;

            const users = rows.map(u => {
                const posts = u.x_posts || 0;
                const views = u.x_views || 0;
                const likes = u.x_likes || 0;
                const reposts = u.x_reposts || 0;
                const replies = u.x_replies || 0;

                const rawScore = (posts * 10) + (views * 0.1) + likes + (replies * 3) + (reposts * 3);
                const erPercent = views > 0 ? ((likes + reposts + replies) / views) * 100 : 0;
                const erMult = Math.min(1 + (erPercent * 0.1), 1.5);
                const xScore = Math.floor(rawScore * erMult);

                const dcScore = u.discord_messages || 0;
                const totalPoints = xScore + dcScore;

                return {
                    username: u.username || 'user' + u.user_id,
                    discordMessages: dcScore,
                    xScore,
                    totalPoints
                };
            }).filter(u => u.totalPoints > 0);

            // Sort by Total
            users.sort((a, b) => b.totalPoints - a.totalPoints);
            users.forEach((u, i) => u.rank = i + 1);

            // Sort by DC
            const dcUsers = [...users].filter(u => u.discordMessages > 0).sort((a, b) => b.discordMessages - a.discordMessages);
            const dcMap = new Map();
            dcUsers.forEach((u, i) => dcMap.set(u.username, i + 1));

            // Sort by X
            const xUsers = [...users].filter(u => u.xScore > 0).sort((a, b) => b.xScore - a.xScore);
            const xMap = new Map();
            xUsers.forEach((u, i) => xMap.set(u.username, i + 1));

            users.forEach(u => {
                u.rankDc = dcMap.get(u.username) || null;
                u.rankX = xMap.get(u.username) || null;
            });

            // Pick top user and some mid user
            const topUser = users[0];
            const user100 = users[99];

            console.log('Manual Calculation Result:');
            console.log('Top 1:', topUser);
            console.log('Rank 100:', user100);

            // Load Snapshot
            const snapshots = JSON.parse(fs.readFileSync('public/data/snapshots_week.json', 'utf8'));
            const snap = snapshots[0];
            console.log(`\nSnapshot Entry Date: ${snap.date}`);

            const snapTop = snap.leaderboard.find(u => u.username === topUser.username);
            const snap100 = snap.leaderboard.find(u => u.username === user100.username);

            console.log('\nFrom Snapshot File:');
            console.log('Top 1 in snap:', snapTop);
            console.log('Rank 100 in snap:', snap100);

            const ok = (
                snapTop && snapTop.rank === topUser.rank &&
                snapTop.rankDc === topUser.rankDc &&
                snapTop.rankX === topUser.rankX &&
                snap100 && snap100.rank === user100.rank &&
                snap100.rankDc === user100.rankDc &&
                snap100.rankX === user100.rankX
            );

            console.log('\n--- VERDICT ---');
            if (ok) console.log('✅ TEST PASSED: Manual calculation matches snapshot data exactly.');
            else {
                console.log('❌ TEST FAILED: Discrepancy found.');
                if (!snapTop) console.log('Top user not found in snap!');
                if (!snap100) console.log('User 100 not found in snap!');
            }

            process.exit(0);
        });
    });
}

verify();
