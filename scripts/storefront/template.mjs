import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canonical = path.join(root, 'storefront-template/supabase/migrations');
const [command = 'check', directory = 'site_brpecaspb'] = process.argv.slice(2);
if (!['check', 'sync'].includes(command)) throw new Error('Use check ou sync e o diretorio da loja.');
const site = path.resolve(root, directory);
if (!site.startsWith(root + path.sep) || !path.basename(site).startsWith('site_')) throw new Error('Informe uma pasta site_* dentro deste repositorio.');
const destination = path.join(site, 'supabase/migrations');
const existing = path.basename(site) === 'site_demirdiesel';
// Existing stores retain their original baseline/history. Never replay a fresh-store baseline there.
const skipped = existing ? new Set(['20260927000000_create_storefront.sql']) : new Set();
const normalize = sql => sql.replace(/\r\n/g, '\n').replace(/Demir Diesel|BR Peças PB/g, 'Loja virtual');
const missing = [], different = [];
for (const name of fs.readdirSync(canonical).filter(n => n.endsWith('.sql')).sort()) {
  if (skipped.has(name)) continue;
  const source = fs.readFileSync(path.join(canonical, name), 'utf8');
  const target = path.join(destination, name);
  if (!fs.existsSync(target)) {
    if (command === 'sync') {
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(target, source);
      console.log(`Adicionada: ${name}`);
    } else missing.push(name);
  } else if (normalize(fs.readFileSync(target, 'utf8')) !== normalize(source)) different.push(name);
}
for (const name of missing) console.log(`AUSENTE ${name}`);
for (const name of different) console.log(`DIVERGENTE ${name}; arquivo existente preservado.`);
if (missing.length || different.length) process.exitCode = 1;
else console.log(`Schema comum conferido: ${path.basename(site)}. Historico legado preservado; nenhum banco alterado.`);
