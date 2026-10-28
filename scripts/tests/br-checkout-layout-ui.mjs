// Actual checkout page, isolated accounts/catalog and network. Never submits a payment.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base=path.resolve('site_brpecaspb'),require=createRequire(path.join(base,'package.json'));
const addresses=[{id:3,cep:'58108152',logradouro:'Rua de teste',numero:'10',bairro:'Centro',cidade:'Bayeux',estado:'PB'},{id:4,cep:'01001000',logradouro:'Outro endereço',numero:'20',bairro:'Centro',cidade:'São Paulo',estado:'SP'}];
const mocks={
 'next/navigation':`const router={replace(){},push(){}};export const useRouter=()=>router;`,
 'next/link':`import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
 '@/components/providers/AuthContext':`const user={id:'test'},profile={id:7};export const useAuth=()=>({user,profile,isLoading:false});`,
 '@/components/providers/CartContext':`const items=[{product:{id:9,name:'MODULO DE AIRBAG LAND ROVER DISCOVERY AH2214D374AG',price:250},quantity:1}];export const useCart=()=>({items,subtotal:250,clearCart(){}});`,
 '@/lib/supabase':`export const supabase={from(){return {select(){return this},eq(){return this},order:async()=>({data:${JSON.stringify(addresses)},error:null})}},auth:{getSession:async()=>({data:{session:null}})}};`,
};
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Page from '@/app/checkout/page';createRoot(document.getElementById('app')).render(<Page/>);`,loader:'tsx',resolveDir:base},alias:{'@':base,'react':path.join(base,'node_modules/react'),'react-dom':path.join(base,'node_modules/react-dom')},plugins:[{name:'isolated-data',setup(b){b.onResolve({filter:/.*/},args=>args.path in mocks?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:base}));}}],bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const css=await require('postcss')([require('@tailwindcss/postcss')({base})]).process(fs.readFileSync(path.join(base,'app/globals.css'),'utf8'),{from:path.join(base,'app/globals.css')});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{for(const width of [320,375,768,1280]){
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 await page.setContent('<div id="app"></div>');await page.evaluate(()=>{window.process={env:{NODE_ENV:'production'}};});await page.addStyleTag({content:css.css});
 await page.evaluate(()=>{window.quotes=[];window.fetch=async(url,init)=>{if(url==='/api/shipping/quote'){const body=JSON.parse(init.body);window.quotes.push(body);return Response.json({options:[{id:1,name:'PAC',company:'Correios',price:30,days:5}],environment:'production'});}if(url==='/api/account/cards')return Response.json({cards:[]});if(url.startsWith('/api/checkout/options'))return Response.json({available:true,policies:{9:{maxInstallments:1,minimumInstallment:5,interestFreeInstallments:1,monthlyInterestPercent:0,feeMode:'absorbed',shippingRates:[]}}});throw Error('Unexpected request '+url);};});
 await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByText('Correios · PAC').waitFor();
 assert.equal(await page.evaluate(()=>window.quotes.at(-1).cep),'58108152');
 const delivery=page.getByRole('region',{name:'Frete para o endereço selecionado'});assert.equal(await delivery.count(),1);
 await delivery.getByRole('radio').click();await page.getByRole('button',{name:'Alterar',exact:true}).click();await page.getByRole('button',{name:/Outro endereço/}).click();await page.waitForFunction(()=>window.quotes.at(-1)?.cep==='01001000');
 assert.equal(await delivery.getByRole('radio').getAttribute('aria-checked'),'false');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`horizontal overflow at ${width}`);
 assert.deepEqual(errors,[]);if(width===375||width===1280)await page.screenshot({path:`.next-group-check/checkout-redesign-${width}.png`,fullPage:true});
 await delivery.getByRole('radio').click();await page.getByRole('radio',{name:'Cartão de crédito',exact:true}).click();await page.getByText('Dados do cartão',{exact:true}).waitFor();
 const save=page.getByRole('switch',{name:'Salvar cartão',exact:true});await save.waitFor();assert.equal(await save.getAttribute('aria-checked'),'false');await save.click();assert.equal(await save.getAttribute('aria-checked'),'true');
 assert.equal(await page.evaluate(()=>{const cvv=document.getElementById('checkout-ccv'),save=document.getElementById('checkout-save-card'),installments=document.getElementById('checkout-installments');return Boolean(cvv.compareDocumentPosition(save)&Node.DOCUMENT_POSITION_FOLLOWING)&&Boolean(save.compareDocumentPosition(installments)&Node.DOCUMENT_POSITION_FOLLOWING);}),true,'card fields, save consent, then installments');
 if(width===375)await page.screenshot({path:'.next-group-check/checkout-card-375.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`card form overflow at ${width}`);
 assert.deepEqual(errors,[]);console.log('PASS BR checkout',width,'px: address selection, automatic quotation, changed-address invalidation and expanded card form without overflow.');await page.close();
}}finally{await browser.close();}
