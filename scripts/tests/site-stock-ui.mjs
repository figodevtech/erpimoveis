import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
 for(const {site,base,key} of [{site:'BR',base:'http://localhost:3011',key:'br_pecas_cart_v1'},{site:'Demir',base:'http://localhost:3015',key:'demirdiesel-cart'}]) {
  for(const width of [375,1280]) {
   const context=await browser.newContext({viewport:{width,height:900}});
   const product={id:900001,titulo:'Peca de teste',precovenda:100,preco_site:100,estoque:5};
   const cart=site==='BR'?[{produto:product,quantidade:1}]:[{product:{id:String(product.id),name:product.titulo,title:product.titulo,stock:5,price:100},quantity:1}];
   await context.addInitScript(({key,cart})=>localStorage.setItem(key,JSON.stringify(cart)),{key,cart});
   await context.route('**/*.supabase.co/**',route=>route.request().method()==='GET'?route.fulfill({json:[]}):route.abort());
   let available=2,fail=false,calls=0;
   await context.route(`${base}/api/**`,route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/stock'){
     calls++;assert.deepEqual(route.request().postDataJSON(),{ids:[product.id]});
     return route.fulfill(fail?{status:503,json:{message:'Consulta temporariamente indisponivel. Tente novamente.'}}:{json:{items:[{productId:product.id,available}]}});
    }
    assert.equal(route.request().method(),'GET','UI stock test must never create orders/payments');
    return route.fulfill({json:{}});
   });
   const page=await context.newPage();
   await page.goto(base+'/carrinho');
   const plus=page.getByRole('button',{name:/Aumentar quantidade/});
   await plus.waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${site} ${width} overflow`);
   await plus.click();
   await page.waitForFunction(key=>{const c=JSON.parse(localStorage.getItem(key));return(c[0]?.quantidade??c[0]?.quantity)===2;},key);
   fail=true;
   const minus=page.getByRole('button',{name:/Diminuir quantidade/});
   await minus.click();
   await page.getByText('Consulta temporariamente indisponivel. Tente novamente.',{exact:true}).first().waitFor();
   assert.equal(await page.evaluate(key=>{const c=JSON.parse(localStorage.getItem(key));return c[0]?.quantidade??c[0]?.quantity;},key),2);
   fail=false;available=0;
   await minus.click();
   await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).length===0,key);
   assert.equal(calls,3);
   assert.equal(context.pages().length,1);
   console.log(`PASS ${site} ${width}px: live ERP availability, network failure preserves cart, zero stock removes item, no checkout/reservation`);
   await context.close();
  }
 }
}finally{await browser.close();}
