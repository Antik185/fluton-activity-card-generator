/**
 * snapshot_leaderboard.js
 * Smart rolling snapshot update. 
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbTimePath = path.join(__dirname, 'database_time.sqlite');
const outPath = path.join(__dirname, 'public', 'data');
const MAX_SNAPSHOTS = 5;

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
            totalPoints,
            xPosts: u.x_posts || 0,
            xViews: u.x_views || 0,
            xLikes: u.x_likes || 0,
            xReposts: u.x_reposts || 0,
            xReplies: u.x_replies || 0,
            erPercent
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
        dbTime.all(`
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
        `, [startDate, endDate], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
}

function loadSnapshots(period) {
    const file = path.join(outPath, `snapshots_${period}.json`);
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function saveSnapshots(period, snapshots) {
    fs.writeFileSync(path.join(outPath, `snapshots_${period}.json`), JSON.stringify(snapshots, null, 2));
}

async function takeWeeklySnapshot(anchorDate) {
    const snapshots = loadSnapshots('week');

    // We want to ensure we have up to MAX_SNAPSHOTS history
    // Current week is handled by leaderboard_week.json, so snapshots should contain previous weeks
    for (let i = 1; i <= MAX_SNAPSHOTS; i++) {
        const endDate = addDays(anchorDate, -(i * 7));
        const startDate = addDays(endDate, -6);

        const exists = snapshots.find(s => s.date === endDate);
        if (exists) continue;

        console.log(`[week] Backfilling: ${startDate} → ${endDate}`);
        const rows = await queryWindow(startDate, endDate);
        if (rows.length > 0) {
            const entry = { date: endDate, leaderboard: computeLeaderboard(rows) };
            snapshots.push(entry);
            console.log(`[OK]   week: saved ${endDate}`);
        } else {
            console.log(`[SKIP] week: no data for ${endDate}`);
        }
    }

    // Sort snapshots by date descending
    snapshots.sort((a, b) => b.date.localeCompare(a.date));
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.splice(MAX_SNAPSHOTS);
    saveSnapshots('week', snapshots);
}

async function takeMonthlySnapshot(anchorDate) {
    const dt = new Date(anchorDate + 'T00:00:00Z');
    let year = dt.getUTCFullYear();
    let month = dt.getUTCMonth() - 1;
    if (month < 0) { month = 11; year--; }

    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const label = new Date(startDate + 'T00:00:00Z')
        .toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const snapshots = loadSnapshots('month');
    if (snapshots.length > 0 && snapshots[0].date === endDate) {
        console.log(`[SKIP] month: snapshot for ${label} already exists`);
        return;
    }

    console.log(`[month] Generating: ${label} (${startDate} → ${endDate})`);
    const rows = await queryWindow(startDate, endDate);
    if (rows.length === 0) { console.log(`[SKIP] month: no data for ${label}`); return; }

    const entry = { date: endDate, monthLabel: label, leaderboard: computeLeaderboard(rows) };
    snapshots.unshift(entry);
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.splice(MAX_SNAPSHOTS);
    saveSnapshots('month', snapshots);
    console.log(`[OK]   month: saved ${label} (${entry.leaderboard.length} users)`);
}

async function run() {
    dbTime.run("ATTACH DATABASE 'database.sqlite' AS mainDb", async (err) => {
        if (err) throw err;
        dbTime.get("SELECT MAX(date) as maxDate FROM user_daily_activity", async (err, row) => {
            const anchorDate = row.maxDate || new Date().toISOString().split('T')[0];
            console.log('Anchor Date:', anchorDate);
            try {
                await takeWeeklySnapshot(anchorDate);
                await takeMonthlySnapshot(anchorDate);
                console.log('\nDone.');
            } catch (e) {
                console.error(e);
                process.exit(1);
            }
            dbTime.close();
        });
    });
}

run();
