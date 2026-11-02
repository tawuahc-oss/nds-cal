const traditional = text => text.replace(/[节龙后惊蛰谷满处阴腊闰]/g,
  char => ({节:'節',龙:'龍',后:'後',惊:'驚',蛰:'蟄',谷:'穀',满:'滿',处:'處',阴:'陰',腊:'臘',闰:'閏'}[char]));
export function lunarInfo(date, Solar = globalThis.Solar) {
  const [year,month,day]=date.split('-').map(Number);
  const lunar=Solar.fromYmd(year,month,day).getLunar();
  const festivals=lunar.getMonth()<0 ? [] : lunar.getFestivals().map(traditional);
  if(festivals.includes('春節'))festivals[festivals.indexOf('春節')]='農曆新年';
  return {date:traditional(lunar.getMonthInChinese())+'月'+lunar.getDayInChinese(),term:traditional(lunar.getJieQi()),festivals};
}
