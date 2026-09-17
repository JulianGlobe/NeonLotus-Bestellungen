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
import { syncAbsenceRoleForUser } from '../utils/absences.js';

const TYPES = {
  kasse: {
    label: 'Kassenstand',
    table: 'cash_updates'
  },
  abmeldung: {
    label: 'Abmeldung',
    table: 'absences'
  }
};

export default {
  data: new SlashCommandBuilder()
    .setName('revidieren')
    .setDescription('Revidiert einen fehlerhaften Verwaltungs-Eintrag anhand seiner ID.')
    .addStringOption(option =>
      option
        .setName('bereich')
        .setDescription('Art des Eintrags')
        .setRequired(true)
        .addChoices(
          { name: 'Kasse', value: 'kasse' },
          { name: 'Abmeldung', value: 'abmeldung' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('id')
        .setDescription('ID des Eintrags')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    const config = loadConfig();

    if (!(await hasManagementPermission(interaction, config))) {
      return interaction.reply({
        content: '❌ Du hast keine Berechtigung, Verwaltungs-Einträge zu revidieren.',
        flags: MessageFlags.Ephemeral
      });
    }

    const typeKey = interaction.options.getString('bereich');
    const id = interaction.options.getInteger('id');
    const type = TYPES[typeKey];

    if (!type) {
      return interaction.reply({
        content: '❌ Unbekannter Bereich.',
        flags: MessageFlags.Ephemeral
      });
    }

    const entry = db.prepare(`
      SELECT *
      FROM ${type.table}
      WHERE id = ?
    `).get(id);

    if (!entry) {
      return interaction.reply({
        content: `❌ In **${type.label}** wurde kein Eintrag mit der ID **#${id}** gefunden.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if ((entry.status || 'ACTIVE') === 'REVOKED') {
      return interaction.reply({
        content: `ℹ️ Der Eintrag **${type.label} #${id}** ist bereits revidiert.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (typeKey === 'kasse') {
      const current = db.prepare(`
        SELECT id
        FROM cash_updates
        WHERE COALESCE(status, 'ACTIVE') != 'REVOKED'
        ORDER BY id DESC
        LIMIT 1
      `).get();

      if (!current || Number(current.id) !== Number(id)) {
        return interaction.reply({
          content:
            '❌ Bei der Fraktionskasse kann nur der **aktuellste aktive Kassenstand** revidiert werden. ' +
            'Dadurch wird automatisch der vorherige Stand wieder zum aktuellen Stand.',
          flags: MessageFlags.Ephemeral
        });
      }
    }

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE ${type.table}
      SET status = 'REVOKED',
          revoked_by = ?,
          revoked_at = ?
      WHERE id = ?
    `).run(interaction.user.id, now, id);

    let details = '';

    if (typeKey === 'kasse') {
      const previous = db.prepare(`
        SELECT *
        FROM cash_updates
        WHERE COALESCE(status, 'ACTIVE') != 'REVOKED'
        ORDER BY id DESC
        LIMIT 1
      `).get();

      details =
        `\n**Revidierter Stand:** $${Number(entry.amount).toLocaleString('de-DE')}` +
        `\n**Wiederhergestellter Stand:** ${
          previous
            ? `$${Number(previous.amount).toLocaleString('de-DE')}`
            : 'Noch kein Kassenstand hinterlegt'
        }`;
    }

    if (typeKey === 'abmeldung') {
      // Nach dem Revidieren sofort neu prüfen. Gibt es keine weitere aktuell
      // aktive Abmeldung, wird die Abgemeldet-Rolle direkt entfernt.
      await syncAbsenceRoleForUser(
        interaction.client,
        config,
        entry.discord_id
      );

      details =
        `\n**Person:** <@${entry.discord_id}>` +
        `\n**Zeitraum:** ${entry.date_from} bis ${entry.date_to}` +
        `\n**Grund:** ${entry.reason || '—'}` +
        `\n**Abgemeldet-Rolle:** automatisch synchronisiert`;
    }

    const embed = new EmbedBuilder()
      .setTitle('↩️ Eintrag revidiert')
      .setDescription(
        `**${type.label} #${id}** wurde revidiert.` +
        details +
        '\n\nDer Eintrag bleibt zur Nachvollziehbarkeit in der Historie erhalten.'
      )
      .addFields({
        name: 'Revidiert durch',
        value: `<@${interaction.user.id}>`
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
