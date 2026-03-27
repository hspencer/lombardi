const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const FEEDS_PATH = path.join(__dirname, '../data/sources/feeds.json');
const TOPICS_PATH = path.join(__dirname, '../data/sources/topics.json');
const RAW_DIR = path.join(__dirname, '../data/raw_news');

if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

const parser = new XMLParser();

function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
}

function fileHash(link) {
    return crypto.createHash('md5').update(link).digest('hex').slice(0, 8);
}

function loadTopics() {
    try {
        const data = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf-8'));
        return (data.topics || []).filter(t => t.trim());
    } catch { return []; }
}

function matchesTopics(topics, title, description) {
    if (topics.length === 0) return true;
    const text = `${title} ${description}`.toLowerCase();
    return topics.some(topic => text.includes(topic.toLowerCase()));
}

async function fetchFeed(source, topics) {
    try {
        console.log(`OS: Fetching ${source.name} (${source.lang})...`);
        const response = await fetch(source.url, { signal: AbortSignal.timeout(15000) });
        const xmlData = await response.text();
        const jsonObj = parser.parse(xmlData);

        const items = jsonObj.rss?.channel?.item || jsonObj.feed?.entry || [];
        const itemList = Array.isArray(items) ? items : [items];
        let saved = 0;
        let skipped = 0;

        for (const item of itemList) {
            const link = item.link?.href || item.link || item.id || '';
            const title = item.title || '';
            const description = item.description || item.summary || '';
            const hash = fileHash(link || title || String(Date.now()));
            const slug = slugify(source.name);
            const fileName = `${slug}-${hash}.json`;
            const filePath = path.join(RAW_DIR, fileName);

            if (fs.existsSync(filePath)) continue;

            if (!matchesTopics(topics, title, description)) {
                skipped++;
                continue;
            }

            const content = {
                source_name: source.name,
                source_lang: source.lang,
                source_region: source.region,
                title,
                link,
                description,
                pub_date: item.pubDate || item.published || item.updated || '',
                ingested_at: new Date().toISOString()
            };

            fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
            saved++;
        }

        const skipMsg = skipped > 0 ? `, ${skipped} filtrados por tema` : '';
        console.log(`  -> ${source.name}: ${saved} nuevos, ${itemList.length} total${skipMsg}`);
    } catch (error) {
        console.error(`  ✗ ${source.name}: ${error.message}`);
    }
}

// Leer feeds.json e iniciar descarga
const feeds = JSON.parse(fs.readFileSync(FEEDS_PATH, 'utf-8'));
const enabled = feeds.filter(f => f.enabled !== false);
const topics = loadTopics();

console.log(`OS: ${enabled.length}/${feeds.length} fuentes habilitadas.`);
if (topics.length > 0) console.log(`OS: Filtrando por ${topics.length} temas: ${topics.join(', ')}`);
console.log('');

(async () => {
    for (const source of enabled) {
        await fetchFeed(source, topics);
    }
    console.log('\nOS: Ciclo de descarga completado.');
})();
