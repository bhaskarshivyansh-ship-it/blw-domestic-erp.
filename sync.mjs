// Import a private, connector-produced snapshot without placing credentials in this app.
// node sync.mjs /absolute/path/to/private-feed.json
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';
import {normalizeSheet,validate,kinds} from './model.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));const file=process.argv[2];if(!file)throw Error('Supply a private feed JSON path');
const feed=JSON.parse(fs.readFileSync(file,'utf8'));const data=process.env.BLW_DATA_DIR||path.join(root,'data');
if(!fs.existsSync(path.join(data,'blw.sqlite')))throw Error('Open the ERP once before syncing');
const db=new DatabaseSync(path.join(data,'blw.sqlite'));db.exec('PRAGMA busy_timeout=10000');
const at=new Date().toISOString();let added=0,changed=0,excluded=0;
const read=k=>db.prepare('SELECT body FROM records WHERE kind=?').all(k).map(r=>JSON.parse(r.body));
const audit=(action,kind,id,body)=>db.prepare('INSERT INTO audit(at,action,kind,record_id,body) VALUES(?,?,?,?,?)').run(at,action,kind,id,JSON.stringify(body));
const fields={orders:['customer','contact','city','mobile','email','date','received','items','qty','value','notes','source'],complaints:['customer','contact','date','sku','qty','description','source'],customers:['name','contact','city','mobile','email','gst','source']};
const sources=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='sources'").get()?.value||'[]');
db.exec('BEGIN IMMEDIATE');
try{
 for(const kind of ['orders','complaints','customers']){
  if(!feed.sheetRows?.[kind])continue;
  const parsed=normalizeSheet(kind,feed.sheetRows[kind]);excluded+=parsed.excluded;
  for(const r of parsed.records){const existing=db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,r.id);const current=existing&&JSON.parse(existing.body);
   if(!current){validate(kind,r,Object.fromEntries(kinds.map(k=>[k,read(k)])));db.prepare('INSERT INTO records(kind,id,body,version) VALUES(?,?,?,1)').run(kind,r.id,JSON.stringify(r));added++;audit('Daily import',kind,r.id,{source:r.source});}
   else {const differences=fields[kind].filter(k=>r[k]!==current[k]);if(differences.length && JSON.stringify(current.dismissedSource)!==JSON.stringify(r) && JSON.stringify(current.sourceReview?.incoming)!==JSON.stringify(r)){const pending={...current,sourceReview:{at,incoming:r,fields:differences}};db.prepare('UPDATE records SET body=?,version=version+1 WHERE kind=? AND id=?').run(JSON.stringify(pending),kind,r.id);changed++;audit('Source change needs review',kind,r.id,{fields:differences});}}
  }
  const name='Google Sheets · '+kind;const s={name,at,note:`Daily refresh: ${parsed.records.length} source records; ${parsed.excluded} excluded. Source edits are held for review.`};const i=sources.findIndex(x=>x.name===name);if(i<0)sources.push(s);else sources[i]=s;
 }
 for(const o of read('orders')){const id='CUS-'+createHash('sha256').update(o.customer.trim().toLowerCase()+'|'+(o.mobile||'')).digest('hex').slice(0,12);if(!db.prepare("SELECT 1 FROM records WHERE kind='customers' AND id=?").get(id)){const r={id,name:o.customer,contact:o.contact,city:o.city,mobile:o.mobile,email:o.email,status:'Needs verification',channel:'Unknown',source:'Derived from order '+o.id,notes:'Customer identity and channel require verification; no commercial terms inferred.'};db.prepare("INSERT INTO records(kind,id,body,version) VALUES('customers',?,?,1)").run(id,JSON.stringify(r));audit('Customer discovered','customers',id,{orderId:o.id});}}
 for(const e of feed.emails||[]){if(e.scope!=='domestic-business'||!e.id||!e.thread||!e.mailbox||!e.body)throw Error('Email must be read and classified domestic-business with source identifiers');
  if(db.prepare("SELECT 1 FROM records WHERE kind='emails' AND id=?").get(e.id))continue;
  const r={...e,status:'Review'};validate('emails',r,{});db.prepare("INSERT INTO records(kind,id,body,version) VALUES('emails',?,?,1)").run(e.id,JSON.stringify(r));added++;audit('Daily business email import','emails',e.id,{mailbox:e.mailbox});
 }
 if(feed.emailCheckedAt){const s={name:'Business email · daily refresh',at:feed.emailCheckedAt,note:'Read-only business screening. Personal and unrelated export messages excluded. Summary counts are not case counts.'};const i=sources.findIndex(x=>x.name===s.name);if(i<0)sources.push(s);else sources[i]=s;}
 db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('sources',JSON.stringify(sources));audit('Daily refresh completed','sources','daily',{added,changed,excluded});db.exec('COMMIT');
 console.log(JSON.stringify({ok:true,at,added,changed,excluded}));
}catch(e){db.exec('ROLLBACK');audit('Daily refresh failed','sources','daily',{message:e.message});throw e;}finally{db.close();}
