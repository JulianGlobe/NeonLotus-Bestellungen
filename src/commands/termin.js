import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig, hasManagementPermission } from '../utils/personnel.js';

async function finish(interaction, invitation, personId) {
  const completedAt=new Date().toISOString();
  db.prepare(`UPDATE meeting_invitations SET status='COMPLETED',completed_by=?,completed_at=? WHERE id=?`)
    .run(interaction.user.id,completedAt,invitation.id);

  if(invitation.thread_id){
    try{
      const thread=await interaction.guild.channels.fetch(invitation.thread_id);
      if(thread?.isThread()) await thread.setArchived(true,'Gespräch abgeschlossen');
    }catch(error){console.error('Termin-Thread konnte nicht archiviert werden:',error);}
  }

  await interaction.reply({
    embeds:[new EmbedBuilder()
      .setTitle('✅ Gespräch abgeschlossen')
      .setDescription(`Das Gespräch **#${invitation.id}** von <@${personId}> wurde als **abgeschlossen** markiert.`)
      .addFields(
        {name:'Anlass',value:invitation.reason||'—'},
        {name:'Abgeschlossen durch',value:`<@${interaction.user.id}>`}
      ).setTimestamp()],
    flags:MessageFlags.Ephemeral
  });
}

export default {
 data:new SlashCommandBuilder().setName('termin').setDescription('Verwaltet Gesprächseinladungen.')
  .addSubcommand(s=>s.setName('abgeschlossen').setDescription('Markiert eine Gesprächseinladung als abgeschlossen.')
    .addUserOption(o=>o.setName('person').setDescription('Person').setRequired(true))
    .addIntegerOption(o=>o.setName('id').setDescription('Optional: konkrete Gesprächs-ID').setRequired(false).setMinValue(1))),
 async execute(interaction){
  const config=loadConfig();
  if(!(await hasManagementPermission(interaction,config)))return interaction.reply({content:'❌ Du hast keine Berechtigung für die Terminverwaltung.',flags:MessageFlags.Ephemeral});

  const person=interaction.options.getUser('person');
  const requestedId=interaction.options.getInteger('id');
  const rows=db.prepare(`SELECT * FROM meeting_invitations WHERE discord_id=? AND COALESCE(status,'OPEN')='OPEN' ORDER BY id DESC`).all(person.id);

  if(!rows.length)return interaction.reply({content:`ℹ️ Für <@${person.id}> gibt es aktuell keine offene Gesprächseinladung.`,flags:MessageFlags.Ephemeral});

  if(requestedId){
    const invitation=rows.find(x=>Number(x.id)===Number(requestedId));
    if(!invitation)return interaction.reply({content:`❌ Gespräch **#${requestedId}** ist für <@${person.id}> nicht offen.`,flags:MessageFlags.Ephemeral});
    return finish(interaction,invitation,person.id);
  }

  if(rows.length>1){
    const lines=rows.slice(0,20).map(x=>`**#${x.id}** — ${x.reason||'Gespräch'}`).join('\n');
    return interaction.reply({
      embeds:[new EmbedBuilder().setTitle('📅 Mehrere offene Gespräche').setDescription(`Für <@${person.id}> gibt es **${rows.length}** offene Gesprächseinladungen.\n\n${lines}\n\nNutze beim Befehl zusätzlich die **ID** des Gesprächs, das abgeschlossen werden soll.`)],
      flags:MessageFlags.Ephemeral
    });
  }
  return finish(interaction,rows[0],person.id);
 }
};
