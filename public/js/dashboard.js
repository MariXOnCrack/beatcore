document.addEventListener('DOMContentLoaded', () => {
    // --- Mobile Sidebar Logic ---
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (mobileMenuToggle && sidebar && sidebarOverlay) {
        mobileMenuToggle.addEventListener('click', () => {
            sidebar.classList.add('open');
            sidebarOverlay.classList.add('active');
        });

        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });

        // Close sidebar when clicking a link on mobile
        const sidebarLinks = sidebar.querySelectorAll('a, .effect-item');
        sidebarLinks.forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('open');
                    sidebarOverlay.classList.remove('active');
                }
            });
        });
    }

    // --- Slider Logic ---
    const sliders = document.querySelectorAll('.seek-slider, .volume-slider');

    sliders.forEach(slider => {
        // Function to update the progress bar
        const updateProgress = () => {
            const value = slider.value;
            const max = slider.max || 100;
            const percentage = (value / max) * 100;
            
            const progress = slider.nextElementSibling;
            if (progress && progress.classList.contains('slider-progress')) {
                progress.style.width = `${percentage}%`;
            }
        };

        // Add event listener
        slider.addEventListener('input', updateProgress);

        // Initial update
        updateProgress();
    });

    // --- Player Logic ---
    const playPauseBtn = document.querySelector('.play-pause-btn');
    const prevBtn = document.querySelector('.prev-btn');
    const nextBtn = document.querySelector('.next-btn');
    const loopBtn = document.querySelector('.loop-btn');
    const shuffleBtn = document.querySelector('.shuffle-btn');
    const volumeSlider = document.querySelector('.volume-slider');
    const seekSlider = document.querySelector('.seek-slider');
    const currentTimeEl = document.querySelector('.current-time');
    const totalTimeEl = document.querySelector('.total-time');
    const trackTitle = document.querySelector('.track-title');
    const trackArtist = document.querySelector('.track-artist');
    const albumArtImg = document.querySelector('.bar-album-art'); // Container or img
    const playerWrapper = document.querySelector('.player-wrapper');
    const sidebarLogo = document.querySelector('.sidebar-logo');
    
    const joinVCBtn = document.getElementById('joinVCBtn');
    
    let colorThief;
    try {
        colorThief = new ColorThief();
    } catch (e) {
        console.warn('ColorThief not loaded', e);
    }

    let currentGuildId = null;

    let socket;
    try {
        socket = io();

        socket.on('update-users', (users) => {
            const container = document.getElementById('onlineUsers');
            if (!container) return;
            
            container.innerHTML = '';
            
            // Add Pulse Dot with Count
            // Wrapper for dot and text
            const countWrapper = document.createElement('div');
            countWrapper.className = 'online-count-wrapper';

            const pulseDot = document.createElement('div');
            pulseDot.className = 'bubble';
            pulseDot.innerHTML = `
                <span class="bubble-outer-dot">
                    <span class="bubble-inner-dot"></span>
                </span>
            `;
            
            const countText = document.createElement('span');
            countText.className = 'online-count-text';
            countText.textContent = `${users.length} Online`;

            countWrapper.appendChild(pulseDot);
            countWrapper.appendChild(countText);
            container.appendChild(countWrapper);

            // Show max 5 users + count? Or all? User asked for "like google docs".
            // Google docs shows bubbles.
            users.forEach(u => {
                const wrapper = document.createElement('div');
                wrapper.className = 'online-user-wrapper';

                const img = document.createElement('img');
                img.className = 'online-user-avatar';
                // Native title removed for custom tooltip
                
                if (u.avatar) {
                     img.src = `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`;
                } else {
                     img.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
                }
                
                img.onerror = function() { wrapper.style.display = 'none'; };

                const tooltip = document.createElement('div');
                tooltip.className = 'user-tooltip';
                tooltip.textContent = u.username;

                wrapper.appendChild(img);
                wrapper.appendChild(tooltip);
                container.appendChild(wrapper);
            });
        });
    } catch (e) {
        console.warn('Socket.io not loaded', e);
    }

    let lastTrackUrl = null;
    let lastThumbnailUrl = null;
    let isPulsing = false;

    let isDraggingSeek = false;
    let isDraggingVolume = false;

    // Control Helpers
    async function sendControl(action, value = null) {
        const guildId = serverSelect ? serverSelect.value : null;
        if (!guildId) return;

        try {
            const response = await fetch(`/api/control/${guildId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, value })
            });
            
            if (!response.ok) {
                const result = await response.json();
                if (result.error && typeof showNotification === 'function') {
                    showNotification(result.error, 'error');
                }
            }

            // Immediate status fetch could make UI snappier
            setTimeout(fetchStatus, 100);
        } catch (error) {
            console.error('Control error:', error);
        }
    }

    if (joinVCBtn) {
        joinVCBtn.addEventListener('click', () => {
            const hasQueue = joinVCBtn.querySelector('span').textContent === 'door_back';
            sendControl(hasQueue ? 'leave' : 'join');
        });
    }

    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            const isPlaying = playPauseBtn.querySelector('span').textContent === 'pause_circle_filled';
            sendControl(isPlaying ? 'pause' : 'resume');
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => sendControl('back'));
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => sendControl('skip'));
    }

    if (loopBtn) {
        loopBtn.addEventListener('click', () => sendControl('loop'));
    }

    if (shuffleBtn) {
        shuffleBtn.addEventListener('click', () => sendControl('shuffle'));
    }

    if (volumeSlider) {
        volumeSlider.addEventListener('mousedown', () => isDraggingVolume = true);
        volumeSlider.addEventListener('mouseup', () => {
            isDraggingVolume = false;
            sendControl('volume', volumeSlider.value);
        });
        volumeSlider.addEventListener('change', () => sendControl('volume', volumeSlider.value));
        
        // Local visual update while dragging
        volumeSlider.addEventListener('input', () => {
            updateSliderVisual(volumeSlider);
        });
    }

    if (seekSlider) {
        // Seek not fully supported backend-side yet for streaming, but visual sync is key
        seekSlider.addEventListener('mousedown', () => isDraggingSeek = true);
        seekSlider.addEventListener('mouseup', () => {
            isDraggingSeek = false;
            sendControl('seek', seekSlider.value);
        });
        seekSlider.addEventListener('change', () => sendControl('seek', seekSlider.value));
        
        // Local visual update while dragging
        seekSlider.addEventListener('input', () => {
             updateSliderVisual(seekSlider);
        });
    }

    function updateSliderVisual(slider) {
        const value = slider.value;
        const max = slider.max || 100;
        const percentage = (value / max) * 100;
        const progress = slider.nextElementSibling;
        if (progress && progress.classList.contains('slider-progress')) {
            progress.style.width = `${percentage}%`;
        }
    }

    // Polling Status
    setInterval(fetchStatus, 1000);

    async function fetchStatus() {
        const guildId = serverSelect ? serverSelect.value : null;
        if (!guildId) return;

        try {
            const response = await fetch(`/api/status/${guildId}`);
            if (response.ok) {
                const status = await response.json();
                updatePlayerUI(status);
            }
        } catch (e) {
            console.error('Status fetch error', e);
        }
    }

    function updatePlayerUI(status) {
        // Store current track globally for "Add to Playlist" feature
        if (status && status.current) {
            window.currentTrack = status.current;
        } else {
            window.currentTrack = null;
        }

        // Check if track changed to refresh queue (Equalizer icon update)
        if (status.current && status.current.url !== lastTrackUrl) {
            lastTrackUrl = status.current.url;
            fetchQueue();
        } else if (!status.current && lastTrackUrl) {
            lastTrackUrl = null;
            fetchQueue();
        }

        // Update Play/Pause Icon
        if (playPauseBtn) {
            const icon = playPauseBtn.querySelector('span');
            icon.textContent = status.isPlaying ? 'pause_circle_filled' : 'play_circle_filled';
        }

        // Update Join VC Icon
        if (joinVCBtn) {
            const icon = joinVCBtn.querySelector('span');
            if (status.hasQueue) {
                icon.textContent = 'door_back';
                joinVCBtn.title = 'Leave Voice Channel';
                joinVCBtn.style.color = '#5865F2';
            } else {
                icon.textContent = 'meeting_room';
                joinVCBtn.title = 'Join Voice Channel';
                joinVCBtn.style.color = '';
            }
        }

        // Update Logo Spin
        if (sidebarLogo) {
            if (status.isPlaying) {
                sidebarLogo.classList.add('spin-slow');
            } else {
                sidebarLogo.classList.remove('spin-slow');
            }
        }

        // Update Loop Button
        if (loopBtn) {
            const icon = loopBtn.querySelector('span');
            // 0: None, 1: Queue, 2: Song
            if (status.loopMode === 1) {
                icon.textContent = 'repeat';
                loopBtn.style.color = '#5865F2';
                loopBtn.title = 'Loop Queue (Click to Loop Song)';
            } else if (status.loopMode === 2) {
                icon.textContent = 'repeat_one';
                loopBtn.style.color = '#5865F2';
                loopBtn.title = 'Loop Song (Click to Disable)';
            } else {
                icon.textContent = 'repeat';
                loopBtn.style.color = ''; // Reset to default
                loopBtn.title = 'No Loop (Click to Loop Queue)';
            }
        }

        // Update Shuffle Button
        if (shuffleBtn) {
            if (status.isShuffled) {
                shuffleBtn.style.color = '#5865F2';
            } else {
                shuffleBtn.style.color = '';
            }
        }

        // Update Info
        if (status.current) {
            if (trackTitle) trackTitle.textContent = status.current.title;
            if (trackArtist) trackArtist.textContent = status.current.author;
            // Update Album Art if possible (needs img tag)
             if (albumArtImg) {
                 const img = albumArtImg.querySelector('img');
                 const placeholder = albumArtImg.querySelector('.album-art-placeholder');
                 const currentThumb = status.current.thumbnail;

                 if (currentThumb) {
                     if (currentThumb !== lastThumbnailUrl) {
                         lastThumbnailUrl = currentThumb;
                         
                         // Update Player Gradient
                         updatePlayerGradient(currentThumb);

                         if (img) {
                             img.crossOrigin = "Anonymous";
                             img.src = currentThumb;
                             img.style.display = 'block';
                         } else {
                             // Create img if not exists
                             const newImg = document.createElement('img');
                             newImg.crossOrigin = "Anonymous";
                             newImg.src = currentThumb;
                             newImg.alt = "Art";
                             newImg.className = "album-art-img";
                             albumArtImg.appendChild(newImg);
                         }
                     }
                     
                     // Ensure visibility (in case it was hidden)
                     if (img && img.style.display === 'none') img.style.display = 'block';
                     if (placeholder) placeholder.style.display = 'none';
                     
                 } else {
                     // No thumbnail, show placeholder
                     if (img) img.style.display = 'none';
                     if (placeholder) placeholder.style.display = 'flex';
                     if (lastThumbnailUrl !== null) {
                         lastThumbnailUrl = null;
                         updateAmbientGradient(null);
                     }
                 }
             }
        } else {
            if (trackTitle) trackTitle.textContent = 'Nothing Playing';
            if (trackArtist) trackArtist.textContent = 'Join voice channel';
             if (albumArtImg) {
                 albumArtImg.innerHTML = `
                            <div class="album-art-placeholder">
                                <span class="material-icons-outlined">music_note</span>
                            </div>`;
                 // Remove gradient when nothing playing
                 if (lastThumbnailUrl !== null) {
                    lastThumbnailUrl = null;
                    updateAmbientGradient(null);
                 }
             }
        }

        // Update Volume (if not dragging)
        if (volumeSlider && !isDraggingVolume) {
            volumeSlider.value = status.volume;
            updateSliderVisual(volumeSlider);
        }

        // Update Progress (if not dragging)
        if (seekSlider && !isDraggingSeek) {
            const currentMs = status.position;
            const totalMs = status.duration || 1; // avoid div/0
            const percentage = Math.min(100, (currentMs / totalMs) * 100);
            
            seekSlider.value = percentage;
            updateSliderVisual(seekSlider);

            if (currentTimeEl) currentTimeEl.textContent = formatTime(currentMs);
            if (totalTimeEl) totalTimeEl.textContent = formatTime(totalMs);
        }

        // Sync Effects UI
        if (typeof updateEffectsUI === 'function') {
            updateEffectsUI(status.filters);
        }
    }

    function formatTime(ms) {
        if (!ms) return "0:00";
        const seconds = Math.floor(ms / 1000);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function startVisualizerSimulation() {
        // DISABLED: Using Real-Time Socket.io sync instead
        // This function is kept to avoid breaking calls but does nothing now
        return; 

        /* Old Simulation Code:
        if (!isPulsing || !ambientGradient) return;
        const now = Date.now();
        const wave1 = Math.sin(now * 0.003); 
        const wave2 = Math.sin(now * 0.007 + 100);
        const wave3 = Math.sin(now * 0.02);
        const energy = (wave1 + wave2 * 0.5 + wave3 * 0.2) / 1.7; 
        const opacity = VISUALIZER.BASE_OPACITY + (Math.abs(energy) * VISUALIZER.VAR_OPACITY);
        const height = VISUALIZER.MIN_HEIGHT_VH + (Math.abs(energy) * VISUALIZER.VAR_HEIGHT_VH);
        ambientGradient.style.opacity = opacity.toFixed(3);
        ambientGradient.style.height = `${height}vh`;
        requestAnimationFrame(startVisualizerSimulation);
        */
    }

    // --- Dynamic Gradient from Album Art ---
    function updatePlayerGradient(imageUrl) {
        if (!playerWrapper) return;
        if (!colorThief) {
             playerWrapper.style.background = 'rgba(0,0,0,0.3)';
             return;
        }
        
        // Create a temporary image to extract color
        const tempImg = new Image();
        tempImg.crossOrigin = "Anonymous";
        tempImg.src = imageUrl;
        
        tempImg.onload = () => {
            try {
                // Get dominant color
                const color = colorThief.getColor(tempImg);
                
                // Apply subtle gradient to player wrapper
                // Bottom-to-top gradient: Color (very low opacity) -> Transparent
                playerWrapper.style.background = `linear-gradient(to top, 
                    rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.2) 0%, 
                    rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.05) 60%,
                    rgba(0,0,0,0) 100%
                )`;
                // Keep the blur
                playerWrapper.style.backdropFilter = "blur(10px)";
                
            } catch (e) {
                console.log('Color extraction failed (likely CORS), using default gradient');
                playerWrapper.style.background = 'rgba(0,0,0,0.3)';
            }
        };
        
        tempImg.onerror = () => {
             playerWrapper.style.background = 'rgba(0,0,0,0.3)';
        };
    }

    // --- Search Logic ---
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    const navHome = document.getElementById('nav-home');
    const navHistory = document.getElementById('nav-history');
    const homeView = document.getElementById('home-view');
    const historyView = document.getElementById('history-view');
    const historyList = document.getElementById('historyList');
    const queueList = document.getElementById('queueList');
    const serverSelect = document.querySelector('.server-select');
    
    // --- Playlist Elements ---
    const navPlaylists = document.getElementById('nav-playlists');
    const playlistsView = document.getElementById('playlists-view');
    const createPlaylistBtn = document.getElementById('createPlaylistBtn');
    const playlistsListContainer = document.getElementById('playlistsListContainer');
    const playlistDetailView = document.getElementById('playlistDetailView');
    const backToPlaylistsBtn = document.getElementById('backToPlaylistsBtn');
    const currentPlaylistName = document.getElementById('currentPlaylistName');
    const playAllPlaylistBtn = document.getElementById('playAllPlaylistBtn');
    const deletePlaylistBtn = document.getElementById('deletePlaylistBtn');
    const playlistSongsList = document.getElementById('playlistSongsList');
    const importPlaylistBtn = document.getElementById('importPlaylistBtn'); // Import Button
    
    // Modals
    const createPlaylistModal = document.getElementById('createPlaylistModal');
    const importPlaylistModal = document.getElementById('importPlaylistModal'); // Import Modal
    const importUrl = document.getElementById('importUrl');
    const importName = document.getElementById('importName');
    const cancelImportPlaylist = document.getElementById('cancelImportPlaylist');
    const confirmImportPlaylist = document.getElementById('confirmImportPlaylist');
    const newPlaylistName = document.getElementById('newPlaylistName');
    const cancelCreatePlaylist = document.getElementById('cancelCreatePlaylist');
    const confirmCreatePlaylist = document.getElementById('confirmCreatePlaylist');
    
    const addToPlaylistModal = document.getElementById('addToPlaylistModal');
    const addToPlaylistList = document.getElementById('addToPlaylistList');
    const cancelAddToPlaylist = document.getElementById('cancelAddToPlaylist');

    // Confirmation Modal
    const confirmationModal = document.getElementById('confirmationModal');
    const confirmationTitle = document.getElementById('confirmationTitle');
    const confirmationMessage = document.getElementById('confirmationMessage');
    const cancelConfirmation = document.getElementById('cancelConfirmation');
    const confirmActionBtn = document.getElementById('confirmAction');
    
    let currentConfirmCallback = null;

    let debounceTimer;

    // Navigation Logic
    if (navHome && searchResults && searchInput && homeView) {
        navHome.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Sidebar active state
            document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
            navHome.parentElement.classList.add('active');

            searchResults.style.display = 'none';
            if (historyView) historyView.style.display = 'none';
            if (playlistsView) playlistsView.style.display = 'none';
            if (importPlaylistBtn) importPlaylistBtn.style.display = 'none'; // Hide Import Button
            homeView.style.display = 'block'; // Show home view
            searchInput.value = ''; 
            searchResults.innerHTML = ''; 
            fetchQueue(); // Refresh queue
        });
    }

    if (navHistory && historyView) {
        navHistory.addEventListener('click', (e) => {
            e.preventDefault();

            // Sidebar active state
            document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
            navHistory.parentElement.classList.add('active');

            searchResults.style.display = 'none';
            homeView.style.display = 'none';
            if (playlistsView) playlistsView.style.display = 'none';
            if (importPlaylistBtn) importPlaylistBtn.style.display = 'none'; // Hide Import Button
            historyView.style.display = 'block';
            
            fetchHistory();
        });
    }

    // Server Selection Logic
    if (serverSelect) {
        serverSelect.addEventListener('change', () => {
            triggerLoadInAnimations(); // Re-trigger load-in animations
            
            // Update socket room
            const newGuildId = serverSelect.value;
            if (newGuildId !== currentGuildId) {
                currentGuildId = newGuildId;
                if (socket) {
                    socket.emit('join-guild', {
                        guildId: currentGuildId,
                        user: typeof CURRENT_USER !== 'undefined' ? CURRENT_USER : { id: 'unknown', username: 'Guest' }
                    });
                }
            }

            // Force navigation to Home tab using the existing click handler
            // This ensures all UI states (sidebar, views, search) are reset correctly
            if (navHome) {
                navHome.click();
            } else {
                fetchQueue();
            }
        });
    }

    // Helper to replay load-in animations
    function triggerLoadInAnimations() {
        const selectors = [
            '.sidebar',
            '.main-content',
            '.top-bar',
            '.queue-section',
            '.player-wrapper',
            '.sidebar-nav li',
            '.welcome-section h1'
        ];

        selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                // Reset animation to trigger it again
                el.style.animation = 'none';
                el.offsetHeight; // Force reflow
                el.style.animation = '';
            });
        });
    }

    // Initial Queue Fetch
    fetchQueue();

    // Initial Socket Join
    if (serverSelect && serverSelect.value && socket) {
         currentGuildId = serverSelect.value;
         socket.emit('join-guild', {
             guildId: currentGuildId,
             user: typeof CURRENT_USER !== 'undefined' ? CURRENT_USER : { id: 'unknown', username: 'Guest' }
         });
    }

    async function fetchQueue() {
        if (!serverSelect || !queueList) return;
        const guildId = serverSelect.value;
        if (!guildId) return;

        try {
            const response = await fetch(`/api/queue/${guildId}`);
            if (!response.ok) throw new Error('Failed to fetch queue');
            const data = await response.json();
            
            // Prevent race conditions: ensure selected server hasn't changed
            if (serverSelect.value !== guildId) return;
            
            renderQueue(data);
        } catch (error) {
            console.error('Queue fetch error:', error);
        }
    }

    async function fetchHistory() {
        if (!serverSelect || !historyList) return;
        const guildId = serverSelect.value;
        if (!guildId) return;

        try {
            const response = await fetch(`/api/history/${guildId}`);
            if (!response.ok) throw new Error('Failed to fetch history');
            const data = await response.json();
            
            // Prevent race conditions: ensure selected server hasn't changed
            if (serverSelect.value !== guildId) return;

            renderHistory(data);
        } catch (error) {
            console.error('History fetch error:', error);
        }
    }

    function renderHistory(songs) {
        if (!songs || songs.length === 0) {
            historyList.innerHTML = `
                <div class="queue-empty">
                    <span class="material-icons-outlined">history</span>
                    <p>No history yet</p>
                </div>`;
            return;
        }

        let html = '';
        
        songs.forEach((song, index) => {
            const timeAgo = getTimeAgo(song.playedAt);
            
            html += `
            <div class="queue-list-item queue-history" style="opacity: 1; filter: none;">
                <div class="q-item-pos">${index + 1}</div>
                <div class="q-item-info">
                    <img src="${song.thumbnail || '/images/default_album.png'}" alt="Art" class="q-item-img" onerror="this.src='https://placehold.co/40x40/2b2d31/white?text=♪'">
                    <div class="q-item-details">
                        <div class="q-item-title" title="${song.title}">${song.title}</div>
                        <div class="q-item-author">${song.author}</div>
                    </div>
                </div>
                <div class="q-item-duration">${timeAgo}</div>
                <div class="q-item-added" title="${song.addedBy}">
                    ${song.addedById && song.addedByAvatar ? 
                        `<img src="https://cdn.discordapp.com/avatars/${song.addedById}/${song.addedByAvatar}.png" class="q-item-avatar" onerror="this.style.display='none'">` : 
                        '<span class="material-icons-outlined" style="font-size: 16px; margin-right: 5px;">person</span>'
                    }
                    <span class="q-item-added-name">${song.addedBy || 'Unknown'}</span>
                </div>
                <div class="q-item-action">
                    <!-- Placeholder for potential future actions -->
                </div>
            </div>
            `;
        });

        historyList.innerHTML = html;
    }

    function getTimeAgo(timestamp) {
        if (!timestamp) return '';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return 'Yesterday'; 
    }

    function renderQueue(data) {
        // data = { current: {...}, queue: [...], currentIndex: ... }
        if (!data || !data.queue || data.queue.length === 0) {
            queueList.innerHTML = `
                <div class="queue-empty">
                    <span class="material-icons-outlined">music_off</span>
                    <p>Queue is empty</p>
                </div>`;
            return;
        }

        let html = '';
        
        // Loop through the full queue
        data.queue.forEach((song, index) => {
            // Determine state
            let state = 'upcoming';
            if (index < data.currentIndex) {
                state = 'history';
            } else if (index === data.currentIndex) {
                state = 'current';
            }
            
            // Pass the absolute index (for removal) and display position (1-based)
            html += createQueueItemHtml(song, index + 1, state, index);
        });

        queueList.innerHTML = html;
        
        // Scroll current song into view if needed (optional)
        // const currentItem = queueList.querySelector('.queue-list-item.playing-now');
        // if (currentItem) currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function createQueueItemHtml(song, position, state, realIndex) {
        // state: 'history', 'current', 'upcoming'
        
        let itemClass = '';
        let iconOrPos = position;
        
        if (state === 'history') {
            itemClass = 'queue-history';
        } else if (state === 'current') {
            itemClass = 'playing-now';
            // Custom SVG Equalizer for current track
            iconOrPos = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
              <rect class="eq-bar eq-bar--1" x="4" y="16" width="3.7" height="8"/>
              <rect class="eq-bar eq-bar--2" x="10.2" y="8" width="3.7" height="16"/>
              <rect class="eq-bar eq-bar--3" x="16.3" y="13" width="3.7" height="11"/>
            </svg>`;
        }

        return `
            <div class="queue-list-item ${itemClass}" ondblclick="jumpToSong(${realIndex})">
                <div class="q-item-pos">
                    ${iconOrPos}
                </div>
                <div class="q-item-info">
                    <img src="${song.thumbnail || '/images/default_album.png'}" alt="Art" class="q-item-img" onerror="this.src='https://placehold.co/40x40/2b2d31/white?text=♪'">
                    <div class="q-item-details">
                        <div class="q-item-title" title="${song.title}">${song.title}</div>
                        <div class="q-item-author">${song.author}</div>
                    </div>
                </div>
                <div class="q-item-duration">${song.timestamp}</div>
                <div class="q-item-added" title="${song.addedBy}">
                    ${song.addedById && song.addedByAvatar ? 
                        `<img src="https://cdn.discordapp.com/avatars/${song.addedById}/${song.addedByAvatar}.png" class="q-item-avatar" onerror="this.style.display='none'">` : 
                        '<span class="material-icons-outlined" style="font-size: 16px; margin-right: 5px;">person</span>'
                    }
                    <span class="q-item-added-name">${song.addedBy || 'Unknown'}</span>
                </div>
                <div class="q-item-action">
                    <button type="button" class="delete-btn" onclick="event.stopPropagation(); removeSong(${realIndex})" title="Remove from Queue">
                        <span class="material-icons-outlined">delete</span>
                    </button>
                </div>
            </div>
        `;
    }

    window.jumpToSong = async (index) => {
        const guildId = serverSelect ? serverSelect.value : null;
        if (!guildId) return;

        try {
            const response = await fetch(`/api/control/${guildId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'jump', value: index })
            });
            
            if (response.ok) {
                setTimeout(() => {
                    fetchQueue();
                    fetchStatus();
                }, 300);
            }
        } catch (error) {
            console.error('Jump error:', error);
        }
    };

    window.removeSong = async (index) => {
        console.log('removeSong called with index:', index);
        const guildId = serverSelect ? serverSelect.value : null;
        if (!guildId) {
            console.error('No guild selected');
            return;
        }

        try {
            const response = await fetch(`/api/queue/remove/${guildId}/${index}`, {
                method: 'POST'
            });
            const result = await response.json();
            
            if (response.ok) {
                fetchQueue(); // Refresh queue
            } else {
                console.error(`Error: ${result.error}`);
            }
        } catch (error) {
            console.error('Remove error:', error);
        }
    };

    window.clearQueue = async () => {
        const guildId = serverSelect ? serverSelect.value : null;
        if (!guildId) return;

        try {
            const response = await fetch(`/api/queue/clear/${guildId}`, {
                method: 'POST'
            });
            
            if (response.ok) {
                fetchQueue();
            } else {
                console.error('Failed to clear queue');
            }
        } catch (error) {
            console.error('Clear queue error:', error);
        }
    };

    if (searchInput && searchResults) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();

            // Clear existing timer
            clearTimeout(debounceTimer);

            // Hide results if query is empty
            if (query.length === 0) {
                searchResults.style.display = 'none';
                homeView.style.display = 'block'; // Show home view
                searchResults.innerHTML = '';
                return;
            }

            // Hide views when searching
            homeView.style.display = 'none';
            if (historyView) historyView.style.display = 'none';
            if (playlistsView) playlistsView.style.display = 'none';

            // Set new timer (500ms debounce)
            debounceTimer = setTimeout(async () => {
                try {
                    // Show loading state (optional)
                    searchResults.style.display = 'block';
                    searchResults.innerHTML = '<div class="loading-spinner">Searching...</div>';
                    
                    // ... existing fetch logic ...
                    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                    if (!response.ok) throw new Error('Search failed');
                    
                    const videos = await response.json();
                    
                    renderSearchResults(videos);
                } catch (error) {
                    console.error('Search error:', error);
                    searchResults.innerHTML = '<div class="error-message">Failed to load results</div>';
                }
            }, 500); // 500ms delay after typing stops
        });
    }

    function renderSearchResults(videos) {
        if (videos.length === 0) {
            searchResults.innerHTML = '<div class="no-results">No results found</div>';
            return;
        }

        const html = videos.map(video => {
            // Escape quotes for onclick
            const safeTitle = video.title.replace(/'/g, "\\'");
            const safeAuthor = video.author.replace(/'/g, "\\'");
            const safeThumbnail = video.thumbnail;
            const safeUrl = video.url;
            const safeTimestamp = video.timestamp;

            return `
            <div class="search-result-item" onclick="playVideo('${safeUrl}', '${safeTitle}', '${safeThumbnail}', '${safeTimestamp}', '${safeAuthor}')">
                <div class="result-img-container">
                    <img src="${video.thumbnail}" alt="${video.title}">
                    <div class="play-overlay">
                        <span class="material-icons">play_arrow</span>
                    </div>
                </div>
                <div class="result-info">
                    <div class="result-title">${video.title}</div>
                    <div class="result-meta">
                        <span class="result-author">${video.author}</span>
                        <span class="result-duration">• ${video.timestamp}</span>
                    </div>
                </div>
                <div class="result-action">
                     <button class="add-to-playlist-btn-small" title="Add to Playlist" onclick="event.stopPropagation(); openAddToPlaylistModal('${safeUrl}', '${safeTitle}', '${safeThumbnail}', '${safeTimestamp}', '${safeAuthor}')">
                        <span class="material-icons-outlined">playlist_add</span>
                     </button>
                </div>
            </div>
        `}).join('');

        searchResults.innerHTML = html;
        searchResults.style.display = 'grid'; // Use grid for layout
    }

    // Play a video
    // --- Sidebar Effects Toggle ---
    const navEffectsToggle = document.getElementById('nav-effects-toggle');
    const effectsSubmenu = document.getElementById('effects-submenu');

    if (navEffectsToggle && effectsSubmenu) {
        navEffectsToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const parent = navEffectsToggle.parentElement; // li.has-submenu
            
            // Toggle open class
            parent.classList.toggle('open');
        });
    }

    // --- Effects Selection Logic ---
    // Update selector to match new sidebar items if needed, but .effect-item is preserved
    const effectItems = document.querySelectorAll('.effect-item');
    
    if (effectItems.length > 0) {
        effectItems.forEach(btn => {
            btn.addEventListener('click', async () => {
                const guildId = serverSelect ? serverSelect.value : null;
                if (!guildId) return;

                const effect = btn.dataset.effect;
                const isEnabled = btn.classList.contains('active');
                
                // Optimistic toggle
                btn.classList.toggle('active');

                try {
                    const response = await fetch(`/api/effects/${guildId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            effect: effect,
                            enabled: !isEnabled // Toggle
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        // Sync UI with actual server state (handles mutual exclusivity)
                        updateEffectsUI(data.filters);
                    } else {
                        // Revert on error
                        btn.classList.toggle('active');
                    }
                } catch (error) {
                    console.error('Effect toggle error:', error);
                    btn.classList.toggle('active');
                }
            });
        });
    }

    function updateEffectsUI(filters) {
        if (!filters) filters = [];
        const items = document.querySelectorAll('.effect-item');
        items.forEach(item => {
            const effect = item.dataset.effect;
            if (filters.includes(effect)) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    window.playVideo = async (url, title, thumbnail, timestamp, author) => {
        // Find selected guild
        const serverSelect = document.querySelector('.server-select');
        const guildId = serverSelect ? serverSelect.value : null;

        if (!guildId) {
            showNotification('Please select a server first.', 'warning');
            return;
        }

        try {
            // Optimistic UI update (optional): could show a toast or something
            
            const response = await fetch('/api/play', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url,
                    title,
                    thumbnail,
                    timestamp,
                    author,
                    guildId
                })
            });

            const result = await response.json();
            
            if (response.ok) {
                // Success: hide search
                searchResults.style.display = 'none';
                searchInput.value = '';
                searchResults.innerHTML = '';
                
                // Determine which view to show
                // If we are in playlists view, stay there. Otherwise go to home.
                const isPlaylistsActive = navPlaylists && navPlaylists.parentElement.classList.contains('active');
                
                if (isPlaylistsActive) {
                    // Ensure playlists view is visible (it should be already)
                    if (playlistsView) playlistsView.style.display = 'block';
                    if (homeView) homeView.style.display = 'none';
                } else {
                    // Default behavior: go to home view
                    if (homeView) homeView.style.display = 'block';
                    if (playlistsView) playlistsView.style.display = 'none';
                }
                
                // Refresh queue to show new song
                fetchQueue();

                // Show notification
                showNotification(`Added "${title}" to queue`, 'success');
            } else {
                console.error(`Error: ${result.error || 'Failed to play song'}`);
            }
        } catch (error) {
            console.error('Play error:', error);
        }
    };

    // --- Playlist Logic ---
    // Variables defined at top of scope

    let currentPlaylistId = null;
    let songToAdd = null;

    // Navigation
    if (navPlaylists && playlistsView) {
        navPlaylists.addEventListener('click', (e) => {
            e.preventDefault();
            
            document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
            navPlaylists.parentElement.classList.add('active');

            searchResults.style.display = 'none';
            homeView.style.display = 'none';
            if (historyView) historyView.style.display = 'none';
            playlistsView.style.display = 'block';
            
            // Show Import Button
            if (importPlaylistBtn) importPlaylistBtn.style.display = 'flex';

            // Show list, hide detail
            if (playlistsListContainer) {
                playlistsListContainer.style.display = 'grid';
                if (playlistsListContainer.parentElement) {
                    playlistsListContainer.parentElement.style.display = 'block';
                }
            }
            if (playlistDetailView) playlistDetailView.style.display = 'none';
            
            currentPlaylistId = null;

            fetchPlaylists();
        });
    }

    if (backToPlaylistsBtn) {
        backToPlaylistsBtn.addEventListener('click', () => {
            playlistDetailView.style.display = 'none';
            playlistsListContainer.parentElement.style.display = 'block'; // Show the container wrapper
            currentPlaylistId = null;
            fetchPlaylists(); // Refresh in case of changes
        });
    }

    // Fetch Playlists
    async function fetchPlaylists() {
        try {
            const response = await fetch(`/api/playlists?_t=${Date.now()}`);
            if (response.ok) {
                const playlists = await response.json();
                renderPlaylists(playlists);
            }
        } catch (error) {
            console.error('Error fetching playlists:', error);
        }
    }

    function renderPlaylists(playlists) {
        if (!playlistsListContainer) return;

        if (playlists.length === 0) {
            playlistsListContainer.innerHTML = `
                <div class="no-playlists">
                    <span class="material-icons-outlined">queue_music</span>
                    <p>No playlists yet</p>
                </div>
            `;
            return;
        }

        playlistsListContainer.innerHTML = playlists.map(p => `
            <div class="playlist-card" onclick="openPlaylist('${p.id}')">
                <div class="playlist-card-art">
                    ${p.songs.length > 0 && p.songs[0].thumbnail 
                        ? `<img src="${p.songs[0].thumbnail}" alt="Art">`
                        : `<span class="material-icons-outlined">music_note</span>`
                    }
                </div>
                <div class="playlist-card-info">
                    <div class="playlist-name">${p.name}</div>
                    <div class="playlist-count">${p.songs.length} songs</div>
                </div>
            </div>
        `).join('');
    }

    // Create Playlist
    if (createPlaylistBtn) {
        createPlaylistBtn.addEventListener('click', () => {
            createPlaylistModal.classList.add('active');
            newPlaylistName.focus();
        });
    }

    if (cancelCreatePlaylist) {
        cancelCreatePlaylist.addEventListener('click', () => {
            createPlaylistModal.classList.remove('active');
            newPlaylistName.value = '';
        });
    }

    if (confirmCreatePlaylist) {
        confirmCreatePlaylist.addEventListener('click', async () => {
            const name = newPlaylistName.value.trim();
            if (!name) return;

            try {
                const response = await fetch('/api/playlists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });

                if (response.ok) {
                    createPlaylistModal.classList.remove('active');
                    newPlaylistName.value = '';
                    fetchPlaylists();
                }
            } catch (error) {
                console.error('Error creating playlist:', error);
            }
        });
    }

    // Open Playlist
    window.openPlaylist = async (id) => {
        try {
            const response = await fetch(`/api/playlists?_t=${Date.now()}`);
            if (response.ok) {
                const playlists = await response.json();
                const playlist = playlists.find(p => p.id === id);
                if (playlist) {
                    renderPlaylistDetail(playlist);
                }
            }
        } catch (error) {
            console.error('Error opening playlist:', error);
        }
    };

    function renderPlaylistDetail(playlist) {
        currentPlaylistId = playlist.id;
        playlistsListContainer.parentElement.style.display = 'none'; // Hide the container wrapper
        playlistDetailView.style.display = 'block';
        
        currentPlaylistName.textContent = playlist.name;
        
        if (playlist.songs.length === 0) {
            playlistSongsList.innerHTML = `
                <div class="queue-empty">
                    <span class="material-icons-outlined">queue_music</span>
                    <p>Playlist is empty</p>
                </div>
            `;
        } else {
            playlistSongsList.innerHTML = playlist.songs.map((song, index) => `
                <div class="queue-list-item" onclick="playVideo('${song.url}', '${song.title.replace(/'/g, "\\'")}', '${song.thumbnail}', '${song.timestamp}', '${song.author.replace(/'/g, "\\'")}')">
                    <div class="q-item-pos">${index + 1}</div>
                    <div class="q-item-info">
                        <div class="playlist-img-wrapper">
                            <img src="${song.thumbnail || '/images/default_album.png'}" alt="Art" class="q-item-img">
                            <div class="play-overlay">
                                <span class="material-icons">play_arrow</span>
                            </div>
                        </div>
                        <div class="q-item-details">
                            <div class="q-item-title">${song.title}</div>
                            <div class="q-item-author">${song.author}</div>
                        </div>
                    </div>
                    <div class="q-item-duration">${song.timestamp}</div>
                    <div class="q-item-action">
                        <button class="delete-btn" onclick="event.stopPropagation(); removeSongFromPlaylist('${playlist.id}', ${index})" title="Remove from Playlist">
                            <span class="material-icons-outlined">delete</span>
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    // Remove Song from Playlist
    window.removeSongFromPlaylist = (playlistId, index) => {
        showConfirmation('Remove Song', 'Remove this song from playlist?', async () => {
            try {
                const response = await fetch(`/api/playlists/${playlistId}/songs/${index}`, {
                    method: 'DELETE'
                });
                if (response.ok) {
                    // Refresh detail view
                    openPlaylist(playlistId);
                    showNotification('Song removed from playlist', 'success');
                }
            } catch (error) {
                console.error('Error removing song:', error);
                showNotification('Error removing song', 'error');
            }
        });
    };

    // Delete Playlist
    if (deletePlaylistBtn) {
        deletePlaylistBtn.addEventListener('click', () => {
            if (!currentPlaylistId) return;
            
            showConfirmation('Delete Playlist', 'Are you sure you want to delete this playlist?', async () => {
                try {
                    const response = await fetch(`/api/playlists/${currentPlaylistId}`, {
                        method: 'DELETE'
                    });
                    if (response.ok) {
                        // Go back to list
                        backToPlaylistsBtn.click();
                        showNotification('Playlist deleted successfully', 'success');
                    }
                } catch (error) {
                    console.error('Error deleting playlist:', error);
                    showNotification('Error deleting playlist', 'error');
                }
            });
        });
    }

    // Play All
    if (playAllPlaylistBtn) {
        playAllPlaylistBtn.addEventListener('click', async () => {
            if (!currentPlaylistId) return;
            
            const serverSelect = document.querySelector('.server-select');
            const guildId = serverSelect ? serverSelect.value : null;
            if (!guildId) {
            showNotification('Please select a server first.', 'warning');
            return;
        }

            try {
                const playResponse = await fetch('/api/play-playlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        playlistId: currentPlaylistId,
                        guildId
                    })
                });
                
                if (playResponse.ok) {
                    const result = await playResponse.json();
                    showNotification(result.message || 'Added playlist to queue!', 'success');
                    fetchQueue();
                } else {
                    const error = await playResponse.json();
                    showNotification(error.error || 'Failed to play playlist', 'error');
                }
            } catch (error) {
                console.error('Error playing all:', error);
                showNotification('An error occurred', 'error');
            }
        });
    }

    // Add to Playlist Modal
    window.openAddToPlaylistModal = (url, title, thumbnail, timestamp, author) => {
        songToAdd = { url, title, thumbnail, timestamp, author };
        addToPlaylistModal.classList.add('active');
        fetchPlaylistsForModal();
    };

    // Also attach to the player bar "Add" button
    const playerAddBtn = document.querySelector('.add-to-playlist-btn');
    if (playerAddBtn) {
        playerAddBtn.addEventListener('click', () => {
             if (window.currentTrack) {
                 openAddToPlaylistModal(
                     window.currentTrack.url,
                     window.currentTrack.title,
                     window.currentTrack.thumbnail,
                     window.currentTrack.timestamp || '?:??', 
                     window.currentTrack.author
                 );
             } else {
                 showNotification('Nothing playing to add!', 'warning');
             }
        });
    }

    if (cancelAddToPlaylist) {
        cancelAddToPlaylist.addEventListener('click', () => {
            addToPlaylistModal.classList.remove('active');
            songToAdd = null;
        });
    }

    async function fetchPlaylistsForModal() {
        try {
            const response = await fetch(`/api/playlists?_t=${Date.now()}`);
            if (response.ok) {
                const playlists = await response.json();
                renderPlaylistsInModal(playlists);
            }
        } catch (error) {
            console.error('Error fetching playlists:', error);
        }
    }

    function renderPlaylistsInModal(playlists) {
        if (!addToPlaylistList) return;
        
        if (playlists.length === 0) {
            addToPlaylistList.innerHTML = '<p style="text-align:center; padding: 20px;">No playlists. Create one first!</p>';
            return;
        }

        addToPlaylistList.innerHTML = playlists.map(p => `
            <div class="modal-list-item" onclick="addSongToPlaylist('${p.id}')">
                <span class="material-icons-outlined">queue_music</span>
                <span>${p.name}</span>
                <span class="count">${p.songs.length} songs</span>
            </div>
        `).join('');
    }

    window.addSongToPlaylist = async (playlistId) => {
        if (!songToAdd) return;
        
        try {
            const response = await fetch(`/api/playlists/${playlistId}/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ song: songToAdd })
            });

            if (response.ok) {
                addToPlaylistModal.classList.remove('active');
                songToAdd = null;
                showNotification('Song added to playlist!', 'success');
            } else {
                showNotification('Failed to add song.', 'error');
            }
        } catch (error) {
            console.error('Error adding song:', error);
            showNotification('Error adding song', 'error');
        }
    };

    // Confirmation Logic
    function showConfirmation(title, message, onConfirm) {
        if (!confirmationModal) return;
        
        confirmationTitle.textContent = title;
        confirmationMessage.textContent = message;
        confirmationModal.classList.add('active');
        
        currentConfirmCallback = onConfirm;
    }

    if (cancelConfirmation) {
        cancelConfirmation.addEventListener('click', () => {
             confirmationModal.classList.remove('active');
             currentConfirmCallback = null;
        });
    }

    if (confirmActionBtn) {
        confirmActionBtn.addEventListener('click', () => {
            if (currentConfirmCallback) {
                currentConfirmCallback();
            }
            confirmationModal.classList.remove('active');
            currentConfirmCallback = null;
        });
    }

    // --- Import Playlist Logic ---
    if (importPlaylistBtn) {
        importPlaylistBtn.addEventListener('click', () => {
            if (importPlaylistModal) importPlaylistModal.classList.add('active');
            if (importUrl) importUrl.focus();
        });
    }

    if (cancelImportPlaylist) {
        cancelImportPlaylist.addEventListener('click', () => {
            if (importPlaylistModal) importPlaylistModal.classList.remove('active');
            if (importUrl) importUrl.value = '';
            if (importName) importName.value = '';
        });
    }

    if (confirmImportPlaylist) {
        confirmImportPlaylist.addEventListener('click', async () => {
            const url = importUrl.value.trim();
            const name = importName.value.trim();
            
            if (!url) {
                showNotification('Please enter a playlist URL', 'warning');
                return;
            }

            confirmImportPlaylist.disabled = true;
            confirmImportPlaylist.textContent = 'Importing...';

            try {
                const response = await fetch('/api/import-playlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, name })
                });

                const result = await response.json();

                if (response.ok) {
                    showNotification(result.message || 'Playlist imported successfully', 'success');
                    if (importPlaylistModal) importPlaylistModal.classList.remove('active');
                    if (importUrl) importUrl.value = '';
                    if (importName) importName.value = '';
                    fetchPlaylists(); // Refresh list
                } else {
                    showNotification(result.error || 'Failed to import playlist', 'error');
                }
            } catch (error) {
                console.error('Import error:', error);
                showNotification('An error occurred during import', 'error');
            } finally {
                confirmImportPlaylist.disabled = false;
                confirmImportPlaylist.textContent = 'Import';
            }
        });
    }

    // Notification System
    window.showNotification = (message, type = 'info') => {
        const container = document.getElementById('notification-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `notification-toast ${type}`;
        
        let icon = 'info';
        if (type === 'success') icon = 'check_circle';
        if (type === 'error') icon = 'error';
        if (type === 'warning') icon = 'warning';

        toast.innerHTML = `
            <span class="material-icons-outlined">${icon}</span>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s forwards';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 3000);
    };
});
