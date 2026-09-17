import db from '../database.js';

const NOTIFICATION_KEY='LEHRLING_TUNER_PRUEFUNG_5_TAGE';
const ANNOUNCEMENT_CHANNEL_ID='1096402401898008621';
const LEADERSHIP_TICKET_CHANNEL_ID='1096406532146606120';
const FIVE_DAYS_MS=5*24*60*60*1000;

export async function processApprenticeExamReminders(client,config){
  const guildId=config.guilds?.sakura?.id;
  if(!guildId)return 0;
  const rows=db.prepare(`
    SELECT e.discord_id,er.joined_at
    FROM employees e
    JOIN employee_ranks er ON er.discord_id=e.discord_id
    WHERE e.active=1 AND er.active=1 AND er.rank_name='Lehrling' AND er.joined_at IS NOT NULL
      AND NOT EXISTS(
        SELECT 1 FROM employee_notifications n
        WHERE n.discord_id=e.discord_id AND n.notification_key=?
      )
  `).all(NOTIFICATION_KEY);

  const due=rows.filter(row=>{
    const joined=new Date(row.joined_at);
    return !Number.isNaN(joined.getTime())&&Date.now()-joined.getTime()>=FIVE_DAYS_MS;
  });
  if(!due.length)return 0;

  const guild=await client.guilds.fetch(guildId);
  const channel=await guild.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
  if(!channel?.isTextBased())throw new Error(`Tunerprüfungs-Channel ${ANNOUNCEMENT_CHANNEL_ID} ist nicht erreichbar.`);

  let sent=0;
  for(const row of due){
    const stillApprentice=db.prepare(`
      SELECT 1 FROM employees e JOIN employee_ranks er ON er.discord_id=e.discord_id
      WHERE e.discord_id=? AND e.active=1 AND er.active=1 AND er.rank_name='Lehrling'
    `).get(row.discord_id);
    if(!stillApprentice)continue;

    await channel.send(`<@${row.discord_id}> du bist nun seit **5 Tagen als Lehrling** angestellt und kannst deine **Tunerprüfung** absolvieren.\nEröffne hierzu bitte ein **Führungsebenenticket** in <#${LEADERSHIP_TICKET_CHANNEL_ID}>.`);
    db.prepare(`INSERT OR IGNORE INTO employee_notifications(discord_id,notification_key,sent_at) VALUES(?,?,?)`)
      .run(row.discord_id,NOTIFICATION_KEY,new Date().toISOString());
    sent++;
  }
  return sent;
}
