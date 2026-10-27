const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(
    path.join(__dirname, 'database.sqlite'),
    sqlite3.OPEN_READONLY
);
const outFile = path.join(
    __dirname,
    'public',
    'data',
    'encrypted_audit_7c9f4d.json'
);
const weekFile = path.join(__dirname, 'public', 'data', 'leaderboard_week.json');
const MIN_FLAGS_PER_USER = 5;
const MIN_VISIBLE_ENGAGEMENT = 10;

function hasEncryptedRole(rolesJson) {
    try {
        return JSON.parse(rolesJson || '[]').some(role => role.name === 'Encrypted');
    } catch {
        return false;
    }
}

function getCurrentPeriod() {
    try {
        const week = JSON.parse(fs.readFileSync(weekFile, 'utf8'));
        return { start: week.startDate, end: week.endDate };
    } catch {
        return { start: null, end: null };
    }
}

function run() {
    const currentPeriod = getCurrentPeriod();
    db.all(`
        SELECT
            u.id AS userId,
            u.username,
            u.nickname,
            u.avatar_url AS avatarUrl,
            u.roles,
            p.url,
            p.timestamp,
            p.author_handle AS authorHandle,
            COALESCE(p.likes, 0) AS likes,
            COALESCE(p.replies, 0) AS replies,
            COALESCE(p.views, 0) AS views,
            COALESCE(p.reposts, 0) AS reposts
        FROM users u
        LEFT JOIN x_posts p ON p.user_id = u.id
        ORDER BY LOWER(u.username), p.timestamp DESC
    `, (error, rows) => {
        if (error) throw error;

        const roleHolders = new Set();
        const flagged = new Map();

        for (const row of rows) {
            if (!hasEncryptedRole(row.roles)) continue;
            roleHolders.add(row.userId);
            if (!row.url) continue;

            const commentsMoreThanLikes = row.replies > row.likes;
            const lowLikesHighViews = row.likes >= 1 && row.likes <= 4 && row.views >= 1000;
            if (!commentsMoreThanLikes && !lowLikesHighViews) continue;
            if (row.replies < MIN_VISIBLE_ENGAGEMENT && row.likes < MIN_VISIBLE_ENGAGEMENT) continue;

            let user = flagged.get(row.userId);
            if (!user) {
                user = {
                    username: row.username,
                    nickname: row.nickname || row.username,
                    avatarUrl: row.avatarUrl || null,
                    suspiciousPostCount: 0,
                    commentsMoreThanLikesCount: 0,
                    lowLikesHighViewsCount: 0,
                    posts: []
                };
                flagged.set(row.userId, user);
            }

            const date = row.timestamp ? row.timestamp.slice(0, 10) : null;
            const reasons = [];
            if (commentsMoreThanLikes) reasons.push('comments_more_than_likes');
            if (lowLikesHighViews) reasons.push('low_likes_high_views');

            user.suspiciousPostCount++;
            if (commentsMoreThanLikes) user.commentsMoreThanLikesCount++;
            if (lowLikesHighViews) user.lowLikesHighViewsCount++;
            user.posts.push({
                url: row.url,
                timestamp: row.timestamp,
                date,
                authorHandle: row.authorHandle || null,
                likes: row.likes,
                comments: row.replies,
                views: row.views,
                reposts: row.reposts,
                reasons,
                isCurrentPeriod: Boolean(
                    date && currentPeriod.start && currentPeriod.end
                    && date >= currentPeriod.start && date <= currentPeriod.end
                )
            });
        }

        const users = [...flagged.values()]
            .filter(user => user.suspiciousPostCount >= MIN_FLAGS_PER_USER)
            .sort((a, b) =>
                b.suspiciousPostCount - a.suspiciousPostCount
                || a.username.localeCompare(b.username)
            );
        const suspiciousPostCount = users.reduce(
            (sum, user) => sum + user.suspiciousPostCount,
            0
        );

        const output = {
            meta: {
                generatedAt: new Date().toISOString(),
                dataThrough: currentPeriod.end,
                currentPeriod,
                encryptedRoleHolders: roleHolders.size,
                flaggedUsers: users.length,
                suspiciousPosts: suspiciousPostCount,
                criteria: {
                    commentsMoreThanLikes: 'Comments are greater than likes',
                    lowLikesHighViews: '1-4 likes with at least 1,000 views',
                    minimumEngagement: 'At least 10 comments or 10 likes per post',
                    minimumFlagsPerUser: MIN_FLAGS_PER_USER
                },
                disclaimer: 'Heuristic flags for manual review, not proof of manipulation.'
            },
            users
        };

        fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
        console.log(
            `Encrypted audit generated: ${roleHolders.size} role holders, `
            + `${users.length} flagged users, ${suspiciousPostCount} posts.`
        );
        db.close();
    });
}

run();
