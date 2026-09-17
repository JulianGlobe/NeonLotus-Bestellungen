import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  RoleSelectMenuBuilder, StringSelectMenuBuilder
} from 'discord.js';
import db from '../database.js';
import { ensureWeeklyDues } from './weeklyDues.js';
import { addToCash } from './cash.js';
import { hasSakuraPersonnelPermission } from './multiguild.js';

const sessions=new Map();
const TTL=15*60*1000;
const sid=()=>Math.random().toString(36).slice(2,10);
function put(userId,data){const id=sid();sessions.set(id,{...data,userId,expires:Date.now()+TTL});return id;}
function get(id,userId){const s=sessions.get(id);if(!s||s.userId!==userId||s.expires<Date.now()){sessions.delete(id);return null;}return s;}
setInterval(()=>{const n=Date.now();for(const [k,v] of sessions)if(v.expires<n)sessions.delete(k);},5*60*1000).unref();

const DEFS={
 personal:{title:'👥 Personalverwaltung',desc:'Mitarbeiter, Ränge, Abmeldungen und Gespräche schnell und zentral verwalten.',buttons:[
  ['Einstellung','🌺','einstellung',ButtonStyle.Success],['Beförderung','⬆️','uprank',ButtonStyle.Primary],
  ['Degradierung','⬇️','downrank',ButtonStyle.Secondary],['Kündigung','👋','kuendigung',ButtonStyle.Danger],
  ['Abmeldung','🏖️','abmeldung',ButtonStyle.Secondary],['Gespräch einladen','📅','termininvite',ButtonStyle.Primary],
  ['Gespräch fertig','✅','terminfinish',ButtonStyle.Success],['Personalakte leeren','🧹','akteclear',ButtonStyle.Danger]
 ]},
 finance:{title:'💰 Finanzen',desc:'Wochenabgaben und Fraktionskasse ohne Umwege verwalten.',buttons:[
  ['Abgabe bezahlt','💸','duespaid',ButtonStyle.Success],['Offene Abgaben','📋','duesopen',ButtonStyle.Primary],
  ['Neue Abgabenwoche','🔄','duesroll',ButtonStyle.Danger],['Kassenstand','🏦','cashstand',ButtonStyle.Primary],
  ['Kasse aktualisieren','🧾','cashupdate',ButtonStyle.Secondary],
  ['Einzahlung','➕','cashin',ButtonStyle.Success],['Auszahlung','➖','cashout',ButtonStyle.Danger]
 ]},
 sanctions:{title:'🚨 Sanktionen',desc:'Sanktionen ausstellen, prüfen, verbuchen und revidieren.',buttons:[
  ['Sanktion erteilen','🚨','sanctionnew',ButtonStyle.Danger],['Sanktion bezahlt','✅','sanctionpaid',ButtonStyle.Success],
  ['Offene Sanktionen','🔎','sanctionopen',ButtonStyle.Primary],['Sanktion verlängern','⏳','sanctionextend',ButtonStyle.Secondary],['Sanktion revidieren','↩️','sanctionrevoke',ButtonStyle.Secondary]
 ]},
 admin:{title:'🛠️ Verwaltung & Sonstiges',desc:'Weitere Werkzeuge für Organisation, Funk, Fraktionsfarben und Ankündigungen.',buttons:[
  ['Funk ändern','📻','funk',ButtonStyle.Primary],['Fraktionsfarben','🎨','colors',ButtonStyle.Primary],
  ['Ankündigung','📢','announce',ButtonStyle.Success],['Eintrag revidieren','↩️','revoke',ButtonStyle.Secondary]
 ]}
};

