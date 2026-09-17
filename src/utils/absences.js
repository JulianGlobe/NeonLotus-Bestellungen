import db from '../database.js';

export function parseGermanDate(value,endOfDay=false){
 const m=String(value||'').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
 if(!m)return null;
 const d=Number(m[1]),mo=Number(m[2]),y=Number(m[3]);
 const date=new Date(y,mo-1,d,endOfDay?23:0,endOfDay?59:0,endOfDay?59:0,endOfDay?999:0);
 return date.getFullYear()===y&&date.getMonth()===mo-1&&date.getDate()===d?date:null;
}
export function isAbsenceActive(row,now=new Date()){
 const from=parseGermanDate(row.date_from),to=parseGermanDate(row.date_to,true);
 return !!from&&!!to&&row.status!=='REVOKED'&&from<=now&&to>=now;
}
export async function syncAbsenceRoleForUser(client,config,discordId){
 const guild=client.guilds.cache.get(config.guilds?.sakura?.id);
 const roleId=config.guilds?.sakura?.roles?.abgemeldet;
 if(!guild||!roleId)return;
 let member;try{member=await guild.members.fetch(discordId);}catch{return;}
 // COALESCE ist wichtig: ältere Abmeldungen können status=NULL haben.
 // SQL `NULL != 'REVOKED'` ist nicht TRUE und würde solche aktiven Einträge
 // fälschlich aus der Prüfung ausschließen.
 const rows=db.prepare(`
  SELECT *
  FROM absences
  WHERE discord_id=?
    AND COALESCE(status,'ACTIVE')!='REVOKED'
 `).all(discordId);
 const active=rows.some(r=>isAbsenceActive(r));
 await member.fetch(true);
 if(active&&!member.roles.cache.has(roleId))await member.roles.add(roleId,'Abmeldung aktiv');
 if(!active&&member.roles.cache.has(roleId))await member.roles.remove(roleId,'Abmeldung revidiert/beendet');
 await member.fetch(true);
 if(!active&&member.roles.cache.has(roleId)){
  throw new Error(`Abgemeldet-Rolle (${roleId}) konnte bei ${discordId} nicht entfernt werden.`);
 }
}
export async function syncAllAbsenceRoles(client,config){
 const ids=db.prepare(`SELECT DISTINCT discord_id FROM absences`).all();
 for(const row of ids){
  try{await syncAbsenceRoleForUser(client,config,row.discord_id);}
  catch(e){console.error(`❌ Abmeldung-Sync ${row.discord_id}:`,e);}
 }
}
