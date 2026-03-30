const fs = require('fs'), path = require('path');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');

const rootFiles = fs.readdirSync('json').filter(f => f.endsWith('.json')).map(f => path.join('json', f));
const weekFolders = ['json/26.02 - 01.03','json/02.03 - 08.03','json/09.03 - 15.03','json/16.03-22.03','json/23.03-29.03'];
const weekFiles = weekFolders.flatMap(folder =>
    fs.existsSync(folder) ? fs.readdirSync(folder).filter(f => f.endsWith('.json')).map(f => path.join(folder, f)) : []
);
const allFiles = [...rootFiles, ...weekFiles];
console.log('Scanning', allFiles.length, 'files...');

const results = {};
let idx = 0;

function scanNext() {
    if (idx >= allFiles.length) {
        let total = 0;
        for (const [fp, msgs] of Object.entries(results)) {
            console.log(fp + ':', msgs.length);
            total += msgs.length;
        }
        console.log('TOTAL messages:', total);
        return;
    }
    const fp = allFiles[idx++];
    const found = [];

    const pipeline = chain([
        fs.createReadStream(fp),
        parser(),
        pick({ filter: 'messages' }),
        streamArray()
    ]);

    pipeline.on('data', ({ value: msg }) => {
        if (msg.author && msg.author.name === 'kera_sakit9') found.push(msg);
    });
    pipeline.on('end', () => {
        if (found.length) results[fp] = found;
        scanNext();
    });
    pipeline.on('error', () => scanNext());
}

scanNext();
