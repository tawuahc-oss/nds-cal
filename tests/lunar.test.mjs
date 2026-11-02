import test from 'node:test';
import assert from 'node:assert/strict';
import lunar from 'lunar-javascript';
import {lunarInfo} from '../assets/lunar-info.js';
const {Solar}=lunar;
test('Traditional Chinese lunar dates and festivals are independent of device timezone',()=>{
  assert.equal(lunarInfo('2026-11-02',Solar).date,'九月廿四');
  assert.ok(lunarInfo('2027-02-06',Solar).festivals.includes('農曆新年'));
  assert.ok(lunarInfo('2027-06-09',Solar).festivals.includes('端午節'));
  assert.ok(lunarInfo('2027-09-15',Solar).festivals.includes('中秋節'));
  assert.equal(lunarInfo('2026-11-07',Solar).term,'立冬');
});
test('all 24 solar terms appear once in each of five full years',()=>{
  for(let year=2026;year<=2031;year++){
    const terms=[];
    for(let date=new Date(Date.UTC(year,0,1));date.getUTCFullYear()===year;date.setUTCDate(date.getUTCDate()+1)){
      const term=lunarInfo(date.toISOString().slice(0,10),Solar).term;if(term)terms.push(term);
    }
    assert.equal(terms.length,24);
    assert.equal(new Set(terms).size,24);
  }
});
test('leap lunar month is labeled and does not repeat the ordinary month festival',()=>{
  let found=false;
  for(let m=1;m<=12;m++)for(let d=1;d<=28;d++){
    const solar=Solar.fromYmd(2028,m,d),l=solar.getLunar();
    if(l.getMonth()<0){found=true;const info=lunarInfo(solar.toYmd(),Solar);assert.match(info.date,/閏/);assert.deepEqual(info.festivals,[]);}
  }
  assert.ok(found);
});
