# Docker Setup for BeatCore Bot

This project is now configured to run with Docker Compose for easy deployment and consistent environments.

## Prerequisites

- Docker Desktop installed (or Docker Engine + Docker Compose)
- Discord Bot Token and OAuth2 credentials

## Quick Start

1. **Clone your environment variables:**
   ```bash
   cp .env.example .env
   ```

2. **Configure your `.env` file** with your Discord credentials:
   ```
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_app_id
   DISCORD_CLIENT_SECRET=your_secret
   DISCORD_CALLBACK_URL=http://localhost:3000/auth/discord/callback
   ```

3. **Build and start the bot:**
   ```bash
   docker-compose up -d
   ```

4. **View logs:**
   ```bash
   docker-compose logs -f bot
   ```

5. **Stop the bot:**
   ```bash
   docker-compose down
   ```

## Usage Commands

### Development (with live logs)
```bash
docker-compose up
```

### Production (background)
```bash
docker-compose up -d
```

### Rebuild after code changes
```bash
docker-compose up -d --build
```

### View running services
```bash
docker-compose ps
```

### Execute commands in container
```bash
docker-compose exec bot /bin/bash
```

## Configuration

### Environment Variables
- `DISCORD_TOKEN` - Your Discord bot token
- `DISCORD_CLIENT_ID` - Your Discord application ID
- `DISCORD_CLIENT_SECRET` - Your Discord application secret
- `DISCORD_CALLBACK_URL` - OAuth2 callback URL (adjust for production)
- `NODE_ENV` - Set to `production` for production deployments

### Data Persistence
- `playlists.json` - Mounted as a volume for persistent playlist data
- `yt-dlp-cache` - Docker volume for caching yt-dlp binaries

## Deployment Notes

### For Production
1. Update `DISCORD_CALLBACK_URL` to your actual domain
2. Change the session secret in `dashboard.js` (currently hardcoded as "keyboard cat")
3. Consider using a reverse proxy (nginx) in front of the container
4. Use a proper session store instead of in-memory storage

### Port Mapping
The web dashboard runs on `port 3000` by default. You can change this by:
- Modifying the port in `docker-compose.yml` (left number) for your machine
- The application port inside the container remains 3000 (right number)

Example for running on port 8080:
```yaml
ports:
  - "8080:3000"
```

## Troubleshooting

### Bot not responding to commands
- Check logs: `docker-compose logs bot`
- Verify bot token is correct in `.env`
- Ensure bot has proper permissions in Discord server

### Web dashboard not accessible
- Verify port 3000 is not blocked by firewall
- Check logs for errors: `docker-compose logs bot`
- Ensure `DISCORD_CALLBACK_URL` matches your setup

### yt-dlp errors
- Container will auto-download yt-dlp binary on first run
- Clear cache if issues persist: `docker volume rm maincode_yt-dlp-cache`

## Docker Architecture

```
┌─────────────────────────────────────┐
│   Docker Container (Node.js 20)    │
│                                     │
│  ├─ Discord Bot (discord.js)       │
│  ├─ Express Dashboard (port 3000)  │
│  ├─ Socket.io (real-time updates)  │
│  └─ yt-dlp (music downloader)      │
│                                     │
│  Volumes:                           │
│  ├─ playlists.json (persistent)    │
│  └─ yt-dlp cache                   │
└─────────────────────────────────────┘
```

## Windows Specific Notes

If running on Windows with WSL2 backend:
- Docker paths work with forward slashes in compose files
- Volume mounting works seamlessly
- Performance is optimized compared to Hyper-V backend
