const fs = require('fs');
const path = require('path');

function getLatestMessages(baseDir) {
    const latestByChannel = {};

    function scanDir(dir) {
        if (!fs.existsSync(dir)) return;
        
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            // Рекурсивно идем в подпапки
            if (entry.isDirectory()) {
                scanDir(fullPath);
            } else if (entry.name.endsWith('.json')) {
                try {
                    const raw = fs.readFileSync(fullPath, 'utf8');
                    const data = JSON.parse(raw);
                    
                    // Поддержка как объекта с { messages: [] }, так и просто массива
                    const msgs = data.messages || (Array.isArray(data) ? data : null);
                    if (!msgs || !Array.isArray(msgs) || msgs.length === 0) continue;

                    // Берем имя канала из меты файла или названия файла
                    const channelName = (data.channel && data.channel.name) 
                        ? data.channel.name 
                        : entry.name.replace('.json', '');

                    // Ищем максимальный timestamp в файле
                    let maxTs = '';
                    for (const msg of msgs) {
                        if (msg.timestamp && msg.timestamp > maxTs) {
                            maxTs = msg.timestamp;
                        }
                    }

                    if (maxTs) {
                        if (!latestByChannel[channelName] || maxTs > latestByChannel[channelName]) {
                            latestByChannel[channelName] = maxTs;
                        }
                    }
                } catch (e) {
                    // Игнорируем файлы, которые не парсятся (например, служебные)
                }
            }
        }
    }

    scanDir(baseDir);

    console.log("=== Последние сообщения в каждом канале ===\n");
    for (const [channel, ts] of Object.entries(latestByChannel)) {
        const dateObj = new Date(ts);
        // Форматируем в: YYYY-MM-DD HH:MM:SS UTC
        const formatted = dateObj.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
        console.log(`[${formatted}] Канал: ${channel}`);
    }
}

const jsonDir = path.join(__dirname, 'json');
getLatestMessages(jsonDir);