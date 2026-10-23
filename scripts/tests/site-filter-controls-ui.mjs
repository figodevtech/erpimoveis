// Isolated browser interaction checks: no server, account or financial writes.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const result=await build({stdin:{contents:`
 import React,{useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {DatePicker} from '@/components/ui/date-picker';
 import {AmountRangeFilter} from '@/app/(app)/(pages)/marketplace/amount-range-filter';
 function Example(){const [range,setRange]=useState(['','']);const [date,setDate]=useState('');return <>
 <DatePicker value={date} onChange={setDate} aria-label="Data inicial"/>
 <output data-testid="date">{date}</output>
 <AmountRangeFilter id="total" title="Valor total" minValue={range[0]} maxValue={range[1]} onChange={(a,b)=>setRange([a,b])}/>
 <button onClick={()=>{setRange(['','']);setDate('');}}>Limpar</button>
 </>};createRoot(document.getElementById('app')).render(<Example/>);
 `,loader:'tsx',resolveDir:process.cwd()},alias:{'@':path.resolve('src')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage();
 await page.setContent('<div id="app"></div>');
 await page.addScriptTag({content:result.outputFiles[0].text});
 const min=page.getByLabel('Mínimo',{exact:true}),max=page.getByLabel('Máximo',{exact:true});
 await min.fill('10025');await max.fill('25075');
 assert.match(await min.inputValue(),/R\$\s*100,25/);assert.match(await max.inputValue(),/R\$\s*250,75/);
 assert.equal(await page.getByRole('slider',{name:'Valor mínimo',exact:true}).getAttribute('aria-valuenow'),'100.25');
 assert.equal(await page.getByRole('slider',{name:'Valor máximo',exact:true}).getAttribute('aria-valuenow'),'250.75');
 await page.getByRole('slider',{name:'Valor mínimo',exact:true}).focus();await page.keyboard.press('ArrowRight');
 assert.ok(Number(await page.getByRole('slider',{name:'Valor mínimo',exact:true}).getAttribute('aria-valuenow'))>100.25);
 await max.fill('2500000');
 assert.equal(await page.getByRole('slider',{name:'Valor máximo',exact:true}).getAttribute('aria-valuemax'),'25000');
 await max.fill('');assert.equal(await max.inputValue(),'');
 await page.getByRole('button',{name:'Data inicial',exact:true}).click();
 await page.getByRole('grid').waitFor();
 await page.getByRole('gridcell').getByRole('button').first().click();
 await page.waitForFunction(()=>/^\d{4}-\d{2}-\d{2}$/.test(document.querySelector('[data-testid=date]').textContent));
 assert.equal(await page.locator('input[type=date]').count(),0);
 await page.getByRole('button',{name:'Limpar',exact:true}).click();
 assert.equal(await min.inputValue(),'');assert.equal(await max.inputValue(),'');
 assert.equal(await page.getByTestId('date').textContent(),'');
 console.log('PASS: shadcn calendar selection, keyboard range control, decimal amounts, expanded range and clearing without residual filters.');
}finally{await browser.close();}
