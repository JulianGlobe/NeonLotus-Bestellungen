import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig } from '../utils/personnel.js';
import { isSakuraGuild, hasSakuraPersonnelPermission } from '../utils/multiguild.js';
import { parseGermanDate, syncAbsenceRoleForUser } from '../utils/absences.js';

export default {
  data:new SlashCommandBuilder()
    .setName('abmeldung-import')
    .setDescription('TEMPORÄR: Importiert eine bestehende Abmeldung.')
    .addUserOption(o=>o.setName('person').setDescription('Mitarbeiter').setRequired(true))
    .addStringOption(o=>o.setName('von').setDescription('TT.MM.JJJJ').setRequired(true))
    .addStringOption(o=>o.setName('bis').setDescription('TT.MM.JJJJ').setRequired(true))
    .addStringOption(o=>o.setName('grund').setDescription('Optionaler ursprünglicher Grund').setRequired(false)),

  async execute(i){
    const c=loadConfig();
    if(!isSakuraGuild(i.guildId,c))return i.reply({content:'❌ Dieser Import ist nur auf dem Sakura-Hauptdiscord verfügbar.',flags:MessageFlags.Ephemeral});
    if(!(await hasSakuraPersonnelPermission(i,c)))return i.reply({content:'❌ Der Import ist erst ab Ausbilder/Führungsebene verfügbar.',flags:MessageFlags.Ephemeral});

    const person=i.options.getUser('person');
    const from=i.options.getString('von').trim(),to=i.options.getString('bis').trim();
    const reason=i.options.getString('grund')?.trim()||'Bestandsimport – bestehende Abmeldung';
    const fromDate=parseGermanDate(from),toDate=parseGermanDate(to,true);
    if(!fromDate||!toDate)return i.reply({content:'❌ Bitte das Format `TT.MM.JJJJ` verwenden.',flags:MessageFlags.Ephemeral});
    if(toDate<fromDate)return i.reply({content:'❌ Das Enddatum darf nicht vor dem Startdatum liegen.',flags:MessageFlags.Ephemeral});

    const duplicate=db.prepare(`SELECT id FROM absences WHERE discord_id=? AND date_from=? AND date_to=? AND COALESCE(status,'ACTIVE')!='REVOKED'`).get(person.id,from,to);
    if(duplicate)return i.reply({content:`⚠️ Diese Abmeldung ist bereits als **#${duplicate.id}** vorhanden. Es wurde nichts doppelt importiert.`,flags:MessageFlags.Ephemeral});

    const now=new Date().toISOString();
    const result=db.prepare(`INSERT INTO absences(discord_id,date_from,date_to,reason,created_at,created_by) VALUES(?,?,?,?,?,?)`).run(person.id,from,to,reason,now,i.user.id);
    await syncAbsenceRoleForUser(i.client,c,person.id);

    return i.reply({embeds:[new EmbedBuilder().setTitle('📥 Abmeldung importiert').addFields(
      {name:'Person',value:`<@${person.id}>`,inline:true},
      {name:'Zeitraum',value:`${from} – ${to}`,inline:true},
      {name:'Grund',value:reason},
      {name:'Abmeldungs-ID',value:`#${result.lastInsertRowid}`,inline:true}
    ).setFooter({text:'Bestandsimport • Rolle automatisch synchronisiert'}).setTimestamp()],flags:MessageFlags.Ephemeral});
  }
};
