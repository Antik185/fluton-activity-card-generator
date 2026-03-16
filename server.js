const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Build all-time rank lookup from leaderboard_all.json
// Reloads automatically when the file changes (checked every 60s)
const lbAllPath = path.join(__dirname, 'public', 'data', 'leaderboard_all.json');
let lbByUsername = {};
let lbAllMtime = 0;

function buildLbByUsername() {
    try {
        const stat = fs.statSync(lbAllPath);
        if (stat.mtimeMs === lbAllMtime) return; // no change
        const lbAllData = JSON.parse(fs.readFileSync(lbAllPath, 'utf8'));
        const entries = (lbAllData.leaderboard || []).filter(u => !u.isOwner);
        const map = {};
        entries.forEach(u => {
            map[u.username.toLowerCase()] = {
                rank: u.rank,
                xScore: u.xScore,
                totalPoints: u.totalPoints,
                discordMessages: u.discordMessages
            };
        });
        const sortedByX = [...entries].sort((a, b) => b.xScore - a.xScore);
        sortedByX.forEach((u, i) => {
            if (map[u.username.toLowerCase()]) map[u.username.toLowerCase()].rankX = i + 1;
        });
        const sortedByDc = [...entries].sort((a, b) => b.discordMessages - a.discordMessages);
        sortedByDc.forEach((u, i) => {
            if (map[u.username.toLowerCase()]) map[u.username.toLowerCase()].rankDc = i + 1;
        });
        lbByUsername = map;
        lbAllMtime = stat.mtimeMs;
        console.log('leaderboard_all.json reloaded:', entries.length, 'entries');
    } catch (e) {
        console.warn('Could not load leaderboard_all.json for rank lookup:', e.message);
    }
}

buildLbByUsername();
setInterval(buildLbByUsername, 60000); // re-check every 60 seconds

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error connecting to database', err.message);
    }
});

const dbTimePath = path.join(__dirname, 'database_time.sqlite');
const dbTime = new sqlite3.Database(dbTimePath, sqlite3.OPEN_READONLY, (err) => {
    if (err) console.error('Error connecting to database_time:', err.message);
});

function addDaysStr(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

app.get('/api/user/:username', (req, res) => {
    const searchTerm = req.params.username.trim().toLowerCase();
    const activeOnly = req.query.active === 'true';

    // Active-user filter clause
    const ACTIVE_FILTER = '(discord_messages >= 20 OR x_posts >= 2)';

    // Find the user first
    db.get(`
        SELECT * FROM users 
        WHERE LOWER(username) LIKE ? OR LOWER(nickname) LIKE ? 
        ORDER BY total_points DESC LIMIT 1
    `, ['%' + searchTerm + '%', '%' + searchTerm + '%'], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error while searching for user' });
        }

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Load owners
        let owners = [];
        try {
            const ownerData = fs.readFileSync(path.join(__dirname, 'owner.json'), 'utf8');
            owners = JSON.parse(ownerData);
        } catch (e) { }

        const isOwner = owners.some(o => o.toLowerCase() === searchTerm || o.toLowerCase() === (user.username || '').toLowerCase());

        // Prepare owner exclusion for SQL
        const ownerPlaceholders = owners.map(() => '?').join(',');
        const ownerExclusion = owners.length > 0 ? ` AND username NOT IN (${ownerPlaceholders})` : '';

        // 1. Calculate Total Users (excluding owners)
        const totalSql = activeOnly
            ? `SELECT COUNT(*) as totalUsers FROM users WHERE ${ACTIVE_FILTER} ${ownerExclusion}`
            : `SELECT COUNT(*) as totalUsers FROM users WHERE 1=1 ${ownerExclusion}`;

        db.get(totalSql, owners, (err, totalRow) => {
            if (err) return res.status(500).json({ error: 'Database error counting users' });

            const totalUsers = totalRow.totalUsers;

            if (isOwner) {
                return handleResponse('*', 'Project Owner');
            }

            // 2. Find rank (excluding owners)
            const rankSql = activeOnly
                ? `SELECT COUNT(*) as higherRankCount FROM users WHERE total_points > ? AND ${ACTIVE_FILTER} ${ownerExclusion}`
                : `SELECT COUNT(*) as higherRankCount FROM users WHERE total_points > ? ${ownerExclusion}`;

            db.get(rankSql, [user.total_points, ...owners], (err, rankRow) => {
                if (err) return res.status(500).json({ error: 'Database error calculating rank' });

                const rank = rankRow.higherRankCount + 1; // 1-based index
                let topPercentile = (rank / totalUsers) * 100;

                // Format percentile for display
                let percentileStr;
                if (topPercentile <= 0.1) percentileStr = "Top 0.1%";
                else if (topPercentile <= 1) percentileStr = "Top 1%";
                else if (topPercentile <= 5) percentileStr = "Top 5%";
                else if (topPercentile <= 10) percentileStr = "Top 10%";
                else percentileStr = 'Top ' + Math.ceil(topPercentile) + '%';

                handleResponse(rank, percentileStr);
            });

            function handleResponse(displayRank, percentileStr) {
                // Count actual X posts from the x_posts table
                db.get('SELECT COUNT(*) as actualXPosts FROM x_posts WHERE user_id = ?', [user.id], (err, xPostRow) => {
                    const actualXPosts = (xPostRow && xPostRow.actualXPosts) ? xPostRow.actualXPosts : (user.x_posts || 0);

                    const lbEntry = lbByUsername[(user.username || '').toLowerCase()] || null;

                    // discord_messages: use leaderboard JSON value (same source as leaderboard page),
                    // falls back to database.sqlite for users outside top 500
                    const discordMessages = (lbEntry && lbEntry.discordMessages)
                        ? lbEntry.discordMessages
                        : (user.discord_messages || 0);

                    // Parse roles JSON
                    let stringRoles = [];
                    try {
                        const parsedRoles = JSON.parse(user.roles);
                        if (Array.isArray(parsedRoles)) {
                            stringRoles = parsedRoles.map(r => r.name).filter(n => n !== '@everyone');
                        }
                    } catch (e) { }

                    res.json({
                        user: {
                            id: user.id,
                            username: user.username,
                            nickname: user.nickname,
                            avatar_url: user.avatar_url,
                            discord_messages: discordMessages,
                            x_posts: actualXPosts,
                            x_likes: user.x_likes || 0,
                            x_reposts: user.x_reposts || 0,
                            x_views: user.x_views || 0,
                            x_replies: user.x_replies || 0,
                            total_points: user.total_points,
                            roles: stringRoles,
                            isOwner: isOwner
                        },
                        stats: {
                            rank: displayRank,
                            totalUsers,
                            percentile: percentileStr,
                            activeOnly: activeOnly
                        },
                        allTime: lbEntry ? {
                            rank: lbEntry.rank,
                            rankDc: lbEntry.rankDc || null,
                            rankX: lbEntry.rankX || null,
                            xScore: lbEntry.xScore || 0,
                            totalPoints: lbEntry.totalPoints || 0,
                            discordMessages: lbEntry.discordMessages || 0
                        } : null
                    });
                }); // end db.get x_posts
            }
        });
    });
});

