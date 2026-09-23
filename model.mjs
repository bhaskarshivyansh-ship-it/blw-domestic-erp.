export const kinds = ['orders','dispatches','jobs','customers','products','suppliers','complaints','invoices','emails'];
export const excluded = (...names) => /shivyansh|kundan|test/i.test(names.join(' '));
export const number = x => x === '' || x == null ? null : Number(String(x).replace(/[₹,\s]/g,''));
export function date(x) {
  if (!x) return '';
  const m = String(x).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : String(x).slice(0,10);
}
export function items(text) { return String(text||'').split('|').filter(Boolean).map(s => {const m=s.trim().match(/^(.+?)\s+x(\d+)$/i); if(!m) throw Error('Invalid order item: '+s);return {sku:m[1].replace(/\s+/g,'').toUpperCase(),qty:Number(m[2])};}); }
export function validate(kind,r,state) {
  if (!kinds.includes(kind)) throw Error('Unknown record type');
  if (!r.id || typeof r.id !== 'string' || r.id.length>200) throw Error('A record ID is required');
  for(const k of ['qty','value','amount','paid','completed','mrp','rating','creditDays','discount'])if(r[k]!=null&&(typeof r[k]!=='number'||!Number.isFinite(r[k])))throw Error(k+' must be a valid number');
  if(['customers','complaints'].includes(kind)&&excluded(r.name||r.customer,r.contact))throw Error('This name is excluded by your test-record rule');
  if(['customers','products','suppliers'].includes(kind)&&!r.name?.trim())throw Error('Name is required');
  for (const [k,v] of Object.entries(r)) if (typeof v==='number' && (!Number.isFinite(v)||v<0)) throw Error(`${k} must be a non-negative number`);
  for (const key of ['date','poDate','promised','expected','due','closed','paidDate','actual','effective']) {
    if(r[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(r[key]) || !Number.isFinite(Date.parse(r[key])) || new Date(r[key]).toISOString().slice(0,10)!==r[key])) throw Error('Invalid '+key);
  }
  if(kind==='orders') {
    if(!r.customer?.trim()) throw Error('Customer is required');
    if(excluded(r.customer,r.contact)) throw Error('This name is excluded by your test-record rule');
    if(!items(r.items).length) throw Error('Enter items as BW11001 x10 | TW21610 x5');
    for(const d of state.dispatches.filter(d=>d.orderId===r.id)){const q=items(r.items).filter(i=>i.sku===d.sku).reduce((n,i)=>n+i.qty,0);const sent=state.dispatches.filter(x=>x.orderId===r.id&&x.sku===d.sku).reduce((n,i)=>n+i.qty,0);if(sent>q)throw Error('Order quantities cannot be reduced below dispatched quantities');}
  }
  if(kind==='dispatches') {
    const order=state.orders.find(o=>o.id===r.orderId);if(!order)throw Error('Select a valid order');
    if(order.status==='Cancelled')throw Error('Cannot dispatch a cancelled order');
    if(!r.date || !r.sku || !Number.isInteger(r.qty) || r.qty<=0)throw Error('Dispatch needs a date, SKU and positive whole quantity');
    const sku=r.sku.replace(/\s+/g,'').toUpperCase();r.sku=sku;
    const ordered=items(order.items).filter(i=>i.sku===sku).reduce((a,i)=>a+i.qty,0);
    const sent=state.dispatches.filter(d=>d.id!==r.id&&d.orderId===r.orderId&&d.sku===sku).reduce((a,d)=>a+d.qty,0);
    if(sent+r.qty>ordered)throw Error('Dispatch quantity exceeds the remaining order quantity');
    if(order.date && r.date<order.date)throw Error('Dispatch cannot be before the order date');
  }
  if(kind==='invoices') {
    if(!r.customer || r.amount==null || !r.date || !r.due) throw Error('Customer, invoice date, due date and amount are required');
    if((r.paid||0)>r.amount)throw Error('Paid amount cannot exceed invoice amount');
    if(r.paid>0&&!r.paidDate)throw Error('Enter the latest payment date');
    if(r.due<r.date||r.paidDate&&r.paidDate<r.date)throw Error('Due date and payment date cannot precede invoice date');
  }
  if(kind==='complaints' && r.status==='Closed' && (!r.closed||!r.action))throw Error('Closure date and corrective action are required');
  if(kind==='emails' && !['Review','Actioned','Dismissed'].includes(r.status))throw Error('Invalid email review status');
  if(kind==='jobs' && r.completed!=null && r.qty!=null && r.completed>r.qty)throw Error('Completed quantity exceeds planned quantity');
  if(kind==='suppliers' && r.rating!=null && r.rating>5)throw Error('Source star rating must be between 0 and 5');
  if(kind==='customers' && r.discount!=null && r.discount>100)throw Error('Discount cannot exceed 100%');
  if(kind==='jobs' && r.actual && r.date && r.actual<r.date)throw Error('Completion date cannot precede start date');
  return r;
}
export function normalizeSheet(kind,rows) {
  const [h,...body]=rows;let removed=0;const out=[];
  const required={orders:['Order no','Shop','Name','Items','Received'],complaints:['Complaint No.','Firm / Customer','Contact Person'],customers:['Registration No.','Firm / Company','Contact Person']}[kind];
  if(!Array.isArray(h)||!required||required.some(k=>!h.includes(k)))throw Error('CSV headers do not match the selected sheet type');
  for(const values of body){const r=Object.fromEntries(h.map((k,i)=>[k,values[i]??'']));
    if(kind==='orders'&&r['Order no']) {if(excluded(r.Shop,r.Name)){removed++;continue;}out.push({id:r['Order no'],customer:r.Shop,contact:r.Name,city:r.City,mobile:r.Mobile,email:r.Email,date:date(r.Received),received:r.Received,items:r.Items,qty:number(r['Total qty']),value:number(r.Value),notes:r.Notes,source:'Google Sheets',status:'Unverified',channel:'Unknown'});}
    if(kind==='complaints'&&r['Complaint No.']){if(excluded(r['Firm / Customer'],r['Contact Person'])){removed++;continue;}out.push({id:r['Complaint No.'],customer:r['Firm / Customer'],contact:r['Contact Person'],date:date(r.Received),sku:r['Part Name'],qty:number(r['Complaint Qty']),description:r['Complaint Description'],status:r.Status||'New',action:r['BLW Feedback / Action'],closed:date(r['Closed on']),source:'Google Sheets'});}
    if(kind==='customers'&&r['Registration No.']){if(excluded(r['Firm / Company'],r['Contact Person'])){removed++;continue;}out.push({id:r['Registration No.'],name:r['Firm / Company'],contact:r['Contact Person'],city:r.City,mobile:r.Mobile,email:r.Email,gst:r['GST No.'],status:'Needs verification',notes:'Registration details require verification; not an approved credit account.',source:'Google Sheets'});}
  }return {records:out,excluded:removed};
}
export function summary(state,today) {
 const orders=state.orders.filter(o=>o.status!=='Cancelled');
 const dispatchQty=id=>state.dispatches.filter(d=>d.orderId===id).reduce((n,d)=>n+d.qty,0);
 const open=orders.filter(o=>dispatchQty(o.id)<items(o.items).reduce((n,i)=>n+i.qty,0));
 return {orders:orders.length,value:orders.filter(o=>o.value!=null).reduce((n,o)=>n+o.value,0),open:open.length,late:open.filter(o=>(o.expected||o.promised)&&(o.expected||o.promised)<today).length,undated:open.filter(o=>!o.expected&&!o.promised).length,receivables:state.invoices.reduce((n,i)=>n+i.amount-(i.paid||0),0),complaints:state.complaints.filter(c=>c.status!=='Closed').length};
}
