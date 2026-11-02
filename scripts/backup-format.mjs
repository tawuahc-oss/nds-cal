import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
export const calendarTables=['categories','events','recurrence_rules','event_exceptions'];
export function calendarBackup(tables){
  return {format:'nds-cal-export',version:1,timezone:'Asia/Hong_Kong',exported_at:new Date().toISOString(),
    tables:Object.fromEntries(calendarTables.map(t=>[t,tables[t]||[]]))};
}
export async function restoreCheck(snapshot){
  if(snapshot.format!=='nds-cal-export'||snapshot.version!==1)throw Error('Unsupported backup format');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(await readFile(new URL('../docs/schema.sql',import.meta.url),'utf8'));
    db.exec('PRAGMA foreign_keys=ON; BEGIN');
    for(const table of calendarTables){
      const allowed=new Set(db.prepare('PRAGMA table_info("'+table+'")').all().map(c=>c.name));
      const rows=snapshot.tables[table];
      if(!Array.isArray(rows))throw Error('Missing backup table '+table);
      for(const row of rows){
        const columns=Object.keys(row);
        if(!columns.length||columns.some(c=>!allowed.has(c)))throw Error('Unknown columns in '+table);
        const sql='INSERT INTO "'+table+'" ('+columns.map(c=>'"'+c+'"').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')';
        db.prepare(sql).run(...columns.map(c=>row[c]));
      }
    }
    db.exec('COMMIT');
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Backup foreign key check failed');
    const counts=Object.fromEntries(calendarTables.map(t=>[t,db.prepare('SELECT COUNT(*) n FROM '+t).get().n]));
    const quote=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
    let sql='-- NDS full calendar data; authentication and security audit data deliberately excluded.\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n';
    const schema=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").all();
    for(const record of schema)sql+=record.sql+';\n';
    for(const table of calendarTables)for(const row of db.prepare('SELECT * FROM '+table).all()){
      sql+='INSERT INTO "'+table+'" ('+Object.keys(row).map(c=>'"'+c+'"').join(',')+') VALUES ('+Object.values(row).map(quote).join(',')+');\n';
    }
    sql+='COMMIT;\nPRAGMA foreign_keys=ON;\n';
    const roundtrip=new DatabaseSync(':memory:');
    roundtrip.exec(sql);
    if(roundtrip.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQL roundtrip failed');
    for(const table of calendarTables)if(roundtrip.prepare('SELECT COUNT(*) n FROM '+table).get().n!==counts[table])throw Error('SQL count mismatch');
    roundtrip.close();
    return {counts,sql};
  }finally{db.close();}
}
