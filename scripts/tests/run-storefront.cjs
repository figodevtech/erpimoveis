const {spawnSync}=require('node:child_process');
const path=require('node:path');
const suites=['site-sale-protection','site-refund','site-refund-delivery','site-stock-transaction','site-refund-authorization','site-refund-denial','site-refund-retry','site-fulfillment','site-payment-webhook','site-order-sync','site-order-notification','site-physical-return','site-return-api','site-orders-list','telegram-site-preference','storefront-json-response'];
let failures=0;
for(const name of suites){
 console.log(`\n${name}`);
 const result=spawnSync(process.execPath,[path.join(__dirname,`${name}.cjs`)],{stdio:'inherit',cwd:path.resolve(__dirname,'../..')});
 if(result.status!==0)failures++;
}
console.log(`\n${suites.length-failures}/${suites.length} suites passed. Simulated services and isolated SQL database; no real charges or refunds.`);
process.exitCode=failures?1:0;
