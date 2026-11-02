import {readFile,writeFile} from 'node:fs/promises';
import {restoreCheck} from './backup-format.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/restore-check.mjs backup.json [output.sql]');
const backup=JSON.parse(await readFile(process.argv[2],'utf8'));
const {counts,sql}=await restoreCheck(backup);
if(process.argv[3])await writeFile(process.argv[3],sql);
console.log('Restore verified:',counts);
