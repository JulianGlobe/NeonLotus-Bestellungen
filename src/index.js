import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import { Client, Collection, GatewayIntentBits, Events, REST, Routes, MessageFlags } from 'discord.js';
import { loadCommands } from './utils/loadCommands.js';
import './database.js';
import dashboardRouter from './web/dashboard.js';
import { syncAllAbsenceRoles } from './utils/absences.js';
import { processOverdueSanctions } from './utils/sanctions.js';
import { upsertAdminPanels, handleAdminPanelInteraction } from './utils/adminPanels.js';
import { ensureNeonSakuraJoinRoles, ensureNeonLotusMemberRole, syncAllNeonLotusMemberRoles, syncSakuraMirrorRoles, syncBlacklistSakuraMirrorRoles } from './utils/neonSync.js';
import { processApprenticeExamReminders } from './utils/apprenticeReminder.js';
import { processWeeklyDuesThursdayReminder } from './utils/weeklyDuesReminder.js';

const requiredEnv=['DISCORD_TOKEN','CLIENT_ID','GUILD_ID'];
const missingEnv=requiredEnv.filter(key=>!process.env[key]);
if(missingEnv.length)throw new Error(`Fehlende Umgebungsvariablen: ${missingEnv.join(', ')}`);

const config=JSON.parse(fs.readFileSync('config.json','utf8'));
const botPublished=String(process.env.BOT_PUBLISHED||'false').toLowerCase()==='true';
const app=express(),port=Number(process.env.PORT||3000);
app.get('/',(_req,res)=>res.status(200).send('Neon Lotus / Sakura Verwaltungsbot ist online.'));
app.get('/health',(_req,res)=>res.status(200).json({ok:true}));
app.use('/personal',dashboardRouter);
app.listen(port,'0.0.0.0',()=>console.log(`🌐 Healthcheck läuft auf Port ${port}.`));

const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
client.commands=new Collection();
await loadCommands(client);

async function registerSlashCommands(){
 const commands=botPublished
  ? client.commands.map(command=>command.data.toJSON())
  : [];
 const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
 const guildIds=[...new Set([process.env.GUILD_ID,config.guilds?.sakura?.id,config.guilds?.blacklist?.id].filter(Boolean))];
 console.log(botPublished
  ? '🔄 Registriere Slash-Commands auf allen Verwaltungs-Discords...'
  : '🚧 BOT_PUBLISHED=false — Slash-Commands werden auf allen Verwaltungs-Discords ausgeblendet.');
 for(const guildId of guildIds){
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,guildId),{body:commands});
  console.log(botPublished
   ? `✅ ${commands.length} Slash-Commands für Guild ${guildId} registriert.`
   : `🚧 Slash-Commands für Guild ${guildId} entfernt.`);
 }
}
try{await registerSlashCommands();}catch(error){console.error('❌ Fehler beim Registrieren der Slash-Commands:',error);}

