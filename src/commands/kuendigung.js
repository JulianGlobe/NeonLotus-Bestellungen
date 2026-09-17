import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import db from '../database.js';
import { loadConfig, hasPersonnelPermission } from '../utils/personnel.js';
import { isSakuraGuild, hasSakuraPersonnelPermission, checkSakuraChannel, terminateSakura } from '../utils/multiguild.js';

async function removeRoleIds(member,ids){
  const removable=[...new Set(ids.filter(Boolean))].filter(id=>member.roles.cache.has(id));
  if(removable.length)await member.roles.remove(removable);
}

function lastRank(discordId){
  return db.prepare(`
    SELECT rank_name FROM employee_ranks
    WHERE discord_id=?
    ORDER BY active DESC, joined_at DESC
    LIMIT 1
  `).get(discordId)?.rank_name||null;
}

function openDebt(discordId){
  return Number(db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM sanctions WHERE discord_id=? AND status='OPEN'`).get(discordId)?.total||0);
}

export default {
  data:new SlashCommandBuilder()
    .setName('kündigung')
    .setDescription('Kündigt eine Person zentral aus Sakura, Neon Lotus und Blacklist.')
    .addUserOption(o=>o.setName('person').setDescription('Person').setRequired(true))
    .addStringOption(o=>o.setName('art').setDescription('Art der Kündigung').setRequired(false)
      .addChoices(
        {name:'Normale Kündigung',value:'NORMAL'},
        {name:'Kündigung mit Schulden',value:'DEBT'},
        {name:'Ersatzbank',value:'BENCH'}
      ))
    .addStringOption(o=>o.setName('grund').setDescription('Grund / Vermerk').setRequired(false)),

  async execute(i){
    const c=loadConfig(),main=isSakuraGuild(i.guildId,c);
    if(main&&!checkSakuraChannel(i,c,'termination'))return i.reply({content:`❌ Nur in <#${c.guilds.sakura.channels.termination}>.`,flags:MessageFlags.Ephemeral});
    if(!(main?await hasSakuraPersonnelPermission(i,c):await hasPersonnelPermission(i,c)))return i.reply({content:'❌ Keine Berechtigung.',flags:MessageFlags.Ephemeral});

    await i.deferReply();
    const u=i.options.getUser('person'),type=i.options.getString('art')||'NORMAL',reason=i.options.getString('grund')||null,now=new Date().toISOString();
    const rank=lastRank(u.id),debt=openDebt(u.id);

    const sg=await i.client.guilds.fetch(c.guilds.sakura.id).catch(()=>null);
    const sm=sg?await sg.members.fetch(u.id).catch(()=>null):null;
    if(sm)await terminateSakura(sm,c);

    let neon='Person nicht auf Neon Lotus.';
    const ng=await i.client.guilds.fetch(c.guilds.neon.id).catch(()=>null);
    const nm=ng?await ng.members.fetch(u.id).catch(()=>null):null;
    if(nm){
      const ids=[...(c.areas.neon?.removeOnTermination||[]).map(k=>c.roles[k]),c.roles.sakura_personal_trenner,c.roles.sakura_leitung_trenner,c.roles.sakura_mitarbeiter,c.roles.sakura_fuehrung,c.roles.sakura_leitung,c.roles.sakura_aushilfe];
      await removeRoleIds(nm,ids);neon='Neon-Lotus-Rollen entfernt.';
    }

    let blacklist='Person nicht auf Blacklist.';
    const bg=await i.client.guilds.fetch(c.guilds.blacklist.id).catch(()=>null);
    const bm=bg?await bg.members.fetch(u.id).catch(()=>null):null;
    if(bm){
      const ids=[c.roles.blacklist_nachwuchs,c.roles.blacklist_profi,c.roles.blacklist_manager,c.roles.blacklist_leitung,c.roles.blacklist_sakura_mitarbeiter,c.roles.blacklist_sakura_fuehrung,c.roles.blacklist_sakura_leitung,c.roles.blacklist_staatsbuerger];
      await removeRoleIds(bm,ids);blacklist='Blacklist-Rollen entfernt.';
    }

    db.transaction(()=>{
      db.prepare(`UPDATE employee_ranks SET active=0,left_at=? WHERE discord_id=? AND active=1`).run(now,u.id);
      db.prepare(`UPDATE employees SET active=0,left_at=? WHERE discord_id=?`).run(now,u.id);
      db.prepare(`UPDATE termination_records SET bench_active=0,bench_left_at=? WHERE discord_id=? AND bench_active=1`).run(now,u.id);
      db.prepare(`INSERT INTO termination_records(discord_id,termination_type,last_rank,note,debt_amount,terminated_by,terminated_at,bench_active) VALUES(?,?,?,?,?,?,?,?)`)
        .run(u.id,type,rank,reason,type==='DEBT'?debt:0,i.user.id,now,type==='BENCH'?1:0);
      db.prepare(`INSERT INTO personnel_actions(discord_id,action,area,old_rank,new_rank,performed_by,reason,created_at) VALUES(?,'KÜNDIGUNG','global',?,NULL,?,?,?)`)
        .run(u.id,rank,i.user.id,`${type==='DEBT'?'Kündigung mit Schulden':type==='BENCH'?'Ersatzbank':'Normale Kündigung'}${reason?` · ${reason}`:''}`,now);
    })();

    const typeLabel=type==='DEBT'?'Kündigung mit Schulden':type==='BENCH'?'Ersatzbank':'Normale Kündigung';
    const fields=[
      {name:'Art',value:typeLabel,inline:false},
      {name:'Letzter Rang',value:rank||'—',inline:true},
      {name:'Sakura',value:sm?'Hauptdiscord-Rollen entfernt.':'Person nicht auf Sakura.',inline:false},
      {name:'Neon Lotus',value:neon,inline:false},
      {name:'Blacklist',value:blacklist,inline:false},
      {name:type==='BENCH'?'Vermerk':'Grund',value:reason||'—',inline:false}
    ];
    if(type==='DEBT')fields.splice(2,0,{name:'Offene Schulden bei Kündigung',value:`$${debt.toLocaleString('de-DE')}`,inline:true});
    return i.editReply({embeds:[new EmbedBuilder().setTitle('🚪 Zentrale Kündigung').setDescription(`<@${u.id}> wurde zentral gekündigt.`).addFields(fields).setTimestamp()]});
  }
};
