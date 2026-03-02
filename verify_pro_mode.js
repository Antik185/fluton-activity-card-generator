const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbTimePath = './database_time.sqlite';
const dbMainPath = './database.sqlite';

const db = new sqlite3.Database(dbTimePath);

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

async function runTest() {
    console.log("=== Pro Mode (Comparison) Verification Test ===\n");

    await new Promise((resolve) => {
        db.run(`ATTACH DATABASE '${dbMainPath}' AS mainDb`, resolve);
    });

    // Get max date to determine current periods
    const { maxDate } = await new Promise((res) => {
        db.get("SELECT MAX(date) as maxDate FROM user_daily_activity", (err, row) => res(row));
    });
    console.log(`Reference Date: ${maxDate}\n`);

    const weekCurrentStart = addDays(maxDate, -6);
    const weekPreviousStart = addDays(weekCurrentStart, -7);
    const weekPreviousEnd = addDays(weekCurrentStart, -1);

    const monthCurrentStart = maxDate.substring(0, 7) + '-01';
    const lastMonthDate = new Date(monthCurrentStart + 'T00:00:00Z');
    lastMonthDate.setUTCMonth(lastMonthDate.getUTCMonth() - 1);
    const monthPreviousStart = lastMonthDate.toISOString().substring(0, 7) + '-01';
    const monthPreviousEnd = new Date(new Date(monthCurrentStart + 'T00:00:00Z').getTime() - 1).toISOString().split('T')[0];

    const periods = [
        {
            name: 'week',
            jsonFile: './public/data/leaderboard_week.json',
            currentRange: [weekCurrentStart, maxDate],
            previousRange: [weekPreviousStart, weekPreviousEnd]
        },
        {
            name: 'month',
            jsonFile: './public/data/leaderboard_month.json',
            currentRange: [monthCurrentStart, maxDate],
            previousRange: [monthPreviousStart, monthPreviousEnd]
        }
    ];

    const testUsers = ['biswaff', 'satishskda', 'antik185', 'msabar'];

    for (const p of periods) {
        console.log(`--- Testing Period: ${p.name.toUpperCase()} ---`);
        console.log(`Current: ${p.currentRange[0]} to ${p.currentRange[1]}`);
        console.log(`Previous: ${p.previousRange[0]} to ${p.previousRange[1]}`);

        if (!fs.existsSync(p.jsonFile)) {
            console.log(`- ERROR: ${p.jsonFile} not found!\n`);
            continue;
        }

        const jsonData = JSON.parse(fs.readFileSync(p.jsonFile, 'utf8'));
        const leaderboard = jsonData.leaderboard;

        for (const username of testUsers) {
            const jsonUser = leaderboard.find(u => u.username === username);
            if (!jsonUser) {
                console.log(`- User ${username} not in ${p.name} leaderboard.`);
                continue;
            }

            const getStats = async (range) => {
                const sql = `
                    SELECT 
                        SUM(uda.discord_messages) as dc,
                        SUM(uda.x_posts) as posts,
                        SUM(uda.x_likes) as likes,
                        SUM(uda.x_reposts) as reposts,
                        SUM(uda.x_views) as views,
                        SUM(uda.x_replies) as replies
                    FROM user_daily_activity uda
                    JOIN mainDb.users u ON u.id = uda.user_id
                    WHERE u.username = ? AND uda.date >= ? AND uda.date <= ?
                `;
                const row = await new Promise((res) => {
                    db.get(sql, [username, range[0], range[1]], (err, row) => res(row));
                });
                if (!row || row.dc === null) return { dc: 0, xScore: 0, total: 0 };

                // Scoring Logic
                const raw = ((row.posts || 0) * 10) + ((row.views || 0) * 0.1) + (row.likes || 0) + ((row.replies || 0) * 3) + ((row.reposts || 0) * 3);
                const er = (row.views || 0) > 0 ? (((row.likes || 0) + (row.reposts || 0) + (row.replies || 0)) / row.views) * 100 : 0;
                const mult = Math.min(1.5, 1 + (er * 0.1));
                const xScore = Math.floor(raw * mult);
                return { dc: row.dc || 0, xScore, total: (row.dc || 0) + xScore };
            };

            const currentDB = await getStats(p.currentRange);

            console.log(`User: ${username}`);

            // Check DC Messages
            if (jsonUser.discordMessages !== currentDB.dc) {
                console.log(`  [Mismatch] Discord: JSON=${jsonUser.discordMessages}, DB=${currentDB.dc}`);
            } else {
                console.log(`  [OK] Discord: ${jsonUser.discordMessages}`);
            }

            // Check X Score
            if (jsonUser.xScore !== currentDB.xScore) {
                console.log(`  [Mismatch] X Score: JSON=${jsonUser.xScore}, DB=${currentDB.xScore}`);
            } else {
                console.log(`  [OK] X Score: ${jsonUser.xScore}`);
            }

            // Check Total
            if (jsonUser.totalPoints !== currentDB.total) {
                console.log(`  [Mismatch] Total: JSON=${jsonUser.totalPoints}, DB=${currentDB.total}`);
            } else {
                console.log(`  [OK] Total: ${jsonUser.totalPoints}`);
            }
        }
        console.log("");
    }

    db.close();
}

runTest();
