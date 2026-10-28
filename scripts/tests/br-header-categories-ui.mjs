import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base=path.resolve('site_brpecaspb'),require=createRequire(path.join(base,'package.json'));
const mocks={
 'next/navigation':`export const useRouter=()=>({push(){}});`,
 'next/link':`import React from 'react';export default function Link({href,children,onClick,...props}){return <a href={href} {...props} onClick={event=>{event.preventDefault();onClick?.(event);}}>{children}</a>}`,
 'next/image':`import React from 'react';export default function Image({fill,priority,...props}){return <img {...props}/>}`,
 '@/components/providers/AuthContext':`export const useAuth=()=>({user:null,profile:null,signOut(){}});`,
 '@/components/providers/CartProvider':`export const useCartContext=()=>({totalItems:0,setIsOpen(){}});`,
 '@/components/providers/WishlistProvider':`export const useWishlistContext=()=>({totalFavorites:0});`,
};
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Header} from '@/components/layout/Header';const categories=Array.from({length:40},(_,i)=>({id:i+1,nome:'Grupo '+i+' com nome muito longo para testar a navegação de produtos',slug:'grupo-'+i}));createRoot(document.getElementById('app')).render(<Header categories={categories}/>);`,loader:'tsx',resolveDir:base},alias:{'@':base,'react':path.join(base,'node_modules/react'),'react-dom':path.join(base,'node_modules/react-dom')},plugins:[{name:'isolated',setup(b){b.onResolve({filter:/.*/},args=>args.path in mocks?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:base}));}}],bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const css=await require('postcss')([require('@tailwindcss/postcss')({base})]).process(fs.readFileSync(path.join(base,'app/globals.css'),'utf8'),{from:path.join(base,'app/globals.css')});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{for(const width of [320,375,768,1024,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<div id="app"></div>');await page.evaluate(()=>{window.process={env:{}};});await page.addStyleTag({content:css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const nav=page.getByRole('navigation',{name:'Categorias de produtos'}),button=nav.getByRole('button',{name:'Mostrar todas as categorias'});await button.waitFor();
 const links=nav.locator('a:visible'),expected=width<768?2:width<1280?4:5;assert.equal(await links.count(),expected);
 const box=await button.boundingBox();for(const link of await links.all()){const rect=await link.boundingBox();assert.ok(rect.x+rect.width<=box.x,`category overlaps button at ${width}`);assert.ok(rect.y>=box.y-4&&rect.y+rect.height<=box.y+box.height+4,`category wraps at ${width}`);}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await button.click();assert.equal(await page.locator('#header-all-categories a').count(),42);await page.locator('#header-all-categories a').last().click();assert.equal(await button.getAttribute('aria-expanded'),'false');assert.deepEqual(errors,[]);
 console.log('PASS header',width,'px: limited categories, no overlap or overflow, full expandable list.');await page.close();
}}finally{await browser.close();}
