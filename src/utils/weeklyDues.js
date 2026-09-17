import db from '../database.js';

const FREE_RANKS = new Set(['Manager','Stv. Inhaber','Boss']);
const FIFTY_RANKS = new Set(['Ausbilder','Stv. Werkstattleiter*in','Werkstattleiter*in','Teamleiter']);

function germanDateToLocal(value){
  const m=String(value||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(!m)return null;
  return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),12,0,0,0);
}

function fridayDeadline(cycle){
  const friday=germanDateToLocal(cycle.start);
  if(!friday)return null;
  const deadline=new Date(friday);
  deadline.setDate(deadline.getDate()-3);
  deadline.setHours(23,59,59,999);
  return deadline;
}

export function isManuallyDuesExempt(discordId){
  return !!db.prepare(`SELECT 1 FROM employee_labels WHERE discord_id=? AND label='dues_exempt'`).get(discordId);
}

export function isAbsentOnFriday(discordId,cycle=getFridayCycle()){
  const friday=germanDateToLocal(cycle.start);
  const deadline=fridayDeadline(cycle);
  if(!friday||!deadline)return false;

  // Für die Wochenabgaben zählt auch eine bereits rechtzeitig gemeldete
  // Abmeldung, die am Mittwoch oder Donnerstag unmittelbar vor der
  // Freitags-Aufstellung noch läuft. Beispiel: Freitag bis Donnerstag
  // abgemeldet => am darauffolgenden Freitag abgabenbefreit.
  //
  // Die bestehende Meldefrist bleibt unverändert: Wird die Abmeldung erst
  // Mittwoch/Donnerstag neu eingetragen, entsteht dadurch keine Befreiung.
  const wednesday=new Date(friday);
  wednesday.setDate(wednesday.getDate()-2);

  const rows=db.prepare(`
    SELECT date_from,date_to,status,created_at
    FROM absences
    WHERE discord_id=?
      AND COALESCE(status,'ACTIVE')!='REVOKED'
  `).all(discordId);

  return rows.some(row=>{
    const from=germanDateToLocal(row.date_from),to=germanDateToLocal(row.date_to);
    const createdAt=row.created_at?new Date(row.created_at):null;
    return from&&to&&createdAt&&!Number.isNaN(createdAt.getTime())
      &&from<=friday
      &&to>=wednesday
      &&createdAt<=deadline;
  });
}

export function isDuesExempt(discordId,cycle=getFridayCycle()){
  return isManuallyDuesExempt(discordId)||isAbsentOnFriday(discordId,cycle);
}

export function weeklyBaseForRank(rankName){
  if(FREE_RANKS.has(rankName)) return 0;
  if(FIFTY_RANKS.has(rankName)) return 50000;
  return 100000;
}

export function getFridayCycle(now=new Date()){
  const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const daysSinceFriday=(d.getDay()-5+7)%7;
  const start=new Date(d); start.setDate(d.getDate()-daysSinceFriday);
  const end=new Date(start); end.setDate(start.getDate()+7);
  const fmt=x=>`${String(x.getDate()).padStart(2,'0')}.${String(x.getMonth()+1).padStart(2,'0')}.${x.getFullYear()}`;
  return {start:fmt(start),end:fmt(end)};
}

export function currentSakuraPersonnel(){
  return db.prepare(`
    SELECT e.discord_id,er.rank_name,COALESCE(e.display_name,e.discord_id) AS display_name
    FROM employees e
    JOIN employee_ranks er
      ON er.discord_id=e.discord_id AND er.active=1
     AND er.joined_at=(SELECT MAX(er2.joined_at) FROM employee_ranks er2 WHERE er2.discord_id=e.discord_id AND er2.active=1)
    WHERE e.active=1
    ORDER BY display_name COLLATE NOCASE
  `).all();
}

