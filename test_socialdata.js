const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');

const API_KEY = '4948|CQ4cozl2G0GCVVLZhRhfXsv9DMHzjPHnL4aE7mK9d7093fab';

db.all('SELECT url FROM x_posts ORDER BY RANDOM() LIMIT 2', async (err, rows) => {
    if (err) throw err;
    const ids = rows.map(r => {
        const match = r.url.match(/\/status\/(\d+)/);
        return match ? match[1] : null;
    }).filter(Boolean);

    console.log("Fetching IDs:", ids);

    try {
        const response = await axios.post('https://api.socialdata.tools/twitter/tweets-by-ids', { ids }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        console.log(JSON.stringify(response.data, null, 2));
    } catch (e) {
        console.error(e.response ? e.response.data : e.message);
    }
});
