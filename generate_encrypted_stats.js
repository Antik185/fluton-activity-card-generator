const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const LAST_THREE_MIN_MESSAGES = 2000;
const OFFICIAL_REQUIREMENTS_EFFECTIVE = '2026-10-12';
const OFFICIAL_REQUIREMENTS = {
    discordMessages: 2500,
    xPosts: 25
};
const COHORTS = [
    {
        label: 'September 2026 cohort',
        roleAwardedAt: '2026-09-16T00:00:00+02:00',
        fullDayEnd: '2026-09-13',
        periodEnd: '2026-09-13',
        members: [
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
        ]
    },
    {
        label: 'October 2026 cohort',
        roleAwardedAt: '2026-10-15T20:35:00+02:00',
        fullDayEnd: '2026-10-14',
        roleDayStart: '2026-10-15T00:00:00+02:00',
        periodEnd: '2026-10-15',
        exportFolder: '12.10-18.10',
        members: [
            '_tasniya',
            'rayleigh2109',
            'qamarop',
            'mary75',
            'drkamilla3920',
            'lumi_48903_49675',
            'romilgi',
            'golnooshbandani6327',
            'mrchuoi279'
        ]
    }
];

// Cohort and list order are preserved for the latest-three benchmark.
const MEMBER_PROFILES = COHORTS.flatMap((cohort, cohortIndex) => cohort.members.map((username, memberIndex) => ({
    username,
    cohortIndex,
    awardOrder: cohortIndex * 1000 + memberIndex,
    ...cohort
})));
const MEMBERS = MEMBER_PROFILES.map(member => member.username);
const banlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'banlist.json'), 'utf8'));
const bannedUsers = new Set(banlist.users);

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

