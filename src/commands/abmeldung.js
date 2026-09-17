import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig } from '../utils/personnel.js';
import { isSakuraGuild } from '../utils/multiguild.js';
import { parseGermanDate,syncAbsenceRoleForUser } from '../utils/absences.js';

export default {
 data:new SlashCommandBuilder().setName('abmeldung').setDescription('Trägt eine Abmeldung ein.')
  .addStringOption(o=>o.setName('von').setDescription('Zeitraum von, z. B. 15.09.2026').setRequired(true))
  .addStringOption(o=>o.setName('bis').setDescription('Zeitraum bis, z. B. 20.09.2026').setRequired(true))
  .addStringOption(o=>o.setName('grund').setDescription('Optionaler Grund').setRequired(false)),
 async execute(interaction){
  const config=loadConfig();
  if(isSakuraGuild(interaction.guildId,config)){
   const member=await interaction.guild.members.fetch(interaction.user.id);
   const roles=config.guilds.sakura.roles;
   const allowed=(config.sakuraMain?.ranks??[]).map(r=>roles[r.key]).filter(Boolean);
   if(!member.permissions.has('Administrator')&&!allowed.some(id=>member.roles.cache.has(id)))
    return interaction.reply({content:'❌ `/abmeldung` kann von Sakura-Personal ab Praktikant verwendet werden.',flags:MessageFlags.Ephemeral});
  }
  const from=interaction.options.getString('von').trim(),to=interaction.options.getString('bis').trim(),reason=interaction.options.getString('grund');
  const fromDate=parseGermanDate(from),toDate=parseGermanDate(to,true);
  if(!fromDate||!toDate)return interaction.reply({content:'❌ Bitte `TT.MM.JJJJ` verwenden, z. B. `15.09.2026`.',flags:MessageFlags.Ephemeral});
  if(toDate<fromDate)return interaction.reply({content:'❌ Das Enddatum darf nicht vor dem Startdatum liegen.',flags:MessageFlags.Ephemeral});
  const now=new Date().toISOString();
  const result=db.prepare(`INSERT INTO absences(discord_id,date_from,date_to,reason,created_at,created_by) VALUES(?,?,?,?,?,?)`).run(interaction.user.id,from,to,reason,now,interaction.user.id);
  await syncAbsenceRoleForUser(interaction.client,config,interaction.user.id);
  await interaction.reply({embeds:[new EmbedBuilder().setTitle('🏖️ Abmeldung eingetragen').setDescription('Die Abwesenheit wurde erfolgreich in der Personalverwaltung hinterlegt.').addFields(
   {name:'👤 Mitarbeiter',value:`<@${interaction.user.id}>`,inline:true},
   {name:'📅 Von',value:from,inline:true},{name:'📅 Bis',value:to,inline:true},
   ...(reason?[{name:'📝 Grund',value:reason}]:[]),
   {name:'🆔 Abmeldungs-ID',value:`#${result.lastInsertRowid}`,inline:true}
  ).setFooter({text:'Abmeldungen • Die Rolle wird automatisch zum Zeitraum synchronisiert.'}).setTimestamp()]});
 }
};