// Daily activity data for DC panel (heatmap, streak, mini-stats)
app.get('/api/user-daily/:username', (req, res) => {
    const username = req.params.username;
    const period = req.query.period || 'week';

    const today = new Date().toISOString().split('T')[0];
    let startDate;
    if (period === 'week') startDate = addDaysStr(today, -6);
    else if (period === 'month') startDate = today.substring(0, 7) + '-01';
    else startDate = '2020-01-01';

    db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username], (err, userRow) => {
        if (err || !userRow) return res.status(404).json({ error: 'User not found' });
        const userId = userRow.id;

        dbTime.all(
            'SELECT date, discord_messages FROM user_daily_activity WHERE user_id = ? ORDER BY date ASC',
            [userId],
            (err2, allRows) => {
                if (err2) return res.status(500).json({ error: 'DB error' });

                const rowMap = {};
                allRows.forEach(r => { rowMap[r.date] = r.discord_messages || 0; });

                // Heatmap — last 7 days oldest→newest
                const heatmap = [];
                for (let i = 6; i >= 0; i--) heatmap.push(rowMap[addDaysStr(today, -i)] || 0);

                // Streak — consecutive days ending today (or yesterday if no data today)
                let streak = 0;
                let checkDate = (rowMap[today] || 0) > 0 ? today : addDaysStr(today, -1);
                for (let i = 0; i < 365; i++) {
                    if ((rowMap[checkDate] || 0) > 0) { streak++; checkDate = addDaysStr(checkDate, -1); }
                    else break;
                }

                // Period stats
                const periodRows = allRows.filter(r => r.date >= startDate);
                const activeDays = periodRows.filter(r => (r.discord_messages || 0) > 0).length;
                const totalMsgs = periodRows.reduce((s, r) => s + (r.discord_messages || 0), 0);
                const avgPerDay = activeDays > 0 ? Math.round(totalMsgs / activeDays) : 0;
                const bestDay = periodRows.reduce((mx, r) => Math.max(mx, r.discord_messages || 0), 0);

                res.json({ heatmap, streak, activeDays, avgPerDay, bestDay });
            }
        );
    });
});

// Endpoint for random users carousel
app.get('/api/random-users', (req, res) => {
    // Get total number of users for percentile calculation
    db.get("SELECT COUNT(*) as total FROM users", (err, countRow) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        const totalUsers = countRow.total;

        // Fetch 6 random users who have more than 0 points
        const query = `
            SELECT id, username, nickname, avatar_url, roles, discord_messages, x_posts, total_points, x_likes, x_reposts, x_views,
            (SELECT COUNT(*) FROM users u2 WHERE u2.total_points > users.total_points) + 1 AS rank
            FROM users 
            WHERE total_points > 0
            ORDER BY RANDOM() 
            LIMIT 6
        `;

        db.all(query, (err, rows) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            const randomUsers = rows.map(user => {
                const rank = user.rank;
                const percentileNum = Math.ceil((rank / totalUsers) * 100);
                let percentileStr = `Top ${percentileNum}%`;
                if (rank <= 10) percentileStr = `Top 10 Player!`;
                else if (rank === 1) percentileStr = `Rank #1 Global`;

                try {
                    user.roles = JSON.parse(user.roles || '[]');
                } catch (e) {
                    user.roles = [];
                }

                return {
                    user: user,
                    stats: { rank, totalUsers, percentile: percentileStr }
                };
            });

            res.json(randomUsers);
        });
    });
});

app.listen(port, () => {
    console.log('Server running at http://localhost:' + port);
});

// Export the Express API for Vercel Serverless
module.exports = app;
