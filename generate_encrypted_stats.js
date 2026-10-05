const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROLE_AWARDED_AT = '2026-09-16';
const PERIOD_END = '2026-09-13';
const LAST_THREE_MIN_MESSAGES = 2000;
// Award-list order is preserved for the latest-three benchmark.
const MEMBERS = [
    'zunzuncrypto',
    'minhnhat80',
    'ry0nx1',
    'learning101997',
    'direumateulll',
    'ariseaura',
    'killian_117',
    'madara.233',
    'welosu',
    'nvphungvtvn7',
    'radhasakhimansi',
    'koushik_xyz',
    'mazay1501'
];

const db = new sqlite3.Database(path.join(__dirname, 'database_time.sqlite'), sqlite3.OPEN_READONLY);
const outFile = path.join(__dirname, 'public', 'data', 'encrypted_stats.json');

function xScore(row) {
    const posts = row.xPosts || 0;
    const views = row.xViews || 0;
    const likes = row.xLikes || 0;
    const reposts = row.xReposts || 0;
    const replies = row.xReplies || 0;
    const raw = posts * 10 + views * 0.1 + likes + replies * 3 + reposts * 3;
    const erPercent = views > 0 ? ((likes + reposts + replies) / views) * 100 : 0;
    return Math.floor(raw * Math.min(1 + erPercent * 0.1, 1.5));
}

function summarize(members, key) {
    const values = members.map(member => Number(member[key]) || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
        min,
        average: Number((total / values.length).toFixed(1)),
        max,
        total,
        minMembers: members.filter(member => member[key] === min).map(member => member.username),
        maxMembers: members.filter(member => member[key] === max).map(member => member.username)
    };
}

function buildSummary(members) {
    return {
        discordMessages: summarize(members, 'discordMessages'),
        xPosts: summarize(members, 'xPosts'),
        xScore: summarize(members, 'xScore'),
        totalScore: summarize(members, 'totalScore'),
        xViews: summarize(members, 'xViews'),
        xLikes: summarize(members, 'xLikes'),
        xReplies: summarize(members, 'xReplies'),
        xReposts: summarize(members, 'xReposts')
    };
}

function run() {
    db.run("ATTACH DATABASE 'database.sqlite' AS mainDb", err => {
        if (err) throw err;

        db.get('SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM user_daily_activity', (minErr, meta) => {
            if (minErr) throw minErr;
            const periodStart = meta.minDate;
            const placeholders = MEMBERS.map(() => '?').join(',');
            const sql = `
                SELECT
                    u.id,
                    u.username,
                    u.nickname,
                    u.avatar_url AS avatarUrl,
                    COALESCE(SUM(uda.discord_messages), 0) AS discordMessages,
                    COALESCE(SUM(uda.x_posts), 0) AS xPosts,
                    COALESCE(SUM(uda.x_views), 0) AS xViews,
                    COALESCE(SUM(uda.x_likes), 0) AS xLikes,
                    COALESCE(SUM(uda.x_reposts), 0) AS xReposts,
                    COALESCE(SUM(uda.x_replies), 0) AS xReplies
                FROM mainDb.users u
                LEFT JOIN user_daily_activity uda
                    ON uda.user_id = u.id
                    AND uda.date >= ?
                    AND uda.date <= ?
                WHERE LOWER(u.username) IN (${placeholders})
                GROUP BY u.id
            `;

            db.all(sql, [periodStart, PERIOD_END, ...MEMBERS], (queryErr, rows) => {
                if (queryErr) throw queryErr;

                const found = new Set(rows.map(row => row.username.toLowerCase()));
                const missing = MEMBERS.filter(username => !found.has(username));
                if (missing.length > 0) {
                    throw new Error(`Encrypted members not found: ${missing.join(', ')}`);
                }

                const members = rows.map(row => {
                    const score = xScore(row);
                    const interactions = row.xLikes + row.xReposts + row.xReplies;
                    return {
                        username: row.username,
                        nickname: row.nickname || row.username,
                        avatarUrl: row.avatarUrl || null,
                        discordMessages: row.discordMessages,
                        xPosts: row.xPosts,
                        xViews: row.xViews,
                        xLikes: row.xLikes,
                        xReposts: row.xReposts,
                        xReplies: row.xReplies,
                        erPercent: row.xViews > 0 ? Number(((interactions / row.xViews) * 100).toFixed(2)) : 0,
                        xScore: score,
                        totalScore: row.discordMessages + score
                    };
                }).sort((a, b) => b.totalScore - a.totalScore);

                members.forEach((member, index) => { member.rank = index + 1; });
                const membersByUsername = new Map(members.map(member => [member.username.toLowerCase(), member]));
                const awardOrder = MEMBERS.map(username => membersByUsername.get(username));
                const excludedFromLastThree = awardOrder
                    .filter(member => member.discordMessages < LAST_THREE_MIN_MESSAGES);
                const lastThreeMembers = awardOrder
                    .filter(member => member.discordMessages >= LAST_THREE_MIN_MESSAGES)
                    .slice(-3);
                const allSummary = buildSummary(members);
                const lastThreeSummary = buildSummary(lastThreeMembers);

                const output = {
                    meta: {
                        periodStart,
                        periodEnd: PERIOD_END,
                        currentDataEnd: meta.maxDate,
                        roleAwardedAt: ROLE_AWARDED_AT,
                        memberCount: members.length,
                        description: 'Benchmark for the Encrypted role recipient cohort.'
                    },
                    summary: allSummary,
                    benchmarks: {
                        all: {
                            label: 'All Encrypted average',
                            members: awardOrder.map(member => member.username),
                            summary: allSummary
                        },
                        lastThree: {
                            label: 'Latest 3 eligible average',
                            minDiscordMessages: LAST_THREE_MIN_MESSAGES,
                            members: lastThreeMembers.map(member => member.username),
                            excluded: excludedFromLastThree.map(member => member.username),
                            summary: lastThreeSummary
                        }
                    },
                    members
                };

                fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
                console.log(`Encrypted analytics generated for ${members.length} members: ${periodStart} -> ${PERIOD_END}`);
                db.close();
            });
        });
    });
}

run();
