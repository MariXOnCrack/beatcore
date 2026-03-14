const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const path = require('path');
require('dotenv').config();

const { importPlaylist } = require('./utils/playlistImport');
const { readPlaylists, writePlaylists } = require('./utils/playlistStore');

const app = express();
app.set('trust proxy', 1); // Trust Cloudflare proxy
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

// Passport Setup
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

const scopes = ['identify', 'guilds'];

passport.use(new Strategy({
    clientID: process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: scopes
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => {
        return done(null, profile);
    });
}));

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'keyboard cat', // Change this in production
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => {
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

// Start Server
function startDashboard(client, queueManager) {
    const server = http.createServer(app);
    const io = new Server(server);
    
    // Online Users Tracking
    const onlineUsers = new Map();

    io.on('connection', (socket) => {
        socket.on('join-guild', (data) => {
            let guildId, user;
            if (typeof data === 'string') {
                guildId = data;
                user = { id: 'unknown', username: 'Guest', avatar: null };
            } else {
                guildId = data.guildId;
                user = data.user;
            }

            if (!guildId) return;

            socket.join(guildId);

            if (!onlineUsers.has(guildId)) {
                onlineUsers.set(guildId, new Map());
            }

            onlineUsers.get(guildId).set(socket.id, user);

            // Broadcast unique users
            const usersMap = onlineUsers.get(guildId);
            const uniqueUsers = [];
            const seenIds = new Set();
            
            for (const u of usersMap.values()) {
                if (u && u.id && !seenIds.has(u.id)) {
                    seenIds.add(u.id);
                    uniqueUsers.push(u);
                }
            }

            io.to(guildId).emit('update-users', uniqueUsers);
        });

        socket.on('disconnect', () => {
            for (const [guildId, users] of onlineUsers.entries()) {
                if (users.has(socket.id)) {
                    users.delete(socket.id);
                    
                    const uniqueUsers = [];
                    const seenIds = new Set();
                    for (const u of users.values()) {
                        if (u && u.id && !seenIds.has(u.id)) {
                            seenIds.add(u.id);
                            uniqueUsers.push(u);
                        }
                    }
                    
                    io.to(guildId).emit('update-users', uniqueUsers);
                    
                    if (users.size === 0) {
                        onlineUsers.delete(guildId);
                    }
                }
            }
        });
    });

    app.use((req, res, next) => {
        req.botClient = client;
        next();
    });

    app.get('/health', (req, res) => {
        res.status(200).send('OK');
    });

    // Root Route
    app.get('/', async (req, res) => {
        if (req.isAuthenticated()) {
            // Get user guilds where bot is present
            const userGuilds = req.user.guilds || [];
            const botGuilds = client.guilds.cache;
            
            const commonGuilds = userGuilds.filter(g => botGuilds.has(g.id) && (g.permissions & 0x8)); // 0x8 = Administrator (basic check)

            res.render('dashboard', {
                user: req.user,
                guilds: commonGuilds
            });
        } else {
            res.redirect('/login');
        }
    });

    // API: Play a song
    app.post('/api/play', express.json(), async (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { url, title, thumbnail, timestamp, author, guildId } = req.body;
        
        if (!url || !guildId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Guild not found' });
        }

        const member = guild.members.cache.get(req.user.id);
        if (!member || !member.voice.channel) {
            return res.status(400).json({ error: 'You must be in a voice channel' });
        }

        const channel = member.voice.channel;
        
        // Get or Create Queue
        const queue = queueManager.create(guildId, channel, client);

        const song = {
            title: title || 'Unknown Title',
            url,
            thumbnail,
            timestamp,
            author,
            addedBy: req.user.global_name || req.user.username,
            addedById: req.user.id
        };

        queue.addSong(song);

        res.json({ success: true, message: `Added ${song.title} to queue` });
    });

    // API: Control (Pause, Resume, Skip, Loop, Shuffle, Volume)
    app.post('/api/control/:guildId', express.json(), (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        
        const guildId = req.params.guildId;
        const { action, value } = req.body;
        
        const queue = queueManager.get(guildId);
        if (!queue) return res.status(404).json({ error: 'No active queue' });

        switch (action) {
            case 'pause':
                queue.player.pause();
                break;
            case 'resume':
                queue.player.unpause();
                break;
            case 'skip':
                queue.skip();
                break;
            case 'loop':
                // Toggle loop mode: 0 -> 1 -> 2 -> 0
                queue.loopMode = (queue.loopMode + 1) % 3;
                break;
            case 'shuffle':
                queue.isShuffled = !queue.isShuffled;
                break;
            case 'volume':
                const vol = parseFloat(value);
                if (!isNaN(vol)) {
                    queue.setVolume(vol / 100); // UI is 0-100, backend is 0.0-1.0
                }
                break;
        }

        res.json({ success: true });
    });

    app.get('/api/queue/:guildId', (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const guildId = req.params.guildId;
        const queue = queueManager.get(guildId);
        
        if (!queue || queue.songs.length === 0) {
            return res.json({ current: null, queue: [], currentIndex: 0 });
        }

        const current = queue.songs[queue.currentIndex];
        
        const allSongs = queue.songs.map((song, index) => ({
            ...song,
            position: index + 1,
            isCurrent: index === queue.currentIndex
        }));

        res.json({
            current: current,
            queue: allSongs,
            currentIndex: queue.currentIndex
        });
    });

    // API: Get History
    app.get('/api/history/:guildId', (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        
        const guildId = req.params.guildId;
        const queue = queueManager.get(guildId);
        
        if (!queue || !queue.playedSongsLog) {
            return res.json([]);
        }

        res.json(queue.playedSongsLog);
    });

    // API: Get Player Status
    app.get('/api/status/:guildId', (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        
        const guildId = req.params.guildId;
        const queue = queueManager.get(guildId);
        
        if (!queue) {
            return res.json({
                isPlaying: false,
                isPaused: false,
                volume: 20,
                position: 0,
                duration: 0,
                current: null
            });
        }

        const current = queue.songs[queue.currentIndex];
        let duration = 0;
        if (current && current.timestamp && current.timestamp !== '?:??') {
            const parts = current.timestamp.split(':').reverse();
            let seconds = 0;
            if (parts[0]) seconds += parseInt(parts[0]) || 0;
            if (parts[1]) seconds += (parseInt(parts[1]) || 0) * 60;
            if (parts[2]) seconds += (parseInt(parts[2]) || 0) * 3600;
            duration = seconds * 1000;
        }

        const isPlaying = queue.player.state.status === 'playing';
        const isPaused = queue.player.state.status === 'paused' || queue.player.state.status === 'autopaused';
        
        const seekTime = queue.seekTime || 0;
        const currentPos = (queue.resource ? queue.resource.playbackDuration : 0) + seekTime;

        res.json({
            isPlaying: isPlaying,
            isPaused: isPaused,
            volume: Math.round(queue.volume * 100),
            loopMode: queue.loopMode || 0,
            isShuffled: queue.isShuffled || false,
            filters: queue.filters || [],
            position: currentPos,
            duration: duration,
            current: current
        });
    });

    // API: Effects Control
    app.post('/api/effects/:guildId', express.json(), (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        const guildId = req.params.guildId;
        const { effect, enabled } = req.body;
        
        const queue = queueManager.get(guildId);
        if (!queue) return res.status(404).json({ error: 'No active queue' });

        if (!queue.filters) queue.filters = [];

        let newFilters = [...queue.filters];
        if (enabled) {
            if (!newFilters.includes(effect)) {
                if (effect === 'nightcore') newFilters = newFilters.filter(f => f !== 'vaporwave');
                if (effect === 'vaporwave') newFilters = newFilters.filter(f => f !== 'nightcore');
                newFilters.push(effect);
            }
        } else {
            newFilters = newFilters.filter(f => f !== effect);
        }

        queue.setFilters(newFilters);

        res.json({ success: true, filters: queue.filters });
    });

    // API: Import Playlist
    app.post('/api/import-playlist', express.json(), async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        
        const { url, name } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        try {
            const playlist = await importPlaylist(url, req.user, name);
            res.json({ success: true, message: `Imported ${playlist.songs.length} songs`, playlist: playlist });
        } catch (error) {
            console.error('Import Error:', error);
            res.status(500).json({ error: error.message || 'Failed to import playlist' });
        }
    });

    // API: Get Playlists
    app.get('/api/playlists', async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const playlists = await readPlaylists();
            const userPlaylists = playlists.filter(p => p.userId === req.user.id);
            res.json(userPlaylists);
        } catch (e) {
            res.status(500).json({ error: 'Failed to fetch playlists' });
        }
    });
    
    // API: Play Playlist
    app.post('/api/play-playlist', express.json(), async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        
        const { playlistId, guildId } = req.body;
        const playlists = await readPlaylists();
        const playlist = playlists.find(p => p.id === playlistId);
        
        if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
        
        const guild = client.guilds.cache.get(guildId);
        const member = guild.members.cache.get(req.user.id);
        if (!member || !member.voice.channel) return res.status(400).json({ error: 'Join a voice channel' });
        
        const queue = queueManager.create(guildId, member.voice.channel, client);
        
        playlist.songs.forEach(s => {
            queue.addSong({
                ...s,
                addedBy: req.user.username,
                addedById: req.user.id
            });
        });
        
        res.json({ success: true, message: `Added ${playlist.songs.length} songs to queue` });
    });

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[Dashboard] Running on port ${PORT}`);
        console.log(`[Dashboard] Listening on IPv4 0.0.0.0 (Cloudflare Tunnel Recommended)`);
        console.log(`[Dashboard] OAuth Callback URL: ${process.env.DISCORD_CALLBACK_URL}`);
    });
}

module.exports = { startDashboard };