export function ensureWeeklyDues(){
  const cycle=getFridayCycle();
  for(const p of currentSakuraPersonnel()){
    const existing=db.prepare(`SELECT * FROM weekly_dues WHERE discord_id=?`).get(p.discord_id);
    const exempt=isDuesExempt(p.discord_id,cycle);
    const regularBase=weeklyBaseForRank(p.rank_name);

    if(regularBase===0){
      db.prepare(`DELETE FROM weekly_dues WHERE discord_id=?`).run(p.discord_id);
      continue;
    }

    if(exempt){
      if(existing&&Number(existing.prepaid_weeks||0)>0){
        db.prepare(`UPDATE weekly_dues SET base_amount=?,amount_due=0,status='PAID',cycle_start=?,cycle_end=?,rank_name=?,updated_at=? WHERE discord_id=?`)
          .run(regularBase,cycle.start,cycle.end,p.rank_name,new Date().toISOString(),p.discord_id);
      }else{
        db.prepare(`DELETE FROM weekly_dues WHERE discord_id=?`).run(p.discord_id);
      }
      continue;
    }

    db.prepare(`
      INSERT INTO weekly_dues(discord_id,base_amount,amount_due,status,cycle_start,cycle_end,rank_name,updated_at)
      VALUES(?,?,?,'OPEN',?,?,?,?)
      ON CONFLICT(discord_id) DO UPDATE SET base_amount=excluded.base_amount,rank_name=excluded.rank_name
    `).run(p.discord_id,regularBase,regularBase,cycle.start,cycle.end,p.rank_name,new Date().toISOString());
  }
}

export function rollWeeklyDues(performedBy){
  ensureWeeklyDues();
  const now=new Date().toISOString(),cycle=getFridayCycle();
  const rows=db.prepare(`SELECT * FROM weekly_dues`).all();
  const active=new Map(currentSakuraPersonnel().map(p=>[p.discord_id,p]));
  const transaction=db.transaction(()=>{
    for(const row of rows){
      const p=active.get(row.discord_id);
      if(!p){db.prepare(`DELETE FROM weekly_dues WHERE discord_id=?`).run(row.discord_id);continue;}
      const regularBase=weeklyBaseForRank(p.rank_name);
      if(regularBase===0){db.prepare(`DELETE FROM weekly_dues WHERE discord_id=?`).run(row.discord_id);continue;}

      const exempt=isDuesExempt(p.discord_id,cycle);
      const before=Number(row.amount_due),prepaid=Math.max(0,Number(row.prepaid_weeks||0));

      if(exempt){
        db.prepare(`INSERT INTO weekly_dues_history(discord_id,rank_name,base_amount,amount_before,amount_after,previous_status,action,performed_by,created_at) VALUES(?,?,?,?,?,?, 'ROLL_EXEMPT',?,?)`)
          .run(row.discord_id,p.rank_name,regularBase,before,0,row.status,performedBy,now);
        if(prepaid>0){
          db.prepare(`UPDATE weekly_dues SET base_amount=?,amount_due=0,status='PAID',cycle_start=?,cycle_end=?,rank_name=?,paid_by=NULL,paid_at=NULL,updated_at=?,prepaid_weeks=? WHERE discord_id=?`)
            .run(regularBase,cycle.start,cycle.end,p.rank_name,now,prepaid,row.discord_id);
        }else{
          db.prepare(`DELETE FROM weekly_dues WHERE discord_id=?`).run(row.discord_id);
        }
        continue;
      }

      const covered=row.status==='PAID'||prepaid>0;
      const after=covered?regularBase:Math.max(regularBase,before*2);
      const nextPrepaid=prepaid>0?prepaid-1:0;
      db.prepare(`INSERT INTO weekly_dues_history(discord_id,rank_name,base_amount,amount_before,amount_after,previous_status,action,performed_by,created_at) VALUES(?,?,?,?,?,?, 'ROLL',?,?)`)
        .run(row.discord_id,p.rank_name,regularBase,before,after,row.status,performedBy,now);
      db.prepare(`UPDATE weekly_dues SET base_amount=?,amount_due=?,status=?,cycle_start=?,cycle_end=?,rank_name=?,paid_by=NULL,paid_at=NULL,updated_at=?,prepaid_weeks=? WHERE discord_id=?`)
        .run(regularBase,after,nextPrepaid>0?'PAID':'OPEN',cycle.start,cycle.end,p.rank_name,now,nextPrepaid,row.discord_id);
    }
  });
  transaction();
}
