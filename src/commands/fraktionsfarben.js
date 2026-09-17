import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { loadConfig } from '../utils/personnel.js';
import { isSakuraGuild, hasSakuraPersonnelPermission } from '../utils/multiguild.js';
import { addToCash } from '../utils/cash.js';

async function allowed(i,c){
  return hasSakuraPersonnelPermission(i,c);
}

const text=(o,n,d,required=false)=>o.setName(n).setDescription(d).setRequired(required);

export default {
  data:new SlashCommandBuilder()
    .setName('fraktionsfarben')
    .setDescription('Postet die Fahrzeugfarben einer Fraktion.')
    .addStringOption(o=>text(o,'fraktion','Name der Fraktion',true))
    .addStringOption(o=>text(o,'primaerfarbe','Primärfarbe / Farbcode',true))
    .addStringOption(o=>text(o,'primaerlack','Lackart der Primärfarbe, z. B. Matt oder Hochglanz',true))
    .addStringOption(o=>text(o,'sekundaerfarbe','Sekundärfarbe / Farbcode',true))
    .addStringOption(o=>text(o,'sekundaerlack','Lackart der Sekundärfarbe, z. B. Matt oder Hochglanz',true))
    .addStringOption(o=>text(o,'perlglanz','Perlglanz / Farbcode'))
    .addStringOption(o=>text(o,'unterboden','Unterbodenbeleuchtung / Farbe'))
    .addStringOption(o=>text(o,'scheinwerfer','Scheinwerferfarbe'))
    .addStringOption(o=>text(o,'reifenqualm','Reifenqualm / Reifenfarbe'))
    .addStringOption(o=>text(o,'felgenfarbe','Felgenfarbe / Farbcode')),
  async execute(i){
    const c=loadConfig();
    if(!isSakuraGuild(i.guildId,c)) return i.reply({content:'❌ Dieser Befehl ist nur auf dem Sakura-Discord verfügbar.',flags:MessageFlags.Ephemeral});
    if(!(await allowed(i,c))) return i.reply({content:'❌ Fraktionsfarben können ausschließlich **ab Ausbilder** eingetragen werden.',flags:MessageFlags.Ephemeral});
    const channelId=c.guilds.sakura.channels.fraktionsfarben;
    if(i.channelId!==channelId) return i.reply({content:`❌ Dieser Befehl darf ausschließlich in <#${channelId}> verwendet werden.`,flags:MessageFlags.Ephemeral});

    const g=n=>i.options.getString(n);
    const fraktion=g('fraktion');
    const optional=(label,name,emoji)=>g(name)?{name:`${emoji} ${label}`,value:`${g(name)}`,inline:true}:null;
    const fields=[
      {name:'🎨 Primärfarbe',value:`**Farbcode:** ${g('primaerfarbe')}\n**Lackart:** ${g('primaerlack')}`,inline:true},
      {name:'🎨 Sekundärfarbe',value:`**Farbcode:** ${g('sekundaerfarbe')}\n**Lackart:** ${g('sekundaerlack')}`,inline:true},
      optional('Perlglanz','perlglanz','✨'),
      optional('Unterboden','unterboden','💡'),
      optional('Scheinwerfer','scheinwerfer','🔦'),
      optional('Reifenqualm','reifenqualm','💨'),
      optional('Felgenfarbe','felgenfarbe','🛞')
    ].filter(Boolean);

    const embed=new EmbedBuilder()
      .setTitle(`🎨 Fraktionsfarben • ${fraktion}`)
      .setDescription('Offiziell hinterlegte Fahrzeugfarben der Fraktion.')
      .addFields(fields)
      .setFooter({text:`Fraktionsfarben • Eingetragen durch ${i.user.username}`})
      .setTimestamp();

    const cash=addToCash(50000,i.user.id);
    embed.addFields({name:'💰 Eintragungsgebühr',value:'**$50.000** wurden automatisch der Fraktionskasse gutgeschrieben.',inline:false});
    embed.setFooter({text:`Fraktionsfarben • Eingetragen durch ${i.user.username} • Kassenstand $${cash.after.toLocaleString('de-DE')}`});
    await i.reply({embeds:[embed],allowedMentions:{parse:[]}});
  }
};
