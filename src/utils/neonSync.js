import db from '../database.js';
import { getArea, getRolesForRank, removeAreaRoles } from './personnel.js';


const NEON_MAIN_TO_SUB = [
  ['nl_nachwuchs','neon_nachwuchs'],
  ['nl_clubkraft','neon_clubkraft'],
  ['nl_profi','neon_profi'],
  ['nl_manager','neon_manager'],
  ['nl_leitung','neon_leitung']
];

export async function syncExactNeonRankFromMain(client,config,discordId) {
  const mainGuild=await client.guilds.fetch(config.guilds.sakura.id).catch(()=>null);
  const neonGuild=await client.guilds.fetch(config.guilds.neon.id).catch(()=>null);
  if(!mainGuild||!neonGuild)throw new Error('Sakura- oder Neon-Lotus-Discord nicht erreichbar.');

  const main=await mainGuild.members.fetch(discordId).catch(()=>null);
  const neon=await neonGuild.members.fetch(discordId).catch(()=>null);
  if(!main)throw new Error('Die Person ist nicht auf dem Sakura-Hauptdiscord.');
  if(!neon)throw new Error('Die Person ist nicht auf dem Neon-Lotus-Discord.');
  await main.fetch(true); await neon.fetch(true);

  const mainRoles=config.guilds.sakura.roles;
  const pair=NEON_MAIN_TO_SUB.find(([mainKey])=>mainRoles[mainKey]&&main.roles.cache.has(mainRoles[mainKey]));
  if(!pair)return null;

  const [,subKey]=pair;
  const subRank=getArea(config,'neon')?.ranks?.find(r=>r.key===subKey);
  if(!subRank)throw new Error(`Neon-Lotus-Zielrang ${subKey} fehlt in der Konfiguration.`);

  // Alle fünf NL-Ränge auf dem Subdiscord explizit entfernen und exakt den
  // Gegenrang des sichtbaren Hauptdiscord-Rangs setzen.
  const allSubIds=NEON_MAIN_TO_SUB.map(([,key])=>config.roles[key]).filter(Boolean);
  const remove=allSubIds.filter(id=>neon.roles.cache.has(id)&&id!==config.roles[subKey]);
  if(remove.length)await neon.roles.remove(remove);

  const targetId=config.roles[subKey];
  if(!targetId)throw new Error(`Rollen-ID für ${subKey} fehlt.`);
  if(!neon.roles.cache.has(targetId))await neon.roles.add(targetId);

  const separator=config.roles.neon_personal_trenner;
  if(separator&&!neon.roles.cache.has(separator))await neon.roles.add(separator);

  await neon.fetch(true);
  if(!neon.roles.cache.has(targetId))throw new Error(`Neon-Lotus-Rolle ${subRank.name} konnte nicht gesetzt werden.`);
  return subRank;
}


export function isActiveSakuraEmployee(discordId) {
  const row=db.prepare(`SELECT active FROM employees WHERE discord_id=?`).get(discordId);
  return Number(row?.active||0)===1;
}

export async function ensureNeonSakuraJoinRoles(member,config) {
  if(!member || member.guild.id!==config.guilds?.neon?.id) return false;
  if(!isActiveSakuraEmployee(member.id)) return false;

  const ids=[
    config.roles.sakura_personal_trenner,
    config.roles.sakura_aushilfe
  ].filter(Boolean);

  const missing=ids.filter(id=>!member.roles.cache.has(id));
  if(missing.length) await member.roles.add(missing);
  return true;
}

export async function ensureNeonLotusMemberRole(member,config) {
  if(!member || member.guild.id!==config.guilds?.neon?.id) return false;

  // Bestellungen-Rolle: ausschließlich automatisch an echte Neon-Lotus-Ränge koppeln.
  // Sakura-/Blacklist-Ränge haben auf diese Rolle keinerlei automatische Auswirkung.
  const orderRoleId='1549103028949229688';
  const neonRankIds=[
    config.roles?.neon_nachwuchs,
    config.roles?.neon_clubkraft,
    config.roles?.neon_profi,
    config.roles?.neon_manager,
    config.roles?.neon_leitung
  ].filter(Boolean);

  await member.fetch(true);
  const hasNeonRank=neonRankIds.some(id=>member.roles.cache.has(id));
  const hasOrderRole=member.roles.cache.has(orderRoleId);

  if(hasNeonRank&&!hasOrderRole){
    await member.roles.add(orderRoleId,'Neon Lotus: Bestellungen-Rolle für aktiven Neon-Lotus-Rang');
    return true;
  }

  // Verlässt jemand die Neon-Lotus-Rangstruktur (z. B. Wechsel zu Sakura/Blacklist),
  // wird die automatisch gekoppelte Bestellungen-Rolle auf dem Neon-Discord entfernt.
  if(!hasNeonRank&&hasOrderRole){
    await member.roles.remove(orderRoleId,'Neon Lotus: kein aktiver Neon-Lotus-Rang mehr');
    return true;
  }

  return false;
}

