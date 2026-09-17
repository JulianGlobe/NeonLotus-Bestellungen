import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig, getRankByKey } from '../utils/personnel.js';
import { isSakuraGuild, getSakuraRank, getSakuraRankChoices, hasSakuraPersonnelPermission, checkSakuraChannel, applySakuraRank } from '../utils/multiguild.js';
import { applyFrameworkRank, ensureNeonSakuraJoinRoles, syncSakuraMirrorRoles, syncBlacklistSakuraMirrorRoles } from '../utils/neonSync.js';

function frameworkChoices(config,focused=''){
 const q=String(focused||'').toLowerCase();
 return (config.frameworkRanks||[]).filter(r=>r.name.toLowerCase().includes(q)).slice(0,25).map(r=>({name:r.name,value:r.key}));
}
function frameworkRank(config,key){return (config.frameworkRanks||[]).find(r=>r.key===key)||null;}

export default {
 data:new SlashCommandBuilder().setName('einstellung').setDescription('Stellt eine Person zentral bei Sakura ein.')
  .addUserOption(o=>o.setName('person').setDescription('Person').setRequired(true))
  .addStringOption(o=>o.setName('rang').setDescription('Framework-Start-Rang').setRequired(true).setAutocomplete(true)),
 async autocomplete(i){const c=loadConfig();await i.respond(frameworkChoices(c,i.options.getFocused()));},
 async execute(i){
  const c=loadConfig();
  if(!isSakuraGuild(i.guildId,c))return i.reply({content:'❌ Einstellungen werden ausschließlich auf dem Sakura-Hauptdiscord durchgeführt.',flags:MessageFlags.Ephemeral});
  if(!checkSakuraChannel(i,c,'einstellung'))return i.reply({content:`❌ Nur in <#${c.guilds.sakura.channels.einstellung}>.`,flags:MessageFlags.Ephemeral});
  if(!(await hasSakuraPersonnelPermission(i,c)))return i.reply({content:'❌ Keine Berechtigung.',flags:MessageFlags.Ephemeral});

  // Cross-Guild-Rollensync kann länger als Discords Antwortfenster dauern.
  // Deshalb die Interaction sofort bestätigen und anschließend nur noch editReply verwenden.
  await i.deferReply();

  const u=i.options.getUser('person'),key=i.options.getString('rang'),fw=frameworkRank(c,key),now=new Date().toISOString();
  if(!fw)return i.editReply({content:'❌ Ungültiger Framework-Rang.'});

  const hiringBlock=db.prepare(`
    SELECT * FROM hiring_blocks
    WHERE discord_id=? AND revoked_at IS NULL
  `).get(u.id);
  if(hiringBlock){
    const active=Number(hiringBlock.indefinite)===1 || (hiringBlock.blocked_until && new Date(hiringBlock.blocked_until).getTime()>Date.now());
    if(active){
      const until=Number(hiringBlock.indefinite)===1
        ? 'unbefristet'
        : new Date(hiringBlock.blocked_until).toLocaleDateString('de-DE');
      return i.editReply({content:`❌ **Einstellung nicht möglich.** Für <@${u.id}> besteht eine aktive Einstellungssperre bis **${until}**.\n**Grund:** ${hiringBlock.reason}`});
    }
  }
  const bench=db.prepare(`SELECT * FROM termination_records WHERE discord_id=? AND bench_active=1 ORDER BY id DESC LIMIT 1`).get(u.id);
  const m=await i.guild.members.fetch(u.id),displayName=m.displayName||u.username;

  // Zuerst die Sakura-Basis als aktive Hauptzugehörigkeit speichern.
  db.prepare(`INSERT INTO employees(discord_id,display_name,joined_at,left_at,active) VALUES(?,?,?,NULL,1) ON CONFLICT(discord_id) DO UPDATE SET display_name=excluded.display_name,left_at=NULL,active=1`).run(u.id,displayName,now);

  let applied;
  try{applied=await applyFrameworkRank(i.client,c,u.id,fw);}
  catch(error){return i.editReply({content:`❌ ${error.message}`});}

  // Genau ein aktiver Framework-Rang in der DB.
  db.prepare(`UPDATE employee_ranks SET active=0,left_at=? WHERE discord_id=? AND active=1`).run(now,u.id);
  db.prepare(`INSERT INTO employee_ranks(discord_id,area,rank_name,joined_at,left_at,active)
    VALUES(?,?,?,?,NULL,1)
    ON CONFLICT(discord_id,area) DO UPDATE SET rank_name=excluded.rank_name,joined_at=excluded.joined_at,left_at=NULL,active=1`)
    .run(u.id,applied.area,applied.rank.name,now);
  db.prepare(`INSERT INTO personnel_actions(discord_id,action,area,old_rank,new_rank,performed_by,reason,created_at)
    VALUES(?,'EINSTELLUNG',?,NULL,?,?,NULL,?)`).run(u.id,applied.area,fw.name,i.user.id,now);
  if(bench){
    db.prepare(`UPDATE termination_records SET bench_active=0,bench_left_at=? WHERE id=?`).run(now,bench.id);
  }

  const label=applied.area==='neon'?'Sakura + Neon Lotus':applied.area==='blacklist'?'Sakura + Blacklist':'Sakura';
  return reply(i,u,fw.name,label);
 }
};

async function reply(i,u,rank,area){
 await i.editReply({embeds:[new EmbedBuilder().setTitle('🌸 Neue Einstellung').setDescription(`Willkommen im Team, <@${u.id}>!`).addFields(
  {name:'👤 Mitarbeiter',value:`<@${u.id}>`,inline:true},{name:'🏢 Zugehörigkeit',value:area,inline:true},
  {name:'🎖️ Framework-Rang',value:`**${rank}**`,inline:true},{name:'🛠️ Eingetragen durch',value:`<@${i.user.id}>`}
 ).setFooter({text:'Personalverwaltung • Zentrale Einstellung'}).setTimestamp()]});
}
