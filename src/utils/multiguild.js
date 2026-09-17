import { reconcileMainHierarchyRoles } from './neonSync.js';
export function isSakuraGuild(guildId, config) {
  return guildId === config.guilds?.sakura?.id;
}
export function getSakuraRank(config, key) {
  return config.sakuraMain?.ranks?.find(r => r.key === key) ?? null;
}
export function getSakuraRankChoices(config, focused='') {
  const q=focused.toLowerCase();
  return (config.sakuraMain?.ranks??[]).filter(r=>r.name.toLowerCase().includes(q)).slice(0,25).map(r=>({name:r.name,value:r.key}));
}
export function getCurrentSakuraRank(member, config) {
  const roles=config.guilds.sakura.roles;
  return [...config.sakuraMain.ranks].filter(r=>member.roles.cache.has(roles[r.key])).sort((a,b)=>b.level-a.level)[0]??null;
}
export async function hasSakuraPersonnelPermission(interaction, config) {
  if (!isSakuraGuild(interaction.guildId, config)) return false;
  const member=await interaction.guild.members.fetch(interaction.user.id);
  if (member.permissions.has('Administrator')) return true;

  // Gemeinsame 21er-Frameworkstruktur:
  // Position 1–10 = Mitarbeiter, Position 11–18 = Führungsebene,
  // Position 19–21 = Leitungsebene. Verwaltungszugriff beginnt bei Position 11.
  const roles=config.guilds.sakura.roles;
  const current=[...(config.frameworkRanks||[])]
    .filter(rank=>roles[rank.key]&&member.roles.cache.has(roles[rank.key]))
    .sort((a,b)=>Number(b.position)-Number(a.position))[0]??null;

  return Number(current?.position||0) >= 11;
}
export function checkSakuraChannel(interaction,config,key) {
  if (!isSakuraGuild(interaction.guildId,config)) return true;
  return interaction.channelId === config.guilds.sakura.channels[key];
}
export async function clearSakuraRankRoles(member,config) {
  const roles=config.guilds.sakura.roles;

  const rankKeys=(config.sakuraMain?.ranks??[]).map(rank=>rank.key);
  const separatorKeys=config.sakuraMain?.separators??[];
  const secondaryKeys=[
    config.sakuraMain?.secondaryAdditionalRoles?.mid,
    config.sakuraMain?.secondaryAdditionalRoles?.high
  ].filter(Boolean);

  const roleIds=[...new Set(
    [...rankKeys,...separatorKeys,...secondaryKeys]
      .map(key=>roles[key])
      .filter(Boolean)
  )];

  if(roleIds.length) {
    await member.roles.remove(roleIds);
  }

  await member.fetch(true);
}

export async function applySakuraRank(member,config,rank) {
  const roles=config.guilds.sakura.roles;

  // Sämtliche Rollen der gemeinsamen Framework-Rangstruktur entfernen.
  const frameworkIds=[...new Set((config.frameworkRanks||[]).map(r=>roles[r.key]).filter(Boolean))]
    .filter(id=>member.roles.cache.has(id));
  if(frameworkIds.length)await member.roles.remove(frameworkIds);

  // Alte Bereichstrenner ebenfalls bereinigen.
  const separatorIds=(config.sakuraMain?.separators??[]).map(k=>roles[k]).filter(Boolean)
    .filter(id=>member.roles.cache.has(id));
  if(separatorIds.length)await member.roles.remove(separatorIds);

  let secondaryKey=null;
  if(rank.level >= 6 && rank.level <= 9) secondaryKey=config.sakuraMain?.secondaryAdditionalRoles?.mid;
  else if(rank.level >= 10 && rank.level <= 12) secondaryKey=config.sakuraMain?.secondaryAdditionalRoles?.high;

  const fw=(config.frameworkRanks||[]).find(r=>r.key===rank.key);
  const band=fw?Object.values(config.frameworkBands||{}).find(b=>fw.position>=b.min&&fw.position<=b.max):null;
  const desiredKeys=[
    ...(config.sakuraMain?.baseRoles??[]),
    rank.key,
    band?.mainSeparator,
    secondaryKey
  ].filter(Boolean);
  const desiredIds=[...new Set(desiredKeys.map(k=>roles[k]).filter(Boolean))];
  if(desiredIds.length)await member.roles.add(desiredIds);

  await member.fetch(true);
  await reconcileMainHierarchyRoles(member,config);

  if(roles.gekuendigt&&member.roles.cache.has(roles.gekuendigt))await member.roles.remove(roles.gekuendigt);
}

export async function terminateSakura(member,config) {
  const r=config.guilds.sakura.roles;
  const keys=[...config.sakuraMain.ranks.map(x=>x.key),...config.sakuraMain.separators,...config.sakuraMain.baseRoles,config.sakuraMain?.secondaryAdditionalRoles?.mid,config.sakuraMain?.secondaryAdditionalRoles?.high,'abgemeldet','sanktion_1','sanktion_2'].filter(Boolean);
  const neonKeys=[
    ...(config.neonMain?.rankRoleKeys??[]),
    config.neonMain?.globalRole,
    config.neonMain?.leadershipRole,
    ...(config.neonMain?.legacyRemoveRoles??[])
  ].filter(Boolean);
  const blacklistKeys=[
    ...(config.blacklistMain?.rankRoleKeys??[]),
    config.blacklistMain?.globalRole
  ].filter(Boolean);
  const ids=[...new Set([
    ...keys.map(k=>r[k]).filter(Boolean),
    ...neonKeys.map(k=>r[k]).filter(Boolean),
    ...blacklistKeys.map(k=>r[k]).filter(Boolean),
    '1096413447039766550'
  ])];
  if(ids.length) await member.roles.remove(ids);
  if(r.gekuendigt) await member.roles.add(r.gekuendigt);
}
