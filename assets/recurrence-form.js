export const weekdayCodes=['MO','TU','WE','TH','FR','SA','SU'];
export const weekdays=['一','二','三','四','五','六','日'];
export function ruleFromForm(form) {
  const f=form.elements, frequency=f.frequency.value;
  if(!frequency)return null;
  const rule={frequency,interval_value:Number(f.interval_value.value),by_weekday:null,day_of_month:null,
    until_date:f.until_date.value||null,occurrence_count:f.occurrence_count.value?Number(f.occurrence_count.value):null};
  if(frequency==='weekly'){
    const checked=[...form.querySelectorAll('[name=weekday]:checked')].map(i=>i.value);
    rule.by_weekday=checked.length?checked.join(','):null;
  }
  if(frequency==='monthly'){
    if(f.monthly_mode.value==='day')rule.day_of_month=Number(f.day_of_month.value);
    if(f.monthly_mode.value==='ordinal')rule.by_weekday=f.ordinal.value+f.ordinal_day.value;
  }
  return rule;
}
export function ruleDescription(r, start='') {
  if(!r)return '不重複';
  let result='每 '+r.interval_value+' '+({daily:'日',weekly:'星期',monthly:'月',yearly:'年'}[r.frequency]||r.frequency);
  if(r.frequency==='weekly'&&r.by_weekday)result+='的星期'+r.by_weekday.split(',').map(c=>weekdays[weekdayCodes.indexOf(c)]).join('、');
  if(r.frequency==='monthly'){
    if(r.by_weekday){
      const m=r.by_weekday.match(/^(-1|[1-5])(MO|TU|WE|TH|FR|SA|SU)$/);
      if(m)result+='的'+(m[1]==='-1'?'最後一個':'第'+m[1]+'個')+'星期'+weekdays[weekdayCodes.indexOf(m[2])];
    }else result+='的 '+(r.day_of_month||Number(start.slice(8,10)))+' 日';
  }
  if(r.until_date)result+='，截至 '+r.until_date;
  if(r.occurrence_count)result+='，最多 '+r.occurrence_count+' 次';
  if(!r.until_date&&!r.occurrence_count)result+='，無固定結束日期';
  return result;
}
