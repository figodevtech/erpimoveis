// Authenticated browser, controlled API responses: never issues a real refund.
const {chromium,expect}=require('@playwright/test');
require('tsx/cjs');require('../../tests/captures/support/capture-env.ts').loadCaptureEnv();
(async()=>{
 const fixture=process.argv.includes('--component')?await require('./site-returns-component-host.cjs')():null;
 const baseURL=fixture?.url||'http://localhost:3000';
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const desktop=process.argv.includes('--desktop');
  const context=await browser.newContext({...(fixture?{}:{storageState:'playwright/.auth/capture-user.json'}),viewport:desktop?{width:1440,height:900}:{width:390,height:844}});
  const page=await context.newPage();
  let requested=false,received=false,refund=false,puts=[];
  const row=()=>({id:1,site_order_id:99999,site_status:'PAGO',total_amount:20,order_created_at:'2026-10-09T15:00:00Z',import_status:'IMPORTADO',refund_status:refund?'AWAITING_CUSTOMER':null,refund_requested_at:refund?'2026-10-09':null,return_requested_at:requested?'2026-10-09':null,return_received_at:received?'2026-10-09':null,refund_request_url:refund?'https://sandbox.asaas.com/solicitar-estorno/test':null,returnItems:[{productId:1,quantity:2,title:'Produto controlado de teste'}],venda:{id:1,status:'CONCLUIDA',status_entrega:'ENTREGUE',cliente:{nomerazaosocial:'Cliente de teste'}},delivery:{method:'delivery',address:{street:'Rua de teste'}}});
  await page.route('**/api/integracoes/site/orders**',async route=>{
   const req=route.request();
   if(req.method()==='PUT'){const data=req.postDataJSON();puts.push(data);if(data.action==='REQUEST_RETURN')requested=true;else received=true;return route.fulfill({json:{ok:true,message:'Registrado'}});}
   if(req.method()==='POST'&&/orders\/99999/.test(req.url())){refund=true;return route.fulfill({json:{ok:true,pending:true,requestUrl:'https://sandbox.asaas.com/solicitar-estorno/test',message:'Cliente deve preencher o formulário'}});}
   return route.fulfill({json:{data:[row()],count:1,pagination:{page:1,limit:20,total:1,totalPages:1}}});
  });
  await page.goto(`${baseURL}/marketplace?canal=loja&secao=orders`,{waitUntil:'domcontentloaded'});
  if(page.url().includes('/login')){
   if(!process.env.CAPTURE_EMAIL||!process.env.CAPTURE_PASSWORD)throw Error('Capture login not configured; UI validation not completed.');
   await page.getByLabel('Usuário ou e-mail').fill(process.env.CAPTURE_EMAIL);
   await page.getByLabel('Senha',{exact:true}).fill(process.env.CAPTURE_PASSWORD);
   const callback=page.waitForResponse(r=>r.url().includes('/api/auth/callback/credentials'),{timeout:15000}).catch(async()=>{
    const security=page.getByText('Conclua a verificação de segurança',{exact:true});
    if(await security.isVisible())throw Error('Login requires manual Turnstile verification; credentials have not been submitted.');
    throw Error('Authentication request was not sent; browser login validation remains pending.');
   });
   await page.getByRole('button',{name:'Entrar',exact:true}).click();
   const response=await callback;
   const result=await response.json().catch(()=>({}));
   if(!response.ok()||result.error||String(result.url||'').includes('error='))throw Error(`Capture authentication rejected (HTTP ${response.status()}); check capture credentials and account access.`);
   await page.waitForURL(url=>!url.pathname.includes('/login'),{timeout:30000,waitUntil:'domcontentloaded'}).catch(async()=>{const alerts=await page.getByRole('alert').allTextContents();throw Error(`Capture login did not complete. ${alerts.join(' ').slice(0,300)}`)});
   await page.goto('http://localhost:3000/marketplace?canal=loja&secao=orders',{waitUntil:'domcontentloaded'});
  }
  await page.getByRole('button',{name:/^Filtros/}).click({timeout:20000});
  await expect(page.getByRole('dialog',{name:'Filtros dos pedidos'})).toBeVisible();
  await page.getByRole('dialog').getByRole('textbox',{name:'Número do pedido'}).fill('99999');
  await page.getByRole('button',{name:'Ver pedidos',exact:true}).click();
  await page.getByRole('button',{name:'Ações do pedido 99999'}).click({timeout:20000});
  await page.getByRole('menuitem',{name:'Detalhes do pedido',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Cliente de teste');
  await expect(page.getByRole('dialog')).toContainText('2 × Produto controlado de teste');
  await page.getByRole('dialog').getByRole('tab',{name:'Entrega',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Rua de teste');
  await expect(page.getByRole('dialog').getByText('Produtos',{exact:true})).toHaveCount(0);
  await page.getByRole('dialog').getByRole('tab',{name:'Resumo',exact:true}).click();
  await page.getByRole('button',{name:'Fechar',exact:true}).click();
  // Radix keeps content mounted for the exit animation: the selected order must remain intact.
  const closingDialog = page.locator('[role="dialog"][data-state="closed"]');
  if(await closingDialog.count()) await expect(closingDialog).toContainText('Cliente de teste');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Ações do pedido 99999'}).click();
  await page.getByRole('menuitem',{name:'Solicitar devolução física'}).click();
  await expect(page.getByText('2 × Produto controlado de teste')).toBeVisible();
  await page.getByLabel('Motivo da devolução').fill('Devolução integral de teste');
  await page.getByRole('button',{name:'Registrar solicitação',exact:true}).click();
  await page.getByRole('button',{name:'Ações do pedido 99999'}).click();
  await expect(page.getByRole('menuitem',{name:'Atualizar andamento'})).toHaveCount(0);
  await expect(page.getByRole('menuitem',{name:'Reembolsar devolução recebida'})).toHaveCount(0);
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
  await expect(page.getByRole('menuitem',{name:'Abrir formulário de reembolso do boleto'})).toHaveAttribute('href','https://sandbox.asaas.com/solicitar-estorno/test');
  await page.getByRole('menuitem',{name:'Detalhes do pedido',exact:true}).click();
  await page.getByRole('dialog').getByRole('tab',{name:'Pagamento',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Aguardando formulário do cliente');
  await expect(page.getByRole('dialog').getByRole('link',{name:'Abrir formulário',exact:true})).toHaveAttribute('href','https://sandbox.asaas.com/solicitar-estorno/test');
  await expect(page.getByRole('dialog').getByRole('button',{name:'Copiar link',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Consultar estorno',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Cancelar e estornar',exact:true})).toHaveCount(0);
  expect(puts.map(p=>p.action)).toEqual(['REQUEST_RETURN','RECEIVE_RETURN']);expect(puts[1].allItemsApproved).toBe(true);
  console.log(`PASS: ${fixture?'isolated component':'authenticated app'} ${desktop?'desktop':'mobile'} UI request/inspection/approval/refund actions, shipment block and boleto form link, controlled responses; no real writes.`);
 }finally{await browser.close();if(fixture)await fixture.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1});
