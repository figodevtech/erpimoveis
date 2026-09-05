import { chromium } from '@playwright/test';
import * as XLSX from 'xlsx';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const STATUS = ["PAGAMENTO","FATURAMENTO","FATURAMENTO","EM_ANDAMENTO","CONCLUIDO","PAGAMENTO","FATURAMENTO","ORCAMENTO","CONCLUIDO","SEM_COBRANCA","CANCELADO","APROVACAO_ORCAMENTO"];
const N = 12;
const os = Array.from({length:N},(_,i)=>({id:1000+i,status:STATUS[i%STATUS.length],prod:400+i*13,serv:250+i*7}));

const HEAD=["OS","Entrada","Conclusão","Saída","Status","Prioridade","Cliente","CPF/CNPJ","Alvo atendido","Setor","Responsável","Descrição","Produtos (R$)","Serviços (R$)","Desconto (R$)","Frete (R$)","Orçamento (R$)","Acréscimo financeiro (R$)"];
const HEAD_IT=["OS","Origem","Tipo","Código","Descrição","Unidade","Quantidade","Preço unitário (R$)","Desconto do item (R$)","Subtotal (R$)"];
const HEAD_EV=["OS","Origem","Natureza","Situação","Descrição","Detalhe","Valor (R$)","Comissão de produtos (R$)"];
const HEAD_FIN=["OS","Status da OS","Entrada da OS","Conclusão da OS","Saída da OS","Criador da OS","Cliente","Alvo atendido","Evento","Data do evento","Origem","Chave origem","Natureza","Descrição","Detalhe","Valor (R$)","Status do evento","Transação","Quantidade snapshot","Valor unitário snapshot","Percentual snapshot","Base snapshot","Receitas da OS","Despesas da OS","Resultado da OS"];

const lin=[],itens=[],ev=[],fin=[];
os.forEach((o,i)=>{
  const orc=o.prod+o.serv+30;
  lin.push([o.id,"2026-08-0"+((i%9)+1),"2026-08-1"+(i%9),"",o.status,["ALTA","NORMAL","BAIXA"][i%3],
    `Cliente de demonstração ${i+1}`,"000.000.000-00",`Veículo ABC-${1000+i}`,"Mecânica","Responsável de teste",
    `Ordem ${i+1} — revisão completa com descrição longa o bastante para ocupar a terceira linha do bloco impresso.`,
    o.prod,o.serv,0,30,orc,0]);
  itens.push([o.id,"ORCAMENTO","Produto","P-"+i,"Filtro de óleo sintético","UN",2,o.prod/2,0,o.prod]);
  itens.push([o.id,"ORCAMENTO","Serviço","S-"+i,"Mão de obra — revisão","H",1,o.serv,0,o.serv]);
  ev.push([o.id,"PRODUTO","RECEITA","ATIVO","Peças aplicadas","",o.prod,0]);
  ev.push([o.id,"SERVICO","RECEITA","ATIVO","Mão de obra","",o.serv,0]);
  ev.push([o.id,"PRODUTO","DESPESA","ATIVO","Custo das peças","",Math.round(o.prod*0.6),0]);
  ev.push([o.id,"COMISSAO","DESPESA","ATIVO","Comissão","",Math.round(o.serv*0.1),0]);
  const rec=o.prod+o.serv, desp=Math.round(o.prod*0.6)+Math.round(o.serv*0.1);
  [["PRODUTO","RECEITA","Peças aplicadas",o.prod],["SERVICO","RECEITA","Mão de obra",o.serv],
   ["PRODUTO","DESPESA","Custo das peças",Math.round(o.prod*0.6)],["COMISSAO","DESPESA","Comissão",Math.round(o.serv*0.1)]]
   .forEach(([org,nat,desc,val],k)=>fin.push([o.id,o.status,"2026-08-0"+((i%9)+1),"2026-08-1"+(i%9),"","Criador teste",
     `Cliente de demonstração ${i+1}`,`Veículo ABC-${1000+i}`,900+k,"2026-08-1"+(i%9),org,`${org}-${k}`,nat,desc,"detalhe",val,"ATIVO","",0,0,0,0,rec,desp,rec-desp]));
});

