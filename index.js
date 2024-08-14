const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, Collection, EmbedBuilder } = require('discord.js');
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
    ]
});

global.discordJsClient = client;

const TwitchMonitor = require("./twitch-monitor");
const DiscordChannelSync = require("./discord-channel-sync");
const LiveEmbed = require('./live-embed');
const MiniDb = require('./minidb');


const commands = [
    {
        name: 'setup',
        description: 'Setup your bot configuration',
        options: [
            {
                type: 3, // STRING
                name: 'twitch_channels',
                description: 'Comma-separated list of Twitch channels',
                required: true,
            },
            {
                type: 3, // STRING
                name: 'discord_announce_channel',
                description: 'Discord channel for announcements',
                required: true,
            },
            {
                type: 3, // STRING
                name: 'discord_mentions',
                description: 'JSON string for mentions',
                required: true,
            },
            {
                type: 3, // STRING
                name: 'twitch_client_id',
                description: 'Twitch client ID',
                required: true,
            },
            {
                type: 3, // STRING
                name: 'twitch_oauth_token',
                description: 'Twitch OAuth token',
                required: true,
            },
            {
                type: 4, // INTEGER
                name: 'twitch_check_interval_ms',
                description: 'Twitch check interval in milliseconds',
                required: true,
            },
            {
                type: 5, // BOOLEAN
                name: 'twitch_use_boxart',
                description: 'Whether to use Twitch box art',
                required: true,
            }
        ],
    },
    {
        name: 'help',
        description: 'Get information about available commands',
    },
    {
        name: 'gettokens',
        description: 'Get instructions on how to obtain your Twitch tokens',
    }
];

const rest = new REST({ version: '10' }).setToken(config.discord_bot_token);

client.once('ready', async () => {
    console.log(`[Discord] Bot is ready; logged in as ${client.user.tag}.`);

    // Register slash commands
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(Routes.applicationCommands(client.user.id), {
            body: commands,
        });

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }


    await syncServerList(true);

    StreamActivity.init(client);

    TwitchMonitor.start();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'setup') {
        try {
            const twitchChannels = options.getString('twitch_channels');
            const discordAnnounceChannel = options.getString('discord_announce_channel');
            const discordMentions = options.getString('discord_mentions');
            const twitchClientId = options.getString('twitch_client_id');
            const twitchOauthToken = options.getString('twitch_oauth_token');
            const twitchCheckIntervalMs = options.getInteger('twitch_check_interval_ms');
            const twitchUseBoxart = options.getBoolean('twitch_use_boxart');

            let parsedDiscordMentions;
            try {
                parsedDiscordMentions = JSON.parse(discordMentions);
            } catch (error) {
                throw new Error(`Error parsing 'discord_mentions': ${error.message}`);
            }

            // Update config.json
            const newConfig = {
                ...config,
                twitch_channels: twitchChannels,  
                discord_announce_channel: discordAnnounceChannel,
                discord_mentions: parsedDiscordMentions,
                twitch_client_id: twitchClientId,
                twitch_oauth_token: twitchOauthToken,
                twitch_check_interval_ms: twitchCheckIntervalMs,
                twitch_use_boxart: twitchUseBoxart,
            };

            fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(newConfig, null, 2));

            // Reload config
            Object.assign(config, newConfig);

            // Trigger refresh
            TwitchMonitor.start(); // Restart TwitchMonitor with new config
            await syncServerList(true); // Refresh Discord channels list

            await interaction.reply('Configuration updated and refreshed successfully!');
        } catch (error) {
            console.error('Error updating configuration:', error.message);
            await interaction.reply(`Failed to update configuration. ${error.message}`);
        }
    } else if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Help - Setup Command')
            .addFields(
                { name: '**/setup**', value: 'Setup your bot configuration.' },
                { name: '**twitch_channels**', value: 'Comma-separated list of Twitch channels to monitor. You can add as little or as many as you want. Syntax: `channel1,channel2`' },
                { name: '**discord_announce_channel**', value: 'The name of the Discord channel where announcements will be made (e.g., `announcements`).' },
                { name: '**discord_mentions**', value: 'Maps a channel name to a specific role. Syntax: `{"channel":"rolename"}`.' },
                { name: '**twitch_client_id**', value: 'Your Twitch client ID.' },
                { name: '**twitch_oauth_token**', value: 'Your Twitch OAuth token.' },
                { name: '**twitch_check_interval_ms**', value: 'The interval (in milliseconds) for polling a user\'s Twitch status.' },
                { name: '**twitch_use_boxart**', value: 'Whether to use Twitch box art (true/false).' }
            )
            .setFooter({ text: 'Ensure that all values are correctly formatted and valid.' });


        await interaction.reply({ embeds: [helpEmbed], ephemeral: false });
    } else if (commandName === 'gettokens') {
        const tokensEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('How to Get Your Twitch Tokens')
            .setDescription('Follow these steps to obtain your Twitch tokens:')
            .addFields(
                { name: '1. Visit the Token Generator', value: 'Go to [Twitch Token Generator](https://twitchtokengenerator.com).' },
                { name: '2. Select Token Type', value: 'In the popup that appears, choose "I want to..." and then select "Bot Chat Token".' },
                { name: '3. Authorize Your Account', value: 'Proceed with authorizing your Twitch account if prompted.' },
                { name: '4. Copy Your Tokens', value: 'In the "Generated Tokens" section, copy the **ACCESS TOKEN** and paste it to `twitch_oauth_token` in your bot configuration.' },
                { name: '5. Paste Client ID', value: 'Also, copy the **CLIENT ID** and paste it to `twitch_client_id` in your bot configuration.' }
            )
            .setFooter({ text: 'Make sure to keep your tokens secure and do not share them.' });

        await interaction.reply({ embeds: [tokensEmbed], ephemeral: false });
    }
});
// --- Startup ---------------------------------------------------------------------------------------------------------
console.log('Timbot is starting.');

