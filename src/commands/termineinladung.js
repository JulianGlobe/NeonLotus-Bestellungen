import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';

import db from '../database.js';
import {
  loadConfig,
  hasManagementPermission
} from '../utils/personnel.js';

export default {
  data: new SlashCommandBuilder()
    .setName('termineinladung')
    .setDescription('Erstellt eine Termineinladung mit Thread.')
    .addUserOption(option =>
      option
        .setName('person')
        .setDescription('Einzuladende Person')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('anlass')
        .setDescription('Anlass des Gesprächs')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('hinweis')
        .setDescription('Optionaler Hinweis')
        .setRequired(false)
    ),

  async execute(interaction) {
    const config = loadConfig();

    if (!(await hasManagementPermission(interaction, config))) {
      return interaction.reply({
        content: '❌ Du hast keine Berechtigung für Termineinladungen.',
        flags: MessageFlags.Ephemeral
      });
    }

    const person = interaction.options.getUser('person');
    const reason = interaction.options.getString('anlass');
    const note = interaction.options.getString('hinweis');
    const now = new Date().toISOString();

    const embed = new EmbedBuilder()
      .setTitle('📅 Termineinladung')
      .setDescription(
        `Hallo <@${person.id}>,\n\n` +
        `du wirst hiermit zu einem Gespräch eingeladen.\n\n` +
        `**Anlass:** ${reason}` +
        (note ? `\n**Hinweis:** ${note}` : '') +
        `\n\nBitte stimmt einen passenden Termin im zugehörigen Thread ab.`
      )
      .addFields(
        {
          name: 'Einladung durch',
          value: `<@${interaction.user.id}>`
        }
      )
      .setTimestamp();

    await interaction.reply({
      content: `<@${person.id}>`,
      embeds: [embed],
      allowedMentions: {
        users: [person.id]
      }
    });

    const message = await interaction.fetchReply();

    const result = db.prepare(`
      INSERT INTO meeting_invitations
      (
        discord_id,
        reason,
        note,
        invited_by,
        created_at,
        message_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      person.id,
      reason,
      note ?? null,
      interaction.user.id,
      now,
      message.id
    );

    try {
      const thread = await message.startThread({
        name: `Termin • ${person.username}`.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: 'Termineinladung'
      });

      await thread.members.add(person.id).catch(() => {});

      await thread.send(
        `<@${person.id}> <@${interaction.user.id}> — hier könnt ihr den Termin abstimmen.`
      );

      db.prepare(`
        UPDATE meeting_invitations
        SET thread_id = ?
        WHERE id = ?
      `).run(thread.id, result.lastInsertRowid);
    } catch (error) {
      console.error('Thread konnte nicht erstellt werden:', error);

      await interaction.followUp({
        content:
          '⚠️ Die Einladung wurde erstellt und in der Personalverwaltung gespeichert, ' +
          'aber der Termin-Thread konnte nicht angelegt werden.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
