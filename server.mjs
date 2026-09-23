import http from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {kinds,validate,normalizeSheet} from './model.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.BLW_DATA_DIR||path.join(root,'data');mkdirSync(data,{recursive:true});
const db=new DatabaseSync(path.join(data,'blw.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT,action TEXT,kind TEXT,record_id TEXT,body TEXT); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);`);
const getSetting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setting=(k,v)=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v);
const state=()=>Object.fromEntries(kinds.map(k=>[k,db.prepare('SELECT body,version FROM records WHERE kind=?').all(k).map(r=>({...JSON.parse(r.body),version:r.version}))]));
const audit=(a,k,id,b)=>db.prepare('INSERT INTO audit(at,action,kind,record_id,body) VALUES(?,?,?,?,?)').run(new Date().toISOString(),a,k,id,JSON.stringify(b));
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
const insert=(k,r)=>db.prepare('INSERT INTO records(kind,id,body,version) VALUES(?,?,?,1)').run(k,r.id,JSON.stringify(r));
// Private seed is deliberately outside the published source tree and loaded once.
if(process.env.BLW_SEED_FILE&&!getSetting('seeded'))transaction(()=>{const seed=JSON.parse(readFileSync(process.env.BLW_SEED_FILE,'utf8'));for(const k of kinds)for(const r of seed[k]||[])insert(k,r);setting('sources',JSON.stringify(seed.sources||[]));setting('seeded','1');audit('Initial private import','sources','seed',{counts:Object.fromEntries(kinds.map(k=>[k,(seed[k]||[]).length]))});});
const sessions=new Map(),attempts=new Map();
const hash=s=>createHash('sha256').update(s).digest('hex');
const port=Number(process.env.PORT||4173);
const host=process.env.BLW_HOST||'127.0.0.1';
const local=host==='127.0.0.1'||host==='localhost';
if(!local&&!process.env.BLW_PUBLIC_ORIGIN?.startsWith('https://'))throw Error('Remote access requires BLW_PUBLIC_ORIGIN with HTTPS and a trusted TLS reverse proxy.');
const origin=process.env.BLW_PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
function send(res,status,body,type='application/json'){res.writeHead(status,{...headers,'Content-Type':type});res.end(type==='application/json'?JSON.stringify(body):body);}
async function body(req){let s='';for await(const b of req){s+=b;if(s.length>5_000_000)throw Error('Import exceeds 5 MB');}return JSON.parse(s||'{}');}
const authenticated=req=>{const token=req.headers.cookie?.match(/(?:^|; )blw=([^;]+)/)?.[1];const key=token&&hash(token);if(!key)return false;const expiry=sessions.get(key);if(!expiry||expiry<Date.now()){sessions.delete(key);return false;}return true;};
const server=http.createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host){send(res,403,{error:'Invalid host'});return;}
  if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){send(res,403,{error:'Open BLW directly to continue'});return;}
  const url=new URL(req.url,origin),p=url.pathname;
  if(p==='/api/session'&&req.method==='GET'){send(res,200,{authenticated:authenticated(req),setup:!getSetting('password'),local});return;}
  if(p==='/api/login'&&req.method==='POST'){
    const key=req.socket.remoteAddress;const a=attempts.get(key)||{n:0,start:Date.now()};if(Date.now()-a.start>900000){a.n=0;a.start=Date.now();}a.n++;attempts.set(key,a);if(a.n>10){send(res,429,{error:'Too many attempts. Wait 15 minutes.'});return;}
    const b=await body(req);if(typeof b.password!=='string'||b.password.length<12){send(res,400,{error:'Use a password of at least 12 characters'});return;}
    if(!getSetting('password')){if(!local){send(res,403,{error:'Create the owner password on this computer first'});return;}const salt=randomBytes(16).toString('hex');setting('password',salt+':'+scryptSync(b.password,salt,64).toString('hex'));}
    const [salt,h]=getSetting('password').split(':');if(!timingSafeEqual(scryptSync(b.password,salt,64),Buffer.from(h,'hex'))){send(res,401,{error:'Incorrect password'});return;}
    attempts.delete(key);const token=randomBytes(32).toString('hex');sessions.set(hash(token),Date.now()+8*3600000);res.setHeader('Set-Cookie',`blw=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${local?'':'; Secure'}`);send(res,200,{ok:true});return;
  }
  if(p==='/api/logout'&&req.method==='POST'){const t=req.headers.cookie?.match(/(?:^|; )blw=([^;]+)/)?.[1];if(t)sessions.delete(hash(t));res.setHeader('Set-Cookie','blw=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');send(res,200,{ok:true});return;}
  if(p.startsWith('/api/')){
    if(!authenticated(req)){send(res,401,{error:'Please sign in'});return;}
    if(p==='/api/state'&&req.method==='GET'){send(res,200,{...state(),sources:JSON.parse(getSetting('sources')||'[]'),audit:db.prepare('SELECT at,action,kind,record_id FROM audit ORDER BY id DESC LIMIT 200').all(),serverTime:new Date().toISOString()});return;}
    if(p==='/api/source-review'&&req.method==='POST'){
      const b=await body(req);transaction(()=>{const row=db.prepare('SELECT body,version FROM records WHERE kind=? AND id=?').get(b.kind,b.id);if(!row||row.version!==b.version)throw Error('Conflict: source record changed. Reload and review again.');const r=JSON.parse(row.body),pending=r.sourceReview;if(!pending)throw Error('No pending source change');const next={...r};if(b.accept===true)for(const key of pending.fields)next[key]=pending.incoming[key];if(!b.accept)next.dismissedSource=pending.incoming;else delete next.dismissedSource;delete next.sourceReview;validate(b.kind,next,state());db.prepare('UPDATE records SET body=?,version=version+1 WHERE kind=? AND id=?').run(JSON.stringify(next),b.kind,b.id);audit(b.accept?'Accepted source change':'Kept existing source values',b.kind,b.id,{before:r,after:next});});send(res,200,{ok:true});return;
    }
    if(p==='/api/record'&&req.method==='POST'){
      const {kind,record,version}=await body(req);transaction(()=>{const old=db.prepare('SELECT version,body FROM records WHERE kind=? AND id=?').get(kind,record.id);if(old&&old.version!==version)throw Error('Conflict: another edit was saved. Reload before editing again.');const clean={...record};delete clean.version;validate(kind,clean,state());
      if(old){const before=JSON.parse(old.body);if(kind==='orders'&&before.promised&&before.promised!==clean.promised)throw Error('Original promise is fixed. Use revised expected date.');db.prepare('UPDATE records SET body=?,version=version+1 WHERE kind=? AND id=?').run(JSON.stringify(clean),kind,clean.id);audit('Updated',kind,clean.id,{before,after:clean});}else{insert(kind,clean);audit('Created',kind,clean.id,clean);}});send(res,200,{ok:true});return;
    }
    if(p==='/api/import'&&req.method==='POST'){
      const b=await body(req);if(!['orders','complaints','customers'].includes(b.kind)||!Array.isArray(b.rows)||b.rows.length>10000)throw Error('Unsupported sheet import');
      const parsed=normalizeSheet(b.kind,b.rows);let added=0,unchanged=0,conflicts=0;
      transaction(()=>{for(const r of parsed.records){const old=db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(b.kind,r.id);if(old){const existing=JSON.parse(old.body);const changed=Object.keys(r).some(k=>!['status','channel'].includes(k)&&r[k]!==existing[k]);if(changed){conflicts++;audit('Source change needs review',b.kind,r.id,{existing,incoming:r});}else unchanged++;continue;}validate(b.kind,r,state());insert(b.kind,r);added++;}audit('Imported',b.kind,'CSV',{added,unchanged,conflicts,excluded:parsed.excluded});});send(res,200,{added,unchanged,conflicts,excluded:parsed.excluded});return;
    }
    if(p==='/api/backup'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="blw-private-backup.json"');send(res,200,{schemaVersion:1,exportedAt:new Date().toISOString(),...state(),sources:JSON.parse(getSetting('sources')||'[]'),audit:db.prepare('SELECT * FROM audit').all()});return;}
    send(res,404,{error:'Unknown endpoint'});return;
  }
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/model.mjs':'model.mjs'};
  if(!files[p]||req.method!=='GET'){send(res,404,'Not found','text/plain');return;}
  const file=path.join(root,files[p]);send(res,200,readFileSync(file),p.endsWith('.css')?'text/css':p.endsWith('.js')||p.endsWith('.mjs')?'text/javascript':'text/html');
}catch(e){send(res,e.message.startsWith('Conflict:')?409:400,{error:e.message});}});
server.listen(port,host,()=>console.log(`BLW ERP ready at ${origin}. Private database: ${data}`));