// --- Discord ---------------------------------------------------------------------------------------------------------
console.log('Connecting to Discord...');

let targetChannels = [];

let syncServerList = async (logMembership) => {
    try {
        console.log('[Discord] Syncing server list...');
        targetChannels = await DiscordChannelSync.getChannelList(client, config.discord_announce_channel, logMembership);
        console.log(`[Discord] Synced ${targetChannels.length} channels`);
    } catch (error) {
        console.error('[Discord] Error syncing server list:', error);
    }
};

client.once('ready', async () => {
    console.log(`[Discord] Bot is ready; logged in as ${client.user.tag}.`);

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(Routes.applicationCommands(client.user.id), {
            body: commands,
        });

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }

    // Init list of connected servers, and determine which channels we are announcing to
    await syncServerList(true);

    // Keep our activity in the user list in sync
    StreamActivity.init(client);

    // Begin Twitch API polling
    TwitchMonitor.start();
});

client.on('guildCreate', guild => {
    console.log(`[Discord]`, `Joined new server: ${guild.name}`);

    syncServerList(false);
});

client.on('guildDelete', guild => {
    console.log(`[Discord]`, `Removed from a server: ${guild.name}`);

    syncServerList(false);
});

console.log('[Discord]', 'Logging in...');
client.login(config.discord_bot_token);

// Activity updater
class StreamActivity {
    static onlineChannels = {};
    static discordClient = null;

    static setChannelOnline(stream) {
        this.onlineChannels[stream.user_name] = stream;
        console.log('[StreamActivity]', `Channel online: ${stream.user_name}`);
        this.updateActivity();
    }

    static setChannelOffline(stream) {
        delete this.onlineChannels[stream.user_name];
        console.log('[StreamActivity]', `Channel offline: ${stream.user_name}`);
        this.updateActivity();
    }

    static clearAllChannels() {
        this.onlineChannels = {};
        console.log('[StreamActivity]', 'Cleared all channels');
        this.updateActivity();
    }

    static getMostRecentStreamInfo() {
        let lastChannel = null;
        for (let channelName in this.onlineChannels) {
            if (typeof channelName !== "undefined" && channelName) {
                lastChannel = this.onlineChannels[channelName];
            }
        }
        return lastChannel;
    }
    static updateActivity() {
        let streamInfo = this.getMostRecentStreamInfo();
        if (streamInfo) {
            this.discordClient.user.setActivity({
                name: streamInfo.user_name,
                type: 1, // 1 is 'STREAMING'
                url: `https://twitch.tv/${streamInfo.user_name.toLowerCase()}`
            });
            console.log('[StreamActivity]', `Update current activity: streaming ${streamInfo.user_name}.`);
        } else {
            console.log('[StreamActivity]', 'Cleared current activity.');
            this.discordClient.user.setActivity(null);
        }
    }

    static init(discordClient) {
        this.discordClient = discordClient;
        this.onlineChannels = {};

        this.updateActivity();

        setInterval(() => this.updateActivity(), 5 * 60 * 1000);
    }
}
// ---------------------------------------------------------------------------------------------------------------------
// Live events

