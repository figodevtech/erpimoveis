import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import path from 'node:path';
import assert from 'node:assert/strict';
const source=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {StorefrontShippingConnection} from '@/app/(app)/(pages)/marketplace/storefront-shipping-connection';createRoot(document.getElementById('app')).render(<StorefrontShippingConnection/>);`,loader:'tsx',resolveDir:process.cwd()},alias:{'@':path.resolve('src')},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 for(const ready of [false,true]){
  const page=await browser.newPage({viewport:{width:375,height:900}});await page.setContent('<div id="app"></div>');
  await page.route('https://shipping-connect.test/**',route=>route.fulfill({contentType:'text/html',body:'<p>Authorized start fixture</p>'}));
  await page.evaluate(ready=>{window.shippingPosts=0;window.fetch=async(_url,init)=>{if(init?.method==='POST'){window.shippingPosts++;return Response.json({url:'https://shipping-connect.test/api/integrations/melhor-envio/authorize?state=test-state'});}return ready?Response.json({configured:true,connected:false,environment:'production',message:'Autorize a conta da loja.'}):Response.json({message:'Publique a atualização da loja.'},{status:503});};},ready);
  await page.addScriptTag({content:source.outputFiles[0].text});
  const button=page.getByRole('button',{name:'Conectar Melhor Envio',exact:true});
  if(!ready){await page.getByText('Publique a atualização da loja.',{exact:true}).waitFor();assert.equal(await button.isEnabled(),false);}
  else{await page.getByText('Autorize a conta da loja.',{exact:true}).waitFor();assert.equal(await button.isEnabled(),true);await Promise.all([page.waitForURL('https://shipping-connect.test/**'),button.click()]);assert.match(page.url(),/authorize\?state=test-state/);}
  console.log('PASS shipping connection UI:',ready?'authorized start navigation':'unpublished storefront warning');await page.close();
 }
}finally{await browser.close();}
