const { createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, StreamType, joinVoiceChannel } = require('@discordjs/voice');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');

const ytDlpWrap = new YTDlpWrap();

// Ensure binary exists (async check, might need to be awaited at startup, but for now we assume it's there or being downloaded)
(async () => {
    try {
        // We can check if it exists or just try to download.
        // For optimization, we only download if missing, but yt-dlp-wrap handles some of this.
        // Let's just trust the main index.js has triggered the download check or do it here silently.
    } catch (e) {}
})();

const EFFECT_FILTERS = {
    bassboost: 'bass=g=15:f=110:w=0.6',
    nightcore: 'aresample=48000,asetrate=48000*1.25',
    vaporwave: 'aresample=48000,asetrate=48000*0.8',
    '8d': 'apulsator=hz=0.125',
    karaoke: 'stereotools=mlev=0.015625',
    tremolo: 'tremolo=f=5:d=0.5',
    vibrato: 'vibrato=f=6.5:d=0.5',
    surround: 'surround',
    treble: 'treble=g=5'
};

class GuildQueue {
    constructor(guildId, voiceChannel, client) {
        this.guildId = guildId;
        this.client = client;
        this.songs = [];
        this.currentIndex = 0;
        this.history = []; // For shuffle back navigation
        this.playedSongsLog = []; // For History Tab
        this.filters = [];
        this.volume = 1.0;
        this.loopMode = 0; // 0: None, 1: Queue, 2: Song
        this.isShuffled = false;
        this.isPlaying = false;
        this.isSeeking = false;
        this.seekTime = 0; // Offset in ms
        
        this.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        this.player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });

        this.connection.subscribe(this.player);

        this.player.on(AudioPlayerStatus.Idle, () => this.handleIdle());
        this.player.on('error', error => this.handleError(error));
        
        // Process tracking for cleanup
        this.currentProcess = null; // To kill ffmpeg/yt-dlp if needed
    }

    addSong(song) {
        this.songs.push(song);
        if (!this.isPlaying && this.songs.length === 1) {
            this.play();
        } else if (!this.isPlaying && this.currentIndex >= this.songs.length - 1) {
             // If we were at the end, and added a song, play it
             this.play();
        }
    }

    async play(seekTime = 0) {
        this.killCurrentProcess(); // Ensure old processes are dead before starting new ones

        if (this.currentIndex >= this.songs.length || this.currentIndex < 0) {
            this.isPlaying = false;
            return;
        }

        const song = this.songs[this.currentIndex];
        this.isPlaying = true;
        console.log(`[Queue ${this.guildId}] Playing ${song.title} (Seek: ${seekTime}s)`);

        try {
            const args = [
                '--ffmpeg-location', ffmpegPath,
                '-f', 'bestaudio',
                '-o', '-'
            ];
            
            if (seekTime > 0) {
                args.push('--download-sections', `*${seekTime}-inf`);
            }
            
            args.push(song.url);

            const ytDlpProcess = ytDlpWrap.exec(args);
            
            if (!ytDlpProcess.ytDlpProcess) {
                throw new Error('yt-dlp process failed to start.');
            }
            
            let stream = ytDlpProcess.ytDlpProcess.stdout;
            
            // Optimization: Track processes to kill them if we skip/stop
            this.currentYtDlp = ytDlpProcess.ytDlpProcess;

            // Filters & PCM Conversion
            const filterArgs = (this.filters || []).map(f => EFFECT_FILTERS[f]).filter(Boolean);
            const ffmpegArgs = [
                '-i', 'pipe:0',
                '-vn',
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '2',
                'pipe:1'
            ];

            if (filterArgs.length > 0) {
                ffmpegArgs.splice(2, 0, '-af', filterArgs.join(','));
            }

            const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
            this.currentFfmpeg = ffmpegProcess;

            // Error handling
            ffmpegProcess.on('error', err => console.error(`[FFmpeg] Error:`, err));
            ffmpegProcess.stdin.on('error', err => {
                if (err.code !== 'EPIPE') console.error(`[FFmpeg] Stdin Error:`, err);
            });
            stream.on('error', err => console.error(`[yt-dlp] Stream Error:`, err));

            // Pipe
            stream.pipe(ffmpegProcess.stdin);
            
            const resource = createAudioResource(ffmpegProcess.stdout, { 
                inlineVolume: true,
                inputType: StreamType.Raw 
            });
            
            resource.volume.setVolume(this.volume);
            this.seekTime = seekTime * 1000;
            this.resource = resource;
            
            this.player.play(resource);

        } catch (error) {
            console.error(`[Queue ${this.guildId}] Playback error:`, error);
            // Auto-skip on error
            this.skip();
        }
    }

    handleIdle() {
        if (this.isSeeking) return;

        console.log(`[Queue ${this.guildId}] Song finished.`);
        
        // Log history
        if (this.songs[this.currentIndex]) {
            this.playedSongsLog.unshift({ ...this.songs[this.currentIndex], playedAt: Date.now() });
            if (this.playedSongsLog.length > 50) this.playedSongsLog.pop();
        }

        if (this.loopMode === 2) {
            // Loop Song: Replay
            this.play();
        } else {
            // Handle Shuffle or Next
            if (this.isShuffled) {
                this.history.push(this.currentIndex);
                if (this.songs.length > 1) {
                    let nextIndex;
                    let attempts = 0;
                    do {
                        nextIndex = Math.floor(Math.random() * this.songs.length);
                        attempts++;
                    } while (nextIndex === this.currentIndex && attempts < 5);
                    this.currentIndex = nextIndex;
                }
            } else {
                this.currentIndex++;
                if (this.loopMode === 1 && this.currentIndex >= this.songs.length) {
                    this.currentIndex = 0;
                }
            }
            this.play();
        }
    }

    handleError(error) {
        console.error(`[Player ${this.guildId}] Error:`, error);
        this.skip();
    }

    jump(index) {
        if (index >= 0 && index < this.songs.length) {
            this.currentIndex = index;
            this.play();
        }
    }

    removeSong(index) {
        if (index < 0 || index >= this.songs.length) return false;
        
        const isCurrent = (index === this.currentIndex);
        this.songs.splice(index, 1);
        
        if (isCurrent) {
            // If we removed the currently playing song, skip it
            if (this.songs.length === 0) {
                this.stop();
            } else {
                if (this.currentIndex >= this.songs.length) {
                    this.currentIndex = 0; // Wrap around if we were at the end
                }
                this.play();
            }
        } else if (index < this.currentIndex) {
            // If we removed a song BEFORE the current one, decrement index
            this.currentIndex--;
        }
        
        return true;
    }

    skip() {
        this.killCurrentProcess();
        // Determine next index logic (similar to handleIdle but forced)
        if (this.loopMode === 2) {
            // Force skip even if loop song is on? Usually yes.
            // If user types /skip, they want to skip.
        }
        
        if (this.isShuffled) {
             this.history.push(this.currentIndex);
             // Pick random
             this.currentIndex = Math.floor(Math.random() * this.songs.length);
        } else {
            this.currentIndex++;
            if (this.loopMode === 1 && this.currentIndex >= this.songs.length) {
                this.currentIndex = 0;
            }
        }
        this.play();
    }
    
    back() {
        if (this.history.length > 0) {
            this.currentIndex = this.history.pop();
            this.play();
        } else if (this.currentIndex > 0) {
            this.currentIndex--;
            this.play();
        }
    }

    stop() {
        this.killCurrentProcess();
        this.player.stop();
        this.isPlaying = false;
    }

    async seek(timeInSeconds) {
        this.isSeeking = true;
        this.killCurrentProcess(); // Stop current stream
        this.player.stop();
        await this.play(timeInSeconds);
        this.isSeeking = false;
    }

    setVolume(vol) {
        this.volume = vol;
        if (this.resource && this.resource.volume) {
            this.resource.volume.setVolume(vol);
        }
    }

    setFilters(filters) {
        this.filters = filters;
        // Restart current song to apply
        const currentPos = (this.resource ? this.resource.playbackDuration : 0) + this.seekTime;
        // Ideally we seek to current position, but filters change timing/audio, so maybe just restart or seek.
        // Seeking with filters is fine.
        this.seek(currentPos / 1000);
    }
    
    killCurrentProcess() {
        if (this.currentYtDlp) {
            try { this.currentYtDlp.kill(); } catch(e) {}
            this.currentYtDlp = null;
        }
        if (this.currentFfmpeg) {
            try { this.currentFfmpeg.kill(); } catch(e) {}
            this.currentFfmpeg = null;
        }
    }
    
    destroy() {
        this.stop();
        this.connection.destroy();
    }
}

module.exports = GuildQueue;
