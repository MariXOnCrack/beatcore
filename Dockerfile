FROM node:20-slim

# Install system dependencies required for audio processing and yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    wget \
    git \
    build-essential \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp - try pip first, fallback to direct download
RUN pip3 install --no-cache-dir yt-dlp || \
    (mkdir -p /usr/local/bin && \
     wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
     chmod +x /usr/local/bin/yt-dlp)

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install Node dependencies
RUN npm install

# Copy application code
COPY . .

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Set environment to production
ENV NODE_ENV=production

# Expose the dashboard port
EXPOSE 3000

# Start the bot and dashboard
CMD ["npm", "start"]
