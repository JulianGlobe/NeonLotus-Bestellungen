import db from '../database.js';
import { isSakuraGuild, hasSakuraPersonnelPermission } from './multiguild.js';

export const SANCTION_DEADLINE_DAYS = 5;

export function getSanctionDeadline(createdAt, escalationLevel = 0, extensionDays = 0) {
  const created = new Date(createdAt);
  const days=(Number(escalationLevel || 0) + 1) * SANCTION_DEADLINE_DAYS + Number(extensionDays || 0);
  return new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
}

export function processOverdueSanctions() {
  const now = Date.now();
  const rows = db.prepare(`SELECT * FROM sanctions WHERE status='OPEN'`).all();
  const changed = [];
  const tx = db.transaction(() => {
    for (const row of rows) {
      const level = Number(row.escalation_level || 0);
      const created = new Date(row.created_at).getTime();
      const extensionMs = Math.max(0,Number(row.deadline_extension_days||0)) * 86400000;
      if (!Number.isFinite(created)) continue;

      // Eskalationsstufe 1 nach 5 Tagen: Betrag x2
      // Eskalationsstufe 2 nach 10 Tagen: Betrag erneut x2
      // Nach 15 Tagen weiterhin offen: keine weitere Erhöhung,
      // sondern Kündigung ausstehend.
      let newLevel = level;
      let amount = Number(row.amount || 0);
      let termination = Number(row.termination_pending || 0);

      if (now >= created + 15 * 86400000 + extensionMs) {
        if (newLevel < 1) { amount *= 2; newLevel = 1; }
        if (newLevel < 2) { amount *= 2; newLevel = 2; }
        termination = 1;
      } else if (now >= created + 10 * 86400000 + extensionMs) {
        if (newLevel < 1) { amount *= 2; newLevel = 1; }
        if (newLevel < 2) { amount *= 2; newLevel = 2; }
      } else if (now >= created + 5 * 86400000 + extensionMs && newLevel < 1) {
        amount *= 2; newLevel = 1;
      }

      if (newLevel !== level || termination !== Number(row.termination_pending || 0)) {
        db.prepare(`UPDATE sanctions SET original_amount=COALESCE(original_amount,?), amount=?, escalation_level=?, last_escalated_at=?, termination_pending=? WHERE id=?`)
          .run(Number(row.amount || 0) / Math.pow(2, level), amount, newLevel, new Date().toISOString(), termination, row.id);
        changed.push({id:row.id,discordId:row.discord_id,amount,level:newLevel,termination});
      }
    }
  });
  tx();

  const debtRows=db.prepare(`
    SELECT discord_id,COALESCE(SUM(amount),0) AS total
    FROM sanctions
    WHERE status='OPEN'
    GROUP BY discord_id
  `).all();
  for(const debt of debtRows){
    if(Number(debt.total)>=1000000){
      db.prepare(`UPDATE sanctions SET termination_pending=1 WHERE discord_id=? AND status='OPEN'`).run(debt.discord_id);
    }
  }

  return changed;
}

export async function syncSakuraSanctionRoles(client, config, discordId) {
  const guildId = config.guilds?.sakura?.id;
  const guild = guildId ? client.guilds.cache.get(guildId) : null;
  if (!guild) return { ok: false, reason: 'guild-not-found' };

  let member;
  try {
    member = await guild.members.fetch(discordId);
  } catch {
    return { ok: false, reason: 'member-not-found' };
  }

  const roles = config.guilds.sakura.roles;
  const role1 = roles.sanktion_1;
  const role2 = roles.sanktion_2;
  const openCount = Number(
    db.prepare(`SELECT COUNT(*) AS count FROM sanctions WHERE discord_id = ? AND status = 'OPEN'`)
      .get(discordId)?.count || 0
  );

  // Kumulativ:
  // 0 offen = keine Rolle
  // 1 offen = 1. Sanktion
  // 2+ offen = 1. + 2. Sanktion
  const shouldHave1 = openCount >= 1;
  const shouldHave2 = openCount >= 2;

  await member.fetch(true);

  if (role1) {
    const has = member.roles.cache.has(role1);
    if (shouldHave1 && !has) await member.roles.add(role1);
    if (!shouldHave1 && has) await member.roles.remove(role1);
  }

  await member.fetch(true);

  if (role2) {
    const has = member.roles.cache.has(role2);
    if (shouldHave2 && !has) await member.roles.add(role2);
    if (!shouldHave2 && has) await member.roles.remove(role2);
  }

  return { ok: true, openCount };
}

export async function hasSanctionPermission(interaction, config) {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (member.permissions.has('Administrator')) return true;

  if (isSakuraGuild(interaction.guildId, config)) {
    return hasSakuraPersonnelPermission(interaction, config);
  }

  // Neon Lotus: bisherige Verwaltungsberechtigungen unverändert.
  return config.permissions?.personnelManagers?.some(id => member.roles.cache.has(id)) ?? false;
}

export function sanctionChannelAllowed(interaction, config) {
  if (!isSakuraGuild(interaction.guildId, config)) return true;
  return interaction.channelId === config.guilds.sakura.channels.sanctions;
}
