const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbTimePath = path.join(__dirname, 'database_time.sqlite');
const dbTime = new sqlite3.Database(dbTimePath, sqlite3.OPEN_READONLY);
const outPath = path.join(__dirname, 'public', 'data');

if (!fs.existsSync(outPath)) {
    fs.mkdirSync(outPath, { recursive: true });
}

function processLeaderboard(period, query, params, startDate, endDate) {
    return new Promise((resolve, reject) => {
        dbTime.all(query, params, async (err, rows) => {
            if (err) return reject(err);

            // Load owners
            let owners = [];
            try {
                const ownerData = fs.readFileSync(path.join(__dirname, 'owner.json'), 'utf8');
                owners = JSON.parse(ownerData);
            } catch (e) { }

            const nonOwnerRows = rows.filter(r => !owners.includes(r.username));
            const ownerRows = rows.filter(r => owners.includes(r.username));

            const totalActive = nonOwnerRows.length;

            let totalDc = 0;
            let totalXPosts = 0;
            let totalViews = 0;

            rows.forEach(r => {
                totalDc += (r.discord_messages || 0);
                totalXPosts += (r.x_posts || 0);
                totalViews += (r.x_views || 0);
            });

            // Fetch X posts details for top 500 users
            const top500Ids = rows.slice(0, 500).map(u => u.user_id);
            const xPostsDetails = {};

            if (top500Ids.length > 0) {
                const xQuery = `
                    SELECT user_id, url, timestamp, likes, reposts, views, replies
                    FROM mainDb.x_posts
                    WHERE user_id IN (${top500Ids.map(() => '?').join(',')})
                    ${startDate && endDate ? "AND timestamp >= ? AND timestamp <= ?" : ""}
                `;
                const xParams = [...top500Ids];
                if (startDate && endDate) {
                    xParams.push(new Date(startDate + 'T00:00:00Z').getTime());
                    xParams.push(new Date(endDate + 'T23:59:59Z').getTime());
                }

                await new Promise((res) => {
                    dbTime.all(xQuery, xParams, (err, xRows) => {
                        if (!err && xRows) {
                            xRows.forEach(xp => {
                                if (!xPostsDetails[xp.user_id]) xPostsDetails[xp.user_id] = [];
                                xPostsDetails[xp.user_id].push(xp);
                            });
                        }
                        res();
                    });
                });
            }

            const mapUser = (u, forceRank = null) => {
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
                    rank: forceRank,
                    username: u.username || 'user' + u.user_id,
                    nickname: u.nickname || 'Unknown User',
                    avatarUrl: u.avatar_url || 'https://cdn.discordapp.com/avatars/1033958209154715688/f2cd023ae0cff33c4ad26e3a75f24782.png?size=512', // Placeholder if needed
                    discordMessages: dcScore,
                    xScore,
                    xPosts: posts,
                    xViews: views,
                    xLikes: likes,
                    xReposts: reposts,
                    xReplies: replies,
                    xDetails: xPostsDetails[u.user_id] || [],
                    totalPoints,
                    tier: 'none',
                    tierBadge: '',
                    isOwner: owners.includes(u.username)
                };
            };

            // Non-owners logic
            let nonOwnerList = nonOwnerRows.slice(0, 500).map(u => {
                const userObj = mapUser(u);
                userObj.avatarUrl = u.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
                return userObj;
            });
            nonOwnerList.sort((a, b) => b.totalPoints - a.totalPoints);
            nonOwnerList.forEach((u, i) => {
                u.rank = i + 1;
                const topRatio = (u.rank / totalActive) * 100;
                if (topRatio <= 0.1) { u.tier = 'gold'; u.tierBadge = '0.1%'; }
                else if (topRatio <= 1) { u.tier = 'cyan'; u.tierBadge = '1%'; }
                else if (topRatio <= 10) { u.tier = 'purple'; u.tierBadge = '10%'; }
                else if (topRatio <= 50) { u.tier = 'silver'; u.tierBadge = '50%'; }
            });

            // Owners logic
            const ownerList = ownerRows.map(u => {
                const userObj = mapUser(u, '*');
                userObj.avatarUrl = u.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
                return userObj;
            });

            const leaderboardData = nonOwnerList.concat(ownerList);

            const output = {
                period,
                startDate: startDate || null,
                endDate: endDate || null,
                stats: {
                    participants: totalActive,
                    totalDcMessages: totalDc,
                    totalXPosts,
                    totalViews
                },
                leaderboard: leaderboardData
            };

            fs.writeFileSync(path.join(outPath, `leaderboard_${period}.json`), JSON.stringify(output, null, 2));
            resolve();
        });
    });
}

async function run() {
    console.log("Generating leaderboard data (anchored to max date + post details)...");

    dbTime.run("ATTACH DATABASE 'database.sqlite' AS mainDb", async (err) => {
        if (err) throw err;

        const maxDateQuery = "SELECT MAX(date) as maxDate FROM user_daily_activity";
        dbTime.get(maxDateQuery, async (err, row) => {
            if (err) throw err;

            // Actual latest date in the system
            const realMaxDate = row.maxDate || new Date().toISOString().split('T')[0];
            // Month anchor = current month up to latest data
            const historicalMaxDate = realMaxDate;

            console.log("Real Max Date (for Week):", realMaxDate);
            console.log("Historical Anchor (for Month/All):", historicalMaxDate);

            const xScoreSql = `(
                ((SUM(uda.x_posts) * 10) + (SUM(uda.x_views) * 0.1) + SUM(uda.x_likes) + (SUM(uda.x_replies) * 3) + (SUM(uda.x_reposts) * 3))
                *
                MIN(1.5, 1 + (
                    CASE WHEN SUM(uda.x_views) > 0 
                    THEN (CAST((SUM(uda.x_likes) + SUM(uda.x_reposts) + SUM(uda.x_replies)) AS FLOAT) / SUM(uda.x_views) * 10.0)
                    ELSE 0 END
                ))
            )`;

            const baseQuery = `
                SELECT uda.user_id, u.username, u.nickname, u.avatar_url, 
                SUM(uda.discord_messages) as discord_messages,
                SUM(uda.x_posts) as x_posts,
                SUM(uda.x_likes) as x_likes,
                SUM(uda.x_reposts) as x_reposts,
                SUM(uda.x_views) as x_views,
                SUM(uda.x_replies) as x_replies
                FROM user_daily_activity uda
                LEFT JOIN mainDb.users u ON u.id = uda.user_id
                $WHERE_CLAUSE
                GROUP BY uda.user_id
                ORDER BY (SUM(uda.discord_messages) + ${xScoreSql}) DESC
            `;

            try {
                // All time - Real-time global stats (including March)
                await processLeaderboard('all', baseQuery.replace('$WHERE_CLAUSE', ""), [], null, realMaxDate);

                // Month - Current month (March 2026)
                const monthStart = realMaxDate.substring(0, 7) + '-01';
                await processLeaderboard('month', baseQuery.replace('$WHERE_CLAUSE', "WHERE uda.date >= ? AND uda.date <= ?"), [monthStart, historicalMaxDate], monthStart, historicalMaxDate);

                // Week - Up to March (real max date)
                const weekStart = addDays(realMaxDate, -6);
                await processLeaderboard('week', baseQuery.replace('$WHERE_CLAUSE', "WHERE uda.date >= ? AND uda.date <= ?"), [weekStart, realMaxDate], weekStart, realMaxDate);

                console.log("Leaderboard Data Generated Successfully.");
                process.exit(0);
            } catch (e) {
                console.error(e);
                process.exit(1);
            }
        });
    });
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

run();
