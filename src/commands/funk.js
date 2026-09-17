import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig } from '../utils/personnel.js';
import { isSakuraGuild, hasSakuraPersonnelPermission } from '../utils/multiguild.js';

const AREAS = {
  neon: { label: 'Neon Lotus', emoji: '🌸' },
  blacklist: { label: 'Blacklist', emoji: '⚫' },
  sakura: { label: 'Sakura Performance', emoji: '🌺' }
};

function getSetting(key) {
  return db.prepare(`SELECT value FROM funk_settings WHERE key = ?`).get(key)?.value ?? null;
}

function setSetting(key, value, userId) {
  db.prepare(`
    INSERT INTO funk_settings (key, value, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(key, value, userId, new Date().toISOString());
}

function buildOverview() {
  const lines = Object.entries(AREAS).map(([key, area]) => {
    const defaults = {
      neon: '6969',
      blacklist: '18747',
      sakura: '569323'
    };
    const value = getSetting(`funk_${key}`) ?? defaults[key] ?? 'Noch nicht hinterlegt';
    return `${area.emoji} **${area.label}**\n\`${value}\``;
  });

  return new EmbedBuilder()
    .setTitle('📻 Funkübersicht')
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: 'Die Funkfrequenzen werden durch die Führungsebene aktualisiert.' })
    .setTimestamp();
}

async function canManageFunk(interaction, config) {
  return hasSakuraPersonnelPermission(interaction, config);
}

async function upsertOverviewMessage(interaction, config) {
  const channelId = config.guilds.sakura.channels.funk;
  const channel = await interaction.guild.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Funkkanal ist kein Textkanal.');

  const storedId = getSetting('funk_message_id');
  if (storedId) {
    try {
      const message = await channel.messages.fetch(storedId);
      await message.edit({ embeds: [buildOverview()] });
      return message;
    } catch {
      // Gelöschte oder nicht mehr erreichbare Nachricht: automatisch neu erstellen.
    }
  }

  const message = await channel.send({ embeds: [buildOverview()] });
  setSetting('funk_message_id', message.id, interaction.user.id);
  return message;
}

export default {
  data: new SlashCommandBuilder()
    .setName('funk')
    .setDescription('Aktualisiert eine Funkfrequenz.')
    .addStringOption(option =>
      option
        .setName('bereich')
        .setDescription('Welcher Funk soll geändert werden?')
        .setRequired(true)
        .addChoices(
          { name: 'Neon Lotus', value: 'neon' },
          { name: 'Blacklist', value: 'blacklist' },
          { name: 'Sakura', value: 'sakura' }
        )
    )
    .addStringOption(option =>
      option
        .setName('funk')
        .setDescription('4- bis 9-stellige Funkfrequenz')
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(9)
    ),

  async execute(interaction) {
    const config = loadConfig();

    if (!(await canManageFunk(interaction, config))) {
      return interaction.reply({
        content: '❌ `/funk` kann ausschließlich **ab Ausbilder** verwendet werden.',
        flags: MessageFlags.Ephemeral
      });
    }

    const areaKey = interaction.options.getString('bereich');
    const funk = interaction.options.getString('funk').trim();
    const area = AREAS[areaKey];

    if (!area) {
      return interaction.reply({ content: '❌ Ungültiger Bereich.', flags: MessageFlags.Ephemeral });
    }

    if (!/^\d{4,9}$/.test(funk)) {
      return interaction.reply({
        content: '❌ Der Funk muss aus **4 bis 9 Ziffern** bestehen.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    setSetting(`funk_${areaKey}`, funk, interaction.user.id);
    const overview = await upsertOverviewMessage(interaction, config);

    const announcementChannel = await interaction.guild.channels.fetch(
      config.guilds.sakura.channels.announcements
    );

    // Finale Ankündigung: gesamte Sakura-Mitarbeiterrolle pingen.
    const employeeRoleId = '1096402401382109244';

    if (announcementChannel?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('📻 Funkänderung')
        .setDescription(
          `${area.emoji} Der **${area.label} Funk** wurde aktualisiert.\n\n` +
          `**Neuer Funk:** \`${funk}\`\n` +
          `**Geändert durch:** <@${interaction.user.id}>`
        )
        .setTimestamp();

      await announcementChannel.send({
        content: `<@&${employeeRoleId}>`,
        embeds: [embed],
        allowedMentions: { roles: [employeeRoleId] }
      });
    }

    await interaction.editReply({
      content:
        `✅ **${area.label}** wurde auf \`${funk}\` aktualisiert.\n` +
        `Die Funkübersicht wurde ${overview ? 'aktualisiert' : 'erstellt'} und die Ankündigung versendet.`
    });
  }
};