export async function syncAllNeonLotusMemberRoles(client,config) {
  const guild=await client.guilds.fetch(config.guilds.neon.id).catch(()=>null);
  if(!guild)return 0;
  await guild.members.fetch();
  let changed=0;
  for(const member of guild.members.cache.values()){
    if(await ensureNeonLotusMemberRole(member,config))changed++;
  }
  return changed;
}


async function clearMainFrameworkRankRoles(member,config) {
  const roles=config.guilds.sakura.roles;
  const ids=[...new Set((config.frameworkRanks||[]).map(r=>roles[r.key]).filter(Boolean))]
    .filter(id=>member.roles.cache.has(id));
  if(ids.length) await member.roles.remove(ids);
}

export async function clearMainNeonRoles(member,config) {
  const roles=config.guilds.sakura.roles;
  const keys=[
    ...(config.neonMain?.rankRoleKeys??[]),
    config.neonMain?.globalRole,
    config.neonMain?.leadershipRole,
    ...(config.neonMain?.legacyRemoveRoles??[])
  ].filter(Boolean);
  const ids=[...new Set([
    ...keys.map(k=>roles[k]).filter(Boolean),
    '1441777254953779282'
  ])].filter(id=>member.roles.cache.has(id));
  if(ids.length) await member.roles.remove(ids,'Neon Lotus: Bereich verlassen');
  await member.fetch(true);
  if(member.roles.cache.has('1441777254953779282')){
    throw new Error('Die separate Neon-Lotus-Rolle konnte auf dem Hauptdiscord nicht entfernt werden.');
  }
}


export async function reconcileMainHierarchyRoles(member,config,explicitFrameworkRank=null) {
  const roles=config.guilds.sakura.roles;
  await member.fetch(true);

  const separatorIds=(config.sakuraMain?.separators??[]).map(k=>roles[k]).filter(Boolean);
  const hierarchyIds=[roles.fuehrungsebene,roles.leitungsebene].filter(Boolean);

  const current=explicitFrameworkRank??((config.frameworkRanks||[])
    .filter(r=>roles[r.key]&&member.roles.cache.has(roles[r.key]))
    .sort((a,b)=>b.position-a.position)[0]??null);
  const band=current?Object.values(config.frameworkBands||{})
    .find(b=>current.position>=b.min&&current.position<=b.max):null;

  const desiredSeparator=band?.mainSeparator?roles[band.mainSeparator]:null;
  const desiredHierarchy=band?.mainHierarchy?roles[band.mainHierarchy]:null;

  const removeSeparators=separatorIds.filter(id=>member.roles.cache.has(id)&&id!==desiredSeparator);
  if(removeSeparators.length)await member.roles.remove(removeSeparators,'Framework Separator-Sync');
  if(desiredSeparator&&!member.roles.cache.has(desiredSeparator))await member.roles.add(desiredSeparator,'Framework Separator-Sync');

  // Führungsebene und Leitungsebene sind exklusiv.
  const removeHierarchy=hierarchyIds.filter(id=>member.roles.cache.has(id)&&id!==desiredHierarchy);
  if(removeHierarchy.length)await member.roles.remove(removeHierarchy,'Framework Hierarchie-Sync');
  if(desiredHierarchy&&!member.roles.cache.has(desiredHierarchy))await member.roles.add(desiredHierarchy,'Framework Hierarchie-Sync');

  await member.fetch(true);
  const wrong=hierarchyIds.filter(id=>id!==desiredHierarchy&&member.roles.cache.has(id));
  if(wrong.length)throw new Error('Hauptdiscord: alte Führungs-/Leitungsebenenrolle konnte nicht entfernt werden.');
}


