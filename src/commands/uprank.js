import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig } from '../utils/personnel.js';
import { isSakuraGuild, hasSakuraPersonnelPermission, checkSakuraChannel } from '../utils/multiguild.js';
import { applyFrameworkRank } from '../utils/neonSync.js';
import { canManageRankTarget } from '../utils/rankPermission.js';

function choices(config,focused=''){
 const q=String(focused||'').toLowerCase();
 return (config.frameworkRanks||[]).filter(r=>r.name.toLowerCase().includes(q)).slice(0,25).map(r=>({name:r.name,value:r.key}));
}
function find(config,key){return (config.frameworkRanks||[]).find(r=>r.key===key)||null;}

export default {
 data:new SlashCommandBuilder().setName('uprank').setDescription('Setzt den gewünschten Rang aus der gemeinsamen Framework-Rangstruktur.')
  .addUserOption(o=>o.setName('person').setDescription('Person').setRequired(true))
  .addStringOption(o=>o.setName('rang').setDescription('Ziel-Rang').setRequired(true).setAutocomplete(true))
  .addStringOption(o=>o.setName('grund').setDescription('Grund').setRequired(false)),
 async autocomplete(i){const c=loadConfig();await i.respond(choices(c,i.options.getFocused()));},
 async execute(i){
  const c=loadConfig();
  if(!isSakuraGuild(i.guildId,c))return i.reply({content:'❌ Rangänderungen werden zentral auf dem Sakura-Hauptdiscord durchgeführt.',flags:MessageFlags.Ephemeral});
  if(!checkSakuraChannel(i,c,'rankChanges'))return i.reply({content:`❌ Nur in <#${c.guilds.sakura.channels.rankChanges}>.`,flags:MessageFlags.Ephemeral});
  if(!(await hasSakuraPersonnelPermission(i,c)))return i.reply({content:'❌ Keine Berechtigung.',flags:MessageFlags.Ephemeral});

  const u=i.options.getUser('person'),key=i.options.getString('rang'),reason=i.options.getString('grund'),fw=find(c,key);
  if(!fw)return i.reply({content:'❌ Ungültiger Framework-Rang.',flags:MessageFlags.Ephemeral});

  const rankPermission=await canManageRankTarget(i,c,u.id,fw);
  if(!rankPermission.ok)return i.reply({content:rankPermission.message,flags:MessageFlags.Ephemeral});

  // Rollen-Sync über zwei Discords kann länger als 3 Sekunden dauern.
  // Die Interaction wird deshalb sofort bestätigt und später bearbeitet.
  await i.deferReply();

  const now=new Date().toISOString();
  const visibleRoles=c.guilds.sakura.roles;
  const old=(c.frameworkRanks||[]).find(r=>visibleRoles[r.key]&&i.guild.members.cache.get(u.id)?.roles.cache.has(visibleRoles[r.key]))?.name??'Nicht erkannt';

  let applied;
  try{applied=await applyFrameworkRank(i.client,c,u.id,fw);}
  catch(error){return i.editReply({content:`❌ ${error.message}`});}

  const saveRank=db.transaction(()=>{
    // Die Framework-Struktur hat genau EINEN aktuell aktiven Rang.
    // Alte Sakura-/Neon-Rangstände bleiben als Historie erhalten, sind aber nicht mehr "aktiv".
    db.prepare(`UPDATE employee_ranks SET active=0,left_at=? WHERE discord_id=? AND active=1`).run(now,u.id);
    db.prepare(`INSERT INTO employee_ranks(discord_id,area,rank_name,joined_at,left_at,active)
      VALUES(?,?,?,?,NULL,1)
      ON CONFLICT(discord_id,area) DO UPDATE SET rank_name=excluded.rank_name,joined_at=excluded.joined_at,left_at=NULL,active=1`)
      .run(u.id,applied.area,applied.rank.name,now);
    db.prepare(`INSERT INTO personnel_actions(discord_id,action,area,old_rank,new_rank,performed_by,reason,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(u.id,'UPRANK',applied.area,old,fw.name,i.user.id,reason,now);
  });
  saveRank();

  await i.editReply({embeds:[new EmbedBuilder().setTitle('⬆️ Beförderung').setDescription(`<@${u.id}> wurde auf den ausgewählten Framework-Rang gesetzt.`).addFields(
   {name:'👤 Mitarbeiter',value:`<@${u.id}>`,inline:true},
   {name:'📤 Vorheriger Framework-Rang',value:old,inline:true},
   {name:'🌟 Neuer Framework-Rang',value:`**${fw.name}**`,inline:true},
   {name:'🛠️ Durchgeführt durch',value:`<@${i.user.id}>`}
  ).setFooter({text:'Personalverwaltung • Zentrale Rangänderung'}).setTimestamp()]});
 }
};