client.once(Events.ClientReady,async readyClient=>{
 console.log(`✅ Verwaltungsbot online als ${readyClient.user.tag}${botPublished?'':' (Publish-Modus: AUS)'}`);
 if(botPublished){
  try{await upsertAdminPanels(client,config);console.log('✅ Verwaltungs-Panels synchronisiert.');}
  catch(e){console.error('❌ Verwaltungs-Panels:',e);}
 }
 try{
  const neonRoleChanges=await syncAllNeonLotusMemberRoles(client,config);
  console.log(`✅ Neon-Lotus-Mitgliedsrolle synchronisiert (${neonRoleChanges} ergänzt).`);
 }catch(e){console.error('❌ Neon-Lotus-Mitgliedsrollen-Sync:',e);}
 try{await syncAllAbsenceRoles(client,config);console.log('✅ Abgemeldet-Rollen synchronisiert.');}catch(e){console.error('❌ Abgemeldet-Rollen-Sync:',e);}
 setInterval(()=>syncAllAbsenceRoles(client,config).catch(e=>console.error('❌ Abgemeldet-Rollen-Sync:',e)),15*60*1000);
 try{const changed=processOverdueSanctions();if(changed.length)console.log(`✅ ${changed.length} Sanktion(en) eskaliert.`);}catch(e){console.error('❌ Sanktions-Eskalation:',e);}
 setInterval(()=>{try{const changed=processOverdueSanctions();if(changed.length)console.log(`✅ ${changed.length} Sanktion(en) eskaliert.`);}catch(e){console.error('❌ Sanktions-Eskalation:',e);}},15*60*1000);
 try{const sent=await processApprenticeExamReminders(client,config);if(sent)console.log(`✅ ${sent} Lehrling(e) zur Tunerprüfung erinnert.`);}catch(e){console.error('❌ Tunerprüfungs-Erinnerung:',e);}
 setInterval(async()=>{try{const sent=await processApprenticeExamReminders(client,config);if(sent)console.log(`✅ ${sent} Lehrling(e) zur Tunerprüfung erinnert.`);}catch(e){console.error('❌ Tunerprüfungs-Erinnerung:',e);}},15*60*1000);
 try{const sent=await processWeeklyDuesThursdayReminder(client,config);if(sent)console.log(`✅ ${sent} Wochenabgaben-Reminder gesendet.`);}catch(e){console.error('❌ Wochenabgaben-Reminder:',e);}
 setInterval(async()=>{try{const sent=await processWeeklyDuesThursdayReminder(client,config);if(sent)console.log(`✅ ${sent} Wochenabgaben-Reminder gesendet.`);}catch(e){console.error('❌ Wochenabgaben-Reminder:',e);}},5*60*1000);
});

client.on(Events.GuildMemberAdd,async member=>{
 try{
  if(member.guild.id===config.guilds?.neon?.id){
   const applied=await ensureNeonSakuraJoinRoles(member,config);
   await ensureNeonLotusMemberRole(member,config);
   if(applied){
    await syncSakuraMirrorRoles(client,config,member.id);
    console.log(`✅ Sakura-Spiegelrollen für ${member.user.tag} auf Neon Lotus synchronisiert.`);
   }
  }
  if(member.guild.id===config.guilds?.blacklist?.id){
   const staatsbuerger=config.roles?.blacklist_staatsbuerger;
   if(staatsbuerger&&!member.roles.cache.has(staatsbuerger))await member.roles.add(staatsbuerger);
   await syncBlacklistSakuraMirrorRoles(client,config,member.id);
   console.log(`✅ Staatsbürger + Sakura-Spiegelrollen für ${member.user.tag} auf Blacklist synchronisiert.`);
  }
 }catch(error){console.error('❌ Subdiscord Join-Rollen-Sync:',error);}
});

client.on(Events.InteractionCreate,async interaction=>{
 try{
  if(interaction.isButton()||interaction.isUserSelectMenu()||interaction.isRoleSelectMenu()||interaction.isStringSelectMenu()||interaction.isModalSubmit()){
   if(await handleAdminPanelInteraction(interaction,client,config))return;
  }
  if(interaction.isAutocomplete()){const command=client.commands.get(interaction.commandName);if(!command?.autocomplete)return;await command.autocomplete(interaction);return;}
  if(!interaction.isChatInputCommand())return;
  const command=client.commands.get(interaction.commandName);if(!command)return;
  await command.execute(interaction);
 }catch(error){
  console.error(`❌ Fehler bei /${interaction.commandName}:`,error);
  if(interaction.isAutocomplete()){try{await interaction.respond([]);}catch{}return;}
  const payload={content:'❌ Beim Ausführen des Befehls ist ein Fehler aufgetreten. Bitte prüfe deine Eingaben oder versuche es erneut.',flags:MessageFlags.Ephemeral};
  try{if(interaction.replied||interaction.deferred)await interaction.followUp(payload);else await interaction.reply(payload);}catch(replyError){console.error('❌ Fehler beim Senden der Fehlermeldung:',replyError);}
 }
});
process.on('unhandledRejection',error=>console.error('❌ Unhandled Promise Rejection:',error));
process.on('uncaughtException',error=>console.error('❌ Uncaught Exception:',error));
client.login(process.env.DISCORD_TOKEN);
