const config = require('./config.json');
const axios = require('axios');
const Cleverbot = require('clevertype').Cleverbot;

const { Client, GatewayIntentBits } = require('discord.js');
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
    console.log('[Discord]', `Bot is ready; logged in as ${client.user.tag}.`);

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
    /**
     * Registers a channel that has come online, and updates the user activity.
     */
    static setChannelOnline(stream) {
        this.onlineChannels[stream.user_name] = stream;

        this.updateActivity();
    }

    /**
     * Marks a channel as having gone offline, and updates the user activity if needed.
     */
    static setChannelOffline(stream) {
        delete this.onlineChannels[stream.user_name];

        this.updateActivity();
    }

    /**
     * Fetches the channel that went online most recently, and is still currently online.
     */
    static getMostRecentStreamInfo() {
        let lastChannel = null;
        for (let channelName in this.onlineChannels) {
            if (typeof channelName !== "undefined" && channelName) {
                lastChannel = this.onlineChannels[channelName];
            }
        }
        return lastChannel;
    }

    /**
     * Updates the user activity on Discord.
     * Either clears the activity if no channels are online, or sets it to "watching" if a stream is up.
     */
    static updateActivity() {
        let streamInfo = this.getMostRecentStreamInfo();

        if (streamInfo) {
            this.discordClient.user.setActivity(streamInfo.user_name, {
                type: 'Streaming',
                url: `https://twitch.tv/${streamInfo.user_name.toLowerCase()}`
            });

            console.log('[StreamActivity]', `Update current activity: watching ${streamInfo.user_name}.`);
        } else {
            console.log('[StreamActivity]', 'Cleared current activity.');

            this.discordClient.user.setActivity(null);
        }
    }

    static init(discordClient) {
        this.discordClient = discordClient;
        this.onlineChannels = {};

        this.updateActivity();

        // Continue to update current stream activity every 5 minutes or so
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
    // Update activity
    StreamActivity.setChannelOffline(streamData);
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
