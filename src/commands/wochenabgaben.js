import { SlashCommandBuilder,EmbedBuilder,MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig } from '../utils/personnel.js';
import { isSakuraGuild, hasSakuraPersonnelPermission } from '../utils/multiguild.js';
import { ensureWeeklyDues,rollWeeklyDues } from '../utils/weeklyDues.js';
import { addToCash } from '../utils/cash.js';

async function allowed(i,c){
 return hasSakuraPersonnelPermission(i,c);
}
export default{
 data:new SlashCommandBuilder().setName('wochenabgaben').setDescription('Verwaltet die Wochenabgaben.')
  .addSubcommand(s=>s.setName('bezahlt').setDescription('Verbucht eine oder mehrere Wochenabgaben.')
   .addUserOption(o=>o.setName('person').setDescription('Mitarbeiter').setRequired(true))
   .addIntegerOption(o=>o.setName('wochen').setDescription('Anzahl bezahlter Wochen (Standard: 1)').setMinValue(1).setMaxValue(12)))
  .addSubcommand(s=>s.setName('aktualisieren').setDescription('Startet die neue Abgabenwoche und verdoppelt unbezahlte Beträge.'))
  .addSubcommand(s=>s.setName('offen').setDescription('Zeigt aktuell offene Wochenabgaben.')),
 async execute(i){
  const c=loadConfig();
  if(!(await allowed(i,c)))return i.reply({content:'❌ Wochenabgaben können ausschließlich **ab Ausbilder** verwaltet werden.',flags:MessageFlags.Ephemeral});
  ensureWeeklyDues();
  const sub=i.options.getSubcommand(),now=new Date().toISOString();
  if(sub==='bezahlt'){
   const u=i.options.getUser('person'),weeks=i.options.getInteger('wochen')||1,row=db.prepare(`SELECT * FROM weekly_dues WHERE discord_id=?`).get(u.id);
   if(!row)return i.reply({content:'❌ Für diese Person ist aktuell keine Wochenabgabe hinterlegt.',flags:MessageFlags.Ephemeral});
   if(row.status==='PAID'&&weeks===1)return i.reply({content:'ℹ️ Diese Wochenabgabe ist bereits als bezahlt markiert. Für Vorauszahlungen kannst du bei `wochen` mehr als 1 angeben.',flags:MessageFlags.Ephemeral});
   const currentDue=row.status==='OPEN'?Number(row.amount_due):0;
   const futureWeeks=row.status==='OPEN'?Math.max(0,weeks-1):weeks;
   const total=currentDue+(futureWeeks*Number(row.base_amount));
   if(total<=0)return i.reply({content:'ℹ️ Für diese Person fällt aktuell keine Wochenabgabe an.',flags:MessageFlags.Ephemeral});
   const prepaid=Number(row.prepaid_weeks||0)+futureWeeks;
   db.prepare(`UPDATE weekly_dues SET status='PAID',paid_by=?,paid_at=?,updated_at=?,prepaid_weeks=? WHERE discord_id=?`).run(i.user.id,now,now,prepaid,u.id);
   db.prepare(`INSERT INTO weekly_dues_history(discord_id,rank_name,base_amount,amount_before,amount_after,previous_status,action,performed_by,created_at) VALUES(?,?,?,?,?,?,?, ?,?)`)
    .run(u.id,row.rank_name,row.base_amount,row.amount_due,total,row.status,weeks>1?'PAID_MULTI':'PAID',i.user.id,now);
   const cash=addToCash(total,i.user.id);
   return i.reply({embeds:[new EmbedBuilder().setTitle('💸 Wochenabgabe bezahlt').setDescription('Die Wochenabgabe wurde erfolgreich verbucht.').addFields(
    {name:'👤 Mitarbeiter',value:`<@${u.id}>`,inline:true},
    {name:'💵 Zahlung',value:`**$${total.toLocaleString('de-DE')}**`,inline:true},
    {name:'📆 Bezahlte Wochen',value:`**${weeks}**`,inline:true},
    {name:'⏩ Davon vorausbezahlt',value:`**${futureWeeks}**`,inline:true},
    {name:'🏦 Neuer Kassenstand',value:`**$${cash.after.toLocaleString('de-DE')}**`,inline:true},
    {name:'🎖️ Rang',value:row.rank_name||'—',inline:true},
    {name:'🛠️ Verbucht durch',value:`<@${i.user.id}>`,inline:true}
   ).setFooter({text:'Wochenabgaben • Zahlung automatisch der Fraktionskasse gutgeschrieben'}).setTimestamp()]});
  }
  if(sub==='aktualisieren'){
   rollWeeklyDues(i.user.id);
   return i.reply({embeds:[new EmbedBuilder().setTitle('🔄 Neue Abgabenwoche').setDescription('Die Wochenabgaben wurden erfolgreich aktualisiert.').addFields(
    {name:'✅ Bezahlt',value:'Starten wieder mit dem regulären Wochenbetrag.'},
    {name:'⚠️ Nicht bezahlt',value:'Der bisher offene Betrag wurde **verdoppelt** und übernommen.'},
    {name:'📆 Zeitraum',value:'Die neue Abgabenperiode läuft wieder von **Freitag bis Freitag**.'}
   ).setFooter({text:'Wochenabgaben • Aktualisierung abgeschlossen'}).setTimestamp()]});
  }
  const rows=db.prepare(`SELECT w.*,COALESCE(e.display_name,w.discord_id) display_name FROM weekly_dues w LEFT JOIN employees e ON e.discord_id=w.discord_id WHERE w.status='OPEN' ORDER BY w.amount_due DESC,display_name`).all();
  return i.reply({embeds:[new EmbedBuilder().setTitle('💰 Offene Wochenabgaben').setDescription(rows.length?rows.map(r=>`👤 <@${r.discord_id}>\n↳ 💵 **$${Number(r.amount_due).toLocaleString('de-DE')}** · 🎖️ ${r.rank_name}`).join('\n\n').slice(0,4000):'✅ Aktuell sind **keine Wochenabgaben offen**.').setFooter({text:`Wochenabgaben • ${rows.length} offene Zahlung(en)`}).setTimestamp()],flags:MessageFlags.Ephemeral});
 }
};