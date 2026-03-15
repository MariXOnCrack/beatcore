const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 3001; // Use a different port for dev

// Mock User
const mockUser = {
    id: '123456789',
    username: 'DevUser',
    global_name: 'Developer',
    avatar: null,
    guilds: [
        { id: '1', name: 'Dev Server', permissions: 0x8, icon: null }
    ]
};

// Mock Queue Data
let mockQueue = {
    currentIndex: 0,
    songs: [
        {
            title: 'Heuss L\'Enfoiré - Bar-Mitzvah (Clip Officiel)',
            url: 'https://youtube.com/watch?v=rSIENBgBFVg',
            thumbnail: 'https://i.ytimg.com/vi/rSIENBgBFVg/hqdefault.jpg',
            timestamp: '3:15',
            author: 'Heuss L\'Enfoiré',
            addedBy: 'Developer',
            addedById: '123456789'
        },
        {
            title: 'Mock Song 2',
            url: 'https://youtube.com/watch?v=example2',
            thumbnail: 'https://placehold.co/600x400/2b2d31/white?text=Mock+2',
            timestamp: '4:20',
            author: 'Mock Artist',
            addedBy: 'Developer',
            addedById: '123456789'
        }
    ],
    isPlaying: true,
    volume: 0.5,
    loopMode: 0,
    isShuffled: false,
    filters: []
};

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use(session({
    store: new FileStore({ path: './sessions_dev', logFn: () => {} }),
    secret: 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Routes
app.get('/login', (req, res) => res.render('login'));
app.get('/auth/discord', (req, res) => {
    req.session.user = mockUser;
    res.redirect('/');
});

app.get('/', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('dashboard', {
        user: req.session.user,
        guilds: req.session.user.guilds
    });
});

// API Mocks
app.get('/api/status/:guildId', (req, res) => {
    res.json({
        isPlaying: mockQueue.isPlaying,
        isPaused: !mockQueue.isPlaying,
        volume: Math.round(mockQueue.volume * 100),
        loopMode: mockQueue.loopMode,
        isShuffled: mockQueue.isShuffled,
        filters: mockQueue.filters,
        position: 45000,
        duration: 195000,
        current: mockQueue.songs[mockQueue.currentIndex]
    });
});

app.get('/api/queue/:guildId', (req, res) => {
    res.json({
        current: mockQueue.songs[mockQueue.currentIndex],
        queue: mockQueue.songs.map((s, i) => ({ ...s, position: i + 1, isCurrent: i === mockQueue.currentIndex })),
        currentIndex: mockQueue.currentIndex
    });
});

app.post('/api/control/:guildId', (req, res) => {
    const { action, value } = req.body;
    console.log(`[Dev] Action: ${action}, Value: ${value}`);
    if (action === 'jump') mockQueue.currentIndex = value;
    if (action === 'volume') mockQueue.volume = value / 100;
    if (action === 'skip') mockQueue.currentIndex = (mockQueue.currentIndex + 1) % mockQueue.songs.length;
    res.json({ success: true });
});

app.get('/api/playlists', (req, res) => {
    res.json([
        { id: 'p1', name: 'Favorites', userId: '123456789', songs: [mockQueue.songs[0]] }
    ]);
});

app.get('/api/history/:guildId', (req, res) => res.json([]));

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
    socket.on('join-guild', () => {
        socket.emit('update-users', [mockUser]);
    });
});

server.listen(PORT, () => {
    console.log(`\x1b[32m[Dev Mode] Dashboard running at http://localhost:${PORT}\x1b[0m`);
    console.log(`\x1b[33m[Dev Mode] Click 'Discord' on login page to auto-login as mock user.\x1b[0m`);
});
