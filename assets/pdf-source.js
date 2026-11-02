import {PDFDocument,rgb,degrees} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {lunarInfo} from './lunar-info.js';
import {ruleDescription} from './recurrence-form.js';
const ink=rgb(.24,.20,.17),muted=rgb(.45,.41,.36),line=rgb(.85,.81,.76);
function wrap(text,font,size,width){
  const result=[];let row='';
  for(const char of String(text||'').replace(/\r/g,'').replace(/\t/g,' ')){
    if(char==='\n'){result.push(row);row='';continue;}
    if(row&&font.widthOfTextAtSize(row+char,size)>width){result.push(row);row=char;}else row+=char;
  }
  if(row||!result.length)result.push(row);
  return result;
}
async function document(fontBytes){
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(fontBytes,{subset:false});
  pdf.setTitle('北區學生月程');pdf.setCreator('NDS Church Calendar');
  return {pdf,font};
}
export async function calendarPdf({from,to,events,fontBytes,Solar,holidays=[]}){
  const {pdf,font}=await document(fontBytes);let month=from.slice(0,7);
  while(month<=to.slice(0,7)){
    const page=pdf.addPage([841.89,595.28]),width=785.89,height=448,x0=28,y0=510,cellW=width/7;
    page.drawText('北區學生月程｜'+month.replace('-','年')+'月',{x:x0,y:558,size:18,font,color:ink});
    page.drawText('香港時間 UTC+8｜範圍：'+from+' 至 '+to,{x:x0,y:537,size:9,font,color:muted});
    const [year,m]=month.split('-').map(Number),offset=new Date(month+'-01T00:00:00Z').getUTCDay(),last=new Date(Date.UTC(year,m,0)).getUTCDate();
    const rows=Math.ceil((offset+last)/7),cellH=height/rows;
    for(let day=0;day<7;day++)page.drawText('日一二三四五六'[day],{x:x0+day*cellW+cellW/2-4,y:y0+6,font,size:10,color:ink});
    for(let row=0;row<=rows;row++)page.drawLine({start:{x:x0,y:y0-row*cellH},end:{x:x0+width,y:y0-row*cellH},thickness:.5,color:line});
    for(let col=0;col<=7;col++)page.drawLine({start:{x:x0+col*cellW,y:y0},end:{x:x0+col*cellW,y:y0-height},thickness:.5,color:line});
    for(let d=1;d<=last;d++){
      const date=month+'-'+String(d).padStart(2,'0');if(date<from||date>to)continue;
      const index=d+offset-1,x=x0+(index%7)*cellW+5,top=y0-Math.floor(index/7)*cellH;
      const lunar=lunarInfo(date,Solar);
      page.drawText(String(d),{x,y:top-14,font,size:10,color:ink});
      page.drawText(lunar.date,{x:x+19,y:top-14,font,size:6.5,color:muted,xSkew:degrees(8)});
      const items=[...[lunar.term,...lunar.festivals].filter(Boolean),...holidays.filter(h=>h.date===date).map(h=>'假期 '+h.title),
        ...events.filter(e=>e.start_at.slice(0,10)<=date&&(e.end_at||e.start_at).slice(0,10)>=date).map(e=>(e.all_day?'全日':e.start_at.slice(11,16))+' '+e.title)];
      const maxLines=Math.floor((cellH-25)/10),lines=items.flatMap(t=>wrap(t,font,7.5,cellW-10));
      let shown=lines.slice(0,maxLines);
      if(lines.length>maxLines)shown[maxLines-1]='…另見詳細活動紀錄';
      shown.forEach((text,i)=>page.drawText(text,{x,y:top-27-i*10,font,size:7.5,color:ink}));
    }
    page.drawText('月曆內容過多時會節錄；完整資料請另下載詳細活動紀錄及 JSON。',{x:x0,y:30,size:8,font,color:muted});
    month=new Date(Date.UTC(year,m,1)).toISOString().slice(0,7);
  }
  return pdf.save();
}
export async function detailsPdf({from,to,events,backup,fontBytes}){
  const {pdf,font}=await document(fontBytes);let page,y;
  const newPage=()=>{
    page=pdf.addPage([595.28,841.89]);y=795;
    page.drawText('北區學生月程｜詳細活動紀錄',{x:32,y,size:17,font,color:ink});y-=24;
    page.drawText(from+' 至 '+to+'｜香港時間 UTC+8',{x:32,y,size:9,font,color:muted});y-=28;
  };
  const paragraph=(text,size=10)=>{
    for(const row of wrap(text,font,size,531)){
      if(!page||y<48)newPage();
      page.drawText(row,{x:32,y,font,size,color:ink});y-=size+5;
    }y-=5;
  };
  newPage();
  paragraph('本文件供閱讀；資料還原請使用 JSON 或 SQL 備份。');
  const rules=backup?.tables?.recurrence_rules||[],exceptions=backup?.tables?.event_exceptions||[];
  const sourceEvents=backup?.tables?.events||[],included=new Set();
  for(const event of events){
    paragraph(event.title,13);
    for(const [label,key] of [['開始','start_at'],['結束','end_at'],['地點','location'],['分類','category_name'],['描述','description'],['備註','notes']])
      paragraph(label+'：'+(event[key]||'未填寫'));
    const rule=rules.find(r=>r.id===event.recurrence_rule_id);
    paragraph('重複：'+ruleDescription(rule,event.start_at));
    if(rule)included.add(rule.id);
    paragraph('單次狀態：'+(event.exception_action==='modified'?'已修改':'原定安排')+
      (event.original_start_at?'；原定開始：'+event.original_start_at:''));
  }
  // Include cancellations too: they intentionally do not appear in the public occurrence API.
  const records=exceptions.filter(x=>{
    let override={};try{override=JSON.parse(x.override_json||'{}');}catch{}
    return included.has(x.recurrence_rule_id)||(x.original_start_at.slice(0,10)>=from&&x.original_start_at.slice(0,10)<=to)||
      (override.start_at?.slice(0,10)>=from&&override.start_at.slice(0,10)<=to);
  });
  if(records.length){
    paragraph('單次修改及取消紀錄',15);
    for(const exception of records){
      const rule=rules.find(r=>r.id===exception.recurrence_rule_id),event=sourceEvents.find(e=>e.id===rule?.event_id);
      paragraph((event?.title||'系列')+'｜原定 '+exception.original_start_at+'｜'+(exception.action==='cancelled'?'已取消':'已修改'));
      if(exception.override_json)paragraph('修改內容：'+exception.override_json);
    }
  }
  if(!events.length&&!records.length)paragraph('此期間沒有活動或單次例外紀錄。');
  for(const [index,p] of pdf.getPages().entries())p.drawText('第 '+(index+1)+' 頁／共 '+pdf.getPageCount()+' 頁',{x:32,y:24,font,size:8,color:muted});
  return pdf.save();
}