export async function applyNeonRank(client,config,discordId,rank) {
  if(!rank) throw new Error('Ungültiger Neon-Lotus-Rang.');
  if(!isActiveSakuraEmployee(discordId)) {
    throw new Error('Die Person muss zuerst aktiv bei Sakura eingestellt sein.');
  }

  const mainGuild=await client.guilds.fetch(config.guilds.sakura.id);
  const neonGuild=await client.guilds.fetch(config.guilds.neon.id);

  let mainMember;
  let neonMember;
  try { mainMember=await mainGuild.members.fetch(discordId); }
  catch { throw new Error('Die Person ist nicht auf dem Sakura-Hauptdiscord.'); }
  try { neonMember=await neonGuild.members.fetch(discordId); }
  catch { throw new Error('Die Person ist nicht auf dem Neon-Lotus-Discord.'); }

  // Auf dem Hauptdiscord darf aus der gemeinsamen Framework-Rangstruktur
  // immer nur genau EIN Rang gleichzeitig aktiv sein.
  await clearMainFrameworkRankRoles(mainMember,config);
  await clearMainNeonRoles(mainMember,config);

  const mainRoles=config.guilds.sakura.roles;
  const desiredMain=[
    mainRoles[rank.mainRole],
    mainRoles[config.neonMain.globalRole]
  ].filter(Boolean);
  if(desiredMain.length) await mainMember.roles.add([...new Set(desiredMain)]);
  await mainMember.fetch(true);
  await reconcileMainHierarchyRoles(mainMember,config);

  // Exakte 1:1-Spiegelung des nun sichtbaren Hauptdiscord-NL-Rangs.
  await syncExactNeonRankFromMain(client,config,discordId);
  await ensureNeonSakuraJoinRoles(neonMember,config);

  return {mainMember,neonMember};
}

export async function removeNeonEverywhere(client,config,discordId) {
  const mainGuild=await client.guilds.fetch(config.guilds.sakura.id).catch(()=>null);
  const neonGuild=await client.guilds.fetch(config.guilds.neon.id).catch(()=>null);

  if(mainGuild){
    const m=await mainGuild.members.fetch(discordId).catch(()=>null);
    if(m) {
      await clearMainNeonRoles(m,config);
      await m.fetch(true);
      await reconcileMainHierarchyRoles(m,config);
    }
  }
  if(neonGuild){
    const m=await neonGuild.members.fetch(discordId).catch(()=>null);
    if(m) await removeAreaRoles(m,config,'neon');
  }
}

export function getNeonRankFromMain(member,config) {
  const area=getArea(config,'neon');
  const roles=config.guilds.sakura.roles;
  return [...(area?.ranks??[])]
    .filter(r=>r.mainRole && roles[r.mainRole] && member.roles.cache.has(roles[r.mainRole]))
    .sort((a,b)=>b.level-a.level)[0]??null;
}


