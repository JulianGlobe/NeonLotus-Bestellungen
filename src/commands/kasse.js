import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig, hasManagementPermission } from '../utils/personnel.js';
import { getCurrentCash, adjustCash } from '../utils/cash.js';

export default {
 data:new SlashCommandBuilder().setName('kasse').setDescription('Verwaltet die Fraktionskasse.')
  .addSubcommand(s=>s.setName('stand').setDescription('Zeigt den aktuellen Kassenstand.'))
  .addSubcommand(s=>s.setName('aktualisieren').setDescription('Setzt den aktuellen Gesamtstand.')
   .addIntegerOption(o=>o.setName('betrag').setDescription('Aktueller Gesamtbetrag').setRequired(true).setMinValue(0)))
  .addSubcommand(s=>s.setName('einzahlung').setDescription('Bucht einen manuellen Kasseneingang.')
   .addIntegerOption(o=>o.setName('betrag').setDescription('Einzahlungsbetrag').setRequired(true).setMinValue(1))
   .addStringOption(o=>o.setName('grund').setDescription('Grund der Einzahlung').setRequired(true)))
  .addSubcommand(s=>s.setName('auszahlung').setDescription('Bucht einen manuellen Kassenabgang.')
   .addIntegerOption(o=>o.setName('betrag').setDescription('Auszahlungsbetrag').setRequired(true).setMinValue(1))
   .addStringOption(o=>o.setName('grund').setDescription('Grund der Auszahlung').setRequired(true))),
 async execute(i){
  const c=loadConfig();
  if(!(await hasManagementPermission(i,c)))return i.reply({content:'❌ Du hast keine Berechtigung für die Fraktionskasse.',flags:MessageFlags.Ephemeral});
  const sub=i.options.getSubcommand();
  if(sub==='stand'){
   const x=getCurrentCash();
   return i.reply({content:x?`💰 Aktueller Kassenstand: **$${Number(x.amount).toLocaleString('de-DE')}**\nZuletzt aktualisiert: <t:${Math.floor(new Date(x.created_at).getTime()/1000)}:f>`:'💰 Noch kein Kassenstand hinterlegt.',flags:MessageFlags.Ephemeral});
  }
  const amount=i.options.getInteger('betrag'),now=new Date().toISOString();
  if(sub==='aktualisieren'){
   const previous=getCurrentCash(),before=Number(previous?.amount||0),diff=amount-before;
   const result=db.prepare(`INSERT INTO cash_updates(amount,performed_by,created_at,status) VALUES(?,?,?,'ACTIVE')`).run(amount,i.user.id,now);
   return i.reply({embeds:[new EmbedBuilder().setTitle('🧾 Fraktionskasse aktualisiert').addFields(
    {name:'Vorher',value:`$${before.toLocaleString('de-DE')}`,inline:true},{name:'Neuer Stand',value:`$${amount.toLocaleString('de-DE')}`,inline:true},
    {name:'Differenz',value:`${diff>=0?'+':'-'}$${Math.abs(diff).toLocaleString('de-DE')}`,inline:true},{name:'Eintrags-ID',value:`#${result.lastInsertRowid}`,inline:true},
    {name:'Durchgeführt durch',value:`<@${i.user.id}>`}
   ).setTimestamp()]});
  }
  const reason=i.options.getString('grund'),sign=sub==='einzahlung'?1:-1;
  let cash;try{cash=adjustCash(sign*amount,i.user.id);}catch(e){return i.reply({content:`❌ ${e.message}`,flags:MessageFlags.Ephemeral});}
  return i.reply({embeds:[new EmbedBuilder().setTitle(sub==='einzahlung'?'💵 Kasseneingang':'💸 Kassenabgang').setDescription(sub==='einzahlung'?'Der Betrag wurde der Fraktionskasse hinzugefügt.':'Der Betrag wurde aus der Fraktionskasse entnommen.').addFields(
   {name:'Betrag',value:`${sign>0?'+':'-'}$${amount.toLocaleString('de-DE')}`,inline:true},
   {name:'Vorher',value:`$${cash.before.toLocaleString('de-DE')}`,inline:true},{name:'Neuer Stand',value:`$${cash.after.toLocaleString('de-DE')}`,inline:true},
   {name:'Grund',value:reason},{name:'Durchgeführt durch',value:`<@${i.user.id}>`},{name:'Eintrags-ID',value:`#${cash.id}`,inline:true}
  ).setFooter({text:'Fraktionskasse • Manuelle Buchung'}).setTimestamp()]});
 }
};
