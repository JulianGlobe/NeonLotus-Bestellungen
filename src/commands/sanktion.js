import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig } from '../utils/personnel.js';
import {
  SANCTION_DEADLINE_DAYS,
  getSanctionDeadline,
  syncSakuraSanctionRoles,
  hasSanctionPermission,
  sanctionChannelAllowed,
  processOverdueSanctions
} from '../utils/sanctions.js';
import { addToCash } from '../utils/cash.js';

function discordDate(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('sanktion')
    .setDescription('Verwaltet Geldsanktionen.')
    .addSubcommand(sub =>
      sub.setName('erteilen')
        .setDescription('Erteilt eine Sanktion.')
        .addUserOption(o => o.setName('person').setDescription('Mitarbeiter').setRequired(true))
        .addIntegerOption(o => o.setName('betrag').setDescription('Betrag').setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('bezahlt')
        .setDescription('Markiert eine offene Sanktion als bezahlt.')
        .addIntegerOption(o => o.setName('id').setDescription('Sanktions-ID').setRequired(true).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub.setName('revidiert')
        .setDescription('Revidiert eine offene Sanktion.')
        .addIntegerOption(o => o.setName('id').setDescription('Sanktions-ID').setRequired(true).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub.setName('offen')
        .setDescription('Zeigt offene Sanktionen einer Person.')
        .addUserOption(o => o.setName('person').setDescription('Mitarbeiter').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('verlaengern')
        .setDescription('Verlängert die Eskalationsfrist einer offenen Sanktion.')
        .addIntegerOption(o => o.setName('id').setDescription('Sanktions-ID').setRequired(true).setMinValue(1))
        .addIntegerOption(o => o.setName('tage').setDescription('Verlängerung in Tagen').setRequired(true).setMinValue(1).setMaxValue(365))
    ),

  async execute(interaction) {
    const config = loadConfig();

    if (!sanctionChannelAllowed(interaction, config)) {
      return interaction.reply({
        content: `❌ Sanktionen können auf dem Hauptdiscord nur in <#${config.guilds.sakura.channels.sanctions}> verwaltet werden.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (!(await hasSanctionPermission(interaction, config))) {
      return interaction.reply({
        content: '❌ Du hast keine Berechtigung für Sanktionen.',
        flags: MessageFlags.Ephemeral
      });
    }

    processOverdueSanctions();
    const sub = interaction.options.getSubcommand();
    const now = new Date().toISOString();

    if (sub === 'erteilen') {
      const person = interaction.options.getUser('person');
      const amount = interaction.options.getInteger('betrag');
      const reason = interaction.options.getString('grund');

      const result = db.prepare(`
        INSERT INTO sanctions
        (discord_id, amount, reason, status, created_by, created_at)
        VALUES (?, ?, ?, 'OPEN', ?, ?)
      `).run(person.id, amount, reason, interaction.user.id, now);

      const deadline = getSanctionDeadline(now);
      const roleSync = await syncSakuraSanctionRoles(interaction.client, config, person.id);

      const embed = new EmbedBuilder()
        .setTitle('🚨 Neue Sanktion')
        .setDescription(
          `👤 **Betroffener:** <@${person.id}>\n` +
          `💰 **Betrag:** $${amount.toLocaleString('de-DE')}\n` +
          `📄 **Grund:** ${reason}\n\n` +
          `🛠️ **Ausgestellt von:** <@${interaction.user.id}>\n` +
          `📅 **Datum/Uhrzeit:** <t:${Math.floor(new Date(now).getTime() / 1000)}:f>\n\n` +
          `⏳ **Zahlungsfrist:** ${discordDate(deadline)}\n` +
          `🆔 **Sanktions-ID:** ${result.lastInsertRowid}`
        )
        .setTimestamp();

      if (roleSync.ok) {
        embed.setFooter({ text: `${roleSync.openCount} offene Sanktion(en) • Sanktionsrollen synchronisiert` });
      }

      await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] }
      });
      await interaction.followUp({
        content: `<@${person.id}>`,
        allowedMentions: { users: [person.id] }
      });
      return;
    }

    if (sub === 'bezahlt') {
      const id = interaction.options.getInteger('id');
      const sanction = db.prepare(`
        SELECT * FROM sanctions WHERE id = ? AND status = 'OPEN'
      `).get(id);

      if (!sanction) {
        return interaction.reply({
          content: '❌ Es wurde keine offene Sanktion mit dieser ID gefunden.',
          flags: MessageFlags.Ephemeral
        });
      }

      db.prepare(`
        UPDATE sanctions
        SET status = 'PAID', paid_by = ?, paid_at = ?
        WHERE id = ?
      `).run(interaction.user.id, now, id);

      const cash = addToCash(Number(sanction.amount), interaction.user.id);

      const roleSync = await syncSakuraSanctionRoles(interaction.client, config, sanction.discord_id);
      const suffix = roleSync.ok ? ` Es verbleiben **${roleSync.openCount}** offene Sanktion(en).` : '';

      return interaction.reply({
        content:
          `✅ Sanktion **#${id}** von <@${sanction.discord_id}> wurde als bezahlt markiert.${suffix}\n` +
          `💰 **$${Number(sanction.amount).toLocaleString('de-DE')}** wurden automatisch zur Fraktionskasse addiert. ` +
          `Neuer Kassenstand: **$${cash.after.toLocaleString('de-DE')}**`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'verlaengern') {
      const id=interaction.options.getInteger('id');
      const days=interaction.options.getInteger('tage');
      const sanction=db.prepare(`SELECT * FROM sanctions WHERE id=? AND status='OPEN'`).get(id);
      if(!sanction)return interaction.reply({content:'❌ Es wurde keine offene Sanktion mit dieser ID gefunden.',flags:MessageFlags.Ephemeral});

      const previous=Math.max(0,Number(sanction.deadline_extension_days||0));
      const total=previous+days;
      db.prepare(`UPDATE sanctions SET deadline_extension_days=? WHERE id=?`).run(total,id);
      const deadline=getSanctionDeadline(sanction.created_at,sanction.escalation_level,total);
      return interaction.reply({
        embeds:[new EmbedBuilder().setTitle('⏳ Sanktionsfrist verlängert').setDescription(`Die Eskalationsfrist von Sanktion **#${id}** wurde um **${days} Tag(e)** verlängert.`).addFields(
          {name:'👤 Person',value:`<@${sanction.discord_id}>`,inline:true},
          {name:'💰 Aktueller Betrag',value:`$${Number(sanction.amount).toLocaleString('de-DE')}`,inline:true},
          {name:'📅 Neue nächste Frist',value:discordDate(deadline)},
          {name:'➕ Verlängerung gesamt',value:`${total} Tag(e)`,inline:true},
          {name:'🛠️ Verlängert durch',value:`<@${interaction.user.id}>`,inline:true}
        ).setFooter({text:'Bis zur neuen Frist erfolgt keine automatische Verdopplung.'}).setTimestamp()],
        flags:MessageFlags.Ephemeral
      });
    }

    if (sub === 'revidiert') {
      const id = interaction.options.getInteger('id');
      const sanction = db.prepare(`
        SELECT * FROM sanctions WHERE id = ? AND status = 'OPEN'
      `).get(id);

      if (!sanction) {
        return interaction.reply({
          content: '❌ Es wurde keine offene Sanktion mit dieser ID gefunden.',
          flags: MessageFlags.Ephemeral
        });
      }

      db.prepare(`
        UPDATE sanctions
        SET status = 'REVOKED', revoked_by = ?, revoked_at = ?
        WHERE id = ?
      `).run(interaction.user.id, now, id);

      const roleSync = await syncSakuraSanctionRoles(interaction.client, config, sanction.discord_id);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('↩️ Sanktion revidiert')
            .setDescription(`Die Sanktion **#${id}** von <@${sanction.discord_id}> wurde revidiert.`)
            .addFields(
              { name: '💰 Betrag', value: `$${Number(sanction.amount).toLocaleString('de-DE')}`, inline: true },
              { name: '📄 Grund', value: sanction.reason || '—' },
              { name: '⚠️ Offene Sanktionen danach', value: roleSync.ok ? String(roleSync.openCount) : 'Rollen-Sync nicht möglich' },
              { name: '🛠️ Revidiert durch', value: `<@${interaction.user.id}>` }
            )
            .setTimestamp()
        ],
        flags: MessageFlags.Ephemeral
      });
    }

    const person = interaction.options.getUser('person');
    const rows = db.prepare(`
      SELECT * FROM sanctions
      WHERE discord_id = ? AND status = 'OPEN'
      ORDER BY id DESC
    `).all(person.id);

    if (rows.length === 0) {
      return interaction.reply({
        content: `✅ <@${person.id}> hat keine offenen Sanktionen.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const current = Date.now();
    const lines = rows.map(row => {
      const deadline = getSanctionDeadline(row.created_at, row.escalation_level, row.deadline_extension_days);
      const overdue = deadline.getTime() < current;
      return `**#${row.id}** — $${Number(row.amount).toLocaleString('de-DE')} — ${row.reason}\n↳ ${Number(row.termination_pending||0)===1 ? '**🚨 KÜNDIGUNG AUSSTEHEND**' : `Nächste Frist: ${discordDate(deadline)}${overdue ? ' **⚠️ ÜBERFÄLLIG**' : ''}`} · Eskalation ${Number(row.escalation_level||0)}/2`;
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('⚠️ Offene Sanktionen')
          .setDescription(lines.join('\n\n').slice(0, 4000))
          .setFooter({ text: `${rows.length} offene Sanktion(en) • Zahlungsfrist jeweils ${SANCTION_DEADLINE_DAYS} Tage` })
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
