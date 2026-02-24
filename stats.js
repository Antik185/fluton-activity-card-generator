const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), sqlite3.OPEN_READONLY);

function query(sql) {
    return new Promise((resolve, reject) => {
        db.get(sql, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function queryAll(sql) {
    return new Promise((resolve, reject) => {
        db.all(sql, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function main() {
    console.log('=== DATABASE STATISTICS ===\n');

    // Total users
    const total = await query('SELECT COUNT(*) as cnt FROM users');
    console.log('Total users in DB:', total.cnt);

    // Users with Early role
    const early = await query("SELECT COUNT(*) as cnt FROM users WHERE roles LIKE '%\"Early\"%'");
    console.log('Users with Early role:', early.cnt);

    // Users with 0 messages
    const zero = await query('SELECT COUNT(*) as cnt FROM users WHERE discord_messages = 0');
    console.log('Users with 0 messages:', zero.cnt);

    console.log('\n=== MESSAGE DISTRIBUTION (all users) ===\n');

    const msg1 = await query('SELECT COUNT(*) as cnt FROM users WHERE discord_messages = 1');
    console.log('Users with exactly 1 message:', msg1.cnt);

    const msg2to5 = await query('SELECT COUNT(*) as cnt FROM users WHERE discord_messages BETWEEN 2 AND 5');
    console.log('Users with 2-5 messages:', msg2to5.cnt);

    const msg6to20 = await query('SELECT COUNT(*) as cnt FROM users WHERE discord_messages BETWEEN 6 AND 20');
    console.log('Users with 6-20 messages:', msg6to20.cnt);

    const msg21to99 = await query('SELECT COUNT(*) as cnt FROM users WHERE discord_messages BETWEEN 21 AND 99');
    console.log('Users with 21-99 messages:', msg21to99.cnt);

    const msg100 = await query('SELECT COUNT(*) as cnt FROM users WHERE discord_messages >= 100');
    console.log('Users with 100+ messages:', msg100.cnt);

    // Now let's count unique authors in content.json
    console.log('\n=== CONTENT.JSON UNIQUE AUTHORS ===\n');

    const fs = require('fs');
    const { chain } = require('stream-chain');
    const { parser } = require('stream-json');
    const { pick } = require('stream-json/filters/Pick');
    const { streamArray } = require('stream-json/streamers/StreamArray');

    const contentPath = path.join(__dirname, 'json', 'content.json');
    if (!fs.existsSync(contentPath)) {
        console.log('content.json not found!');
    } else {
        const uniqueAuthors = new Set();
        const authorMsgCount = {};

        await new Promise((resolve, reject) => {
            const pipeline = chain([
                fs.createReadStream(contentPath),
                parser(),
                pick({ filter: 'messages' }),
                streamArray()
            ]);

            pipeline.on('data', data => {
                const msg = data.value;
                const author = msg.author;
                if (!author || author.isBot) return;
                uniqueAuthors.add(author.id);
                authorMsgCount[author.id] = (authorMsgCount[author.id] || 0) + 1;
            });

            pipeline.on('end', () => resolve());
            pipeline.on('error', err => reject(err));
        });

        console.log('Unique authors in content.json:', uniqueAuthors.size);

        // Distribution for content.json
        let c1 = 0, c2to5 = 0, c6to20 = 0, c21to99 = 0, c100 = 0;
        for (const id of Object.keys(authorMsgCount)) {
            const cnt = authorMsgCount[id];
            if (cnt === 1) c1++;
            else if (cnt <= 5) c2to5++;
            else if (cnt <= 20) c6to20++;
            else if (cnt <= 99) c21to99++;
            else c100++;
        }

        console.log('\n=== CONTENT.JSON MESSAGE DISTRIBUTION ===\n');
        console.log('Authors with exactly 1 message:', c1);
        console.log('Authors with 2-5 messages:', c2to5);
        console.log('Authors with 6-20 messages:', c6to20);
        console.log('Authors with 21-99 messages:', c21to99);
        console.log('Authors with 100+ messages:', c100);
    }

    db.close();
}

main().catch(err => {
    console.error(err);
    db.close();
});
