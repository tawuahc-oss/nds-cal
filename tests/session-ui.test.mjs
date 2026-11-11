import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../assets/app.js',import.meta.url),'utf8');
test('losing calendar authorization removes notes and clears an open detail view immediately',()=>{
  const elements=Object.fromEntries(['detailDialog','detailBody','detailActions'].map(id=>[id,{
    cleared:false,closed:false,close(){this.closed=true;},replaceChildren(){this.cleared=true;}
  }]));
  const context={state:{session:{token:'old'},events:[{id:'event',title:'Public',notes:'Private'}]},
    $:id=>elements[id],sessionStorage:{removeItem(){}},storageKey:'test',renderAuth(){},renderCalendar(){}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const saveSession='),source.indexOf('const errorText='))+'\nsaveSession(null);',context);
  assert.equal(context.state.session,null);
  assert.equal(context.state.events[0].title,'Public');
  assert.equal('notes' in context.state.events[0],false);
  assert.equal(elements.detailDialog.closed,true);
  assert.equal(elements.detailBody.cleared,true);
  assert.equal(elements.detailActions.cleared,true);
});

test('calendar archive button opens the archive dialog and clears previous errors',()=>{
  const elements=Object.fromEntries(['archiveOpen','archiveYear','archiveBefore','archiveError','archiveCandidates','archiveDialog']
    .map(id=>[id,{textContent:'old error',replaceChildren(){this.cleared=true;},showModal(){this.open=true;}}]));
  const context={$:id=>elements[id],today:'2026-11-12'};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("$('archiveOpen').onclick="),source.indexOf("for(const [id,kind]")),context);
  elements.archiveOpen.onclick();
  assert.equal(elements.archiveDialog.open,true);
  assert.equal(elements.archiveYear.value,2024);
  assert.equal(elements.archiveBefore.value,'2025-01-01');
  assert.equal(elements.archiveError.textContent,'');
  assert.equal(elements.archiveCandidates.cleared,true);
});
