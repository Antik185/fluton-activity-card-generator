const https = require('https');
const db = require('./db');
const fs = require('fs');

const API_KEY = '61b259ea36msh83412520f437913p18a663jsn58a5aae8c1c3';
const HOST = 'twitter-api45.p.rapidapi.com';

function fetchTweetMetrics(tweetId) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            hostname: HOST,
            port: null,
            path: '/tweet.php?id=' + tweetId,
            headers: {
                'x-rapidapi-key': API_KEY,
                'x-rapidapi-host': HOST
            }
        };

        const req = https.request(options, function (res) {
            const chunks = [];

            res.on('data', function (chunk) {
                chunks.push(chunk);
            });

            res.on('end', function () {
                const body = Buffer.concat(chunks);
                try {
                    const json = JSON.parse(body.toString());
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

// Test with one ID to see exactly what fields are returned
async function testFetch() {
    console.log("Testing API fetch to inspect response format...");
    try {
        const data = await fetchTweetMetrics('1671370010743263233');
        fs.writeFileSync('test_tweet.json', JSON.stringify(data, null, 2));
        console.log("Saved response to test_tweet.json");
    } catch (e) {
        console.error("Error fetching tweet:", e);
    }
}

testFetch();
