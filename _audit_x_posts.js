/**
 * Audit x_posts: only links shared in content / share-content / mascot-competition channels
 * are valid. Everything else gets removed.
 * Rebuilds x_posts table from scratch using only correct source channels.
 */
const fs = require('fs'), path = require('path');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');
const sqlite3 = require('sqlite3').verbose();

const CONTENT_CHANNEL_NAMES = new Set([
    'content.json', 'share-content.json', 'mascot-competition.json'
]);
const X_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/g;

const banlist = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers = new Set(banlist.users);
const bannedPosts    = new Set(banlist.posts.map(p => p.split('?')[0]));
const bannedAccounts = new Set((banlist.banned_accounts || []).map(a => a.toLowerCase()));

// Collect all content-channel files from all folders
const rootFiles = fs.readdirSync('json')
    .filter(f => CONTENT_CHANNEL_NAMES.has(f))
    .map(f => path.join('json', f));

const weekFolders = ['json/26.02 - 01.03','json/02.03 - 08.03','json/09.03 - 15.03','json/16.03-22.03','json/23.03-29.03'];
const weekFiles = weekFolders.flatMap(folder =>
    fs.existsSync(folder) ? fs.readdirSync(folder)
        .filter(f => CONTENT_CHANNEL_NAMES.has(f))
        .map(f => path.join(folder, f)) : []
);

const allContentFiles = [...rootFiles, ...weekFiles];
console.log('Content channel files to scan:', allContentFiles.length);
allContentFiles.forEach(f => console.log(' ', f));

// valid x_posts: Map url -> {url, user_id, timestamp}
// If same URL posted by multiple users, keep all; if same user+url, keep earliest
const validPosts = new Map(); // key: url+user_id

let fileIdx = 0;
function scanNext() {
    if (fileIdx >= allContentFiles.length) {
        applyToDb();
        return;
    }
    const fp = allContentFiles[fileIdx++];
    console.log('\nScanning', fp, '...');
    let count = 0;

    const pipeline = chain([
        fs.createReadStream(fp),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);

    pipeline.on('data', ({ value: msg }) => {
        const author = msg.author;
        if (!author || author.isBot || bannedUsers.has(author.name)) return;
        const links = (msg.content || '').match(X_REGEX) || [];
        links.forEach(l => {
            const url = l.split('?')[0];
            const urlAccount = (url.match(/x\.com\/([^/]+)\/status/) || [])[1] || '';
            if (bannedPosts.has(url) || bannedAccounts.has(urlAccount.toLowerCase())) return;
            const key = url + '|' + author.id;
            if (!validPosts.has(key)) {
                validPosts.set(key, { url, user_id: author.id, timestamp: msg.timestamp });
                count++;
            }
        });
    });
    pipeline.on('end', () => { console.log('  +' + count + ' valid posts'); scanNext(); });
    pipeline.on('error', err => { console.error('Error:', err.message); scanNext(); });
}

function applyToDb() {
    console.log('\nTotal valid x_posts from content channels:', validPosts.size);

    const db = new sqlite3.Database('database.sqlite');

    // Get current x_posts count
    db.get('SELECT COUNT(*) as cnt FROM x_posts', (e, r) => {
        console.log('Current x_posts in DB:', r.cnt);
        const validKeys = new Set([...validPosts.keys()].map(k => {
            const [url, uid] = k.split('|');
            return url + '|' + uid;
        }));

        // Find posts in DB that are NOT in valid set
        db.all('SELECT url, user_id FROM x_posts', (e, rows) => {
            const toDelete = rows.filter(r => !validKeys.has(r.url + '|' + r.user_id));
            console.log('Posts to DELETE (wrong channel):', toDelete.length);
            if (toDelete.length <= 20) toDelete.forEach(r => console.log(' ', r.url, '- user:', r.user_id));

            // Find valid posts NOT in DB (shouldn't happen but let's check)
            const inDb = new Set(rows.map(r => r.url + '|' + r.user_id));
            const toAdd = [...validPosts.values()].filter(p => !inDb.has(p.url + '|' + p.user_id));
            console.log('Posts to ADD (missing from DB):', toAdd.length);

            if (!toDelete.length && !toAdd.length) {
                console.log('\n✅ DB already correct, nothing to change.');
                db.close(); return;
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Delete invalid posts and decrement user counters
                toDelete.forEach(({ url, user_id }) => {
                    db.run('DELETE FROM x_posts WHERE url = ? AND user_id = ?', [url, user_id]);
                    db.run('UPDATE users SET x_posts = MAX(0, x_posts - 1) WHERE id = ?', [user_id]);
                });

                // Add missing valid posts
                toAdd.forEach(({ url, user_id, timestamp }) => {
                    db.run('INSERT OR IGNORE INTO x_posts (url, user_id, timestamp) VALUES (?, ?, ?)',
                        [url, user_id, timestamp], function(err) {
                            if (!err && this.changes > 0) {
                                db.run('UPDATE users SET x_posts = x_posts + 1 WHERE id = ?', [user_id]);
                            }
                        });
                });

                db.run('COMMIT', () => {
                    console.log('\n✅ Done. Deleted', toDelete.length, '| Added', toAdd.length);
                    db.close();
                });
            });
        });
    });
}

scanNext();
