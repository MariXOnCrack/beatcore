const fs = require('fs').promises;
const path = require('path');

// Use /app/data for persistent storage in Docker, or local directory in development
const DATA_DIR = process.env.NODE_ENV === 'production' 
    ? '/app/data' 
    : path.join(__dirname, '..');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
        console.warn('Could not create data directory:', err);
    }
}

async function readPlaylists() {
    try {
        await ensureDataDir();
        const data = await fs.readFile(PLAYLISTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            await writePlaylists([]);
            return [];
        }
        throw err;
    }
}

async function writePlaylists(playlists) {
    await ensureDataDir();
    await fs.writeFile(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2));
}

module.exports = {
    readPlaylists,
    writePlaylists
};
