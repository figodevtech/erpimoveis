// Authenticated browser, controlled API responses: never issues a real refund.
const {chromium,expect}=require('@playwright/test');
require('tsx/cjs');require('../../tests/captures/support/capture-env.ts').loadCaptureEnv();
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({storageState:'playwright/.auth/capture-user.json',viewport:{width:390,height:844}});
  const page=await context.newPage();
  let requested=false,received=false,refund=false,puts=[];
  const row=()=>({id:1,site_order_id:99999,site_status:'PAGO',total_amount:20,order_created_at:'2026-10-09T15:00:00Z',import_status:'IMPORTADO',refund_status:refund?'AWAITING_CUSTOMER':null,refund_requested_at:refund?'2026-10-09':null,return_requested_at:requested?'2026-10-09':null,return_received_at:received?'2026-10-09':null,refund_request_url:refund?'https://sandbox.asaas.com/solicitar-estorno/test':null,returnItems:[{productId:1,quantity:2,title:'Produto controlado de teste'}],venda:{id:1,status:'CONCLUIDA',status_entrega:'ENTREGUE',cliente:{nomerazaosocial:'Cliente de teste'}},delivery:{method:'delivery',address:{street:'Rua de teste'}}});
  await page.route('**/api/integracoes/site/orders**',async route=>{
   const req=route.request();
   if(req.method()==='PUT'){const data=req.postDataJSON();puts.push(data);if(data.action==='REQUEST_RETURN')requested=true;else received=true;return route.fulfill({json:{ok:true,message:'Registrado'}});}
   if(req.method()==='POST'&&/orders\/99999/.test(req.url())){refund=true;return route.fulfill({json:{ok:true,pending:true,requestUrl:'https://sandbox.asaas.com/solicitar-estorno/test',message:'Cliente deve preencher o formulário'}});}
   return route.fulfill({json:{data:[row()],count:1,pagination:{page:1,limit:20,total:1,totalPages:1}}});
  });
  await page.goto('http://localhost:3000/marketplace?canal=loja&secao=orders',{waitUntil:'domcontentloaded'});
  if(page.url().includes('/login')){
   if(!process.env.CAPTURE_EMAIL||!process.env.CAPTURE_PASSWORD)throw Error('Capture login not configured; UI validation not completed.');
   await page.getByLabel('Usuário ou e-mail').fill(process.env.CAPTURE_EMAIL);
   await page.getByLabel('Senha',{exact:true}).fill(process.env.CAPTURE_PASSWORD);
   await page.getByRole('button',{name:'Entrar',exact:true}).click();
   await page.waitForURL(url=>!url.pathname.includes('/login'),{timeout:30000});
   await page.goto('http://localhost:3000/marketplace?canal=loja&secao=orders',{waitUntil:'domcontentloaded'});
  }
  await page.getByRole('button',{name:'Ações do pedido 99999'}).click({timeout:20000});
  await page.getByRole('menuitem',{name:'Solicitar devolução física'}).click();
  await expect(page.getByText('2 × Produto controlado de teste')).toBeVisible();
  await page.getByLabel('Motivo da devolução').fill('Devolução integral de teste');
  await page.getByRole('button',{name:'Registrar solicitação',exact:true}).click();
  await page.getByRole('button',{name:'Ações do pedido 99999'}).click();
  await page.getByRole('menuitem',{name:'Conferir recebimento da devolução'}).click();
  await page.getByLabel('Resultado da conferência').fill('Todos os itens recebidos e aprovados');
  await expect(page.getByRole('button',{name:'Confirmar recebimento',exact:true})).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Confirmar recebimento',exact:true}).click();
  await page.getByRole('button',{name:'Ações do pedido 99999'}).click();
  await page.getByRole('menuitem',{name:'Reembolsar devolução recebida'}).click();
  await page.getByRole('button',{name:'Confirmar estorno',exact:true}).click();
  await page.getByRole('button',{name:'Ações do pedido 99999'}).click();
  await expect(page.getByRole('menuitem',{name:'Abrir formulário de reembolso do boleto'})).toBeVisible();
  expect(puts.map(p=>p.action)).toEqual(['REQUEST_RETURN','RECEIVE_RETURN']);expect(puts[1].allItemsApproved).toBe(true);
  console.log('PASS: mobile UI request/inspection/approval/refund actions and boleto form link, controlled responses; no real writes.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1});
