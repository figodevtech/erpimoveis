// Verificação do componente real com APIs simuladas; nenhuma emissão externa.
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";
import http from "node:http";
import assert from "node:assert/strict";
// Usa o bundler que acompanha a dependência de desenvolvimento tsx.
const taskRequire = createRequire(import.meta.url);
const { build } = createRequire(taskRequire.resolve("tsx"))("esbuild");
const base = 'src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/';
const entrada = 'import React from "react"; import {createRoot} from "react-dom/client"; import {EmissaoNfseDialog} from "./' + base + 'emissao-nfse-dialog";' +
    'function App(){const [ids,setIds]=React.useState([390,393]); const [open,setOpen]=React.useState(true); window.setGroup=setIds; window.setDialogOpen=setOpen; return <EmissaoNfseDialog open={open} onOpenChange={setOpen} osId={ids[0]} osIdsAdicionais={ids.slice(1)}/>;} createRoot(document.getElementById("root")).render(<App/>);';
const servico = (os, id, descricao, valor) => ({ ordemservicoid: os, servicoid: id, quantidade: 1, precounitario: valor, descricao, servico: { descricao: 'REPARO', itemlistaservico: '14.01' }, pendenciasCadastro: [] });
const dados = (ids) => ({ ok: true, osIds: ids, modeloEmissao: 'NACIONAL', politicaEmissao: { exigeRtc: false, motivo: 'Teste', regimeTributario: '4' }, servicos: ids.map(id => servico(id, 37, id === 390 ? 'REPARO DE MODULO VOLVO' : id === 393 ? 'REPARO DE PAINEL' : 'SERVIÇO NOVO', id === 390 ? 3500 : 1200)) });
const contexto = { ok: true, modeloEmissao: 'NACIONAL', politicaEmissao: { exigeRtc: false, motivo: 'Teste', regimeTributario: '4' }, padraoFiscal: { codigoTributacaoNacionalIss: '140101', tributacaoIss: '1', tipoRetencaoIss: '1' }, pendenciasCadastro: [] };
const pausas = [];
(async () => {
    const result = await build({ stdin: { contents: entrada, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'test-stubs', setup(build) {
                    build.onResolve({ filter: /customerDialogRegister\/customerDialog$/ }, () => ({ path: 'cliente', namespace: 'test' }));
                    build.onResolve({ filter: /^@\/lib\/toast$/ }, () => ({ path: 'toast', namespace: 'test' }));
                    build.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'cliente' ? 'export const CustomerDialog=()=>null;' : 'export const toast={error:()=>{},loading:()=>0,success:()=>{},warning:()=>{}};', loader: 'js' }));
                } }] });
    const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8'); res.end(req.url === '/app.js' ? result.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const page = await browser.newPage();
        const erros = [];
        page.on('pageerror', e => erros.push(e.message));
        let modo = 'normal', revisoes = [], emissoes = [];
        await page.route('**/api/nfse/**', async (route) => {
            const url = new URL(route.request().url());
            const os = Number(url.pathname.split('/').pop());
            if (url.pathname.includes('servicos-de-os')) {
                const ids = [os, ...(url.searchParams.get('osIdsAdicionais') || '').split(',').filter(Boolean).map(Number)];
                if (modo === 'falha')
                    return route.fulfill({ status: 500, json: { ok: false, message: 'Falha simulada no carregamento' } });
                if (modo === 'parcial')
                    return route.fulfill({ json: dados([ids[0]]) });
                if (modo === 'atrasada' && os === 390) {
                    await new Promise(resolve => pausas.push(resolve));
                }
                return route.fulfill({ json: dados(ids) }).catch(() => { });
            }
            if (url.pathname.includes('contexto-emissao')) {
                revisoes.push({ os, body: route.request().postDataJSON() });
                if (modo === 'revisao-atrasada') {
                    await new Promise(resolve => pausas.push(resolve));
                }
                return route.fulfill({ json: contexto }).catch(() => { });
            }
            if (url.pathname.includes('de-os')) {
                emissoes.push({ os, body: route.request().postDataJSON() });
                return route.fulfill({ status: 202, json: { ok: true } });
            }
            throw new Error('Rota inesperada ' + url);
        });
        const load = async () => { await page.goto('http://127.0.0.1:' + server.address().port); };
        await load();
        await expect(page.getByText('REPARO DE PAINEL', { exact: true })).toBeVisible();
        await expect(page.getByText('OS #390, OS #393', { exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox')).toHaveCount(2);
        await expect(page.getByRole('button', { name: 'Revisar nota' })).toBeDisabled();
        await page.getByRole('checkbox').nth(0).check();
        await page.getByRole('checkbox').nth(1).check();
        await page.getByRole('button', { name: 'Revisar nota' }).click();
        await expect(page.locator('[id="nfse-valor-390:37"]')).toHaveValue('3500,00');
        await expect(page.locator('[id="nfse-valor-393:37"]')).toHaveValue('1200,00');
        await expect(page.getByRole('button', { name: /Emitir R/ })).toHaveText(/4\.700,00/);
        await page.locator('[id="nfse-valor-393:37"]').fill('950,50');
        await expect(page.locator('[id="nfse-valor-390:37"]')).toHaveValue('3500,00');
        await expect(page.getByRole('button', { name: /Emitir R/ })).toHaveText(/4\.450,50/);
        await page.getByRole('button', { name: /Emitir R/ }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        assert.deepEqual(revisoes[0], { os: 390, body: { servicos: [{ ordemservicoId: 390, osservicoId: 37 }, { ordemservicoId: 393, osservicoId: 37 }] } });
        assert.deepEqual(emissoes[0].body.servicos, [{ ordemservicoId: 390, osservicoId: 37, valor: 3500 }, { ordemservicoId: 393, osservicoId: 37, valor: 950.5 }]);
        assert.equal(emissoes[0].body.osIdsAdicionais, undefined);
        console.log('OK: duas linhas, seleção independente, total 4700 e payload explícito.');
        await load();
        await expect(page.getByRole('checkbox')).toHaveCount(2);
        await page.getByRole('checkbox').nth(1).check();
        await page.getByRole('button', { name: 'Revisar nota' }).click();
        await expect(page.getByRole('button', { name: /Emitir R/ })).toHaveText(/1\.200,00/);
        assert.equal(revisoes.at(-1).os, 393);
        await page.getByRole('button', { name: /Emitir R/ }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        assert.equal(emissoes.at(-1).os, 393);
        assert.equal(emissoes.at(-1).body.servicos.length, 1);
        console.log('OK: somente OS 393, âncora 393, total 1200.');
        for (const falha of ['falha', 'parcial']) {
            modo = falha;
            await load();
            await expect(page.getByText('Não foi possível carregar as OS', { exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Revisar nota' })).toBeDisabled();
            await expect(page.getByRole('checkbox')).toHaveCount(0);
        }
        console.log('OK: carregamento incompleto ou falho bloqueia revisão.');
        modo = 'atrasada';
        await load();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect.poll(() => pausas.length).toBe(1);
        await page.evaluate(() => window.setGroup([400]));
        await expect(page.getByText('SERVIÇO NOVO', { exact: true })).toBeVisible();
        pausas.splice(0).forEach(resolve => resolve());
        await page.waitForTimeout(250);
        await expect(page.getByText('REPARO DE MODULO VOLVO', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('checkbox')).toHaveCount(1);
        console.log('OK: resposta antiga de listagem não sobrescreve grupo novo.');
        modo = 'normal';
        await load();
        await expect(page.getByRole('checkbox')).toHaveCount(2);
        await page.getByRole('checkbox').nth(0).check();
        modo = 'revisao-atrasada';
        await page.getByRole('button', { name: 'Revisar nota' }).click();
        await expect(page.getByRole('button', { name: 'Preparando...' })).toBeVisible();
        await page.evaluate(() => window.setGroup([400]));
        await expect(page.getByText('SERVIÇO NOVO', { exact: true })).toBeVisible();
        pausas.splice(0).forEach(resolve => resolve());
        await page.waitForTimeout(250);
        await expect(page.getByRole('button', { name: /Emitir R/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Revisar nota' })).toBeDisabled();
        assert.deepEqual(erros, []);
        console.log('OK: revisão antiga ignorada após mudar de grupo; nenhum erro no navegador.');
    }
    finally {
        pausas.splice(0).forEach(resolve => resolve());
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