let liveMessageDb = new MiniDb('live-messages');
let messageHistory = liveMessageDb.get("history") || {};

TwitchMonitor.onChannelLiveUpdate(async (streamData) => {
    const isLive = streamData.type === "live";

    // Refresh channel list
    await syncServerList(false);

    // Update activity
    StreamActivity.setChannelOnline(streamData);

    // Generate message
    const msgFormatted = `${streamData.user_name} went live on Twitch!`;
    const msgEmbed = LiveEmbed.createForStream(streamData);

    // Broadcast to all target channels
    let anySent = false;

    for (const discordChannel of targetChannels) {
        const liveMsgDiscrim = `${discordChannel.guild.id}_${discordChannel.name}_${streamData.id}`;

        if (discordChannel) {
            try {
                // Either send a new message, or update an old one
                let existingMsgId = messageHistory[liveMsgDiscrim] || null;

                if (existingMsgId) {
                    // Fetch existing message
                    try {
                        const existingMsg = await discordChannel.messages.fetch(existingMsgId);
                        await existingMsg.edit({
                            content: msgFormatted,
                            embeds: [msgEmbed]
                        });

                        // Clean up entry if no longer live
                        if (!isLive) {
                            delete messageHistory[liveMsgDiscrim];
                            liveMessageDb.put('history', messageHistory);
                        }
                    } catch (e) {
                        // Unable to retrieve message object for editing
                        if (e.message === "Unknown Message") {
                            // Specific error: the message does not exist, most likely deleted.
                            delete messageHistory[liveMsgDiscrim];
                            liveMessageDb.put('history', messageHistory);
                            // This will cause the message to be posted as new in the next update if needed.
                        } else {
                            console.warn('[Discord] Error editing message:', e);
                        }
                    }
                } else if (isLive) {
                    // Sending a new message
                    let mentionMode = (config.discord_mentions && config.discord_mentions[streamData.user_name.toLowerCase()]) || null;

                    if (mentionMode) {
                        mentionMode = mentionMode.toLowerCase();

                        if (mentionMode === "everyone" || mentionMode === "here") {
                            mentionMode = `@${mentionMode}`;
                        } else {
                            let roleData = discordChannel.guild.roles.cache.find(role => role.name.toLowerCase() === mentionMode);

                            if (roleData) {
                                mentionMode = `<@&${roleData.id}>`;
                            } else {
                                console.log('[Discord]', `Cannot mention role: ${mentionMode}`, `(does not exist on server ${discordChannel.guild.name})`);
                                mentionMode = null;
                            }
                        }
                    }

                    let msgToSend = mentionMode ? `${msgFormatted} ${mentionMode}` : msgFormatted;

                    try {
                        const message = await discordChannel.send({
                            content: msgToSend,
                            embeds: [msgEmbed]
                        });
                        console.log('[Discord]', `Sent announce msg to #${discordChannel.name} on ${discordChannel.guild.name}`);

                        messageHistory[liveMsgDiscrim] = message.id;
                        liveMessageDb.put('history', messageHistory);
                    } catch (err) {
                        console.log('[Discord]', `Could not send announce msg to #${discordChannel.name} on ${discordChannel.guild.name}:`, err.message);
                    }
                }

                anySent = true;
            } catch (e) {
                console.warn('[Discord]', 'Message send problem:', e);
            }
        }
    }

    liveMessageDb.put('history', messageHistory);
    return anySent;
});

TwitchMonitor.onChannelOffline((streamData) => {
    console.log('[TwitchMonitor]', `Channel offline: ${streamData.user_name}`);
    StreamActivity.clearAllChannels();
});

// --- Common functions ------------------------------------------------------------------------------------------------
String.prototype.replaceAll = function(search, replacement) {
    return this.split(search).join(replacement);
};

String.prototype.spacifyCamels = function () {
    return this.replace(/([a-z](?=[A-Z]))/g, '$1 ');
};

Array.prototype.joinEnglishList = function () {
    return [this.slice(0, -1).join(', '), this.slice(-1)[0]].join(this.length < 2 ? '' : ' and ');
};

String.prototype.lowercaseFirstChar = function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

Array.prototype.hasEqualValues = function (b) {
    if (this.length !== b.length) {
        return false;
    }

    this.sort();
    b.sort();

    for (let i = 0; i < this.length; i++) {
        if (this[i] !== b[i]) {
            return false;
        }
    }

    return true;
};
