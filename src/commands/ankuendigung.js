import {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits
} from 'discord.js';
import { hasSakuraPersonnelPermission } from '../utils/multiguild.js';

const AREAS={
  mitarbeiter:{
    label:'Normale Mitarbeiter',
    channelKey:'announcements',
    pingRoleKey:'sakura_mitarbeiter_base'
  },
  fuehrung:{
    label:'Führungsebene',
    channelKey:'announcements_leadership',
    pingRoleKey:'fuehrungsebene'
  },
  leitung:{
    label:'Leitungsebene',
    channelKey:'announcements_management',
    pingRoleKey:'leitungsebene'
  }
};

async function allowed(i,c){
  return hasSakuraPersonnelPermission(i,c);
}

export default {
  data:new SlashCommandBuilder()
    .setName('ankündigung')
    .setDescription('Veröffentlicht eine Ankündigung im ausgewählten Personalbereich.')
    .addStringOption(o=>o.setName('bereich').setDescription('Ankündigungsbereich').setRequired(true)
      .addChoices(
        {name:'👥 Normale Mitarbeiter',value:'mitarbeiter'},
        {name:'🧭 Führungsebene',value:'fuehrung'},
        {name:'👑 Leitungsebene',value:'leitung'}
      ))
    .addStringOption(o=>o.setName('titel').setDescription('Titel der Ankündigung').setRequired(true))
    .addStringOption(o=>o.setName('text').setDescription('Text der Ankündigung').setRequired(true)),

  async execute(i,c){
    if(i.guildId!==c.guilds.sakura.id)return i.reply({content:'❌ Dieser Befehl ist nur auf dem Sakura-Hauptdiscord verfügbar.',flags:MessageFlags.Ephemeral});
    if(!(await allowed(i,c)))return i.reply({content:'❌ Keine Berechtigung.',flags:MessageFlags.Ephemeral});

    const areaKey=i.options.getString('bereich');
    const area=AREAS[areaKey];
    if(!area)return i.reply({content:'❌ Ungültiger Ankündigungsbereich.',flags:MessageFlags.Ephemeral});

    const channelId=c.guilds.sakura.channels[area.channelKey];
    const roleId=c.guilds.sakura.roles[area.pingRoleKey];
    const channel=await i.guild.channels.fetch(channelId).catch(()=>null);
    if(!channel?.isTextBased())return i.reply({content:`❌ Der Ankündigungschannel für **${area.label}** wurde nicht gefunden.`,flags:MessageFlags.Ephemeral});
    if(!roleId)return i.reply({content:`❌ Die Ping-Rolle für **${area.label}** ist nicht konfiguriert.`,flags:MessageFlags.Ephemeral});

    const title=i.options.getString('titel');
    const text=i.options.getString('text');
    await channel.send({
      content:`<@&${roleId}>`,
      allowedMentions:{roles:[roleId]},
      embeds:[new EmbedBuilder()
        .setTitle(`📢 ${title}`)
        .setDescription(text)
        .addFields({name:'Bereich',value:area.label,inline:true})
        .setFooter({text:`Sakura Performance • Ankündigung von ${i.user.username}`})
        .setTimestamp()]
    });
    return i.reply({content:`✅ Ankündigung wurde in <#${channelId}> veröffentlicht und <@&${roleId}> gepingt.`,allowedMentions:{parse:[]},flags:MessageFlags.Ephemeral});
  }
};
