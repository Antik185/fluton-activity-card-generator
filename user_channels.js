const fs = require('fs');
const path = require('path');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');
const sqlite3 = require('sqlite3').verbose();

const jsonDir = path.join(__dirname, 'json');
const TARGET_USERNAME = 'prudhvi0030';

// Skip general.json - too large
const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json') && f !== 'general.json');
let fileIndex = 0;
const results = {};

function processFile() {
    if (fileIndex >= files.length) {
        // Get total from DB
        const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), sqlite3.OPEN_READONLY);
        db.get("SELECT discord_messages FROM users WHERE username = ?", [TARGET_USERNAME], (err, row) => {
            const totalDB = row ? row.discord_messages : 0;
            let sumOther = 0;
            const sorted = Object.entries(results).sort((a, b) => b[1] - a[1]);

            console.log(`\n=== Message stats for ${TARGET_USERNAME} ===\n`);
            for (const [channel, count] of sorted) {
                console.log(`${channel}: ${count} messages`);
                sumOther += count;
            }

            const generalEstimate = totalDB - sumOther;
            console.log(`general: ~${generalEstimate} messages (estimated)`);
            console.log(`\nTotal in DB: ${totalDB}`);
            console.log(`Sum of non-general channels: ${sumOther}`);
            db.close();
        });
        return;
    }

    const file = files[fileIndex];
    const filePath = path.join(jsonDir, file);
    const channelName = file.replace('.json', '');
    let count = 0;

    const pipeline = chain([
        fs.createReadStream(filePath),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);

    pipeline.on('data', data => {
        const msg = data.value;
        const author = msg.author;
        if (!author) return;
        if (author.name === TARGET_USERNAME) {
            count++;
        }
    });

    pipeline.on('end', () => {
        if (count > 0) {
            results[channelName] = count;
            console.log(`✓ ${channelName}: ${count}`);
        }
        fileIndex++;
        processFile();
    });

    pipeline.on('error', err => {
        console.error('Error: ' + file + ':', err.message);
        fileIndex++;
        processFile();
    });
}

processFile();