function panelEmbed(d){
 const hints={
  personal:'Über die Buttons öffnest du direkt die benötigte Personenwahl oder das passende Formular.',
  finance:'Zahlungen werden wie gewohnt automatisch mit der Fraktionskasse verknüpft.',
  sanctions:'Sanktionsrollen, Fristen und Eskalationen bleiben vollständig aktiv.',
  admin:'Änderungen verwenden dieselbe Verwaltungslogik wie die Slash-Befehle.'
 };
 return new EmbedBuilder().setTitle(d.title)
  .setDescription(`${d.desc}\n\n${hints[Object.keys(DEFS).find(k=>DEFS[k]===d)]}`)
  .setFooter({text:'Sakura Performance • Verwaltungsbot'})
  .setTimestamp();
}
function panelRows(key,d){
 const bs=d.buttons.map(([label,emoji,action,style])=>new ButtonBuilder().setCustomId(`vp:${action}`).setLabel(label).setEmoji(emoji).setStyle(style));
 const rows=[];for(let i=0;i<bs.length;i+=5)rows.push(new ActionRowBuilder().addComponents(bs.slice(i,i+5)));return rows;
}
function setting(k){return db.prepare(`SELECT value FROM funk_settings WHERE key=?`).get(k)?.value||null;}
function save(k,v){db.prepare(`INSERT INTO funk_settings(key,value,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(k,v,'SYSTEM',new Date().toISOString());}

export async function upsertAdminPanels(client,config){
 const guild=await client.guilds.fetch(config.guilds.sakura.id);
 for(const [key,d] of Object.entries(DEFS)){
  const channelId=config.guilds.sakura.channels.panels?.[key];if(!channelId)continue;
  const ch=await guild.channels.fetch(channelId);if(!ch?.isTextBased())continue;
  let msg=null,id=setting(`panel_message_${key}`);
  if(id)try{msg=await ch.messages.fetch(id);}catch{}
  const payload={embeds:[panelEmbed(d)],components:panelRows(key,d)};
  if(msg)await msg.edit(payload);else{msg=await ch.send(payload);save(`panel_message_${key}`,msg.id);}
 }
}

async function allowed(i,config){
 return hasSakuraPersonnelPermission(i,config);
}
async function requireLead(i,config){
 if(await allowed(i,config))return true;
 await i.reply({content:'❌ Diese Schnellaktion ist ausschließlich **ab Ausbilder** verfügbar.',flags:MessageFlags.Ephemeral});return false;
}
function userPick(action,title,placeholder='Mitarbeiter auswählen'){
 const s=put(action.userId,{action:action.name,extra:action.extra||{}});
 return {id:s,row:new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`vpu:${s}`).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)),title};
}
async function showUserPick(i,name,title,extra={}){
 const s=put(i.user.id,{action:name,extra});
 await i.reply({embeds:[new EmbedBuilder().setTitle(title).setDescription('Wähle die betreffende Person aus der Liste aus.')],
  components:[new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`vpu:${s}`).setPlaceholder('Mitarbeiter auswählen').setMinValues(1).setMaxValues(1))],
  flags:MessageFlags.Ephemeral});
}
function input(id,label,style=TextInputStyle.Short,required=true,placeholder=null){
 const x=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
 if(placeholder)x.setPlaceholder(placeholder);return new ActionRowBuilder().addComponents(x);
}
async function modal(i,id,title,rows){const m=new ModalBuilder().setCustomId(id).setTitle(title);m.addComponents(...rows);await i.showModal(m);}

function targetChannel(config,command,sub){
 const ch=config.guilds.sakura.channels;
 if(command==='einstellung')return ch.einstellung;
 if(command==='uprank'||command==='downrank')return ch.rankChanges;
 if(command==='kündigung')return ch.termination;
 if(command==='sanktion')return ch.sanctions;
 if(command==='termineinladung'||command==='termin')return ch.appointments;
 if(command==='abmeldung')return ch.absences;
 if(command==='wochenabgaben')return ch.weeklyDues;
 if(command==='kasse'&&(sub==='einzahlung'||sub==='auszahlung'))return ch.cashLog;
 return null;
}
function fakeOptions(values,sub=null){
 return {
  getSubcommand:()=>sub,
  getUser:n=>values[n]??null,getString:n=>values[n]??null,getInteger:n=>values[n]??null,
  getRole:n=>values[n]??null,getBoolean:n=>values[n]??null
 };
}
async function runCommand(i,client,config,name,values={},sub=null){
 const cmd=client.commands.get(name);if(!cmd)throw new Error(`Command ${name} nicht geladen.`);
 const outId=targetChannel(config,name,sub);
 const out=outId?await i.guild.channels.fetch(outId).catch(()=>null):null;
 let acknowledged=false;
 let publicReplyMessage=null;
 const proxy=new Proxy(i,{get(target,prop){
  if(prop==='options')return fakeOptions(values,sub);
  if(prop==='channelId')return outId||target.channelId;
  if(prop==='deferReply')return async options=>{
   if(!acknowledged){
    acknowledged=true;
    return target.deferReply({...(options||{}),flags:MessageFlags.Ephemeral});
   }
  };
  if(prop==='editReply')return async payload=>{
   const hasPublicOutput=out?.isTextBased()&&Array.isArray(payload?.embeds)&&payload.embeds.length>0;
   if(hasPublicOutput){
    publicReplyMessage=await out.send(payload);
    return target.editReply({content:`✅ Aktion ausgeführt. Ausgabe: <#${outId}>`,embeds:[],components:[]});
   }
   return target.editReply(payload);
  };
  if(prop==='reply')return async payload=>{
   const forceWeeklyPublic=name==='wochenabgaben'&&out?.isTextBased()&&Array.isArray(payload?.embeds)&&payload.embeds.length>0;
   const ephemeral=Boolean(payload?.flags)&&!forceWeeklyPublic;
   if(ephemeral){acknowledged=true;return target.reply(payload);}
   if(forceWeeklyPublic&&payload?.flags)payload={...payload,flags:undefined};
   if(out?.isTextBased()){
    publicReplyMessage=await out.send(payload);
    if(!acknowledged){
     acknowledged=true;
     await target.reply({content:`✅ Aktion ausgeführt. Ausgabe: <#${outId}>`,flags:MessageFlags.Ephemeral});
    }
    return publicReplyMessage;
   }
   acknowledged=true;return target.reply(payload);
  };
  if(prop==='fetchReply')return async ()=>{
   if(publicReplyMessage)return publicReplyMessage;
   return target.fetchReply();
  };
  if(prop==='followUp')return async payload=>{
   const ephemeral=Boolean(payload?.flags);
   if(!ephemeral&&out?.isTextBased())return out.send(payload);
   return target.followUp(payload);
  };
  const v=target[prop];return typeof v==='function'?v.bind(target):v;
 }});
 // Panel-Kommandos erhalten dieselbe Config wie normale Slash-Commands.
 // Zusätzliche Argumente sind für Commands, die nur (interaction) verwenden,
 // in JavaScript unschädlich.
 await cmd.execute(proxy,config);
}

