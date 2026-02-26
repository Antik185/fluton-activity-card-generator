const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const dbTime = require('./db_time');
const sqlite3 = require('sqlite3').verbose();

const jsonDir = path.join(__dirname, 'json');
const numThreads = require('os').cpus().length || 4;

function startBuilding() {
    if (!fs.existsSync(jsonDir)) {
        console.error("JSON directory not found: " + jsonDir);
        return;
    }

    const files = fs.readdirSync(jsonDir).filter(file => file.endsWith('.json'));
    console.log(`Found ${files.length} JSON files. Spawning ${numThreads} worker threads...`);

    // Prepare SQLite transaction
    dbTime.serialize(() => {
        dbTime.run('BEGIN TRANSACTION');

        const insertStmt = dbTime.prepare(`
            INSERT INTO user_daily_activity (user_id, date, discord_messages)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET
                discord_messages = discord_messages + excluded.discord_messages
        `);

        let filesCompleted = 0;
        let activeWorkers = 0;
        let fileIndex = 0;

        // Function to start a worker and give it a file
        function startWorker() {
            if (fileIndex >= files.length) return; // No more files

            const file = files[fileIndex++];
            const filePath = path.join(jsonDir, file);
            activeWorkers++;

            console.log(`[Thread Started] parsing ${file}`);

            const worker = new Worker(path.join(__dirname, 'build_time_worker.js'), {
                workerData: { filePath }
            });

            worker.on('message', (message) => {
                if (message.type === 'progress') {
                    // Update DB with extracted data
                    const grouped = message.data;
                    for (const userId in grouped) {
                        for (const date in grouped[userId]) {
                            const count = grouped[userId][date];
                            insertStmt.run(userId, date, count);
                        }
                    }
                } else if (message.type === 'done') {
                    filesCompleted++;
                    activeWorkers--;
                    console.log(`[Thread Finished] ${file}. (${filesCompleted}/${files.length}) - ${message.processedMessages} messages`);

                    if (fileIndex < files.length) {
                        startWorker(); // start another task on a completed thread slot
                    } else if (activeWorkers === 0) {
                        finishBuilding(insertStmt);
                    }
                }
            });

            worker.on('error', (err) => {
                console.error(`Worker error on ${file}:`, err);
                activeWorkers--;
                filesCompleted++;
                if (activeWorkers === 0 && fileIndex >= files.length) finishBuilding(insertStmt);
            });

            worker.on('exit', (code) => {
                if (code !== 0) console.error(`Worker stopped with exit code ${code} for ${file}`);
            });
        }

        // Spawn initial workers
        for (let i = 0; i < numThreads && i < files.length; i++) {
            startWorker();
        }
    });
}

function finishBuilding(insertStmt) {
    insertStmt.finalize();

    // Now process X Metrics
    console.log("Merging X (Twitter) Metrics from main database...");

    const dbMainPath = path.join(__dirname, 'database.sqlite');
    const dbMain = new sqlite3.Database(dbMainPath, sqlite3.OPEN_READONLY);

    dbMain.all("SELECT * FROM x_posts", (err, xPosts) => {
        if (err) {
            console.error("Error fetching x_posts", err);
            commitAndExit();
            return;
        }

        if (!xPosts || xPosts.length === 0) {
            commitAndExit();
            return;
        }

        dbTime.serialize(() => {
            const updateXStmt = dbTime.prepare(`
                INSERT INTO user_daily_activity (user_id, date, x_posts, x_likes, x_reposts, x_views, x_replies)
                VALUES (?, ?, 1, ?, ?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET
                    x_posts = x_posts + 1,
                    x_likes = x_likes + excluded.x_likes,
                    x_reposts = x_reposts + excluded.x_reposts,
                    x_views = x_views + excluded.x_views,
                    x_replies = x_replies + excluded.x_replies
            `);

            for (const post of xPosts) {
                if (!post.timestamp) continue;
                const dateStr = new Date(post.timestamp).toISOString().split('T')[0];
                updateXStmt.run(post.user_id, dateStr, post.likes || 0, post.reposts || 0, post.views || 0, post.replies || 0);
            }

            updateXStmt.finalize(() => {
                dbMain.close();
                commitAndExit();
            });
        });
    });
}

function commitAndExit() {
    dbTime.run('COMMIT', (err) => {
        if (err) console.error("Commit failed for time DB:", err);
        else console.log("✅ Time database successfully built!");
        process.exit(0);
    });
}

// Ensure db schema is created
setTimeout(startBuilding, 1000);
