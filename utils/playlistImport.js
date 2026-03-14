const axios = require('axios');
const cheerio = require('cheerio');
const ytSearch = require('yt-search');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ytDlpWrap = new YTDlpWrap();
const { readPlaylists, writePlaylists } = require('./playlistStore');

async function importPlaylist(url, user, name) {
    console.log(`[Import] Importing playlist from: ${url}`);
    
    let songs = [];
    let playlistName = name || 'Imported Playlist';

    // Check if Apple Music
    if (url.includes('music.apple.com')) {
        songs = await scrapeAppleMusic(url);
        if (!name && songs.name) playlistName = songs.name;
        // If scrapeAppleMusic returns object with name and tracks, unpack it. 
        // But the original code logic was mixed. Let's standardize.
        // Actually, let's keep the logic close to original but refactored.
    } else if (url.includes('open.spotify.com')) {
        songs = await scrapeSpotify(url);
        // Assuming scrapeSpotify returns array of songs directly or object?
        // Let's refine the helpers below.
    } else {
        // Default: yt-dlp (YouTube, SoundCloud, etc.)
        const result = await scrapeYtDlp(url);
        songs = result.songs;
        if (!name) playlistName = result.name || playlistName;
    }

    if (songs.length === 0) {
        throw new Error('No songs found to import.');
    }

    // Create new playlist
    const playlists = await readPlaylists();
    const newPlaylist = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        userId: user.id,
        name: playlistName,
        createdAt: Date.now(),
        songs: songs
    };
    
    playlists.push(newPlaylist);
    await writePlaylists(playlists);
    
    return newPlaylist;
}

async function scrapeAppleMusic(url) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        
        let tracksFound = [];
        let detectedName = null;
        
        // Strategy 1: JSON-LD
        const jsonLdScripts = $('script[type="application/ld+json"]');
        jsonLdScripts.each((i, script) => {
            try {
                const raw = $(script).html();
                if (!raw) return;
                const data = JSON.parse(raw);
                const entities = data['@graph'] || [data];
                
                entities.forEach(entity => {
                    if (entity['@type'] === 'MusicPlaylist' && entity.track) {
                        detectedName = entity.name;
                        entity.track.forEach(t => {
                            tracksFound.push({
                                title: t.name,
                                artist: t.byArtist ? (Array.isArray(t.byArtist) ? t.byArtist[0].name : t.byArtist.name) : ''
                            });
                        });
                    }
                });
            } catch (e) {
                console.error('JSON-LD parse error:', e.message);
            }
        });

        // Strategy 2: DOM Scraping (Fallback)
        if (tracksFound.length === 0) {
            $('.songs-list-row').each((i, el) => {
                const title = $(el).find('.songs-list-row__song-name').text().trim();
                const artist = $(el).find('.songs-list-row__by-line').text().trim();
                if (title) tracksFound.push({ title, artist });
            });

            if (tracksFound.length === 0) {
                $('.track-view').each((i, el) => {
                    const title = $(el).find('.track-view__title').text().trim();
                    const artist = $(el).find('.track-view__artist').text().trim();
                    if (title) tracksFound.push({ title, artist });
                });
            }
            
            const pageTitle = $('h1').first().text().trim();
            if (pageTitle) detectedName = pageTitle;
        }

        if (tracksFound.length === 0) {
            throw new Error('Could not find any tracks. Apple Music layout may have changed.');
        }

        console.log(`[Import] Found ${tracksFound.length} tracks on Apple Music. Resolving to YouTube...`);
        const songs = await resolveTracksToYoutube(tracksFound);
        
        // Attach name to array for return convenience (dirty but works)
        songs.name = detectedName;
        return songs;

    } catch (e) {
        console.error('Apple Music Scraping Error:', e);
        throw new Error('Failed to scrape Apple Music page');
    }
}

