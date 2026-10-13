const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
require('tsx/cjs');
const { buildSiteOrderNotification } = require(path.resolve('src/lib/integrations/site-order-notification.ts'));
const order = { id: 100, total: 40, paymentMethod: 'Pix', customer: {name:'José <Silva>',phone:'11987654321'},
  shippingAddress: {deliveryMethod:'delivery',logradouro:'Rua São João',numero:'37',complemento:'Sala 2',bairro:'Centro',cidade:'João Pessoa',estado:'PB',cep:'58000000'},
  items:[{produtoId:1,quantidade:2,title:'Peça de injeção',reference:'ABC'}] };
const message = buildSiteOrderNotification(order);
for(const text of ['José <Silva>','Entrega: Envio','Rua São João, 37','Sala 2','Centro','João Pessoa/PB','CEP 58000000','2 × Peça de injeção','ref. ABC','Pix']) assert.ok(message.includes(text),text);
const pickup = buildSiteOrderNotification({...order,shippingAddress:{deliveryMethod:'pickup',pickupAddress:'Loja Demir'}});
assert.ok(pickup.includes('Retirada na loja')); assert.ok(pickup.includes('Local: Loja Demir'));assert.ok(!pickup.includes('Rua São João'));
assert.ok(buildSiteOrderNotification({...order,items:[{produtoId:1,quantidade:1}]}).includes('Produto #1'));
const large = buildSiteOrderNotification({...order,items:Array.from({length:200},()=>({...order.items[0],title:'x'.repeat(1000)}))});
assert.ok(large.length <= 1000);assert.ok(large.includes('Veja todos no ERP'));
let source = 'SITE_ORDER:1:100', sentText;
const original = Module._load;
Module._load = function(name,...args){
 if(name==='@/lib/supabaseAdmin')return{ supabaseAdmin:{rpc:async()=>({data:[{notification_id:1,usuario_id:'test',chat_id:1,title:'Novo pedido',message,source_event_id:source,attempts:1}],error:null}),from:()=>({update(){return this},eq(){return this},is:async()=>({error:null})})}};
 if(name==='@/lib/integrations/telegram')return{getTelegramEnvironment:()=>({enabled:true,configured:true}),escapeTelegramHtml:t=>t.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),sendTelegramMessage:async params=>{sentText=params.text;return{message_id:1}},TelegramApiError:class extends Error{}};
 return original.call(this,name,...args);
};
const {processTelegramMarketplaceNotifications}=require(path.resolve('src/lib/integrations/telegram-marketplace-notifications.ts'));
(async()=>{
 assert.equal((await processTelegramMarketplaceNotifications()).sent,1);
 assert.ok(sentText.startsWith('🛒 <b>Site</b>'));assert.ok(sentText.includes('José &lt;Silva&gt;'));assert.ok(sentText.includes('2 × Peça de injeção'));
 source='ML_ORDER:1:100';await processTelegramMarketplaceNotifications();assert.ok(sentText.startsWith('🛒 <b>Mercado Livre</b>'));
 console.log('PASS: customer, address, pickup, products/quantity, overflow, HTML escaping and Site/ML Telegram labels.');
})().catch(e=>{console.error(e);process.exitCode=1});
