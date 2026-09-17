import db from '../database.js';
import { ensureWeeklyDues } from './weeklyDues.js';

const CHANNEL_ID='1096402401898008621';
const REMINDER_KEY_PREFIX='WOCHENABGABEN_DONNERSTAG_15';

function localDateParts(now=new Date()){
  const parts=new Intl.DateTimeFormat('de-DE',{
    timeZone:'Europe/Berlin',
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hour12:false
  }).formatToParts(now);
  return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
}

function berlinWeekKey(now=new Date()){
  const parts=localDateParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function processWeeklyDuesThursdayReminder(client,config){
  const parts=localDateParts();
  const berlinNow=new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`);
  if(berlinNow.getDay()!==4)return 0; // Donnerstag
  if(Number(parts.hour)<15)return 0;

  const notificationKey=`${REMINDER_KEY_PREFIX}:${berlinWeekKey()}`;
  const alreadySent=db.prepare(`
    SELECT 1 FROM employee_notifications
    WHERE discord_id=? AND notification_key=?
  `);

  ensureWeeklyDues();

  const open=db.prepare(`
    SELECT wd.discord_id,wd.amount_due
    FROM weekly_dues wd
    JOIN employees e ON e.discord_id=wd.discord_id
    WHERE e.active=1
      AND wd.status='OPEN'
      AND wd.amount_due>0
  `).all().filter(row=>!alreadySent.get(row.discord_id,notificationKey));

  if(!open.length)return 0;

  const guild=await client.guilds.fetch(config.guilds.sakura.id);
  const channel=await guild.channels.fetch(CHANNEL_ID);
  if(!channel?.isTextBased())throw new Error(`Wochenabgaben-Reminder-Channel ${CHANNEL_ID} ist nicht erreichbar.`);

  let sent=0;
  for(const row of open){
    await channel.send(
      `<@${row.discord_id}> Erinnerung: Deine **Wochenabgaben** sind aktuell noch offen. `+
      `Bitte begleiche diese **bis morgen (Freitag) zur Aufstellung**.`
    );
    db.prepare(`
      INSERT OR IGNORE INTO employee_notifications(discord_id,notification_key,sent_at)
      VALUES(?,?,?)
    `).run(row.discord_id,notificationKey,new Date().toISOString());
    sent++;
  }
  return sent;
}