async function scrapeSpotify(url) {
    try {
        console.log(`[Import] Spotify URL detected. Scraping metadata...`);
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        let tracksFound = [];
        let detectedName = null;
        
        const pageTitle = $('title').text().trim();
        detectedName = pageTitle.replace(' | Spotify', '').replace(' - Playlist by', '');

        // Strategy 1: JSON-LD
        const jsonLdScripts = $('script[type="application/ld+json"]');
        jsonLdScripts.each((i, script) => {
           try {
               const raw = $(script).html();
               if (!raw) return;
               const data = JSON.parse(raw);
               const entities = data['@graph'] || [data];
               
               entities.forEach(entity => {
                   if (entity['@type'] === 'MusicPlaylist' || entity['@type'] === 'MusicAlbum') {
                       if (entity.name) detectedName = entity.name;
                       
                       if (entity.track) {
                           const tracks = Array.isArray(entity.track) ? entity.track : [entity.track];
                           tracks.forEach(t => {
                               let trackName = t.name;
                               let artistName = 'Unknown Artist';
                               
                               if (t.byArtist) {
                                   const artists = Array.isArray(t.byArtist) ? t.byArtist : [t.byArtist];
                                   artistName = artists.map(a => a.name).join(', ');
                               } else if (t.creator) {
                                   const creators = Array.isArray(t.creator) ? t.creator : [t.creator];
                                   artistName = creators.map(c => c.name).join(', ');
                               }
                               
                               if (trackName) {
                                   tracksFound.push({ title: trackName, artist: artistName });
                               }
                           });
                       }
                   }
               });
           } catch (e) {
               console.error('JSON-LD parse error:', e.message);
           }
        });

        // Strategy 2: HTML Scraping
        if (tracksFound.length === 0) {
             $('[data-testid="tracklist-row"]').each((i, el) => {
                const titleEl = $(el).find('[dir="auto"]').first(); 
                const title = titleEl.text().trim();
                const artistLinks = $(el).find('a[href*="/artist/"]');
                const artist = artistLinks.first().text().trim() || 'Unknown Artist';

                if (title) tracksFound.push({ title, artist });
            });
        }

        // Strategy 3: Meta Tag Scraping + Track Page Resolution
        if (tracksFound.length === 0) {
            console.log('[Import] HTML scraping failed. Trying meta tags + track page resolution...');
            const trackUrls = [];
            $('meta[name="music:song"], meta[property="music:song"]').each((i, el) => {
                 const content = $(el).attr('content');
                 if (content && content.includes('/track/')) {
                     trackUrls.push(content);
                 }
            });

            const urlsToFetch = trackUrls.slice(0, 60);
            const trackBatchSize = 5;
            for (let i = 0; i < urlsToFetch.length; i += trackBatchSize) {
                const batch = urlsToFetch.slice(i, i + trackBatchSize);
                await Promise.all(batch.map(async (tUrl) => {
                    try {
                        const tRes = await axios.get(tUrl, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
                            timeout: 5000
                        });
                        const $t = cheerio.load(tRes.data);
                        let title = $t('meta[property="og:title"]').attr('content');
                        let desc = $t('meta[property="og:description"]').attr('content');
                        let artist = 'Unknown Artist';
                        if (desc) {
                            const parts = desc.split(' · ');
                            if (parts.length >= 1) artist = parts[0];
                        }
                        if (title) tracksFound.push({ title, artist });
                    } catch (e) { /* ignore */ }
                }));
                await new Promise(r => setTimeout(r, 200));
            }
        }

        console.log(`[Import] Found ${tracksFound.length} tracks on Spotify. Resolving to YouTube...`);
        const songs = await resolveTracksToYoutube(tracksFound);
        songs.name = detectedName;
        return songs;

    } catch (e) {
        console.error('Spotify Scraping Error:', e);
        throw new Error('Failed to scrape Spotify page. Ensure the playlist is Public.');
    }
}

async function resolveTracksToYoutube(tracks) {
    const songs = [];
    const batchSize = 5;
    for (let i = 0; i < tracks.length; i += batchSize) {
        const batch = tracks.slice(i, i + batchSize);
        await Promise.all(batch.map(async (track) => {
            const query = `${track.artist} - ${track.title} audio`;
            try {
                const r = await ytSearch(query);
                if (r && r.videos.length > 0) {
                    const video = r.videos[0];
                    songs.push({
                        title: video.title,
                        url: video.url,
                        thumbnail: video.thumbnail,
                        timestamp: video.timestamp,
                        author: video.author.name,
                        addedAt: Date.now()
                    });
                }
            } catch (e) {
                console.error(`[Import] Search failed for ${query}:`, e.message);
            }
        }));
        await new Promise(r => setTimeout(r, 200));
    }
    return songs;
}

async function scrapeYtDlp(url) {
    const args = ['--flat-playlist', '-J', url];
    const stdout = await ytDlpWrap.execPromise(args);
    const metadata = JSON.parse(stdout);

    let songs = [];
    let name = metadata.title;

    if (metadata._type === 'playlist' && metadata.entries) {
        songs = metadata.entries.map(entry => {
            let songUrl = entry.url;
            if (!songUrl && entry.id) {
                 songUrl = `https://www.youtube.com/watch?v=${entry.id}`;
            }
            
            return {
                title: entry.title || 'Unknown Title',
                url: songUrl || url,
                thumbnail: entry.thumbnail || null, 
                timestamp: entry.duration ? new Date(entry.duration * 1000).toISOString().substr(14, 5) : '?:??',
                author: entry.uploader || entry.artist || 'Unknown',
                addedAt: Date.now()
            };
        });
    } else if (metadata._type === 'video' || !metadata._type) {
         songs.push({
            title: metadata.title || 'Unknown',
            url: metadata.webpage_url || url,
            thumbnail: metadata.thumbnail,
            timestamp: metadata.duration_string || '?:??',
            author: metadata.uploader || 'Unknown',
            addedAt: Date.now()
         });
    }
    
    return { songs, name };
}

module.exports = { importPlaylist };
