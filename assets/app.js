import {lunarInfo} from './lunar-info.js';
import {ruleFromForm,ruleDescription,weekdayCodes,weekdays} from './recurrence-form.js';
const $=id=>document.getElementById(id);
const preview=['127.0.0.1','localhost'].includes(location.hostname)&&location.port==='8081';
const API=(!preview&&['127.0.0.1','localhost','tawuahc-oss.github.io'].includes(location.hostname))?'https://nds-cal.tawuahc.workers.dev':location.origin;
const storageKey=preview?'nds-preview-session':'nds-admin-session';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const state={month:today.slice(0,7),selected:today,events:[],categories:[],adminEvents:[],rules:[],
  filters:new Map(),session:null,editing:null,categoryId:null,loading:0,mutating:false,holidays:null};
const f=$('eventForm').elements;
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const button=(text,action,className)=>{const b=node('button',text,className);b.type='button';b.onclick=action;return b;};
const report=(text,error=false)=>{$('status').textContent=(preview?'本機測試資料（不會修改雲端）｜':'')+text;$('status').dataset.error=String(error);};
const saveSession=value=>{state.session=value;try{if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey);}catch{}renderAuth();};
const errorText=message=>{
  const map={'Unauthorized':'登入已失效，請重新登入。','Origin not allowed':'目前網址未獲 API 允許，請使用設定好的本機網址。',
    'Invalid username or password':'帳號或密碼不正確。','Too many login attempts. Try later.':'登入嘗試過多，請稍後再試。',
    'The first event date must match the selected recurrence rule':'開始日期必須符合重複規則。例如每月第一個星期一，可從 2026-11-02 開始。',
    'Remove or restore occurrence exceptions before changing recurrence schedule':'此系列有單次例外。請先恢復例外，再更改系列的日期或重複規則。',
    'Category is used by events; reassign those events first':'此分類仍有活動使用，請先更改活動分類。',
    'Current password is incorrect':'目前密碼不正確。','Invalid recovery code':'復原碼不正確或已使用。',
    'Choose a different password':'新密碼必須與目前密碼不同。',
    'Keep the current and previous calendar year online':'請至少保留今年及去年的資料；清理日期不能設定得更近期。',
    'Too many occurrences in date range':'活動太多，無法完整顯示或匯出。請縮短日期範圍。',
    'Internal server error':'伺服器暫時無法完成操作，請稍後再試或聯絡管理員。',
    'Category name already exists':'已有相同名稱的分類。',
    'Use 6-128 characters and avoid common passwords; 12 or more is recommended':'請使用 6–128 字元並避開常見密碼，建議 12 字元以上。'};
  return map[message]||message;
};
async function api(path,method='GET',body) {
  if(state.session&&Date.parse(state.session.expires_at)<=Date.now())saveSession(null);
  let response;
  try{response=await fetch(API+path,{method,cache:'no-store',headers:{
    ...(state.session?{Authorization:'Bearer '+state.session.token}:{}),
    ...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
  catch{throw Error('無法連接伺服器，請檢查網絡及 API 來源設定。');}
  const data=await response.json().catch(()=>({error:'伺服器沒有回傳有效 JSON。'}));
  if(!response.ok){if(response.status===401&&path!='/api/admin/login')saveSession(null);throw Error(errorText(data.error||'HTTP '+response.status));}
  return data;
}
function range(){
  const [y,m]=state.month.split('-').map(Number);
  return {from:state.month+'-01',to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};
}
function visible(e){return state.filters.get(e.category_id||'')!==false;}
function eventsOn(day){return state.events.filter(e=>visible(e)&&e.start_at.slice(0,10)<=day&&(e.end_at||e.start_at).slice(0,10)>=day);}
function time(e){return e.all_day?'全日':e.start_at.slice(11,16);}
const detailDateFormat=new Intl.DateTimeFormat('zh-HK',{
  timeZone:'Asia/Hong_Kong',year:'numeric',month:'long',day:'numeric'
});
const detailTimeFormat=new Intl.DateTimeFormat('zh-HK',{
  timeZone:'Asia/Hong_Kong',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
function detailDateTime(value,allDay){
  if(!value)return value;
  const localValue=value.replace(' ','T');
  const date=new Date(localValue.length===10?localValue+'T00:00:00+08:00':
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(localValue)?localValue:localValue+'+08:00');
  if(Number.isNaN(date.getTime()))return value;
  const day=detailDateFormat.format(date);
  return allDay?day+'（全日）':day+' '+detailTimeFormat.format(date);
}
const detailDialog=$('detailDialog');
function isOutsideDetail(event){
  const {left,right,top,bottom}=detailDialog.getBoundingClientRect();
  return event.target===detailDialog&&
    (event.clientX<left||event.clientX>right||event.clientY<top||event.clientY>bottom);
}
let detailPressOutside=false;
detailDialog.addEventListener('pointerdown',event=>{
  detailPressOutside=isOutsideDetail(event);
});
detailDialog.addEventListener('click',event=>{
  if(detailPressOutside&&isOutsideDetail(event))detailDialog.close();
  detailPressOutside=false;
});
function color(e){return /^#[\da-f]{6}$/i.test(e.category_color||'')?e.category_color:'#87684a';}
function renderAuth(){
  const logged=!!state.session;
  for(const id of ['adminPanel','logout','addEvent'])$(id).hidden=!logged;
  $('loginOpen').hidden=logged;
  $('adminName').textContent=logged?(state.session.username||'管理員'):'';
  if(!logged){state.adminEvents=[];state.rules=[];$('adminEvents').replaceChildren();}
}
function renderFilters(){
  const root=$('filters'),legend=$('categoryLegend');root.replaceChildren();legend.replaceChildren();
  for(const category of [...state.categories,{id:'holidays',name:'香港公眾假期',color:'#a74732'}]){
    const label=node('label'),input=node('input');input.type='checkbox';input.checked=state.filters.get(category.id)!==false;
    input.onchange=()=>{state.filters.set(category.id,input.checked);renderCalendar();};
    const swatch=node('span',undefined,'swatch');swatch.style.setProperty('--event-color',category.color);
    label.append(input,swatch,document.createTextNode(category.name));root.append(label);
    const key=node('span'),dot=swatch.cloneNode();key.append(dot,document.createTextNode(category.name));legend.append(key);
  }
}
function renderCalendar(){
  const {from,to}=range(),root=$('days');root.replaceChildren();$('monthTitle').textContent=state.month.replace('-','年')+'月';
  const first=new Date(from+'T00:00:00Z').getUTCDay(),last=Number(to.slice(8));
  for(let i=0;i<Math.ceil((first+last)/7)*7;i++){
    const d=i-first+1;
    if(d<1||d>last){root.append(node('div',undefined,'day blank'));continue;}
    const day=state.month+'-'+String(d).padStart(2,'0'),cell=node('div',undefined,'day'+(day===today?' today':'')+(day===state.selected?' selected':''));
    const header=node('div',undefined,'dayheader'),date=button(String(d),()=>{state.selected=day;renderCalendar();},'datebutton');
    date.setAttribute('aria-label',day+'，查看當日活動');
    const lunar=lunarInfo(day),info=node('span',[lunar.date,lunar.term,...lunar.festivals].filter(Boolean).join(' '),'lunar-info');
    header.append(date,info);cell.append(header);
    if(state.filters.get('holidays')!==false)for(const h of state.holidays?.events.filter(h=>h.date===day)||[])cell.append(node('span',h.title==='公眾假期'?h.title:'假期 · '+h.title,'holiday-label'));
    const eventMarkers=node('div',undefined,'event-markers');
    const timedMarkers=node('div',undefined,'timed-markers');
    for(const e of eventsOn(day)){
      const b=button(e.all_day?e.title:time(e)+' '+e.title,()=>showDetails(e),'calendar-event'+(e.all_day?' all-day':''));
      b.style.setProperty('--event-color',color(e));b.setAttribute('aria-label',time(e)+' '+e.title);
      if(e.all_day)eventMarkers.append(b);
      else timedMarkers.append(b);
    }
    if(timedMarkers.childElementCount)eventMarkers.append(timedMarkers);
    if(eventMarkers.childElementCount)cell.append(eventMarkers);
    root.append(cell);
  }
  $('dayDate').textContent=new Intl.DateTimeFormat('zh-HK',{dateStyle:'full',timeZone:'Asia/Hong_Kong'}).format(new Date(state.selected+'T00:00:00+08:00'))+' · 農曆'+lunarInfo(state.selected).date;
  const list=$('dayList');list.replaceChildren();
  for(const e of eventsOn(state.selected)){
    const card=button('',()=>showDetails(e),'day-card');
    card.style.setProperty('--event-color',color(e));
    const hours=!e.all_day&&e.end_at?time(e)+' – '+e.end_at.slice(11,16):time(e);
    card.append(node('strong',e.title),node('small',[hours,e.category_name,e.location].filter(Boolean).join(' · ')));
    list.append(card);
  }
  if(!list.children.length)list.append(node('p','當日沒有符合篩選條件的活動。','hint'));
  if(state.filters.get('holidays')!==false)for(const h of state.holidays?.events.filter(h=>h.date===state.selected)||[])list.append(node('p',h.title==='公眾假期'?h.title:'香港公眾假期：'+h.title,'holiday-label'));
}
function renderAdmin(){
  const root=$('adminEvents');root.replaceChildren();
  for(const e of state.adminEvents){
    const r=state.rules.find(r=>r.event_id===e.id),row=node('div',undefined,'admin-row'),info=node('div');
    info.append(node('strong',e.title),node('small',e.start_at+'　'+ruleDescription(r,e.start_at)));
    const actions=node('div',undefined,'actions');actions.append(button('編輯',()=>openEditor(e,r)),button(r?'刪除整個系列':'刪除',()=>deleteEvent(e,r),'danger'));
    if(r)actions.append(button('單次活動／恢復',()=>showSeries(r)));
    row.append(info,actions);root.append(row);
  }
  if(!root.children.length)root.append(node('p','尚未新增活動。'));
}
async function reload(){
  const sequence=++state.loading,hadSession=!!state.session;report('正在讀取活動…');$('refresh').disabled=true;
  try{
    const {from,to}=range();
    const [categories,events,adminEvents,rules]=await Promise.all([
      api('/api/categories'),
      api((hadSession?'/api/admin/calendar':'/api/calendar')+'?from='+from+'&to='+to),
      hadSession?allAdminRows('events'):null,
      hadSession?allAdminRows('recurrences'):null
    ]);
    if(sequence!==state.loading)return;
    state.categories=categories.categories;state.events=events.events;
    if(hadSession&&state.session){
      state.adminEvents=adminEvents.events;state.rules=rules.recurrences;
    }
    renderFilters();renderCalendar();renderAdmin();report('已更新。'+(state.holidays&&!state.holidays.years.includes(state.month.slice(0,4))?'此年份的香港公眾假期尚未公布／收錄。':''));
  }catch(e){if(sequence===state.loading){if(hadSession&&!state.session){await reload();report('登入已失效，仍可查看公開月曆。',true);return;}state.events=[];renderCalendar();report(e.message,true);}}
  finally{if(sequence===state.loading)$('refresh').disabled=false;}
}
async function allAdminRows(key){
  const all=[];let offset=0;
  for(let page=0;page<100;page++){
    const data=await api('/api/admin/'+key+'?limit=200&offset='+offset);all.push(...data[key]);
    if(!data.has_more)return {[key]:all};
    offset=data.next_offset;
  }
  throw Error('管理資料過多，請先封存舊資料後再試。');
}
function setRepeatVisibility(){
  const frequency=f.frequency.value,mode=f.monthly_mode.value;
  $('repeatFields').hidden=!frequency;$('weeklyFields').hidden=frequency!=='weekly';$('monthlyFields').hidden=frequency!=='monthly';
  $('monthDayLabel').hidden=mode!=='day';$('ordinalFields').hidden=mode!=='ordinal';
  $('recurrencePreview').textContent='';
  $('ruleSummary').textContent=ruleDescription(ruleFromForm($('eventForm')),f.start_at.value);
}
function dateTypes(){
  for(const name of ['start_at','end_at']){
    const value=f[name].value;f[name].type=f.all_day.checked?'date':'datetime-local';
    f[name].value=value?(f.all_day.checked?value.slice(0,10):value.length===10?value+'T09:00':value.slice(0,16)):'';
  }
}
function openEditor(e=null,r=null,scope='series'){
  if(!state.session){$('loginDialog').showModal();return;}
  $('detailDialog').close();$('eventForm').reset();state.editing={event:e,rule:r,scope};$('eventError').textContent='';
  $('editorTitle').textContent=!e?'新增活動':scope==='single'?'只修改這一次':r?'修改整個系列':'編輯活動';
  $('editScope').textContent=scope==='single'?'只影響原定於 '+e.original_start_at+' 的這次活動。':r?'修改系列內容會套用於沒有單次覆寫的活動。':'';
  f.all_day.checked=e?!!e.all_day:true;dateTypes();
  for(const name of ['title','location','description','notes'])f[name].value=e?.[name]||'';
  for(const name of ['start_at','end_at'])f[name].value=e?.[name]?.slice(0,f.all_day.checked?10:16)||(name==='start_at'?state.selected:'');
  f.category_id.replaceChildren(new Option('不指定分類',''),...state.categories.map(c=>new Option(c.name,c.id)));
  f.category_id.value=e?.category_id||'';
  f.frequency.value=r?.frequency||'';f.interval_value.value=r?.interval_value||1;
  f.until_date.value=r?.until_date||'';f.occurrence_count.value=r?.occurrence_count||'';
  f.monthly_mode.value=r?.by_weekday?'ordinal':r?.day_of_month?'day':'same';
  f.day_of_month.value=r?.day_of_month||Number(f.start_at.value.slice(8,10));
  const match=r?.by_weekday?.match(/^(-1|[1-5])(MO|TU|WE|TH|FR|SA|SU)$/);
  f.ordinal.value=match?.[1]||'1';f.ordinal_day.value=match?.[2]||weekdayCodes[(new Date(f.start_at.value.slice(0,10)+'T00:00:00Z').getUTCDay()+6)%7]||'MO';
  for(const checkbox of $('weekdays').querySelectorAll('input'))checkbox.checked=(r?.by_weekday||'').split(',').includes(checkbox.value);
  $('repeatSection').hidden=scope==='single';setRepeatVisibility();$('eventDialog').showModal();
}
function eventFromForm(){
  const all=f.all_day.checked,convert=value=>value?(all?value:value+':00+08:00'):null;
  return {title:f.title.value.trim(),start_at:convert(f.start_at.value),end_at:convert(f.end_at.value),all_day:all,
    category_id:f.category_id.value||null,location:f.location.value,description:f.description.value,notes:f.notes.value};
}
async function mutate(action){
  if(state.mutating)return;state.mutating=true;
  try{await action();await reload();return true;}finally{state.mutating=false;}
}
function showDetails(e){
  $('detailTitle').textContent=e.title;const body=$('detailBody');body.replaceChildren();
  const fields=[['開始',detailDateTime(e.start_at,e.all_day)],['結束',detailDateTime(e.end_at,e.all_day)],['地點',e.location],['分類',e.category_name],['描述',e.description],['備註',e.notes]];
  const dl=node('dl');for(const [label,value] of fields)if(value)dl.append(node('dt',label),node('dd',value));body.append(dl);
  const actions=$('detailActions');actions.replaceChildren();
  if(state.session){
    const original=state.adminEvents.find(x=>x.id===(e.event_id||e.id)),r=state.rules.find(x=>x.id===e.recurrence_rule_id);
    if(e.is_recurring){
      actions.append(button('只修改這一次',()=>openEditor(e,r,'single')),button('修改整個系列',()=>openEditor(original,r)),
        button('只取消這一次',()=>changeException(e,'cancelled'),'danger'));
      if(e.exception_action)actions.append(button('恢復原定安排',()=>changeException(e,'restore')));
    }else actions.append(button('編輯',()=>openEditor(original||e)),button('刪除',()=>deleteEvent(original||e),'danger'));
  }
  $('detailDialog').showModal();
}
async function changeException(e,action){
  if(!confirm(action==='cancelled'?'只取消 '+e.original_start_at+' 這次活動？':'恢復 '+e.original_start_at+' 的原定安排？'))return;
  try{await mutate(async()=>{
    const p='/api/admin/recurrences/'+e.recurrence_rule_id+'/exceptions';
    if(action==='restore')await api(p+'/'+encodeURIComponent(e.original_start_at),'DELETE');
    else await api(p,'POST',{original_start_at:e.original_start_at,action});
    $('detailDialog').close();
  });}catch(error){report(error.message,true);}
}
async function showSeries(r){
  try{
    const {from,to}=range(),data=await api('/api/admin/recurrences/'+r.id+'/occurrences?from='+from+'&to='+to);
    $('detailTitle').textContent=r.title+'｜'+state.month;$('detailBody').replaceChildren();$('detailActions').replaceChildren();
    for(const e of data.occurrences){
      const row=node('div',undefined,'admin-row'),actions=node('div',undefined,'actions');
      row.append(node('span',e.start_at+'　'+(e.exception_action==='cancelled'?'已取消':e.exception_action==='modified'?'已單次修改':'正常')));
      if(e.exception_action)actions.append(button('恢復',()=>changeException(e,'restore')));
      if(e.exception_action!=='cancelled')actions.append(button('編輯這次',()=>openEditor(e,r,'single')),button('取消這次',()=>changeException(e,'cancelled'),'danger'));
      row.append(actions);$('detailBody').append(row);
    }
    if(!data.occurrences.length)$('detailBody').append(node('p','本月沒有這個系列的活動，可關閉後切換月份再查看。'));
    $('detailDialog').showModal();
  }catch(error){report(error.message,true);}
}
async function deleteEvent(e,r){
  if(!confirm('確定刪除「'+e.title+'」'+(r?'整個系列及全部單次例外':'')+'？此操作會修改雲端資料。'))return;
  try{await mutate(async()=>{await api(r?'/api/admin/recurrences/'+r.id:'/api/admin/events/'+e.id,'DELETE');$('detailDialog').close();});}
  catch(error){report(error.message,true);}
}
async function moveCategory(id,target){
  const ids=state.categories.map(category=>category.id),from=ids.indexOf(id);
  if(state.mutating||from<0||target<0||target>=ids.length||from===target)return;
  ids.splice(from,1);ids.splice(target,0,id);
  $('categoryError').textContent='';
  try{await mutate(()=>api('/api/admin/categories/order','PUT',{ids}));renderCategories();}
  catch(e){$('categoryError').textContent=e.message;}
}
function renderCategories(){
  $('categoryList').replaceChildren();
  for(const [index,c] of state.categories.entries()){
    const row=node('div',undefined,'admin-row');row.append(node('span',c.name+'　'+c.color));
    const actions=node('div',undefined,'actions');actions.append(button('編輯',()=>{state.categoryId=c.id;for(const key of ['name','sort_order'])$('categoryForm').elements[key].value=c[key];for(const option of $('categoryForm').elements.color)option.checked=option.value===String(c.color).toLowerCase();}),
      button('刪除',async()=>{if(!confirm('確定刪除分類「'+c.name+'」？'))return;try{await mutate(()=>api('/api/admin/categories/'+c.id,'DELETE'));renderCategories();}catch(e){$('categoryError').textContent=e.message;}},'danger'));
    const handle=node('span','⠿','category-drag');handle.draggable=true;handle.title='拖曳調整順序';
    handle.ondragstart=event=>event.dataTransfer.setData('text/plain',c.id);
    row.ondragover=event=>event.preventDefault();
    row.ondrop=event=>{event.preventDefault();moveCategory(event.dataTransfer.getData('text/plain'),index);};
    const up=button('↑',()=>moveCategory(c.id,index-1)),down=button('↓',()=>moveCategory(c.id,index+1));
    up.setAttribute('aria-label',c.name+'上移');down.setAttribute('aria-label',c.name+'下移');
    up.disabled=index===0;down.disabled=index===state.categories.length-1;
    actions.prepend(handle,up,down);
    row.append(actions);$('categoryList').append(row);
  }
}
function download(name,value,type='application/json'){
  const url=URL.createObjectURL(new Blob([value],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
for(const [index,code] of weekdayCodes.entries()){
  const label=node('label',undefined,'inline'),checkbox=node('input');checkbox.type='checkbox';checkbox.name='weekday';checkbox.value=code;
  label.append(checkbox,document.createTextNode('星期'+weekdays[index]));$('weekdays').append(label);
}
for(const el of document.querySelectorAll('[data-close]'))el.onclick=()=>$(el.dataset.close).close();
$('eventForm').onchange=()=>{dateTypes();setRepeatVisibility();};
$('previewRecurrence').onclick=async()=>{
  const form=$('eventForm');
  if(!form.reportValidity())return;
  const event=eventFromForm(),rule=ruleFromForm(form);
  if(!rule)return;
  const snapshot=JSON.stringify({event,rule}),button=$('previewRecurrence');
  button.disabled=true;$('recurrencePreview').textContent='正在計算日期…';
  try{
    const result=await api('/api/admin/recurrence-preview','POST',{event,rule});
    if(snapshot!==JSON.stringify({event:eventFromForm(),rule:ruleFromForm(form)}))return;
    $('recurrencePreview').textContent=result.from+' 至 '+result.to+' 共 '+result.total+' 次；'+
      (result.starts.length?'日期'+(result.total>result.starts.length?'（首 12 次）':'')+'：'+result.starts.join('、'):'此範圍內沒有活動。')+
      '。這是目前表格的規則預覽，未儲存，不含已保存的單次修改或取消。';
  }catch(error){
    if(snapshot===JSON.stringify({event:eventFromForm(),rule:ruleFromForm(form)}))$('recurrencePreview').textContent=error.message;
  }finally{button.disabled=false;}
};
$('eventForm').onsubmit=async event=>{
  event.preventDefault();if(state.mutating)return;$('eventError').textContent='';const item=eventFromForm(),editing=state.editing,rule=ruleFromForm($('eventForm'));
  if(item.end_at&&item.end_at<item.start_at){$('eventError').textContent='結束時間不能早於開始時間。';return;}
  $('saveEvent').disabled=true;$('eventFields').disabled=true;
  try{await mutate(async()=>{
    if(editing.scope==='single')await api('/api/admin/recurrences/'+editing.event.recurrence_rule_id+'/exceptions','POST',
      {original_start_at:editing.event.original_start_at,action:'modified',override:item});
    else await api('/api/admin/calendar-events'+(editing.event?'/'+editing.event.id:''),editing.event?'PUT':'POST',{event:item,rule});
    $('eventDialog').close();
  });}catch(error){$('eventError').textContent=error.message;}
  finally{$('saveEvent').disabled=false;$('eventFields').disabled=false;}
};
$('loginOpen').onclick=()=>{$('loginError').textContent='';$('loginDialog').showModal();};
$('loginForm').onsubmit=async event=>{
  event.preventDefault();const form=$('loginForm'),submit=form.querySelector('button[type=submit]');submit.disabled=true;$('loginError').textContent='';
  const username=form.elements.username.value,password=form.elements.password.value;form.elements.password.value='';
  try{const login=await api('/api/admin/login','POST',{username,password});saveSession({...login,username});
    $('loginDialog').close();await reload();
  }catch(error){saveSession(null);$('loginError').textContent=error.message;}finally{submit.disabled=false;}
};
$('logout').onclick=async()=>{
  try{await api('/api/admin/logout','POST');saveSession(null);await reload();}
  catch(e){report('尚未確認伺服器登出成功：'+e.message,true);}
};
$('manageCategories').onclick=()=>{state.categoryId=null;$('categoryForm').reset();$('categoryError').textContent='';renderCategories();$('categoriesDialog').showModal();};
$('resetCategory').onclick=()=>{state.categoryId=null;$('categoryForm').reset();};
$('categoryForm').onsubmit=async event=>{
  event.preventDefault();const fields=$('categoryForm').elements;$('categoryError').textContent='';
  try{await mutate(()=>api('/api/admin/categories'+(state.categoryId?'/'+state.categoryId:''),state.categoryId?'PUT':'POST',
    {name:fields.name.value.trim(),color:fields.color.value,sort_order:Number(fields.sort_order.value)}));state.categoryId=null;$('categoryForm').reset();renderCategories();}
  catch(e){$('categoryError').textContent=e.message;}
};
$('exportJson').onclick=async()=>{try{download('nds-cal-'+today+'.json',JSON.stringify(await api('/api/admin/export'),null,2));}catch(e){report(e.message,true);}};
$('accountOpen').onclick=()=>{$('accountForm').reset();$('accountError').textContent='';$('accountResult').textContent='';$('accountDialog').showModal();};
$('resetOpen').onclick=()=>{$('loginDialog').close();$('resetForm').reset();$('resetError').textContent='';$('resetDialog').showModal();};
$('accountForm').onsubmit=async event=>{
  event.preventDefault();const form=$('accountForm'),fields=form.elements,action=event.submitter?.value;
  if(action==='change'&&(!fields.new_password.value||fields.new_password.value!==fields.confirm_password.value)){
    $('accountError').textContent='請輸入新密碼，並確認兩次輸入一致。';return;
  }
  if(!confirm(action==='change'?'更改密碼會登出所有管理員，並作廢現有復原碼。確定繼續？':'新復原碼會作廢舊碼。確定產生並下載？'))return;
  const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('accountError').textContent='';
  const current_password=fields.current_password.value,new_password=fields.new_password.value;form.reset();
  try{
    const result=await api(action==='change'?'/api/admin/change-password':'/api/admin/recovery-code','POST',{current_password,...(action==='change'?{new_password}:{})});
    if(action==='change'){saveSession(null);$('accountDialog').close();report('密碼已更新，請重新登入並產生新的復原碼。');}
    else{download('nds-cal-recovery-code.txt','NDS Calendar 一次性復原碼（請離線保管）\n'+result.recovery_code+'\n','text/plain;charset=utf-8');$('accountResult').textContent='新復原碼已下載。請確認檔案保存成功，舊碼已作廢。';}
  }catch(e){$('accountError').textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}
};
$('resetForm').onsubmit=async event=>{
  event.preventDefault();const form=$('resetForm'),fields=form.elements;
  if(fields.new_password.value!==fields.confirm_password.value){$('resetError').textContent='兩次新密碼輸入不一致。';return;}
  const submit=form.querySelector('button[type=submit]');submit.disabled=true;
  const body={recovery_code:fields.recovery_code.value.trim(),new_password:fields.new_password.value};form.reset();
  try{await api('/api/admin/reset-password','POST',body);saveSession(null);$('resetDialog').close();report('密碼已重設。請重新登入並產生新的復原碼。');}
  catch(e){$('resetError').textContent=e.message;}finally{submit.disabled=false;}
};
let fontPromise;
$('exportPdf').onclick=()=>{const r=range();$('pdfForm').elements.from.value=r.from;$('pdfForm').elements.to.value=r.to;$('pdfError').textContent='';$('pdfDialog').showModal();};
$('pdfMonth').onclick=()=>{const r=range();$('pdfForm').elements.from.value=r.from;$('pdfForm').elements.to.value=r.to;};
$('pdfYear').onclick=()=>{const y=state.month.slice(0,4);$('pdfForm').elements.from.value=y+'-01-01';$('pdfForm').elements.to.value=y+'-12-31';};
$('pdfForm').onsubmit=async event=>{
  event.preventDefault();const form=$('pdfForm'),from=form.elements.from.value,to=form.elements.to.value,kind=form.elements.kind.value;
  const days=(Date.parse(to)-Date.parse(from))/86400000;
  if(days<0||days>1826){$('pdfError').textContent='請選擇有效日期範圍，每次最多五年。';return;}
  const submit=form.querySelector('button[type=submit]');submit.disabled=true;$('pdfError').textContent='正在產生 PDF…';
  try{
    fontPromise||=fetch('./assets/fonts/NotoSansTC.ttf').then(r=>{if(!r.ok)throw Error('中文字型無法讀取。');return r.arrayBuffer();}).catch(e=>{fontPromise=null;throw e;});
    const [{calendarPdf,detailsPdf},fontBytes,backup]=await Promise.all([import('./pdf.js'),fontPromise,api('/api/admin/export')]);
    const unique=new Map();
    for(let cursor=from;cursor<=to;){
      const end=new Date(Math.min(Date.parse(cursor)+30*86400000,Date.parse(to))).toISOString().slice(0,10);
      for(const item of (await api('/api/calendar?from='+cursor+'&to='+end)).events)unique.set(item.id,item);
      cursor=new Date(Date.parse(end)+86400000).toISOString().slice(0,10);
    }
    const events=[...unique.values()].sort((a,b)=>a.start_at.localeCompare(b.start_at)),args={from,to,events,backup,fontBytes,Solar:globalThis.Solar,holidays:state.holidays?.events||[]};
    const bytes=await (kind==='calendar'?calendarPdf:detailsPdf)(args);
    download('nds-cal-'+kind+'-'+from+'-'+to+'.pdf',bytes,'application/pdf');$('pdfDialog').close();report('PDF 已產生。');
  }catch(e){$('pdfError').textContent=e.message;}finally{submit.disabled=false;}
};
$('archiveOpen').onclick=()=>{
  const year=Number(today.slice(0,4));$('archiveYear').value=year-2;$('archiveBefore').value=(year-1)+'-01-01';
};
for(const [id,kind] of [['archiveCalendar','calendar'],['archiveDetails','details']])$(id).onclick=()=>{
  const year=String($('archiveYear').value);
  if(!/^\d{4}$/.test(year)){$('archiveError').textContent='請輸入四位數年份。';return;}
  $('archiveDialog').close();$('pdfForm').elements.from.value=year+'-01-01';$('pdfForm').elements.to.value=year+'-12-31';
  $('pdfForm').elements.kind.value=kind;$('pdfError').textContent='';$('pdfDialog').showModal();
};
$('archiveJson').onclick=async()=>{try{download('nds-cal-archive-'+today+'.json',JSON.stringify(await api('/api/admin/export'),null,2));}catch(e){$('archiveError').textContent=e.message;}};
$('archivePreview').onclick=async()=>{
  try{
    const before=$('archiveBefore').value,data=await api('/api/admin/archive-preview?before='+encodeURIComponent(before));
    $('archiveCandidates').replaceChildren(node('p','可清理 '+data.candidates.length+' 個活動／已結束系列：'));
    for(const e of data.candidates)$('archiveCandidates').append(node('p',e.start_at+'　'+e.title));
  }catch(e){$('archiveError').textContent=e.message;}
};
for(const id of ['newEvent','addEvent'])$(id).onclick=()=>openEditor();
for(const [id,delta] of [['prev',-1],['next',1]])$(id).onclick=()=>{
  const [y,m]=state.month.split('-').map(Number);state.month=new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);state.selected=state.month+'-01';reload();
};
const monthForm=$('monthForm');
const monthFields=monthForm.elements;
for(let month=1;month<=12;month++){
  monthFields.month.add(new Option(month+'月',String(month).padStart(2,'0')));
}
$('monthTitle').onclick=()=>{
  const [year,month]=state.month.split('-');
  monthFields.year.value=year;
  monthFields.month.value=month;
  $('monthDialog').showModal();
};
monthForm.onsubmit=event=>{
  event.preventDefault();
  state.month=Number(monthFields.year.value)+'-'+monthFields.month.value;
  state.selected=state.month===today.slice(0,7)?today:state.month+'-01';
  $('monthDialog').close();
  reload();
};
$('today').onclick=()=>{state.month=today.slice(0,7);state.selected=today;reload();};
$('refresh').onclick=reload;
function applyTheme(theme){
  document.body.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content =
    getComputedStyle(document.body).getPropertyValue('--bg').trim();
}
let savedTheme;
try{savedTheme=localStorage.getItem('nds-theme');}catch{}
applyTheme(savedTheme==='night'?'night':'day');
$('theme').onclick=()=>{
  const theme=document.body.dataset.theme==='night'?'day':'night';
  applyTheme(theme);
  try{localStorage.setItem('nds-theme',theme);}catch{}
};
try{const saved=JSON.parse(sessionStorage.getItem(storageKey));if(saved?.token&&Date.parse(saved.expires_at)>Date.now())state.session=saved;}catch{}
const portraitLayout=matchMedia('(orientation: portrait)');
function placeFilters(){
  const filters=$('filters');
  if(portraitLayout.matches)$('portraitFilters').append(filters);
  else document.querySelector('.cal-shell').before(filters);
}
portraitLayout.addEventListener('change',placeFilters);
placeFilters();
renderAuth();renderCalendar();
fetch('./assets/data/hk-holidays.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{
  for(const holiday of data.events){
    if(/^佛誕(?:翌日)?$/.test(holiday.title))holiday.title='公眾假期';
  }
  state.holidays=data;renderCalendar();
}).catch(()=>report('香港公眾假期資料暫時無法讀取；教會活動仍可使用。',true));
reload();
// Other visitors see changes within a minute without redeploying the site.
setInterval(()=>{if(!document.hidden&&!state.mutating&&!document.querySelector('dialog[open]'))reload();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!state.mutating)reload();});
