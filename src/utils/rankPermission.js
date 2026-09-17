export async function canManageRankTarget(interaction,config,targetUserId,targetFrameworkRank=null){
  const roles=config.guilds.sakura.roles;
  const guild=interaction.guild;
  const actor=await guild.members.fetch(interaction.user.id);
  if(actor.permissions.has('Administrator'))return {ok:true};

  const target=await guild.members.fetch(targetUserId).catch(()=>null);
  if(!target)return {ok:false,message:'❌ Die Zielperson wurde auf dem Sakura-Hauptdiscord nicht gefunden.'};

  const ranks=config.frameworkRanks||[];
  const actorRank=[...ranks].sort((a,b)=>b.position-a.position).find(r=>roles[r.key]&&actor.roles.cache.has(roles[r.key]));
  const targetRank=[...ranks].sort((a,b)=>b.position-a.position).find(r=>roles[r.key]&&target.roles.cache.has(roles[r.key]));
  if(!actorRank)return {ok:false,message:'❌ Dein eigener Framework-Rang konnte nicht erkannt werden.'};
  if(!targetRank)return {ok:false,message:'❌ Der aktuelle Framework-Rang der Zielperson konnte nicht erkannt werden.'};

  if(Number(targetRank.position)>=Number(actorRank.position)){
    return {ok:false,message:`❌ Du kannst nur Personen befördern/degradieren, die mindestens **einen Framework-Rang unter dir** stehen. Dein Rang: **${actorRank.name}**, Zielperson: **${targetRank.name}**.`};
  }
  if(targetFrameworkRank&&Number(targetFrameworkRank.position)>Number(actorRank.position)){
    return {ok:false,message:`❌ Du kannst keine Person auf einen Rang über deinem eigenen Framework-Rang (**${actorRank.name}**) setzen.`};
  }
  return {ok:true,actorRank,targetRank};
}
