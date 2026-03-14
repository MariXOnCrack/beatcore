FROM node:20-slim

# Install system dependencies required for audio processing and yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

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
