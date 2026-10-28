import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import path from 'node:path';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useProductPackage} from '@/app/(app)/(pages)/marketplace/mercadolivre/create-listing/use-product-package';const empty={widthCm:'',heightCm:'',lengthCm:'',weightGrams:''};function Example(){const [form,setForm]=useState({produtoId:'9',...empty});useProductPackage(form,setForm,true);return <><input aria-label="Peso" value={form.weightGrams} onChange={e=>setForm(p=>({...p,weightGrams:e.target.value}))}/><button onClick={()=>setForm({produtoId:'10',...empty})}>Outro produto</button><output>{JSON.stringify(form)}</output></>};createRoot(document.getElementById('app')).render(<Example/>);`,loader:'tsx',resolveDir:process.cwd()},alias:{'@':path.resolve('src')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{for(const scenario of ['prefill','manual','stale']){
 const page=await browser.newPage();await page.setContent('<div id="app"></div>');await page.evaluate(()=>{window.pending=[];window.fetch=async url=>new Promise(resolve=>window.pending.push({url,resolve}));});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>window.pending.length===1);
 if(scenario==='manual')await page.getByLabel('Peso').fill('999');
 if(scenario==='stale'){await page.getByText('Outro produto').click();await page.waitForFunction(()=>window.pending.length===2);}
 await page.evaluate(()=>window.pending[0].resolve(Response.json({package:{widthCm:'15',heightCm:'10',lengthCm:'20',weightGrams:'750'}})));
 if(scenario==='prefill')await page.waitForFunction(()=>document.querySelector('input').value==='750');
 else {await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,50)));assert.equal(await page.getByLabel('Peso').inputValue(),scenario==='manual'?'999':'');}
 if(scenario==='stale'){await page.evaluate(()=>window.pending[1].resolve(Response.json({package:{widthCm:'30',heightCm:'20',lengthCm:'40',weightGrams:'1500'}})));await page.waitForFunction(()=>document.querySelector('input').value==='1500');}
 console.log('PASS Mercado Livre package autofill:',scenario);await page.close();
}}finally{await browser.close();}
