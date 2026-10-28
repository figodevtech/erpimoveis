// Isolated real components; every request is stubbed. No purchases or data writes.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
for(const site of ['site_brpecaspb','site_demirdiesel']){
 const base=path.resolve(site);
 const result=await build({stdin:{contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {CheckoutTerms,useCheckoutTerms} from '@/components/product/CheckoutTerms';
 import {ShippingSimulator} from '@/components/product/ShippingSimulator';
 function Example(){const [mixed,setMixed]=useState(false);const terms=useCheckoutTerms(mixed?[{productId:9,total:100},{productId:10,total:200}]:[{productId:9,total:100}]);return <><CheckoutTerms terms={terms} newCard disabled={false}/><output data-testid="total">{terms.quote?.total}</output><button onClick={()=>setMixed(true)}>Adicionar item à vista</button><ShippingSimulator productIds={[9]}/></>};createRoot(document.getElementById('app')).render(<Example/>);
 `,loader:'tsx',resolveDir:base},alias:{'@':base,'react':path.join(base,'node_modules/react'),'react-dom':path.join(base,'node_modules/react-dom')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const page=await browser.newPage({viewport:{width:375,height:900}});
 await page.setContent('<div id="app"></div>');
 await page.evaluate(()=>{window.fetch=async(url)=>Response.json(url.startsWith('/api/shipping/')?{options:[{id:1,name:'PAC',company:'Correios',price:30,days:5}],environment:'production',quotedAt:new Date().toISOString()}:{available:true,fees:{operationValue:.5,one:2,six:4,twelve:6},policies:{9:{maxInstallments:3,minimumInstallment:5,interestFreeInstallments:1,monthlyInterestPercent:0,feeMode:'incremental',shippingRates:[]}}});});
 await page.addScriptTag({content:result.outputFiles[0].text});
 await page.getByRole('combobox',{name:'Parcelamento'}).click();await page.getByRole('option',{name:/3x de/}).click();
 await page.waitForFunction(()=>document.querySelector('[data-testid=total]').textContent==='102.09');
 const save=page.getByRole('switch',{name:'Salvar cartão para compras futuras'});assert.equal(await save.getAttribute('aria-checked'),'false');await save.click();assert.equal(await save.getAttribute('aria-checked'),'true');
 await page.getByLabel('CEP de destino').fill('58108152');await page.getByRole('button',{name:'Simular',exact:true}).click();await page.getByText('Correios · PAC').waitFor();
 await page.getByRole('button',{name:'Adicionar item à vista'}).click();await page.waitForFunction(()=>document.querySelector('[data-testid=total]').textContent==='300');
 await page.getByRole('combobox',{name:'Parcelamento'}).click();assert.equal(await page.getByRole('option').count(),1);await page.keyboard.press('Escape');
 console.log('PASS',site,'installments, mixed cart restriction, opt-in switch and provider shipping quote.');await page.close();
 const automatic=await build({stdin:{contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {ShippingChoices,useShippingQuote} from '@/components/product/ShippingSimulator';
 function Example(){const [cep,setCep]=useState('58108152'),[quantity,setQuantity]=useState(1),[delivery,setDelivery]=useState(true);const quote=useShippingQuote(cep,[{productId:9,quantity}],delivery);return <><ShippingChoices quote={quote}/><output data-testid="shipping-price">{quote.option?.price||0}</output><button onClick={()=>setCep('01001000')}>Trocar destino</button><button onClick={()=>setQuantity(2)}>Alterar quantidade</button><button onClick={()=>setDelivery(false)}>Retirada</button></>};createRoot(document.getElementById('app')).render(<Example/>);
 `,loader:'tsx',resolveDir:base},alias:{'@':base,'react':path.join(base,'node_modules/react'),'react-dom':path.join(base,'node_modules/react-dom')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const autoPage=await browser.newPage({viewport:{width:375,height:900}});await autoPage.setContent('<div id="app"></div>');
 await autoPage.evaluate(()=>{window.shippingRequests=[];window.fetch=async(url,init)=>{const body=JSON.parse(init.body);window.shippingRequests.push(body);return Response.json({options:[{id:1,name:'PAC',company:'Correios',price:(body.cep==='58108152'?30:40)*body.items[0].quantity,days:5}],environment:'production',quotedAt:new Date().toISOString()});};});
 await autoPage.addScriptTag({content:automatic.outputFiles[0].text});
 await autoPage.getByRole('radio').waitFor();assert.equal(await autoPage.getByTestId('shipping-price').textContent(),'0','shipping is never selected without consent');
 await autoPage.getByRole('radio').click();assert.equal(await autoPage.getByTestId('shipping-price').textContent(),'30');
 await autoPage.getByRole('button',{name:'Trocar destino'}).click();assert.equal(await autoPage.getByTestId('shipping-price').textContent(),'0','changing destination discards the previous selection');
 await autoPage.waitForFunction(()=>window.shippingRequests.length===2);await autoPage.getByRole('radio').click();assert.equal(await autoPage.getByTestId('shipping-price').textContent(),'40');
 await autoPage.getByRole('button',{name:'Alterar quantidade'}).click();assert.equal(await autoPage.getByTestId('shipping-price').textContent(),'0');
 await autoPage.waitForFunction(()=>window.shippingRequests.length===3);await autoPage.getByRole('radio').click();assert.equal(await autoPage.getByTestId('shipping-price').textContent(),'80');
 await autoPage.getByRole('button',{name:'Retirada',exact:true}).click();assert.equal(await autoPage.getByTestId('shipping-price').textContent(),'0');
 assert.equal((await autoPage.evaluate(()=>window.shippingRequests[1].cep)),'01001000');
 console.log('PASS',site,'automatic address quotation, quantity change, selection invalidation and pickup.');await autoPage.close();
 const productTerms=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ProductPaymentTerms} from '@/components/product/ProductPaymentTerms';function Example(){const [id,setId]=useState(1);return <><ProductPaymentTerms productId={id} price={100}/><button onClick={()=>setId(2)}>Produto à vista</button><button onClick={()=>setId(3)}>Sem taxas disponíveis</button><button onClick={()=>setId(4)}>Com repasse integral</button></>};createRoot(document.getElementById('app')).render(<Example/>);`,loader:'tsx',resolveDir:base},alias:{'@':base,'react':path.join(base,'node_modules/react'),'react-dom':path.join(base,'node_modules/react-dom')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const productPage=await browser.newPage({viewport:{width:375,height:900}});await productPage.setContent('<div id="app"></div>');
 await productPage.evaluate(()=>{window.fetch=async url=>{const id=Number(new URL(url,'https://test.local').searchParams.get('ids'));return Response.json({available:true,fees:id===3?null:{operationValue:.5,one:2,six:4,twelve:6},policies:{[id]:{maxInstallments:id===2?1:3,minimumInstallment:5,interestFreeInstallments:1,monthlyInterestPercent:0,shippingRates:[],feeMode:id>=3?'full':'absorbed'}}});};});
 await productPage.addScriptTag({content:productTerms.outputFiles[0].text});await productPage.getByText('3x de R$ 33,33',{exact:true}).waitFor();
 await productPage.getByRole('button',{name:'Ver condições de parcelamento'}).click();assert.equal(await productPage.getByRole('row').count(),4);await productPage.keyboard.press('Escape');
 await productPage.getByRole('button',{name:'Produto à vista',exact:true}).click();await productPage.getByText('1x de R$ 100,00',{exact:true}).waitFor();assert.equal(await productPage.getByText('3x de R$ 33,33',{exact:true}).count(),0);
 await productPage.getByRole('button',{name:'Sem taxas disponíveis',exact:true}).click();await productPage.getByText('Condições do cartão indisponíveis agora.',{exact:true}).waitFor();assert.equal(await productPage.getByRole('button',{name:'Ver condições de parcelamento'}).count(),0);
 await productPage.getByRole('button',{name:'Com repasse integral',exact:true}).click();await productPage.getByText('3x de R$ 34,89',{exact:true}).waitFor();await productPage.getByText('R$ 104,69',{exact:true}).waitFor();
 console.log('PASS',site,'product installment table, cash-only rule, fee failure and real surcharge.');await productPage.close();
}
const settings=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ProductCheckoutSettings} from '@/app/(app)/(pages)/estoque/components/dialog-produto/tabs/product-checkout-settings';createRoot(document.getElementById('app')).render(<ProductCheckoutSettings productId={99}/>);`,loader:'tsx',resolveDir:process.cwd()},alias:{'@':path.resolve('src')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const page=await browser.newPage();await page.setContent('<div id="app"></div>');
await page.evaluate(()=>{window.requests=[];window.fetch=async(url,init)=>{window.requests.push({url,method:init?.method||'GET',body:init?.body?JSON.parse(init.body):null});return Response.json({paymentOverride:true,policy:{maxInstallments:1,minimumInstallment:5,interestFreeInstallments:1,monthlyInterestPercent:0,shippingRates:[]}});};});
await page.addScriptTag({content:settings.outputFiles[0].text});assert.equal(await page.getByRole('dialog').count(),0,'Settings must stay inside the product dialog content');await page.getByRole('button',{name:'Salvar regras'}).waitFor();
await page.getByRole('combobox',{name:'Máximo de parcelas'}).click();await page.getByRole('option',{name:'Até 3 parcelas',exact:true}).click();await page.getByRole('combobox',{name:'Repasse das taxas Asaas'}).click();await page.getByRole('option',{name:'Repassar toda a taxa do cartão',exact:true}).click();await page.getByRole('button',{name:'Salvar regras'}).click();
const writes=await page.evaluate(()=>window.requests.filter(r=>r.method==='PUT'));assert.equal(writes.length,1);assert.equal(writes[0].body.productId,99);assert.equal(writes[0].body.policy.maxInstallments,3);assert.equal(writes[0].body.policy.feeMode,'full');console.log('PASS ERP: configuration is saved only for the selected product.');await page.close();
const preview=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ProductInstallmentPreview} from '@/app/(app)/(pages)/estoque/components/dialog-produto/tabs/product-installment-preview';function Example(){const [price,setPrice]=useState(100);return <><ProductInstallmentPreview productId={99} price={price} disabled={false} policy={{maxInstallments:3,minimumInstallment:5,interestFreeInstallments:1,monthlyInterestPercent:0,shippingRates:[],shippingPackage:null,feeMode:'full'}}/><button onClick={()=>setPrice(200)}>Alterar preço</button></>};createRoot(document.getElementById('app')).render(<Example/>);`,loader:'tsx',resolveDir:process.cwd()},alias:{'@':path.resolve('src')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
for(const groupMode of [false,true]){
 const inherited=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ProductCheckoutSettings} from '@/app/(app)/(pages)/estoque/components/dialog-produto/tabs/product-checkout-settings';createRoot(document.getElementById('app')).render(<ProductCheckoutSettings ${groupMode?'groupId={2}':'productId={99} assignedGroupId={2} price={100}'}/>);`,loader:'tsx',resolveDir:process.cwd()},alias:{'@':path.resolve('src')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const view=await browser.newPage({viewport:{width:375,height:900}});await view.setContent('<div id="app"></div>');
 await view.evaluate(()=>{window.writes=[];const policy={maxInstallments:6,minimumInstallment:5,interestFreeInstallments:1,feeMode:'absorbed',monthlyInterestPercent:0,shippingRates:[],shippingPackage:{weight:1,width:15,height:10,length:20}};window.fetch=async(url,init)=>{if(init?.method==='PUT')window.writes.push(JSON.parse(init.body));return Response.json({policy,inheritedPolicy:{...policy,shippingPackage:null},paymentOverride:false,groupName:'Motor'});};});
 await view.addScriptTag({content:inherited.outputFiles[0].text});const max=view.getByRole('combobox',{name:'Máximo de parcelas'});await max.waitFor();await view.getByText(groupMode?'Aplicado aos produtos do grupo que não possuem regra individual.':/Usando as regras do grupo Motor/).waitFor();
 if(groupMode){assert.equal(await view.getByLabel('Personalizar parcelamento deste produto').count(),0);assert.equal(await view.getByText('Peso e dimensões para envio',{exact:true}).count(),0);await view.getByLabel('Valor de referência para simular (R$)').waitFor();}
 else {assert.equal(await max.isEnabled(),false);await view.getByRole('switch',{name:'Personalizar parcelamento deste produto'}).click();assert.equal(await max.isEnabled(),true);}
 await max.click();await view.getByRole('option',{name:'Até 3 parcelas',exact:true}).click();await view.getByRole('button',{name:'Salvar regras'}).click();
 const first=await view.evaluate(()=>window.writes[0]);assert.equal(first.policy.maxInstallments,3);
 if(groupMode){assert.equal(first.groupId,2);assert.equal(first.productId,undefined);}
 else {assert.equal(first.paymentOverride,true);await view.getByRole('switch',{name:'Personalizar parcelamento deste produto'}).click();assert.equal(await max.isEnabled(),false);await view.getByRole('button',{name:'Salvar regras'}).click();const last=await view.evaluate(()=>window.writes.at(-1));assert.equal(last.paymentOverride,false);assert.equal(last.policy.maxInstallments,6);assert.equal(last.policy.shippingPackage.weight,1);}
 console.log('PASS ERP:',groupMode?'group payment settings exclude product shipping':'product override and returning to group inheritance');await view.close();
}
for(const mobile of [false,true]){
 const check=await browser.newPage({viewport:{width:mobile?375:1280,height:900},hasTouch:mobile});await check.setContent('<div id="app"></div>');
 await check.evaluate(()=>{window.fetch=async()=>Response.json({fees:{operationValue:.5,one:2,six:4,twelve:6}});});
 await check.addScriptTag({content:preview.outputFiles[0].text});
 const trigger=check.getByRole('button',{name:'Simular parcelas'});
 if(mobile)await trigger.tap();else await trigger.hover();
 await check.getByRole('table').waitFor();
 const row=check.getByRole('row').filter({has:check.getByRole('cell',{name:'3x',exact:true})});assert.match(await row.textContent(),/104,69/);assert.match(await row.textContent(),/4,69/);
 if(!mobile){await check.getByRole('table').hover();assert.equal(await check.getByRole('table').isVisible(),true,'moving from trigger to table keeps preview open');}
 await check.keyboard.press('Escape');await check.getByRole('button',{name:'Alterar preço'}).click();
 if(mobile)await trigger.tap();else await trigger.hover();
 await check.getByRole('table').waitFor();assert.match(await check.getByRole('row').filter({has:check.getByRole('cell',{name:'3x',exact:true})}).textContent(),/208,86/);
 console.log('PASS ERP installment preview:',mobile?'touch':'hover','and unsaved price update.');await check.close();
}
}finally{await browser.close();}
