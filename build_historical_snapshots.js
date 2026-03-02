/**
 * build_historical_snapshots.js
 * Enhanced version: calculates multi-platform ranks and anchors to max data date.
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbTimePath = path.join(__dirname, 'database_time.sqlite');
const outPath = path.join(__dirname, 'public', 'data');

if (!fs.existsSync(outPath)) fs.mkdirSync(outPath, { recursive: true });

const dbTime = new sqlite3.Database(dbTimePath, sqlite3.OPEN_READONLY);

function computeLeaderboard(rows) {
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
            nickname: u.nickname || 'Unknown User',
            discordMessages: dcScore,
            xScore,
            totalPoints
        };
    }).filter(u => u.totalPoints > 0);

    // Rank Total
    users.sort((a, b) => b.totalPoints - a.totalPoints);
    users.forEach((u, i) => u.rank = i + 1);

    // Rank DC
    const dcUsers = [...users]
        .filter(u => u.discordMessages > 0)
        .sort((a, b) => b.discordMessages - a.discordMessages);
    const dcRankMap = new Map();
    dcUsers.forEach((u, i) => dcRankMap.set(u.username, i + 1));

    // Rank X
    const xUsers = [...users]
        .filter(u => u.xScore > 0)
        .sort((a, b) => b.xScore - a.xScore);
    const xRankMap = new Map();
    xUsers.forEach((u, i) => xRankMap.set(u.username, i + 1));

    // Map back ranks
    users.forEach(u => {
        u.rankDc = dcRankMap.get(u.username) || null;
        u.rankX = xRankMap.get(u.username) || null;
    });

    return users.slice(0, 30000);
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

function queryWindow(startDate, endDate) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT uda.user_id, u.username, u.nickname,
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
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function buildWeeklySnapshots(anchorDate, minDate) {
    console.log(`\n[WEEKLY] Building 6 snapshots anchored from: ${anchorDate}`);
    const snapshots = [];

    // Current weekly period in generation is DATE(anchorDate, '-6 days') to anchorDate
    // So snapshots[0] ends on addDays(anchorDate, -7)
    for (let i = 0; i < 6; i++) {
        const endDate = addDays(anchorDate, -(7 * (i + 1)));
        const startDate = (i === 5) ? minDate : addDays(endDate, -6);

        if (startDate > endDate) break;

        const rows = await queryWindow(startDate, endDate);
        if (rows.length === 0) break;

        const leaderboard = computeLeaderboard(rows);
        snapshots.push({ date: endDate, leaderboard });
        console.log(`  [OK]   Week ${i + 1}: ${startDate} → ${endDate} (${leaderboard.length} users)`);
    }

    fs.writeFileSync(path.join(outPath, 'snapshots_week.json'), JSON.stringify(snapshots, null, 2));
    return snapshots;
}

async function buildMonthlySnapshots(anchorDate, minDate) {
    console.log(`\n[MONTHLY] Building calendar month snapshots anchored before: ${anchorDate}`);
    const snapshots = [];

    // anchorDate is e.g. 2026-02-25 (February)
    // Month snapshots should be January 2026, December 2025, etc.
    const dt = new Date(anchorDate + 'T00:00:00Z');
    let currentYear = dt.getUTCFullYear();
    let currentMonth = dt.getUTCMonth(); // 0-based

    for (let i = 0; i < 6; i++) {
        let year = currentYear;
        let month = currentMonth - 1 - i;

        while (month < 0) { month += 12; year--; }

        const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        if (endDate < minDate) break;

        const monthLabel = new Date(startDate + 'T00:00:00Z')
            .toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

        const effectiveStart = startDate < minDate ? minDate : startDate;
        const rows = await queryWindow(effectiveStart, endDate);
        if (rows.length === 0) continue;

        const leaderboard = computeLeaderboard(rows);
        snapshots.push({ date: endDate, monthLabel, leaderboard });
        console.log(`  [OK]   ${monthLabel}: ${effectiveStart} → ${endDate} (${leaderboard.length} users)`);
    }

    fs.writeFileSync(path.join(outPath, 'snapshots_month.json'), JSON.stringify(snapshots, null, 2));
    return snapshots;
}

async function run() {
    dbTime.run("ATTACH DATABASE 'database.sqlite' AS mainDb", async (err) => {
        if (err) throw err;

        dbTime.get("SELECT MIN(date) as minDate, MAX(date) as maxDate FROM user_daily_activity", async (err, row) => {
            if (err) throw err;
            const anchorDate = row.maxDate || new Date().toISOString().split('T')[0];
            const minDate = row.minDate;

            try {
                await buildWeeklySnapshots(anchorDate, minDate);
                await buildMonthlySnapshots(anchorDate, minDate);
                console.log('\nDone.');
            } catch (e) {
                console.error(e);
            }
            dbTime.close();
        });
    });
}

run();
