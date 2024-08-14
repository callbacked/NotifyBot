const { Client, Channel } = require('discord.js');

/**
 * Helper class for syncing Discord target channels.
 */
class DiscordChannelSync {
    static async getChannelList(client, channelName, verbose) {
        let nextTargetChannels = [];

        try {
            if (!client.isReady()) {
                throw new Error('Client is not ready');
            }

            const guilds = await client.guilds.fetch();

            for (const [guildId, guild] of guilds) {
                const fullGuild = await client.guilds.fetch(guildId);
                const channels = await fullGuild.channels.fetch();

                const targetChannel = channels.find(c => c.name === channelName && c.type === 0); // 0 is for text channels

                if (!targetChannel) {
                    if (verbose) {
                        console.warn('[Discord]', 'Configuration problem /!\\', `Guild ${fullGuild.name} does not have a #${channelName} channel!`);
                    }
                } else {
                    const permissions = targetChannel.permissionsFor(fullGuild.members.me);

                    if (verbose) {
                        console.log('[Discord]', ' --> ', `Member of server ${fullGuild.name}, target channel is #${targetChannel.name}`);
                    }

                    if (!permissions.has("SendMessages")) {
                        if (verbose) {
                            console.warn('[Discord]', 'Permission problem /!\\', `I do not have SEND_MESSAGES permission on channel #${targetChannel.name} on ${fullGuild.name}: announcement sends will fail.`);
                        }
                    }

                    nextTargetChannels.push(targetChannel);
                }
            }

            if (verbose) {
                console.log('[Discord]', `Discovered ${nextTargetChannels.length} channels to announce to for ${channelName}.`);
            }
        } catch (error) {
            console.error('[Discord]', 'Error fetching channels:', error);
        }

        return nextTargetChannels;
    }
}

module.exports = DiscordChannelSync;