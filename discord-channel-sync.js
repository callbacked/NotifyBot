const { Client, PermissionsBitField } = require('discord.js');

/**
 * Helper class for syncing Discord target channels.
 */
class DiscordChannelSync {
    static async getChannelList(client, channelIds, verbose) {
        let nextTargetChannels = [];

        try {
            if (!client.isReady()) {
                throw new Error('Client is not ready');
            }

            const guilds = await client.guilds.fetch();

            for (const [guildId, guild] of guilds) {
                const fullGuild = await client.guilds.fetch(guildId);
                const channels = await fullGuild.channels.fetch();

                if (verbose) {
                    console.log('[Discord]', `Fetching channels for guild: ${fullGuild.name}`);
                    console.log('[Discord]', `Channels available: ${channels.map(c => c.id).join(', ')}`);
                }

                for (const channelId of channelIds) {
                    const targetChannel = channels.get(channelId);

                    if (targetChannel) {
                        if (targetChannel.type !== 0) {
                            if (verbose) {
                                console.warn('[Discord]', 'Configuration problem /!\\', `Channel ID ${channelId} in Guild ${fullGuild.name} is not a text channel.`);
                            }
                        } else {
                            const permissions = targetChannel.permissionsFor(fullGuild.members.me);

                            if (verbose) {
                                console.log('[Discord]', ' --> ', `Member of server ${fullGuild.name}, target channel is #${targetChannel.name}`);
                                console.log('[Discord]', 'Permissions:', permissions.toArray());
                            }

                            if (!permissions.has(PermissionsBitField.Flags.SendMessages)) {
                                if (verbose) {
                                    console.warn('[Discord]', 'Permission problem /!\\', `I do not have SEND_MESSAGES permission on channel #${targetChannel.name} on ${fullGuild.name}: announcement sends will fail.`);
                                }
                            } else {
                                nextTargetChannels.push(targetChannel);
                            }
                        }
                    }
                }
            }

            if (verbose) {
                console.log('[Discord]', `Discovered ${nextTargetChannels.length} channels to announce to.`);
            }
        } catch (error) {
            console.error('[Discord]', 'Error fetching channels:', error);
        }

        return nextTargetChannels;
    }
}

module.exports = DiscordChannelSync;