function planilha(modo,q){
  const wb=XLSX.utils.book_new();
  if(modo==='financeiro'){
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([HEAD_FIN,...fin]),"Relatório");
  }else{
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([HEAD,...lin]),"Relatório");
    if(q.get('itens')==='1') XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([HEAD_IT,...itens]),"Itens");
    if(q.get('eventos')==='1') XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([HEAD_EV,...ev]),"Eventos");
  }
  return XLSX.write(wb,{type:"buffer",bookType:"xlsx"});
}

const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:1400},locale:'pt-BR',colorScheme:'light',acceptDownloads:true});
const page=await context.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/reports/ordens/export*',async route=>{
  const u=new URL(route.request().url());
  const modo=u.searchParams.get('mode')==='financeiro'?'financeiro':'simples';
  await route.fulfill({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:planilha(modo,u.searchParams)});
});

const base='http://127.0.0.1:3117/login/relatorio-ordens-preview?status=PAGAMENTO,FATURAMENTO';
try{
  // ---- 1) Modo COM ITENS
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:180000});
  await page.getByText('Relação de ordens de serviço').first().waitFor({timeout:180000});
  await page.waitForTimeout(2000);
  await page.getByRole('button',{name:'Exibir'}).click();
  await page.getByText('Exibir itens das OS').click();
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  let t=await page.innerText('body');
  assert.ok(t.includes('Filtro de óleo sintético'),'Itens não apareceram.');
  assert.ok(t.includes('FATURAMENTO'),'Faturamento sumiu no modo itens.');
  await page.screenshot({path:'artifacts/faturamento/relatorio/folha-itens.png',fullPage:true});

  // ---- 2) Modo COM EVENTOS
  await page.getByRole('button',{name:'Exibir'}).click();
  await page.getByText('Exibir itens das OS').click();
  await page.getByText('Exibir eventos financeiros').click();
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  t=await page.innerText('body');
  assert.ok(t.includes('Custo das peças'),'Eventos não apareceram.');
  assert.ok(t.includes('FATURAMENTO'),'Faturamento sumiu no modo eventos.');
  await page.screenshot({path:'artifacts/faturamento/relatorio/folha-eventos.png',fullPage:true});

  // ---- 3) PDF
  const dl=page.waitForEvent('download',{timeout:180000});
  await page.getByRole('button',{name:'Baixar PDF'}).click();
  const d=await dl;
  const destino='artifacts/faturamento/relatorio/relacao.pdf';
  await d.saveAs(destino);
  const tam=fs.statSync(destino).size;
  const cab=fs.readFileSync(destino).subarray(0,5).toString('latin1');
  assert.equal(cab,'%PDF-','O arquivo baixado não é um PDF.');
  assert.ok(tam>20000,`PDF pequeno demais: ${tam} bytes.`);
  console.log(`PDF: ${tam} bytes, cabeçalho ${cab}`);

  // ---- 4) Relatório financeiro
  await page.goto(base+'&folha=financeiro',{waitUntil:'domcontentloaded',timeout:180000});
  await page.getByText('Eventos financeiros por OS').first().waitFor({timeout:180000});
  await page.waitForTimeout(2500);
  t=await page.innerText('body');
  assert.ok(t.includes('FATURAMENTO'),'Faturamento não apareceu no relatório financeiro.');
  assert.ok(t.includes('PAGAMENTO'),'Pagamento sumiu do relatório financeiro.');
  await page.screenshot({path:'artifacts/faturamento/relatorio/folha-financeiro.png',fullPage:true});

  assert.deepEqual(errors,[]);
  console.log('OK: itens, eventos, PDF e relatório financeiro — todos com Faturamento.');
}finally{await browser.close();}
