const { chromium } = require('@playwright/test');
(async () => {
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await browser.newPage();
 await page.goto('http://localhost:3011/produtos?sort=name',{waitUntil:'networkidle',timeout:90000});
 for(const width of [320,375,768,1280]) {
  await page.setViewportSize({width,height:850});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Overflow '+width);
 }
 await page.setViewportSize({width:375,height:812});
 await page.getByRole('button',{name:/^Filtros/}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByText('Somente pronta entrega',{exact:true}).click();
 await page.waitForURL(/estoque=disponivel/);
 await page.waitForLoadState('networkidle');
 if(!new URL(page.url()).searchParams.has('sort')) throw Error('Lost sort');
 await dialog.getByRole('button',{name:'Recondicionadas',exact:true}).click();
 await page.waitForURL(/condicao=RECONDICIONADO/);
 await page.waitForLoadState('networkidle');
 await dialog.getByRole('button',{name:'Limpar',exact:true}).click();
 await page.waitForURL(url=>!url.searchParams.has('estoque')&&!url.searchParams.has('condicao'));
 await dialog.getByRole('button',{name:/Ver .* produtos/}).click();
 console.log('PASS: responsive 320/375/768/1280; mobile sheet; stock/condition; clear preserves sorting');
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
