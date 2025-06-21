const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const iconv = require('iconv-lite'); 

const app = express();
const PORT = process.env.PORT || 3000;

// База данных URL 
const urlDatabase = {

    "новости": [
        "https://ria.ru/",
        "https://www.rbc.ru/",
        "https://lenta.ru/",
        "https://www.kommersant.ru/"
    ],

    "программирование": [
        "https://habr.com/ru/hubs/programming/",
        "https://developer.mozilla.org/ru/docs/Web/JavaScript",
        "https://stackoverflow.com/",
        "https://www.freecodecamp.org/news/",
        "https://css-tricks.com/",
        "https://www.smashingmagazine.com/",
        "https://dev.to/",
        "https://tproger.ru/"
    ],

    "космос": [
        "https://www.roscosmos.ru/",
        "https://nplus1.ru/rubric/astronomy",
        "https://www.nasa.gov/",
        "https://www.space.com/"
    ],

    "дизайн": [
        "https://www.figma.com/blog/",
        "https://dribbble.com/",
        "https://www.behance.net/",
        "https://www.awwwards.com/"
    ],

    "gamedev": [
        "https://dtf.ru/gamedev",
        "https://habr.com/ru/hubs/gamedev/",
        "https://www.gamedeveloper.com/",
        "https://80.lv/"
    ],

    "ai": [
        "https://habr.com/ru/hubs/artificial_intelligence/",
        "https://openai.com/blog",
        "https://deepmind.google/discover/blog/",
        "https://nplus1.ru/rubric/robotics"
    ],

    "кибербезопасность": [
        "https://xakep.ru/",
        "https://habr.com/ru/hubs/infosecurity/",
        "https://www.securitylab.ru/",
        "https://www.kaspersky.ru/blog/"
    ]

};


app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Получение списка URL по ключевому слову
app.get('/api/urls', (req, res) => {
    const keyword = req.query.keyword?.toLowerCase().trim();

    if (!keyword) {
        return res.status(400).json({ error: 'Ключевое слово не указано.' });
    }

    const foundKey = Object.keys(urlDatabase).find(key => key.includes(keyword));
    const urls = foundKey ? urlDatabase[foundKey] : [];

    if (urls.length > 0) {
        res.json(urls);
    } else {
        res.status(404).json({ error: `Для ключевого слова '${keyword}' URL не найдены.` });
    }
});

// Скачивание контента с передачей прогресса через Server-Sent Events 
app.get('/api/download', async (req, res) => {
    const urlToFetch = req.query.url;

    if (!urlToFetch) {
        return res.status(400).send('URL для скачивания не указан.');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };
    
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 15000); 

    try {
        const response = await fetch(urlToFetch, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Node.js Content Downloader' }
        });

        if (!response.ok) {
            throw new Error(`Ошибка при запросе к URL: ${response.status} ${response.statusText}`);
        }
        
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
             throw new Error(`Неподдерживаемый тип контента: ${contentType}. Ожидается text/html.`);
        }
        
        const charsetMatch = contentType.match(/charset=([^;]+)/);
        let encoding = charsetMatch && charsetMatch[1] ? charsetMatch[1].toLowerCase() : 'utf-8';
        if (!iconv.encodingExists(encoding)) {
             console.warn(`Неизвестная кодировка: ${encoding}, используется utf-8 как запасной вариант.`);
             encoding = 'utf-8';
        }

        const totalSize = Number(response.headers.get('content-length')) || 0;
        sendEvent({ type: 'size', payload: totalSize });

        let downloadedSize = 0;
        const contentBuffer = [];

        for await (const chunk of response.body) {
            downloadedSize += chunk.length;
            contentBuffer.push(chunk);
            sendEvent({
                type: 'progress',
                payload: { progress: downloadedSize }
            });
        }
        
        const rawBuffer = Buffer.concat(contentBuffer);
        const fullContent = iconv.decode(rawBuffer, encoding);
        
        sendEvent({ type: 'done', payload: fullContent });

    } catch (error) {
        console.error('Ошибка при скачивании:', error.name === 'AbortError' ? 'Таймаут запроса' : error.message);
        const errorMessage = error.name === 'AbortError' 
            ? `Не удалось загрузить контент с ${urlToFetch}. Сайт не ответил вовремя.`
            : `Не удалось загрузить контент с ${urlToFetch}. Причина: ${error.message}`;
        sendEvent({ type: 'error', payload: errorMessage });
    } finally {
        clearTimeout(timeout);
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});