export async function syncSakuraMirrorRoles(client,config,discordId,explicitFrameworkRank=null) {
  const mainGuild=await client.guilds.fetch(config.guilds.sakura.id).catch(()=>null);
  const neonGuild=await client.guilds.fetch(config.guilds.neon.id).catch(()=>null);
  if(!mainGuild||!neonGuild)return;

  const main=await mainGuild.members.fetch(discordId).catch(()=>null);
  const neon=await neonGuild.members.fetch(discordId).catch(()=>null);
  if(!main||!neon)return;
  await main.fetch(true);
  await neon.fetch(true);

  const mr=config.guilds.sakura.roles,nr=config.roles;
  const hierarchyIds=[
    nr.sakura_mitarbeiter,
    nr.sakura_fuehrung,
    nr.sakura_leitung
  ].filter(Boolean);

  if(!isActiveSakuraEmployee(discordId)){
    const remove=[nr.sakura_personal_trenner,nr.sakura_aushilfe,...hierarchyIds]
      .filter(Boolean).filter(id=>neon.roles.cache.has(id));
    if(remove.length)await neon.roles.remove(remove,'Sakura-Spiegel: nicht aktiv');
    return;
  }

  const current=explicitFrameworkRank??((config.frameworkRanks||[])
    .filter(r=>mr[r.key]&&main.roles.cache.has(mr[r.key]))
    .sort((a,b)=>b.position-a.position)[0]??null);
  const band=current?Object.values(config.frameworkBands||{})
    .find(b=>current.position>=b.min&&current.position<=b.max):null;

  let targetId=null;
  if(band?.neonMirror&&nr[band.neonMirror])targetId=nr[band.neonMirror];
  else if(nr.sakura_aushilfe)targetId=nr.sakura_aushilfe;

  // HARTE EXKLUSIVITÄT:
  // Erst ALLE Mitarbeiter/Führungs-/Leitungsebenenrollen entfernen,
  // danach exakt die zum Zielrang passende Rolle neu setzen.
  const removeHierarchy=hierarchyIds.filter(id=>neon.roles.cache.has(id));
  if(removeHierarchy.length)await neon.roles.remove(removeHierarchy,'Sakura-Spiegel: Hierarchie neu setzen');

  if(nr.sakura_aushilfe&&neon.roles.cache.has(nr.sakura_aushilfe)&&targetId!==nr.sakura_aushilfe){
    await neon.roles.remove(nr.sakura_aushilfe,'Sakura-Spiegel: Aushilfe entfernen');
  }
  if(nr.sakura_personal_trenner&&!neon.roles.cache.has(nr.sakura_personal_trenner)){
    await neon.roles.add(nr.sakura_personal_trenner,'Sakura-Spiegel: Personal');
  }
  if(targetId)await neon.roles.add(targetId,'Sakura-Spiegel: Ziel-Hierarchie');

  await neon.fetch(true);
  const wrong=hierarchyIds.filter(id=>id!==targetId&&neon.roles.cache.has(id));
  if(wrong.length)throw new Error('Neon Lotus: alte Sakura-Hierarchieebene konnte nicht entfernt werden.');
  if(targetId&&hierarchyIds.includes(targetId)&&!neon.roles.cache.has(targetId)){
    throw new Error('Neon Lotus: neue Sakura-Hierarchieebene konnte nicht gesetzt werden.');
  }
}


const BLACKLIST_MAIN_TO_SUB = [
  ['b_nachwuchs','blacklist_nachwuchs'],
  ['b_profi','blacklist_profi'],
  ['b_manager','blacklist_manager'],
  ['b_leitung','blacklist_leitung']
];

async function clearMainBlacklistRoles(member,config) {
  const roles=config.guilds.sakura.roles;
  const keys=[
    ...(config.blacklistMain?.rankRoleKeys??[]),
    config.blacklistMain?.globalRole,
    'blacklist_leitung'
  ].filter(Boolean);
  const ids=[...new Set(keys.map(k=>roles[k]).filter(Boolean))].filter(id=>member.roles.cache.has(id));
  if(ids.length)await member.roles.remove(ids);
}

async function removeBlacklistSubRanks(member,config) {
  const ids=BLACKLIST_MAIN_TO_SUB.map(([,k])=>config.roles[k]).filter(Boolean)
    .filter(id=>member.roles.cache.has(id));
  if(ids.length)await member.roles.remove(ids);
}

