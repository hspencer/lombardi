const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const csv = require('csv-parser');

const CSV_PATH = path.join(__dirname, '../data/sources/feeds.csv');
const RAW_DIR = path.join(__dirname, '../data/raw_news');

if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

const parser = new XMLParser();

function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
}

function fileHash(link) {
    return crypto.createHash('md5').update(link).digest('hex').slice(0, 8);
}

async function fetchFeed(source) {
    try {
        console.log(`OS: Fetching ${source.name} (${source.language})...`);
        const response = await fetch(source.feed_url, { signal: AbortSignal.timeout(15000) });
        const xmlData = await response.text();
        const jsonObj = parser.parse(xmlData);

        const items = jsonObj.rss?.channel?.item || jsonObj.feed?.entry || [];
        const itemList = Array.isArray(items) ? items : [items];
        let saved = 0;

        for (const item of itemList) {
            const link = item.link?.href || item.link || item.id || '';
            const hash = fileHash(link || item.title || String(Date.now()));
            const slug = slugify(source.name);
            const fileName = `${slug}-${hash}.json`;
            const filePath = path.join(RAW_DIR, fileName);

            // No re-descargar si ya existe
            if (fs.existsSync(filePath)) continue;

            const content = {
                source_name: source.name,
                source_lang: source.language,
                source_region: source.country_region,
                source_owner_type: source.owner_type,
                title: item.title,
                link,
                description: item.description || item.summary || '',
                pub_date: item.pubDate || item.published || item.updated || '',
                ingested_at: new Date().toISOString()
            };

            fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
            saved++;
        }

        console.log(`  -> ${source.name}: ${saved} nuevos, ${itemList.length} total`);
    } catch (error) {
        console.error(`  ✗ ${source.name}: ${error.message}`);
    }
}

// Leer CSV e iniciar descarga
const sources = [];
fs.createReadStream(CSV_PATH)
    .pipe(csv())
    .on('data', (data) => sources.push(data))
    .on('end', async () => {
        console.log(`OS: Iniciando descarga de ${sources.length} fuentes.\n`);
        for (const source of sources) {
            await fetchFeed(source);
        }
        console.log('\nOS: Ciclo de descarga completado.');
    });
