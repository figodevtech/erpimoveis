const {chromium,expect}=require('@playwright/test');
(async()=>{const b=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});const p=await b.newPage({viewport:{width:1280,height:900}});
await p.goto('http://localhost:3011/produtos?q=377906021DQ',{waitUntil:'networkidle'});
const card=p.locator('[data-slot="carousel"]').filter({has:p.locator('a[href="/produto/258"]')}).first();
await expect(card.locator('span[aria-live]')).toHaveText('1 / 3');
await card.locator('[data-slot="carousel-next"]').click(); await expect(card.locator('span[aria-live]')).toHaveText('2 / 3');
if(!p.url().includes('/produtos'))throw Error('Arrow navigated to product');
await card.locator('[data-slot="carousel-previous"]').click();await expect(card.locator('span[aria-live]')).toHaveText('1 / 3');
await p.goto('http://localhost:3011/produto/258',{waitUntil:'networkidle'});
const gallery=p.locator('[data-slot="carousel"]').first();await gallery.locator('[data-slot="carousel-next"]').click();await expect(gallery.locator('span[aria-live]')).toHaveText('2 / 3');
await p.getByRole('button',{name:'Ver foto 3',exact:true}).click();await expect(gallery.locator('span[aria-live]')).toHaveText('3 / 3');
await gallery.locator('[data-slot="carousel-next"]').click();await expect(gallery.locator('span[aria-live]')).toHaveText('1 / 3');
for(const width of [320,375,768,1280]){await p.setViewportSize({width,height:900});if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+width)}
await p.setViewportSize({width:375,height:812});
const box=await gallery.locator('[data-slot="carousel-content"]').boundingBox();await p.mouse.move(box.x+box.width*.8,box.y+box.height*.65);await p.mouse.down();await p.mouse.move(box.x+box.width*.2,box.y+box.height*.65,{steps:15});await p.mouse.up();await expect(gallery.locator('span[aria-live]')).toHaveText('2 / 3');
console.log('PASS card arrows without navigation; detail arrows, loop, thumbnails, drag; widths 320/375/768/1280');await b.close()})().catch(e=>{console.error(e.message);process.exit(1)})
