import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';

import db from '../database.js';
import {
  loadConfig
} from '../utils/personnel.js';

export default {
  data: new SlashCommandBuilder()
    .setName('personalakte')
    .setDescription('Verwaltet gespeicherte Personalakten.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Leert den Inhalt einer Personalakte, ohne die Akte selbst zu löschen.')
        .addUserOption(option =>
          option
            .setName('person')
            .setDescription('Person, deren Personalakten-Inhalte gelöscht werden sollen')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('bestaetigung')
            .setDescription('Zur Bestätigung exakt CLEAR eingeben')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const config = loadConfig();

    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Dieser Befehl kann nur auf dem Server verwendet werden.',
        flags: MessageFlags.Ephemeral
      });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    const allowedRoleIds = [
      '1096402401424060517', // Discord Technik
      '1096402401382109245'  // Leitungsebene
    ];

    const hasPermission =
      member.permissions.has('Administrator') ||
      allowedRoleIds.some(roleId => member.roles.cache.has(roleId));

    if (!hasPermission) {
      return interaction.reply({
        content: '❌ Dieser Befehl kann ausschließlich von **Discord Technik** oder **Leitungsebene** verwendet werden.',
        flags: MessageFlags.Ephemeral
      });
    }

    const person = interaction.options.getUser('person');
    const confirmation = interaction.options.getString('bestaetigung');

    if (confirmation !== 'CLEAR') {
      return interaction.reply({
        content: '❌ Abgebrochen. Zur Bestätigung musst du exakt **CLEAR** eingeben.',
        flags: MessageFlags.Ephemeral
      });
    }

    const employee = db.prepare(`
      SELECT *
      FROM employees
      WHERE discord_id = ?
    `).get(person.id);

    if (!employee) {
      return interaction.reply({
        content: `❌ Für <@${person.id}> existiert aktuell keine Personalakte in der Datenbank.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const transaction = db.transaction(() => {
      const counts = {
        sanctions: db.prepare(
          'SELECT COUNT(*) AS count FROM sanctions WHERE discord_id = ?'
        ).get(person.id).count,

        sales: db.prepare(
          'SELECT COUNT(*) AS count FROM sales WHERE discord_id = ?'
        ).get(person.id).count,

        absences: db.prepare(
          'SELECT COUNT(*) AS count FROM absences WHERE discord_id = ?'
        ).get(person.id).count,

        actions: db.prepare(
          'SELECT COUNT(*) AS count FROM personnel_actions WHERE discord_id = ?'
        ).get(person.id).count,

        meetings: db.prepare(
          'SELECT COUNT(*) AS count FROM meeting_invitations WHERE discord_id = ?'
        ).get(person.id).count
      };

      db.prepare('DELETE FROM sanctions WHERE discord_id = ?').run(person.id);
      db.prepare('DELETE FROM sales WHERE discord_id = ?').run(person.id);
      db.prepare('DELETE FROM absences WHERE discord_id = ?').run(person.id);
      db.prepare('DELETE FROM personnel_actions WHERE discord_id = ?').run(person.id);
      db.prepare('DELETE FROM meeting_invitations WHERE discord_id = ?').run(person.id);

      return counts;
    });

    const counts = transaction();

    const total =
      counts.sanctions +
      counts.sales +
      counts.absences +
      counts.actions +
      counts.meetings;

    const embed = new EmbedBuilder()
      .setTitle('🧹 Personalakte geleert')
      .setDescription(
        `Die Inhalte der Personalakte von <@${person.id}> wurden gelöscht.\n\n` +
        `**Die Personalakte selbst sowie der aktuelle Neon-/Sakura-Rang bleiben bestehen.**\n\n` +
        `Insgesamt wurden **${total} Einträge** entfernt.`
      )
      .addFields(
        { name: 'Sanktionen', value: String(counts.sanctions), inline: true },
        { name: 'Verkäufe', value: String(counts.sales), inline: true },
        { name: 'Abmeldungen', value: String(counts.absences), inline: true },
        { name: 'Gesprächseinladungen', value: String(counts.meetings), inline: true },
        { name: 'Personalhistorie', value: String(counts.actions), inline: true }
      )
      .setFooter({
        text: `Geleert durch ${interaction.user.username}`
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
