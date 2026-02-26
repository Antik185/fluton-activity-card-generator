const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const filePath = workerData.filePath;
const banlist = JSON.parse(fs.readFileSync('banlist.json', 'utf8'));
const bannedUsers = new Set(banlist.users);
let processedMessages = 0;

// groupedData[userId][dateStr] = count
let groupedData = {};

function processData() {
    const pipeline = chain([
        fs.createReadStream(filePath),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);

    pipeline.on('data', data => {
        const msg = data.value;
        const author = msg.author;
        if (!author || author.isBot || bannedUsers.has(author.name)) return;

        processedMessages++;

        // Extract timestamp
        if (!msg.timestamp) return;

        // Convert to YYYY-MM-DD
        const dateStr = new Date(msg.timestamp).toISOString().split('T')[0];

        if (!groupedData[author.id]) {
            groupedData[author.id] = {};
        }
        if (!groupedData[author.id][dateStr]) {
            groupedData[author.id][dateStr] = 0;
        }
        groupedData[author.id][dateStr]++;

        // Send batches back to main thread to prevent memory bloat on huge files
        if (processedMessages % 50000 === 0) {
            parentPort.postMessage({ type: 'progress', data: groupedData });
            groupedData = {}; // reset
        }
    });

    pipeline.on('end', () => {
        // Send remaining
        if (Object.keys(groupedData).length > 0) {
            parentPort.postMessage({ type: 'progress', data: groupedData });
        }
        parentPort.postMessage({ type: 'done', processedMessages });
    });

    pipeline.on('error', err => {
        throw err;
    });
}

processData();