function getRoleDayDiscordCounts() {
    const counts = new Map(MEMBERS.map(username => [username, 0]));

    for (const cohort of COHORTS) {
        if (!cohort.roleDayStart || !cohort.exportFolder) continue;

        const exportDir = path.join(__dirname, 'json', cohort.exportFolder);
        const wanted = new Set(cohort.members);
        const start = new Date(cohort.roleDayStart);
        const end = new Date(cohort.roleAwardedAt);

        for (const file of fs.readdirSync(exportDir).filter(name => name.endsWith('.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(exportDir, file), 'utf8'));
            for (const message of data.messages || []) {
                const author = message.author;
                if (!author || author.isBot || bannedUsers.has(author.name)) continue;

                const username = author.name.toLowerCase();
                if (!wanted.has(username)) continue;

                const timestamp = new Date(message.timestamp);
                if (timestamp >= start && timestamp < end) {
                    counts.set(username, counts.get(username) + 1);
                }
            }
        }
    }

    return counts;
}

function run() {
    const roleDayDiscordCounts = getRoleDayDiscordCounts();

    db.run("ATTACH DATABASE 'database.sqlite' AS mainDb", err => {
        if (err) throw err;

        db.get('SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM user_daily_activity', (minErr, meta) => {
            if (minErr) throw minErr;
            const periodStart = meta.minDate;
            const cutoffRows = MEMBER_PROFILES.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',');
            const cutoffParams = MEMBER_PROFILES.flatMap(member => [
                member.username,
                member.fullDayEnd,
                member.roleDayStart || null,
                member.roleAwardedAt,
                member.periodEnd,
                member.roleAwardedAt,
                roleDayDiscordCounts.get(member.username) || 0,
                member.awardOrder
            ]);
            const sql = `
                WITH recipient_cutoffs(
                    username,
                    full_day_end,
                    role_day_start,
                    cutoff_timestamp,
                    period_end,
                    awarded_at,
                    role_day_discord,
                    award_order
                ) AS (VALUES ${cutoffRows})
                SELECT
                    u.id,
                    u.username,
                    u.nickname,
                    u.avatar_url AS avatarUrl,
                    rc.period_end AS periodEnd,
                    rc.awarded_at AS roleAwardedAt,
                    rc.award_order AS awardOrder,
                    COALESCE((
                        SELECT SUM(uda.discord_messages)
                        FROM user_daily_activity uda
                        WHERE uda.user_id = u.id
                          AND uda.date >= ?
                          AND uda.date <= rc.full_day_end
                    ), 0) + rc.role_day_discord AS discordMessages,
                    COALESCE((
                        SELECT SUM(uda.x_posts)
                        FROM user_daily_activity uda
                        WHERE uda.user_id = u.id
                          AND uda.date >= ?
                          AND uda.date <= rc.full_day_end
                    ), 0) + COALESCE((
                        SELECT COUNT(*)
                        FROM mainDb.x_posts post
                        WHERE post.user_id = u.id
                          AND rc.role_day_start IS NOT NULL
                          AND datetime(post.timestamp) >= datetime(rc.role_day_start)
                          AND datetime(post.timestamp) < datetime(rc.cutoff_timestamp)
                    ), 0) AS xPosts,
                    COALESCE((SELECT SUM(uda.x_views) FROM user_daily_activity uda WHERE uda.user_id = u.id AND uda.date >= ? AND uda.date <= rc.full_day_end), 0)
                        + COALESCE((SELECT SUM(post.views) FROM mainDb.x_posts post WHERE post.user_id = u.id AND rc.role_day_start IS NOT NULL AND datetime(post.timestamp) >= datetime(rc.role_day_start) AND datetime(post.timestamp) < datetime(rc.cutoff_timestamp)), 0) AS xViews,
                    COALESCE((SELECT SUM(uda.x_likes) FROM user_daily_activity uda WHERE uda.user_id = u.id AND uda.date >= ? AND uda.date <= rc.full_day_end), 0)
                        + COALESCE((SELECT SUM(post.likes) FROM mainDb.x_posts post WHERE post.user_id = u.id AND rc.role_day_start IS NOT NULL AND datetime(post.timestamp) >= datetime(rc.role_day_start) AND datetime(post.timestamp) < datetime(rc.cutoff_timestamp)), 0) AS xLikes,
                    COALESCE((SELECT SUM(uda.x_reposts) FROM user_daily_activity uda WHERE uda.user_id = u.id AND uda.date >= ? AND uda.date <= rc.full_day_end), 0)
                        + COALESCE((SELECT SUM(post.reposts) FROM mainDb.x_posts post WHERE post.user_id = u.id AND rc.role_day_start IS NOT NULL AND datetime(post.timestamp) >= datetime(rc.role_day_start) AND datetime(post.timestamp) < datetime(rc.cutoff_timestamp)), 0) AS xReposts,
                    COALESCE((SELECT SUM(uda.x_replies) FROM user_daily_activity uda WHERE uda.user_id = u.id AND uda.date >= ? AND uda.date <= rc.full_day_end), 0)
                        + COALESCE((SELECT SUM(post.replies) FROM mainDb.x_posts post WHERE post.user_id = u.id AND rc.role_day_start IS NOT NULL AND datetime(post.timestamp) >= datetime(rc.role_day_start) AND datetime(post.timestamp) < datetime(rc.cutoff_timestamp)), 0) AS xReplies
                FROM recipient_cutoffs rc
                JOIN mainDb.users u ON LOWER(u.username) = rc.username
                ORDER BY rc.award_order
            `;

            db.all(sql, [...cutoffParams, periodStart, periodStart, periodStart, periodStart, periodStart, periodStart], (queryErr, rows) => {
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
                        benchmarkPeriodEnd: row.periodEnd,
                        roleAwardedAt: row.roleAwardedAt,
                        awardOrder: row.awardOrder,
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
                const cohortMembers = COHORTS.map(cohort => cohort.members.map(username => membersByUsername.get(username)));
                const previousCohortMembers = cohortMembers.at(-2);
                const currentCohortMembers = cohortMembers.at(-1);
                const excludedFromLastThree = awardOrder
                    .filter(member => member.discordMessages < LAST_THREE_MIN_MESSAGES);
                const lastThreeMembers = awardOrder
                    .filter(member => member.discordMessages >= LAST_THREE_MIN_MESSAGES)
                    .slice(-3);
                const allSummary = buildSummary(members);
                const previousCohortSummary = buildSummary(previousCohortMembers);
                const currentCohortSummary = buildSummary(currentCohortMembers);
                const lastThreeSummary = buildSummary(lastThreeMembers);

                const output = {
                    meta: {
                        periodStart,
                        periodEnd: COHORTS.at(-1).periodEnd,
                        currentDataEnd: meta.maxDate,
                        roleAwardedAt: COHORTS.at(-1).roleAwardedAt,
                        memberCount: members.length,
                        cohortCount: COHORTS.length,
                        cohorts: COHORTS.map(cohort => ({
                            label: cohort.label,
                            periodEnd: cohort.periodEnd,
                            roleAwardedAt: cohort.roleAwardedAt,
                            memberCount: cohort.members.length
                        })),
                        description: 'Benchmark using each Encrypted recipient cohort pre-role cutoff.'
                    },
                    summary: allSummary,
                    benchmarks: {
                        current: {
                            label: 'Current cohort average',
                            periodEnd: COHORTS.at(-1).periodEnd,
                            roleAwardedAt: COHORTS.at(-1).roleAwardedAt,
                            members: currentCohortMembers.map(member => member.username),
                            summary: currentCohortSummary
                        },
                        previous: {
                            label: 'Previous cohort average',
                            periodEnd: COHORTS.at(-2).periodEnd,
                            roleAwardedAt: COHORTS.at(-2).roleAwardedAt,
                            members: previousCohortMembers.map(member => member.username),
                            summary: previousCohortSummary
                        },
                        official: {
                            label: 'Official minimum',
                            effectiveAsOf: OFFICIAL_REQUIREMENTS_EFFECTIVE,
                            summary: {
                                discordMessages: { average: OFFICIAL_REQUIREMENTS.discordMessages },
                                xPosts: { average: OFFICIAL_REQUIREMENTS.xPosts }
                            }
                        },
                        all: {
                            label: 'All Encrypted average',
                            members: awardOrder.map(member => member.username),
                            usesIndividualCutoffs: true,
                            summary: allSummary
                        },
                        lastThree: {
                            label: 'Latest 3 eligible average',
                            minDiscordMessages: LAST_THREE_MIN_MESSAGES,
                            members: lastThreeMembers.map(member => member.username),
                            excluded: excludedFromLastThree.map(member => member.username),
                            usesIndividualCutoffs: true,
                            summary: lastThreeSummary
                        }
                    },
                    members
                };

                fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
                console.log(`Encrypted analytics generated for ${members.length} members across ${COHORTS.length} cohorts: ${periodStart} -> ${COHORTS.at(-1).periodEnd}`);
                db.close();
            });
        });
    });
}

run();
