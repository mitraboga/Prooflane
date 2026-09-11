import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function check(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=`${directory}/${entry.name}`;if(entry.isDirectory())await check(path);else if(/\.(mjs|js)$/.test(entry.name)){const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}}}
for(const directory of ['src','sdk','scripts','examples','labs','test','web/dist'])await check(directory);
console.log('All JavaScript syntax checks passed.');
