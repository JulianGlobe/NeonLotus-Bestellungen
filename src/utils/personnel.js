import fs from 'fs';
import { isSakuraGuild, hasSakuraPersonnelPermission } from './multiguild.js';

export function loadConfig() {
  return JSON.parse(fs.readFileSync('config.json', 'utf8'));
}

export function getArea(config, areaKey) {
  return config.areas?.[areaKey] ?? null;
}

export function getRankByKey(config, areaKey, rankKey) {
  const area = getArea(config, areaKey);
  return area?.ranks.find(rank => rank.key === rankKey) ?? null;
}

export function getCurrentAreaRank(member, config, areaKey) {
  const area = getArea(config, areaKey);

  if (!area || !member?.roles?.cache) {
    return null;
  }

  const owned = area.ranks
    .filter(rank => member.roles.cache.has(config.roles[rank.key]))
    .sort((a, b) => b.level - a.level);

  return owned[0] ?? null;
}

export async function hasPersonnelPermission(interaction, config) {
  if (!interaction.guild) return false;

  // Auf dem Hauptdiscord gilt ausschließlich die gemeinsame Framework-Hierarchie:
  // Verwaltungszugriff ab Position 11 (Ausbilder/Führungsebene) aufwärts.
  if (isSakuraGuild(interaction.guildId, config)) {
    return hasSakuraPersonnelPermission(interaction, config);
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (member.permissions.has('Administrator')) return true;

  // Bestehende lokale Verwaltungsberechtigungen auf Subdiscords beibehalten.
  return config.permissions.personnelManagers.some(roleId =>
    member.roles.cache.has(roleId)
  );
}

export async function hasManagementPermission(interaction, config) {
  return hasPersonnelPermission(interaction, config);
}

export function roleIdsFromKeys(config, keys) {
  return keys.map(key => config.roles[key]).filter(Boolean);
}

export async function removeAreaRoles(member, config, areaKey) {
  const area = getArea(config, areaKey);

  if (!area || !member?.roles?.cache) {
    return [];
  }

  const keys = [
    ...area.ranks.map(rank => rank.key),
    ...area.separators
  ];

  const roleIds = roleIdsFromKeys(config, keys)
    .filter(roleId => member.roles.cache.has(roleId));

  if (roleIds.length > 0) {
    await member.roles.remove(roleIds);
  }

  return roleIds;
}

export function getRolesForRank(config, areaKey, rank) {
  const area = getArea(config, areaKey);

  if (!area || !rank) {
    return [];
  }

  const keys = new Set([
    ...area.baseRoles,
    rank.key,
    rank.separator
  ]);

  return roleIdsFromKeys(config, [...keys]);
}

export function getAutocompleteRanks(config, areaKey, focusedValue = '') {
  const area = getArea(config, areaKey);

  if (!area) {
    return [];
  }

  const query = focusedValue.toLowerCase();

  return area.ranks
    .filter(rank => rank.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map(rank => ({
      name: rank.name,
      value: rank.key
    }));
}
