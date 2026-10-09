const http=require('node:http');const path=require('node:path');const esbuild=require('esbuild');
module.exports=async function startFixture(){
 const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {StorefrontOrders} from './src/app/(app)/(pages)/marketplace/storefront-orders';createRoot(document.getElementById('root')).render(<StorefrontOrders/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},tsconfig:'tsconfig.json',plugins:[{name:'isolated-next',setup(build){
  build.onResolve({filter:/^next\/(dynamic|link|navigation)$/},args=>({path:args.path,namespace:'next-fixture'}));
  build.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({contents:args.path==='next/dynamic'?'export default ()=>()=>null':args.path==='next/link'?"import React from 'react';export default ({children,...props})=>React.createElement('a',props,children)":"export const usePathname=()=>'/marketplace';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push(){},replace(){}});",loader:'js',resolveDir:process.cwd()}));
  build.onResolve({filter:/(venda-detail-dialog|emissao-nota-dialog)$/},args=>({path:args.path,namespace:'dialog-fixture'}));
  build.onLoad({filter:/.*/,namespace:'dialog-fixture'},()=>({contents:'export const VendaDetailsDialog=()=>null;export const EmissaoNotaDialog=()=>null;',loader:'js',resolveDir:process.cwd()}));
 }}]});
 const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle.outputFiles[0].text);}else if(req.url?.startsWith('/marketplace')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');}else{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return{url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
};