export async function syncExactBlacklistRankFromMain(client,config,discordId,explicitRank=null) {
  const mainGuild=await client.guilds.fetch(config.guilds.sakura.id).catch(()=>null);
  const subGuild=await client.guilds.fetch(config.guilds.blacklist.id).catch(()=>null);
  if(!mainGuild)throw new Error('Sakura-Hauptdiscord nicht erreichbar.');
  if(!subGuild)throw new Error('Blacklist-Discord nicht erreichbar. Guild 1341884168404992000 ist für den Bot nicht erreichbar.');

  const botMember=await subGuild.members.fetchMe().catch(()=>null);
  if(!botMember)throw new Error('Der Verwaltungsbot ist auf dem Blacklist-Discord nicht als Mitglied erreichbar.');
  if(!botMember.permissions.has('ManageRoles'))throw new Error('Dem Verwaltungsbot fehlt auf Blacklist "Rollen verwalten".');

  const main=await mainGuild.members.fetch(discordId).catch(()=>null);
  const sub=await subGuild.members.fetch(discordId).catch(()=>null);
  if(!main)throw new Error('Die Person ist nicht auf dem Sakura-Hauptdiscord.');
  if(!sub)throw new Error('Die Person ist nicht auf dem Blacklist-Discord.');

  await main.fetch(true);
  await sub.fetch(true);

  let rank=explicitRank;
  if(!rank){
    const mr=config.guilds.sakura.roles;
    const pair=BLACKLIST_MAIN_TO_SUB.find(([k])=>mr[k]&&main.roles.cache.has(mr[k]));
    if(!pair)throw new Error('Auf dem Hauptdiscord wurde kein B.-Framework-Rang erkannt.');
    rank=config.areas.blacklist.ranks.find(r=>r.key===pair[1])||null;
  }
  if(!rank)throw new Error('Blacklist-Zielrang konnte nicht bestimmt werden.');

  const targetId=config.roles[rank.key];
  if(!targetId)throw new Error(`Für Blacklist ${rank.name} fehlt die Rollen-ID in config.json.`);

  console.log(`[BLACKLIST SYNC] ${discordId}: Ziel ${rank.name} (${targetId}) in Guild ${subGuild.id}`);

  const allRankIds=BLACKLIST_MAIN_TO_SUB.map(([,k])=>config.roles[k]).filter(Boolean);
  const remove=allRankIds.filter(id=>id!==targetId&&sub.roles.cache.has(id));
  if(remove.length)await sub.roles.remove(remove,'Blacklist Framework-Sync');
  if(!sub.roles.cache.has(targetId))await sub.roles.add(targetId,'Blacklist Framework-Sync');

  await sub.fetch(true);
  if(!sub.roles.cache.has(targetId)){
    throw new Error(`Blacklist ${rank.name} (${targetId}) wurde von Discord nicht übernommen.`);
  }
  console.log(`[BLACKLIST SYNC] OK ${discordId}: ${rank.name} gesetzt.`);
  return rank;
}

export async function syncBlacklistSakuraMirrorRoles(client,config,discordId,explicitFrameworkRank=null) {
  const mainGuild=await client.guilds.fetch(config.guilds.sakura.id).catch(()=>null);
  const subGuild=await client.guilds.fetch(config.guilds.blacklist.id).catch(()=>null);
  if(!mainGuild||!subGuild)return;
  const main=await mainGuild.members.fetch(discordId).catch(()=>null);
  const sub=await subGuild.members.fetch(discordId).catch(()=>null);
  if(!main||!sub)return;
  await main.fetch(true);await sub.fetch(true);
  const mr=config.guilds.sakura.roles,nr=config.roles;
  const ids=[nr.blacklist_sakura_mitarbeiter,nr.blacklist_sakura_fuehrung,nr.blacklist_sakura_leitung].filter(Boolean);
  const desired=new Set();
  if(isActiveSakuraEmployee(discordId)){
    const current=explicitFrameworkRank??((config.frameworkRanks||[]).filter(r=>mr[r.key]&&main.roles.cache.has(mr[r.key])).sort((a,b)=>b.position-a.position)[0]??null);
    const band=current?Object.values(config.frameworkBands||{}).find(b=>current.position>=b.min&&current.position<=b.max):null;
    const key=band?.mainSeparator==='leitung_trenner'?'blacklist_sakura_leitung':
      band?.mainSeparator==='fuehrung_trenner'?'blacklist_sakura_fuehrung':'blacklist_sakura_mitarbeiter';
    if(nr[key])desired.add(nr[key]);
  }
  const remove=ids.filter(id=>sub.roles.cache.has(id)&&!desired.has(id));
  if(remove.length)await sub.roles.remove(remove);
  const add=[...desired].filter(id=>!sub.roles.cache.has(id));
  if(add.length)await sub.roles.add(add);
}


export async function syncGlobalFrameworkHierarchy(client,config,discordId,explicitFrameworkRank=null) {
  const mainGuild=await client.guilds.fetch(config.guilds.sakura.id).catch(()=>null);
  const main=mainGuild?await mainGuild.members.fetch(discordId).catch(()=>null):null;

  // Sakura-Hauptdiscord: Mitarbeiter / Führungsebene / Leitungsebene
  if(main)await reconcileMainHierarchyRoles(main,config,explicitFrameworkRank);

  // Neon Lotus: Sakura Personal + exakt eine der drei Hierarchie-Spiegelrollen
  await syncSakuraMirrorRoles(client,config,discordId,explicitFrameworkRank);

  // Blacklist: exakt eine der drei Sakura-Hierarchie-Spiegelrollen
  await syncBlacklistSakuraMirrorRoles(client,config,discordId,explicitFrameworkRank);
}

