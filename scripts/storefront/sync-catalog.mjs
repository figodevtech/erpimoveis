import fs from 'node:fs';
import pg from 'pg';

function readEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--erp-env') || !args.includes('--store-env') || !args.includes('--target') || !args.includes('--company')) {
  throw new Error('Use --erp-env ARQUIVO --store-env ARQUIVO --target URL --company ID --expect-name NOME.');
}
const erp = readEnv(option('--erp-env')), store = readEnv(option('--store-env'));
const secret = erp.STOREFRONT_CATALOG_SYNC_SECRET;
if (!secret || secret !== store.ERP_CATALOG_SYNC_SECRET) throw new Error('Segredos de catalogo ausentes ou divergentes.');
const target = new URL(option('--target'));
const configured = new URL(store.NEXT_PUBLIC_SITE_URL);
if (target.origin !== configured.origin && !['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('Destino diferente da loja configurada.');
const companyId = Number(option('--company'));
if (!Number.isSafeInteger(companyId) || companyId < 1 || !args.includes('--expect-name')) throw new Error('Confirme empresa e nome esperado.');
const productIds = args.includes('--product-ids') ? option('--product-ids').split(',').map(Number) : null;
if (productIds && (!productIds.length || productIds.some(id => !Number.isSafeInteger(id) || id < 1))) throw new Error('Informe IDs de produtos positivos separados por virgula.');
const client = new pg.Client({ connectionString: erp.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
const httpUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null; } catch { return null; } };
try {
  await client.connect();
  const company = (await client.query("select coalesce(to_jsonb(e)->>'nomerazaosocial',to_jsonb(e)->>'razao_social',to_jsonb(e)->>'nome',to_jsonb(e)->>'razaosocial') as nomerazaosocial from public.empresa e where id=$1", [companyId])).rows[0];
  if (!company || company.nomerazaosocial !== option('--expect-name')) throw new Error('A empresa do ERP nao corresponde ao cliente esperado.');
  const rows = (await client.query('select * from public.site_catalog_export where empresa_id=$1 and ($2::int[] is null or produto_id=any($2::int[])) order by produto_id', [companyId, productIds])).rows;
  if (productIds && rows.length !== new Set(productIds).size) throw new Error('Um ou mais produtos nao pertencem ao catalogo da empresa confirmada.');
  const categories = (await client.query('select id,nome,descricao,ativo,"exibirSite" from public.produtogrupo order by id')).rows;
  const images = (await client.query('select produto_id,url,path,ordem from public.produto_imagem where produto_id=any($1::int[]) order by ordem', [rows.map(p => Number(p.produto_id))])).rows;
  const imageMap = new Map();
  for (const img of images) {
    const url = httpUrl(img.url);
    if (!url) continue;
    const list = imageMap.get(Number(img.produto_id)) || [];
    if (list.length < 30) list.push({ url, path: String(img.path || url).slice(0, 1000), order: Math.max(0, Number(img.ordem || 0)) });
    imageMap.set(Number(img.produto_id), list);
  }
  for (let index = 0; index < rows.length; index += 500) {
    const batch = rows.slice(index, index + 500);
    const ids = new Set(batch.map(p => p.grupo_produto_id));
    const payload = {
      categories: categories.filter(c => ids.has(c.id)).map(c => ({ id: Number(c.id), name: String(c.nome).slice(0,160), description: c.descricao?.slice(0,2000) || null, active: c.exibirSite === true })),
      products: batch.map(p => ({
        id: Number(p.produto_id), title: String(p.titulo || `Produto #${p.produto_id}`).slice(0,300),
        marketplaceTitle: p.titulo?.slice(0,300) || null, marketplaceDescription: p.descricao?.slice(0,10000) || null,
        price: Math.max(0, Number(p.preco || 0)), stock: Math.max(0, Math.trunc(Number(p.estoque || 0))),
        reference: p.referencia?.slice(0,200) || null, manufacturer: p.fabricante?.slice(0,200) || null,
        categoryId: p.grupo_produto_id ? Number(p.grupo_produto_id) : null,
        imageUrl: httpUrl(p.imagem_principal) || imageMap.get(Number(p.produto_id))?.[0]?.url || null,
        condition: ['NOVO','USADO','RECONDICIONADO'].includes(p.conservacao?.toUpperCase()) ? p.conservacao.toUpperCase() : null,
        featured: Boolean(p.destaque), visible: Boolean(p.visible), deleted: false, barcode: p.codigobarras?.slice(0,100) || null,
        updatedAt: p.source_updated_at ? new Date(p.source_updated_at).toISOString() : null,
        images: imageMap.get(Number(p.produto_id)) || [],
      })),
    };
    const response = await fetch(new URL('/api/integrations/erp/catalog', target), {
      method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Loja recusou lote: HTTP ${response.status}, ${result.error || 'erro desconhecido'}.`);
    console.log(`Lote aplicado: ${result.products} produtos, ${result.categories} categorias.`);
  }
  console.log(`Carga inicial concluida: ${rows.length} produtos de ${company.nomerazaosocial}. ERP consultado somente para leitura.`);
} catch (error) {
  if (error.code) console.error(`Carga interrompida (SQLSTATE ${error.code}).`);
  else console.error(String(error.message).replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g, '[URL]'));
  process.exitCode = 1;
} finally { await client.end(); }
