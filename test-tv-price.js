const WebSocket = require('ws');
function pack(o){ const p=JSON.stringify(o); return `~m~${p.length}~m~${p}`; }
function parse(s){ s=s.toString(); const arr=[]; let i=0; while(true){ const a=s.indexOf('~m~',i); if(a<0)break; const b=s.indexOf('~m~',a+3); if(b<0)break; const len=parseInt(s.slice(a+3,b)); const p=s.slice(b+3,b+3+len); try{arr.push(JSON.parse(p))}catch(e){} i=b+3+len;} return arr; }
const session='qs_'+Math.random().toString(36).slice(2);
const ws=new WebSocket('wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=2026_06_13-11_00', {headers:{Origin:'https://www.tradingview.com','User-Agent':'Mozilla/5.0'}});
const symbols=['OANDA:XAUUSD','TVC:GOLD','FOREXCOM:XAUUSD','FX_IDC:XAUUSD','CAPITALCOM:GOLD'];
ws.on('open',()=>{
 console.log('open',session);
 ws.send(pack({m:'quote_create_session',p:[session]}));
 ws.send(pack({m:'quote_set_fields',p:[session,'base-currency-logoid','ch','chp','currency-logoid','currency_code','current_session','description','exchange','format','fractional','is_tradable','language','local_description','logoid','lp','lp_time','minmov','minmove2','original_name','pricescale','pro_name','short_name','type','update_mode','volume','ask','bid','high_price','low_price','open_price','prev_close_price']}));
 for(const sym of symbols){
   ws.send(pack({m:'quote_add_symbols',p:[session,sym]}));
   ws.send(pack({m:'quote_fast_symbols',p:[session,sym]}));
 }
});
let n=0;
ws.on('message',d=>{
 const t=d.toString(); if(t.startsWith('~h~')){ws.send(t); return;}
 for(const m of parse(t)){
  if(m.m==='qsd') { n++; console.log(JSON.stringify(m.p[1],null,2)); }
  else if(['critical_error','protocol_error'].includes(m.m)) console.error('ERR',JSON.stringify(m));
 }
 if(n>=1) setTimeout(()=>process.exit(0),2000);
});
ws.on('error',e=>{console.error(e); process.exit(1)});
setTimeout(()=>{console.log('timeout');process.exit(2)},15000);
