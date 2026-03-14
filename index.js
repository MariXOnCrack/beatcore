const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events, MessageFlags } = require('discord.js');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ytSearch = require('yt-search');
require('dotenv').config();
const { startDashboard } = require('./dashboard');
const queueManager = require('./structures/QueueManager');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Ensure yt-dlp binary is ready
const ytDlpWrap = new YTDlpWrap();
(async () => {
    try {
        await YTDlpWrap.downloadFromGithub();
        console.log('[Bot] yt-dlp binary verified/downloaded.');
    } catch (err) {
        console.error('[Bot] Failed to download yt-dlp binary:', err);
    }
})();

// Start Dashboard with queueManager
startDashboard(client, queueManager);

// Define commands
const commands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Plays music from YouTube')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('The URL or search term')
                .setRequired(true))
].map(command => command.toJSON());

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands globally.');

    } catch (error) {
        console.error('Error refreshing commands:', error);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'play') {
        const query = interaction.options.getString('query');
        const channel = interaction.member.voice.channel;

        if (!channel) {
            console.log('[Bot] User tried to play but is not in a voice channel.');
            try {
                await interaction.reply({ content: 'You need to be in a voice channel.', flags: MessageFlags.Ephemeral });
            } catch (err) {
                console.error('[Bot] Failed to send ephemeral reply:', err);
            }
            return;
        }
        
        const guildId = interaction.guild.id;

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            let title, url, thumbnail, timestamp, author;

            if (query.startsWith('http') || query.startsWith('www')) {
                url = query;
                title = "Unknown (URL)";
                thumbnail = "";
                timestamp = "?:??";
                author = "Unknown";
                
                // Optional: Fetch metadata here if desired, but might be slow
            } else {
                const searchResult = await ytSearch(query);
                if (!searchResult || !searchResult.videos || searchResult.videos.length === 0) {
                     await interaction.editReply('No results found.');
                     return;
                }
                const video = searchResult.videos[0];
                url = video.url;
                title = video.title;
                thumbnail = video.thumbnail;
                timestamp = video.timestamp;
                author = video.author.name;
            }

            const song = {
                title,
                url,
                thumbnail,
                timestamp,
                author,
                addedBy: interaction.user.globalName || interaction.user.username,
                addedById: interaction.user.id,
                addedByAvatar: interaction.user.avatar
            };

            // Get or create queue using Manager
            const queue = queueManager.create(guildId, channel, client);

            // Add song to queue
            queue.addSong(song);

            await interaction.editReply(`Added **${title}** to queue.`);

        } catch (error) {
            console.error('[Bot] Error processing play command:', error);
            try {
                await interaction.editReply('An error occurred while trying to play the song.');
            } catch (e) {
                // Ignore if reply fails
            }
        }
    }
});

// Graceful Shutdown
const cleanup = () => {
    console.log('\n[Bot] Shutting down, cleaning up queues...');
    queueManager.destroyAll();
    client.destroy();
    process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

client.login(process.env.DISCORD_TOKEN);
