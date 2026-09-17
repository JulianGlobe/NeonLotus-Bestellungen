import db from '../database.js';

export function getCurrentCash(){
  return db.prepare(`
    SELECT * FROM cash_updates
    WHERE COALESCE(status,'ACTIVE')!='REVOKED'
    ORDER BY id DESC LIMIT 1
  `).get();
}

export function addToCash(amount, performedBy){
  const value=Number(amount||0);
  if(value<=0) throw new Error('Kassenbetrag muss größer als 0 sein.');
  const transaction=db.transaction(()=>{
    const current=getCurrentCash();
    const before=Number(current?.amount||0);
    const after=before+value;
    const result=db.prepare(`
      INSERT INTO cash_updates(amount,performed_by,created_at,status)
      VALUES(?,?,?,'ACTIVE')
    `).run(after,performedBy,new Date().toISOString());
    return {before,after,added:value,id:result.lastInsertRowid};
  });
  return transaction();
}


export function adjustCash(delta, performedBy){
  const value=Number(delta||0);
  if(!Number.isFinite(value)||value===0) throw new Error('Kassenänderung darf nicht 0 sein.');
  const transaction=db.transaction(()=>{
    const current=getCurrentCash();
    const before=Number(current?.amount||0);
    const after=before+value;
    if(after<0) throw new Error('Der Kassenstand kann nicht negativ werden.');
    const result=db.prepare(`
      INSERT INTO cash_updates(amount,performed_by,created_at,status)
      VALUES(?,?,?,'ACTIVE')
    `).run(after,performedBy,new Date().toISOString());
    return {before,after,difference:value,id:result.lastInsertRowid};
  });
  return transaction();
}
