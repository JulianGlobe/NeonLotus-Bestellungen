import db from '../database.js';
import { getSanctionDeadline } from './sanctions.js';

const CHANNEL_ID='1096402401898008621';
const PREFIX='SANKTION_24H_REMINDER';

function berlinHour(now=new Date()){
  const h=new Intl.DateTimeFormat('de-DE',{
    timeZone:'Europe/Berlin',hour:'2-digit',hour12:false
  }).format(now);
  return Number(h);
}

function money(value){
  return `$${Number(value||0).toLocaleString('de-DE')}`;
}

export async function processSanctionPaymentReminders(client,config){
  // Reminder frühestens ab 15 Uhr deutscher Zeit.
  if(berlinHour()<15)return 0;

  const now=Date.now();
  const rows=db.prepare(`
    SELECT s.*,COALESCE(e.active,0) AS employee_active
    FROM sanctions s
    LEFT JOIN employees e ON e.discord_id=s.discord_id
    WHERE s.status='OPEN'
      AND COALESCE(e.active,0)=1
  `).all();

  const due=[];
  for(const row of rows){
    const level=Number(row.escalation_level||0);
    // Nur die beiden Verdoppelungsfristen erinnern. Ab Stufe 2 gibt es keine
    // weitere Verdoppelung mehr, sondern später ggf. Kündigung ausstehend.
    if(level>=2)continue;

    const deadline=getSanctionDeadline(
      row.created_at,
      level,
      Number(row.deadline_extension_days||0)
    );
    const remaining=deadline.getTime()-now;
    if(remaining<=0 || remaining>24*60*60*1000)continue;

    const key=`${PREFIX}:${row.id}:LEVEL_${level}:DEADLINE_${deadline.toISOString()}`;
    const sent=db.prepare(`
      SELECT 1 FROM employee_notifications
      WHERE discord_id=? AND notification_key=?
    `).get(row.discord_id,key);
    if(!sent)due.push({row,deadline,key});
  }

  if(!due.length)return 0;

  const guild=await client.guilds.fetch(config.guilds.sakura.id);
  const channel=await guild.channels.fetch(CHANNEL_ID);
  if(!channel?.isTextBased())throw new Error(`Sanktions-Reminder-Channel ${CHANNEL_ID} ist nicht erreichbar.`);

  let count=0;
  for(const {row,deadline,key} of due){
    const nextAmount=Number(row.amount||0)*2;
    const deadlineText=deadline.toLocaleString('de-DE',{
      timeZone:'Europe/Berlin',
      day:'2-digit',month:'2-digit',year:'numeric',
      hour:'2-digit',minute:'2-digit'
    });
    await channel.send(
      `<@${row.discord_id}> Erinnerung: Deine **Sanktion #${row.id}** über **${money(row.amount)}** `+
      `muss bis **${deadlineText} Uhr** bezahlt werden. Danach erhöht sich der offene Betrag auf **${money(nextAmount)}**.`
    );
    db.prepare(`
      INSERT OR IGNORE INTO employee_notifications(discord_id,notification_key,sent_at)
      VALUES(?,?,?)
    `).run(row.discord_id,key,new Date().toISOString());
    count++;
  }
  return count;
}
