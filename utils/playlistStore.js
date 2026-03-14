const fs = require('fs').promises;
const path = require('path');

const PLAYLISTS_FILE = path.join(__dirname, '../playlists.json');

async function readPlaylists() {
    try {
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
    await fs.writeFile(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2));
}

module.exports = {
    readPlaylists,
    writePlaylists
};
