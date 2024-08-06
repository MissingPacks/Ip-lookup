import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const WYCEKI_DIR = path.join(__dirname, 'wycieki');
const CACHE_EXPIRY = 3600 * 1000; // 1 hour in milliseconds
let combinedData = {};
let cache = {};

loadCombinedData();

app.use(express.static('public'));
app.use(express.json());

app.get('/search', async (req, res) => {
    const nick = req.query.nick?.toLowerCase();
    if (!nick) {
        return res.status(400).json({ error: 'Nick is required' });
    }

    try {
        let results = await searchLocalDatabase(nick);
        if (results.length === 0) {
            results = await searchAPI(nick);
        }

        if (results.length > 0) {
            res.json(results);
        } else {
            res.status(404).json({ error: 'No results found' });
        }
    } catch (error) {
        console.error('Error during search:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/add', async (req, res) => {
    const newData = req.body;
    try {
        const success = await addToLocalDatabase(newData);
        res.status(success ? 200 : 500).json({ message: success ? 'New data added successfully' : 'Failed to add new data' });
    } catch (error) {
        console.error('Error adding new data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

async function loadCombinedData() {
    try {
        const files = await fs.readdir(WYCEKI_DIR);
        await Promise.all(files.map(async (file) => {
            const filePath = path.join(WYCEKI_DIR, file);
            const fileContent = await fs.readFile(filePath, 'utf-8');
            combinedData[file] = JSON.parse(fileContent);
        }));
        console.log('Data loaded');
    } catch (error) {
        console.error('Error reading directory:', error);
    }
}

async function searchLocalDatabase(nick) {
    let results = [];
    for (const [file, data] of Object.entries(combinedData)) {
        for (const [storedNick, ip] of Object.entries(data)) {
            if (storedNick.toLowerCase() === nick) {
                results.push({ nick: storedNick, ip: ip, file: file });
            }
        }
    }
    return results;
}

function isCacheValid(timestamp) {
    return (Date.now() - timestamp) < CACHE_EXPIRY;
}

async function searchAPI(nick) {
    if (cache[nick] && isCacheValid(cache[nick].timestamp)) {
        return cache[nick].data;
    }

    try {
        const response = await fetch(`https://api.crafty.gg/api/v2/players/${nick}`);
        const json = await response.json();

        if (!json.success || !json.data || !json.data.usernames || json.data.usernames.length === 0) {
            console.error('No valid usernames found in API response:', json);
            return [];
        }

        let apiResults = [];
        for (const usernameObj of json.data.usernames) {
            const username = usernameObj.username.toLowerCase();
            const localResults = await searchLocalDatabase(username);
            apiResults = [...apiResults, ...localResults];
        }

        cache[nick] = { data: apiResults, timestamp: Date.now() };
        return apiResults;

    } catch (error) {
        console.error('Error searching in external API:', error);
        return [];
    }
}

async function addToLocalDatabase(newData) {
    const { file, nick, ip } = newData;
    try {
        combinedData[file] = { ...combinedData[file], [nick]: ip };
        await fs.writeFile(path.join(WYCEKI_DIR, file), JSON.stringify(combinedData[file], null, 2));
        console.log('New data added to combinedData:', combinedData);
        return true;
    } catch (error) {
        console.error('Error adding new data:', error);
        return false;
    }
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
