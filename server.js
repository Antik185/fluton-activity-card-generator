const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

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

app.get('/api/user/:username', (req, res) => {
    const searchTerm = req.params.username.trim().toLowerCase();

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

        // Calculate Rank and Total Users
        db.get('SELECT COUNT(*) as totalUsers FROM users', [], (err, totalRow) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            const totalUsers = totalRow.totalUsers;

            // Find rank (how many users have MORE points than this user)
            db.get('SELECT COUNT(*) as higherRankCount FROM users WHERE total_points > ?', [user.total_points], (err, rankRow) => {
                if (err) return res.status(500).json({ error: 'Database error' });

                const rank = rankRow.higherRankCount + 1; // 1-based index
                let topPercentile = (rank / totalUsers) * 100;

                // Format percentile for display
                let percentileStr;
                if (topPercentile <= 0.1) percentileStr = "Top 0.1%";
                else if (topPercentile <= 1) percentileStr = "Top 1%";
                else if (topPercentile <= 5) percentileStr = "Top 5%";
                else if (topPercentile <= 10) percentileStr = "Top 10%";
                else percentileStr = 'Top ' + Math.ceil(topPercentile) + '%';

                // Parse roles JSON
                let stringRoles = [];
                try {
                    const parsedRoles = JSON.parse(user.roles);
                    // Discord roles format: [{ name: 'Role 1', color: '#hex' }]
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
                        discord_messages: user.discord_messages,
                        x_posts: user.x_posts,
                        x_likes: user.x_likes || 0,
                        x_reposts: user.x_reposts || 0,
                        x_views: user.x_views || 0,
                        total_points: user.total_points,
                        roles: stringRoles
                    },
                    stats: {
                        rank,
                        totalUsers,
                        percentile: percentileStr
                    }
                });
            });
        });
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
