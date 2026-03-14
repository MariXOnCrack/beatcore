const GuildQueue = require('./GuildQueue');

class QueueManager {
    constructor() {
        this.queues = new Map();
    }

    get(guildId) {
        return this.queues.get(guildId);
    }

    create(guildId, voiceChannel, client) {
        if (this.queues.has(guildId)) {
            return this.queues.get(guildId);
        }
        const queue = new GuildQueue(guildId, voiceChannel, client);
        this.queues.set(guildId, queue);
        return queue;
    }

    delete(guildId) {
        const queue = this.queues.get(guildId);
        if (queue) {
            queue.destroy();
            this.queues.delete(guildId);
        }
    }
    
    has(guildId) {
        return this.queues.has(guildId);
    }

    destroyAll() {
        for (const [guildId, queue] of this.queues) {
            queue.destroy();
        }
        this.queues.clear();
    }
}

module.exports = new QueueManager();