export async function handleAdminPanelInteraction(i,client,config){
 if(i.isButton()&&i.customId.startsWith('vp:')){
  const a=i.customId.slice(3);
  if(a==='abmeldung'){
   return modal(i,'vpm:abmeldung','🏖️ Abmeldung',[
    input('von','Von (TT.MM.JJJJ)',TextInputStyle.Short,true,'16.09.2026'),
    input('bis','Bis (TT.MM.JJJJ)',TextInputStyle.Short,true,'20.09.2026'),
    input('grund','Grund (optional)',TextInputStyle.Paragraph,false)
   ]).then(()=>true);
  }
  if(!(await requireLead(i,config)))return true;
  if(['einstellung','uprank','downrank','kuendigung','termininvite','terminfinish','akteclear','duespaid','sanctionnew','sanctionopen'].includes(a)){
   await showUserPick(i,a,{
    einstellung:'🌺 Einstellung',uprank:'⬆️ Beförderung',downrank:'⬇️ Degradierung',kuendigung:'👋 Kündigung',
    termininvite:'📅 Gesprächseinladung',terminfinish:'✅ Gespräch abschließen',akteclear:'🧹 Personalakte leeren',
    duespaid:'💸 Wochenabgabe bezahlen',sanctionnew:'🚨 Sanktion erteilen',sanctionopen:'🔎 Offene Sanktionen'
   }[a]);return true;
  }
  if(a==='duesopen'){ensureWeeklyDues();await runCommand(i,client,config,'wochenabgaben',{},'offen');return true;}
  if(a==='duesroll'){
   const s=put(i.user.id,{action:'duesroll'});
   await i.reply({embeds:[new EmbedBuilder().setTitle('⚠️ Neue Abgabenwoche starten?').setDescription('Bezahlte bzw. vorausbezahlte Wochen werden übernommen. **Offene, unbezahlte Beträge werden verdoppelt.**')],
    components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vpc:${s}`).setLabel('Abgabenwoche aktualisieren').setEmoji('🔄').setStyle(ButtonStyle.Danger))],flags:MessageFlags.Ephemeral});return true;
  }
  if(a==='cashstand'){await runCommand(i,client,config,'kasse',{},'stand');return true;}
  if(a==='cashupdate'){await modal(i,'vpm:cashupdate','🧾 Kasse aktualisieren',[input('betrag','Aktueller Gesamtbetrag',TextInputStyle.Short,true,'2500000')]);return true;}
  if(a==='cashin'||a==='cashout'){await modal(i,`vpm:${a}`,a==='cashin'?'➕ Einzahlung':'➖ Auszahlung',[input('betrag','Betrag',TextInputStyle.Short,true,'50000'),input('grund','Grund',TextInputStyle.Paragraph,true)]);return true;}
  if(a==='sanctionpaid'||a==='sanctionrevoke'){
   await modal(i,`vpm:${a}`,a==='sanctionpaid'?'✅ Sanktion bezahlt':'↩️ Sanktion revidieren',[input('id','Sanktions-ID',TextInputStyle.Short,true,'123')]);return true;
  }
  if(a==='sanctionextend'){
   await modal(i,'vpm:sanctionextend','⏳ Sanktion verlängern',[
    input('id','Sanktions-ID',TextInputStyle.Short,true,'123'),
    input('tage','Verlängerung in Tagen',TextInputStyle.Short,true,'7')
   ]);return true;
  }
  if(a==='funk'){
   const s=put(i.user.id,{action:'funk'});
   const menu=new StringSelectMenuBuilder().setCustomId(`vps:${s}`).setPlaceholder('Funkbereich auswählen').addOptions(
    {label:'Sakura Performance',value:'sakura',emoji:'🌺'},{label:'Neon Lotus',value:'neon',emoji:'🌸'},{label:'Blacklist',value:'blacklist',emoji:'⚫'});
   await i.reply({embeds:[new EmbedBuilder().setTitle('📻 Funk aktualisieren').setDescription('Wähle zuerst den Funkbereich.')],components:[new ActionRowBuilder().addComponents(menu)],flags:MessageFlags.Ephemeral});return true;
  }
  if(a==='colors'){
   const s=put(i.user.id,{action:'colors'});
   await modal(i,`vpm:colors1:${s}`,'🎨 Fraktionsfarben • 1/2',[
    input('fraktion','Fraktionsname'),input('primaerfarbe','Primärfarbe / Farbcode'),input('primaerlack','Primär-Lackart'),
    input('sekundaerfarbe','Sekundärfarbe / Farbcode'),input('sekundaerlack','Sekundär-Lackart')
   ]);return true;
  }
  if(a==='announce'){
   const s=put(i.user.id,{action:'announce'});
   const menu=new StringSelectMenuBuilder().setCustomId(`vps:${s}`).setPlaceholder('Ankündigungsbereich auswählen').addOptions(
    {label:'Normale Mitarbeiter',value:'mitarbeiter',emoji:'👥',description:'Mitarbeiter-Ankündigungen'},
    {label:'Führungsebene',value:'fuehrung',emoji:'🧭',description:'Ankündigungen für die Führungsebene'},
    {label:'Leitungsebene',value:'leitung',emoji:'👑',description:'Ankündigungen für die Leitungsebene'}
   );
   await i.reply({embeds:[new EmbedBuilder().setTitle('📢 Ankündigung').setDescription('Wähle zuerst den Bereich. Channel und Ping-Rolle werden anschließend automatisch passend gewählt.')],
    components:[new ActionRowBuilder().addComponents(menu)],flags:MessageFlags.Ephemeral});return true;
  }
  if(a==='revoke'){
   const s=put(i.user.id,{action:'revoke'});
   const menu=new StringSelectMenuBuilder().setCustomId(`vps:${s}`).setPlaceholder('Bereich auswählen').addOptions({label:'Kassenstand',value:'kasse',emoji:'💰'},{label:'Abmeldung',value:'abmeldung',emoji:'🏖️'});
   await i.reply({embeds:[new EmbedBuilder().setTitle('↩️ Eintrag revidieren').setDescription('Welcher Eintrag soll revidiert werden?')],components:[new ActionRowBuilder().addComponents(menu)],flags:MessageFlags.Ephemeral});return true;
  }
 }
 if(i.isButton()&&i.customId.startsWith('vpc:')){
  const s=get(i.customId.slice(4),i.user.id);if(!s)return expired(i);
  if(s.action==='duesroll'){await runCommand(i,client,config,'wochenabgaben',{},'aktualisieren');sessions.delete(i.customId.slice(4));return true;}
 }
 if(i.isButton()&&i.customId.startsWith('vpa:')){
  const parts=i.customId.split(':'),s=get(parts[1],i.user.id);if(!s)return expired(i);
  if(s.action==='announce'){
   await modal(i,`vpm:announce:${parts[1]}`,'Ankündigung verfassen',[
    input('titel','Titel',TextInputStyle.Short,true,'Wichtige Information'),
    input('text','Text',TextInputStyle.Paragraph,true,'Text der Ankündigung')
   ]);
   return true;
  }
 }
 if(i.isUserSelectMenu()&&i.customId.startsWith('vpu:')){
  const id=i.customId.slice(4),s=get(id,i.user.id);if(!s)return expired(i);
  s.extra={...s.extra,user:i.users.first()};
  if(s.action==='einstellung'){
   const ranks=config.frameworkRanks||[];
   const menu=new StringSelectMenuBuilder().setCustomId(`vprank:${id}`).setPlaceholder('Einstellungsrang auswählen')
    .addOptions(ranks.slice(0,25).map(r=>({label:r.name,value:r.key})));
   await i.update({
    embeds:[new EmbedBuilder().setTitle('🌺 Einstellung').setDescription(`Person: <@${s.extra.user.id}>\n\nWähle den Rang aus, auf den die Person eingestellt werden soll.`)],
    components:[new ActionRowBuilder().addComponents(menu)]
   });
   return true;
  }
  if(s.action==='uprank'||s.action==='downrank'){
   const ranks=config.frameworkRanks||[];
   const menu=new StringSelectMenuBuilder().setCustomId(`vptarget:${id}`).setPlaceholder('Ziel-Rang auswählen')
    .addOptions(ranks.slice(0,25).map(r=>({label:r.name,value:r.key})));
   await i.update({embeds:[new EmbedBuilder().setTitle(s.action==='uprank'?'⬆️ Beförderung':'⬇️ Degradierung').setDescription(`Person: <@${s.extra.user.id}>\n\nWähle direkt den gewünschten Rang aus der gemeinsamen Framework-Rangstruktur.`)],components:[new ActionRowBuilder().addComponents(menu)]});return true;
  }
  if(s.action==='kuendigung'){
   const menu=new StringSelectMenuBuilder().setCustomId(`vpterm:${id}`).setPlaceholder('Kündigungsart auswählen').addOptions(
    {label:'Normale Kündigung',value:'NORMAL',emoji:'👋'},
    {label:'Kündigung mit Schulden',value:'DEBT',emoji:'💸'},
    {label:'Ersatzbank',value:'BENCH',emoji:'🪑'}
   );
   await i.update({embeds:[new EmbedBuilder().setTitle('👋 Kündigung').setDescription(`Person: <@${s.extra.user.id}>\n\nWähle die Art der Kündigung.`)],components:[new ActionRowBuilder().addComponents(menu)]});return true;
  }
  if(s.action==='termininvite'){await modal(i,`vpm:termininvite:${id}`,'📅 Gesprächseinladung',[input('anlass','Anlass',TextInputStyle.Paragraph),input('hinweis','Hinweis (optional)',TextInputStyle.Paragraph,false)]);return true;}
  if(s.action==='terminfinish'){
   const rows=db.prepare(`SELECT * FROM meeting_invitations WHERE discord_id=? AND COALESCE(status,'OPEN')='OPEN' ORDER BY id DESC`).all(s.extra.user.id);
   if(!rows.length){sessions.delete(id);await i.update({content:`ℹ️ Für <@${s.extra.user.id}> gibt es keine offene Gesprächseinladung.`,embeds:[],components:[]});return true;}
   const menu=new StringSelectMenuBuilder().setCustomId(`vpt:${id}`).setPlaceholder('Gespräch auswählen').addOptions(rows.slice(0,25).map(r=>({label:`#${r.id} • ${(r.reason||'Gespräch').slice(0,80)}`,description:(r.created_at||'').slice(0,10),value:String(r.id)})));
   await i.update({embeds:[new EmbedBuilder().setTitle('✅ Gespräch abschließen').setDescription(`Für <@${s.extra.user.id}> sind **${rows.length}** Gespräche offen. Wähle das Gespräch aus, das abgeschlossen werden soll.`)],components:[new ActionRowBuilder().addComponents(menu)]});return true;
  }
  if(s.action==='akteclear'){await modal(i,`vpm:akteclear:${id}`,'🧹 Personalakte leeren',[input('confirm','Zur Bestätigung CLEAR eingeben',TextInputStyle.Short,true,'CLEAR')]);return true;}
  if(s.action==='duespaid'){await modal(i,`vpm:duespaid:${id}`,'💸 Wochenabgabe bezahlen',[input('wochen','Anzahl Wochen (1–12)',TextInputStyle.Short,true,'1')]);return true;}
  if(s.action==='sanctionnew'){await modal(i,`vpm:sanctionnew:${id}`,'🚨 Sanktion erteilen',[input('betrag','Betrag',TextInputStyle.Short,true,'50000'),input('grund','Grund',TextInputStyle.Paragraph)]);return true;}
  if(s.action==='sanctionopen'){await runCommand(i,client,config,'sanktion',{person:s.extra.user},'offen');sessions.delete(id);return true;}
 }
 if(i.isRoleSelectMenu()&&i.customId.startsWith('vpr:')){
  const id=i.customId.slice(4),s=get(id,i.user.id);if(!s)return expired(i);
  s.extra={role:i.roles.first()||null};
  await modal(i,`vpm:announce:${id}`,'📢 Ankündigung',[input('titel','Titel'),input('text','Text',TextInputStyle.Paragraph)]);return true;
 }
 if(i.isStringSelectMenu()&&i.customId.startsWith('vpterm:')){
  const id=i.customId.slice(7),s=get(id,i.user.id);if(!s)return expired(i);
  s.extra={...s.extra,terminationType:i.values[0]};
  const label=s.extra.terminationType==='BENCH'?'Vermerk (optional)':'Grund (optional)';
  await modal(i,`vpm:kuendigung:${id}`,'👋 Kündigung',[input('grund',label,TextInputStyle.Paragraph,false)]);
  return true;
 }
 if(i.isStringSelectMenu()&&i.customId.startsWith('vptarget:')){
  const id=i.customId.slice(9),s=get(id,i.user.id);if(!s)return expired(i);
  s.extra={...s.extra,rank:i.values[0]};
  await modal(i,`vpm:${s.action}:${id}`,s.action==='uprank'?'⬆️ Beförderung':'⬇️ Degradierung',[input('grund','Grund (optional)',TextInputStyle.Paragraph,false)]);return true;
 }
 if(i.isStringSelectMenu()&&i.customId.startsWith('vparea:')){
  const id=i.customId.slice(7),s=get(id,i.user.id);if(!s)return expired(i);
  const area=i.values[0];s.extra={...s.extra,area};
  await modal(i,`vpm:${s.action}:${id}`,s.action==='uprank'?'⬆️ Beförderung':'⬇️ Degradierung',[input('grund','Grund (optional)',TextInputStyle.Paragraph,false)]);return true;
 }
 if(i.isStringSelectMenu()&&i.customId.startsWith('vprank:')){
  const id=i.customId.slice(7),s=get(id,i.user.id);if(!s)return expired(i);
  const rank=i.values[0];
  await runCommand(i,client,config,'einstellung',{person:s.extra.user,rang:rank});
  sessions.delete(id);return true;
 }
 if(i.isStringSelectMenu()&&i.customId.startsWith('vpt:')){
  const id=i.customId.slice(4),s=get(id,i.user.id);if(!s)return expired(i);
  const invitationId=Number(i.values[0]);
  if(!Number.isInteger(invitationId)||invitationId<1)return bad(i,'Ungültige Gesprächs-ID.');
  await runCommand(i,client,config,'termin',{person:s.extra.user,id:invitationId},'abgeschlossen');
  sessions.delete(id);
  return true;
 }
 if(i.isStringSelectMenu()&&i.customId.startsWith('vps:')){
  const id=i.customId.slice(4),s=get(id,i.user.id);if(!s)return expired(i);const v=i.values[0];
  if(s.action==='funk'){s.extra={bereich:v};await modal(i,`vpm:funk:${id}`,'📻 Funk aktualisieren',[input('funk','Neue Funkfrequenz (4–9 Ziffern)',TextInputStyle.Short,true,'569323')]);return true;}
  if(s.action==='announce'){
   s.extra={bereich:v};
   const labels={mitarbeiter:'Normale Mitarbeiter',fuehrung:'Führungsebene',leitung:'Leitungsebene'};
   await i.update({
    embeds:[new EmbedBuilder().setTitle('📢 Ankündigung').setDescription(`Bereich: **${labels[v]||v}**\n\nChannel und Ping-Rolle werden automatisch gewählt. Klicke auf **Ankündigung verfassen**.`)],
    components:[new ActionRowBuilder().addComponents(
     new ButtonBuilder().setCustomId(`vpa:${id}:compose`).setLabel('Ankündigung verfassen').setEmoji('📢').setStyle(ButtonStyle.Success)
    )]
   });
   return true;
  }
  if(s.action==='revoke'){s.extra={bereich:v};await modal(i,`vpm:revoke:${id}`,'↩️ Eintrag revidieren',[input('id','Eintrags-ID',TextInputStyle.Short,true,'123')]);return true;}
 }
 if(i.isModalSubmit()&&i.customId.startsWith('vpm:')){
  const parts=i.customId.split(':'),a=parts[1],id=parts[2]||null,s=id?get(id,i.user.id):null,f=n=>i.fields.getTextInputValue(n);
  if(id&&!s)return expired(i);
  if(a==='abmeldung'){await runCommand(i,client,config,'abmeldung',{von:f('von'),bis:f('bis'),grund:f('grund')||null});return true;}
  if(a==='cashupdate'){const n=Number(f('betrag').replace(/[.$,\s]/g,''));if(!Number.isInteger(n)||n<0)return bad(i,'Bitte einen gültigen Gesamtbetrag eingeben.');await runCommand(i,client,config,'kasse',{betrag:n},'aktualisieren');return true;}
  if(a==='cashin'||a==='cashout'){const n=Number(f('betrag').replace(/[.$,\s]/g,''));if(!Number.isInteger(n)||n<1)return bad(i,'Bitte einen gültigen Betrag eingeben.');await runCommand(i,client,config,'kasse',{betrag:n,grund:f('grund')},a==='cashin'?'einzahlung':'auszahlung');return true;}
  if(a==='sanctionpaid'||a==='sanctionrevoke'){const n=Number(f('id'));if(!Number.isInteger(n)||n<1)return bad(i,'Bitte eine gültige Sanktions-ID eingeben.');await runCommand(i,client,config,'sanktion',{id:n},a==='sanctionpaid'?'bezahlt':'revidiert');return true;}
  if(a==='sanctionextend'){
   const n=Number(f('id')),days=Number(f('tage'));
   if(!Number.isInteger(n)||n<1)return bad(i,'Bitte eine gültige Sanktions-ID eingeben.');
   if(!Number.isInteger(days)||days<1||days>365)return bad(i,'Die Verlängerung muss zwischen 1 und 365 Tagen liegen.');
   await runCommand(i,client,config,'sanktion',{id:n,tage:days},'verlaengern');return true;
  }
  if(a==='uprank'||a==='downrank'){await runCommand(i,client,config,a,{person:s.extra.user,rang:s.extra.rank,grund:f('grund')||null});sessions.delete(id);return true;}
  if(a==='kuendigung'){await runCommand(i,client,config,'kündigung',{person:s.extra.user,art:s.extra.terminationType||'NORMAL',grund:f('grund')||null});sessions.delete(id);return true;}
  if(a==='termininvite'){await runCommand(i,client,config,'termineinladung',{person:s.extra.user,anlass:f('anlass'),hinweis:f('hinweis')||null});sessions.delete(id);return true;}
  if(a==='akteclear'){await runCommand(i,client,config,'personalakte',{person:s.extra.user,bestaetigung:f('confirm')},'clear');sessions.delete(id);return true;}
  if(a==='duespaid'){const n=Number(f('wochen'));if(!Number.isInteger(n)||n<1||n>12)return bad(i,'Die Anzahl der Wochen muss zwischen 1 und 12 liegen.');await runCommand(i,client,config,'wochenabgaben',{person:s.extra.user,wochen:n},'bezahlt');sessions.delete(id);return true;}
  if(a==='sanctionnew'){const n=Number(f('betrag').replace(/[.$,\s]/g,''));if(!Number.isInteger(n)||n<1)return bad(i,'Bitte einen gültigen Sanktionsbetrag eingeben.');await runCommand(i,client,config,'sanktion',{person:s.extra.user,betrag:n,grund:f('grund')},'erteilen');sessions.delete(id);return true;}
  if(a==='funk'){await runCommand(i,client,config,'funk',{bereich:s.extra.bereich,funk:f('funk')});sessions.delete(id);return true;}
  if(a==='announce'){await runCommand(i,client,config,'ankündigung',{bereich:s.extra.bereich,titel:f('titel'),text:f('text')});sessions.delete(id);return true;}
  if(a==='revoke'){const n=Number(f('id'));if(!Number.isInteger(n)||n<1)return bad(i,'Bitte eine gültige Eintrags-ID eingeben.');await runCommand(i,client,config,'revidieren',{bereich:s.extra.bereich,id:n});sessions.delete(id);return true;}
  if(a==='colors1'){
   s.extra={fraktion:f('fraktion'),primaerfarbe:f('primaerfarbe'),primaerlack:f('primaerlack'),sekundaerfarbe:f('sekundaerfarbe'),sekundaerlack:f('sekundaerlack')};
   await i.reply({embeds:[new EmbedBuilder().setTitle('🎨 Fraktionsfarben • optionale Angaben').setDescription('Die Pflichtangaben sind gespeichert. Ergänze jetzt die optionalen Fahrzeugfarben oder veröffentliche direkt.')],
    components:[new ActionRowBuilder().addComponents(
     new ButtonBuilder().setCustomId(`vpcolor:${id}:more`).setLabel('Optionale Farben ergänzen').setEmoji('✨').setStyle(ButtonStyle.Primary),
     new ButtonBuilder().setCustomId(`vpcolor:${id}:publish`).setLabel('Direkt veröffentlichen').setEmoji('✅').setStyle(ButtonStyle.Success)
    )],flags:MessageFlags.Ephemeral});return true;
  }
  if(a==='colors2'){Object.assign(s.extra,{perlglanz:f('perlglanz')||null,unterboden:f('unterboden')||null,scheinwerfer:f('scheinwerfer')||null,reifenqualm:f('reifenqualm')||null,felgenfarbe:f('felgenfarbe')||null});await publishColors(i,config,s.extra);sessions.delete(id);return true;}
 }
 if(i.isButton()&&i.customId.startsWith('vpcolor:')){
  const [,id,act]=i.customId.split(':'),s=get(id,i.user.id);if(!s)return expired(i);
  if(act==='more'){await modal(i,`vpm:colors2:${id}`,'🎨 Fraktionsfarben • 2/2',[input('perlglanz','Perlglanz (optional)',TextInputStyle.Short,false),input('unterboden','Unterboden (optional)',TextInputStyle.Short,false),input('scheinwerfer','Scheinwerfer (optional)',TextInputStyle.Short,false),input('reifenqualm','Reifenqualm (optional)',TextInputStyle.Short,false),input('felgenfarbe','Felgenfarbe (optional)',TextInputStyle.Short,false)]);return true;}
  await publishColors(i,config,s.extra);sessions.delete(id);return true;
 }
 return false;
}
async function publishColors(i,config,x){
 const ch=await i.guild.channels.fetch(config.guilds.sakura.channels.fraktionsfarben);
 const fields=[
  {name:'🎨 Primärfarbe',value:`**Farbcode:** ${x.primaerfarbe}\n**Lackart:** ${x.primaerlack}`,inline:true},
  {name:'🎨 Sekundärfarbe',value:`**Farbcode:** ${x.sekundaerfarbe}\n**Lackart:** ${x.sekundaerlack}`,inline:true},
  x.perlglanz&&{name:'✨ Perlglanz',value:x.perlglanz,inline:true},x.unterboden&&{name:'💡 Unterboden',value:x.unterboden,inline:true},
  x.scheinwerfer&&{name:'🔦 Scheinwerfer',value:x.scheinwerfer,inline:true},x.reifenqualm&&{name:'💨 Reifenqualm',value:x.reifenqualm,inline:true},
  x.felgenfarbe&&{name:'🛞 Felgenfarbe',value:x.felgenfarbe,inline:true}
 ].filter(Boolean);
 const cash=addToCash(50000,i.user.id);
 fields.push({name:'💰 Eintragungsgebühr',value:'**$50.000** wurden automatisch der Fraktionskasse gutgeschrieben.',inline:false});
 await ch.send({embeds:[new EmbedBuilder().setTitle(`🎨 Fraktionsfarben • ${x.fraktion}`).setDescription('Offiziell hinterlegte Fahrzeugfarben der Fraktion.').addFields(fields).setFooter({text:`Fraktionsfarben • Eingetragen durch ${i.user.username} • Kassenstand $${cash.after.toLocaleString('de-DE')}`}).setTimestamp()]});
 await i.reply({content:`✅ Fraktionsfarben wurden in <#${ch.id}> veröffentlicht.\n💰 **$50.000** wurden automatisch der Fraktionskasse gutgeschrieben. Neuer Stand: **$${cash.after.toLocaleString('de-DE')}**`,flags:MessageFlags.Ephemeral});
}
async function expired(i){await i.reply({content:'⌛ Diese Panel-Sitzung ist abgelaufen. Bitte starte die Aktion erneut.',flags:MessageFlags.Ephemeral});return true;}
async function bad(i,text){await i.reply({content:`❌ ${text}`,flags:MessageFlags.Ephemeral});return true;}
