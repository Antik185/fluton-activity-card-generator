const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), sqlite3.OPEN_READONLY);

const sql = `
  SELECT u.username, u.nickname, u.discord_messages, u.x_likes,
         COUNT(xp.url) as unique_posts,
         CAST(u.x_likes AS REAL) / COUNT(xp.url) as avg_likes
  FROM users u
  JOIN x_posts xp ON xp.user_id = u.id
  WHERE u.discord_messages >= 100
  GROUP BY u.id
  HAVING unique_posts = 1 AND avg_likes >= 2
  ORDER BY avg_likes DESC
`;

db.all(sql, (err, rows) => {
  if (err) { console.error(err); return; }

  console.log('Users with 100+ messages, exactly 1 post, avg >= 2 likes/post:', rows.length);
  console.log('');

  rows.forEach((r, i) => {
    console.log(`${i + 1}. ${r.username} (${r.nickname}) | msgs: ${r.discord_messages} | posts: ${r.unique_posts} | likes: ${r.x_likes} | avg: ${r.avg_likes.toFixed(1)}`);
  });

  db.close();
});
