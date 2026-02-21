const db = require('./db');

db.serialize(() => {
    // Add columns if they don't exist
    try {
        db.run('ALTER TABLE x_posts ADD COLUMN likes INTEGER DEFAULT NULL');
        db.run('ALTER TABLE x_posts ADD COLUMN reposts INTEGER DEFAULT NULL');
        db.run('ALTER TABLE x_posts ADD COLUMN views INTEGER DEFAULT NULL');

        db.run('ALTER TABLE users ADD COLUMN x_likes INTEGER DEFAULT 0');
        db.run('ALTER TABLE users ADD COLUMN x_reposts INTEGER DEFAULT 0');
        db.run('ALTER TABLE users ADD COLUMN x_views INTEGER DEFAULT 0');
    } catch (e) {
        // Ignore if columns already exist
    }
    console.log("Database schema updated with metrics columns.");
});