export async function applyFrameworkRank(client,config,discordId,frameworkRank) {
  const mainGuild=await client.guilds.fetch(config.guilds.sakura.id);
  const main=await mainGuild.members.fetch(discordId);
  await main.fetch(true);

  const mr=config.guilds.sakura.roles;
  const targetMainId=mr[frameworkRank.key];
  if(!targetMainId){
    throw new Error(`Hauptdiscord-Rollen-ID für Framework-Rang ${frameworkRank.name} (${frameworkRank.key}) fehlt.`);
  }

  // 1) Wiedereinstellung bereinigen.
  if(mr.gekuendigt&&main.roles.cache.has(mr.gekuendigt)){
    await main.roles.remove(mr.gekuendigt,'Framework: Wiedereinstellung');
  }

  // 2) HARTER RESET: ALLE 21 Framework-Ränge auf dem Sakura-Hauptdiscord entfernen.
  // Der ausgewählte Zielrang wird NICHT aus Discord zurückgelesen, sondern direkt verwendet.
  const allFrameworkIds=[...new Set((config.frameworkRanks||[])
    .map(r=>mr[r.key]).filter(Boolean))];
  const oldFrameworkIds=allFrameworkIds.filter(id=>main.roles.cache.has(id));
  if(oldFrameworkIds.length){
    await main.roles.remove(oldFrameworkIds,'Framework: alle alten Ränge entfernen');
  }

  // 3) Alte Bereichs-Zugehörigkeiten immer vollständig entfernen.
  await clearMainNeonRoles(main,config);
  await clearMainBlacklistRoles(main,config);

  // Auch lokale NL-/Blacklist-Ränge zunächst vollständig löschen.
  const neonGuild=await client.guilds.fetch(config.guilds.neon.id).catch(()=>null);
  const neonMember=neonGuild?await neonGuild.members.fetch(discordId).catch(()=>null):null;
  if(neonMember)await removeAreaRoles(neonMember,config,'neon');

  const blGuild=await client.guilds.fetch(config.guilds.blacklist.id).catch(()=>null);
  const blMember=blGuild?await blGuild.members.fetch(discordId).catch(()=>null):null;
  if(blMember)await removeBlacklistSubRanks(blMember,config);

  // 4) Exakt EINEN neuen Framework-Rang setzen.
  await main.roles.add(targetMainId,`Framework: Zielrang ${frameworkRank.name}`);
  // discord.js Member#fetch() can still leave a stale role cache immediately after
  // several cross-guild mutations. Fetch the member from the guild manager again.
  let verifiedMain=await mainGuild.members.fetch({user:discordId,force:true});

  // Sakura-Grundrollen sicherstellen.
  const baseKeys=config.sakuraMain?.baseRoles??[];
  const baseIds=baseKeys.map(k=>mr[k]).filter(Boolean);
  const missingBase=baseIds.filter(id=>!main.roles.cache.has(id));
  if(missingBase.length)await main.roles.add(missingBase,'Framework: Sakura-Grundrollen');

  let rank=null;

  if(frameworkRank.area==='sakura'){
    rank=(config.sakuraMain.ranks||[]).find(r=>r.key===frameworkRank.areaRankKey);
    if(!rank)throw new Error('Sakura-Rang nicht gefunden.');
  } else if(frameworkRank.area==='neon'){
    rank=getArea(config,'neon')?.ranks?.find(r=>r.key===frameworkRank.areaRankKey);
    if(!rank)throw new Error('Neon-Lotus-Rang nicht gefunden.');

    const neonGlobalId=mr[config.neonMain?.globalRole]||mr.neon_lotus_global||'1441777254953779282';
    if(neonGlobalId)await main.roles.add(neonGlobalId,'Framework: Neon Lotus Zugehörigkeit');

    if(neonMember){
      // Neon-Lotus-Ränge verwenden wie Blacklist direkt rank.key.
      const localId=config.roles?.[rank.key];
      if(!localId)throw new Error(`Neon-Lotus-Rollen-ID für ${rank.key} fehlt.`);
      await neonMember.roles.add(localId,`Framework: ${frameworkRank.name}`);
      await neonMember.fetch(true);
      await ensureNeonLotusMemberRole(neonMember,config);
    }
  } else if(frameworkRank.area==='blacklist'){
    rank=getArea(config,'blacklist')?.ranks?.find(r=>r.key===frameworkRank.areaRankKey);
    if(!rank)throw new Error('Blacklist-Rang nicht gefunden.');

    // Blacklist allgemein, NICHT Blacklist Leitung.
    const blacklistGlobalId=mr[config.blacklistMain?.globalRole]||mr.blacklist_allgemein;
    if(blacklistGlobalId)await main.roles.add(blacklistGlobalId,'Framework: Blacklist Zugehörigkeit');
    if(mr.blacklist_leitung&&main.roles.cache.has(mr.blacklist_leitung)){
      await main.roles.remove(mr.blacklist_leitung,'Framework: Blacklist-Leitung ist kein allgemeiner Tag');
    }

    if(blMember){
      // Blacklist-Ränge verwenden rank.key; die Rollen-IDs liegen zentral unter config.roles.
      const localId=config.roles?.[rank.key];
      if(!localId)throw new Error(`Blacklist-Rollen-ID für ${rank.key} fehlt.`);
      await blMember.roles.add(localId,`Framework: ${frameworkRank.name}`);
    }
  } else {
    throw new Error('Framework-Bereich nicht implementiert.');
  }

  // 5) Hauptdiscord-Hierarchie ausschließlich aus dem EXPLIZITEN Zielrang setzen.
  await reconcileMainHierarchyRoles(main,config,frameworkRank);

  // 6) Spiegelrollen ebenfalls ausschließlich aus dem EXPLIZITEN Zielrang setzen.
  await syncSakuraMirrorRoles(client,config,discordId,frameworkRank);
  await syncBlacklistSakuraMirrorRoles(client,config,discordId,frameworkRank);

  // 7) Abschlussprüfung mit FORCIERT frischem Member.
  verifiedMain=await mainGuild.members.fetch({user:discordId,force:true});
  let presentFrameworkIds=allFrameworkIds.filter(id=>verifiedMain.roles.cache.has(id));

  // Falls Discord nach den vielen Mutationen den Zielrang wider Erwarten nicht
  // zurückliefert, Zielrang einmal idempotent nachsetzen und erneut frisch laden.
  if(presentFrameworkIds.length!==1||presentFrameworkIds[0]!==targetMainId){
    await verifiedMain.roles.add(targetMainId,`Framework: Abschlussprüfung ${frameworkRank.name}`);
    verifiedMain=await mainGuild.members.fetch({user:discordId,force:true});
    presentFrameworkIds=allFrameworkIds.filter(id=>verifiedMain.roles.cache.has(id));
  }

  if(presentFrameworkIds.length!==1||presentFrameworkIds[0]!==targetMainId){
    const names=(config.frameworkRanks||[])
      .filter(r=>mr[r.key]&&verifiedMain.roles.cache.has(mr[r.key]))
      .map(r=>r.name).join(', ')||'keiner';
    throw new Error(`Framework-Abschlussprüfung fehlgeschlagen. Vorhandene Ränge: ${names}. Erwartet: ${frameworkRank.name}.`);
  }

  // 8) Bereichstags ebenfalls gegen den frisch geladenen Member prüfen.
  const neonTag=mr[config.neonMain?.globalRole]||mr.neon_lotus_global||'1441777254953779282';
  const blacklistTag=mr[config.blacklistMain?.globalRole]||mr.blacklist_allgemein;
  if(frameworkRank.area!=='neon'&&neonTag&&verifiedMain.roles.cache.has(neonTag)){
    throw new Error('Framework-Abschlussprüfung: Neon-Lotus-Zugehörigkeit ist trotz Bereichswechsel noch vorhanden.');
  }
  if(frameworkRank.area!=='blacklist'&&blacklistTag&&verifiedMain.roles.cache.has(blacklistTag)){
    throw new Error('Framework-Abschlussprüfung: Blacklist-Zugehörigkeit ist trotz Bereichswechsel noch vorhanden.');
  }

  return {area:frameworkRank.area,rank};
}
