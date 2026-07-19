
import { buildNFePreviewXml } from './buildNFe';
import { EmpresaRow, NFeDestinatario } from './types';

const mockItem = {
    numeroItem: 1,
    codigoProduto: '123',
    descricao: 'Produto',
    ncm: '12345',
    cfop: '5102',
    unidade: 'UN',
    quantidade: 1,
    valorUnitario: 10,
    valorTotal: 10,
    csosn: '102',
    aliquotaIcms: 0
};

const mockDest: NFeDestinatario = {
    razaoSocial: 'CLIENTE REAL EM PRODUCAO',
    cpf: '12345678901',
    indIEDest: '9',
    endereco: {
        logradouro: 'Rua', numero: '1', bairro: 'B', codigoMunicipio: '1', nomeMunicipio: 'M', uf: 'SP', cep: '1', codigoPais: '1', nomePais: 'B'
    }
};

const mockEmpresa = {
    id: 1,
    cnpj: '00000000000000',
    razaosocial: 'Empresa',
    // ...
    codigomunicipio: '2507507',
    uf: 'PB',
    ambiente: 'HOMOLOGACAO'
} as EmpresaRow;

console.log("--- TEST HOMOLOGACAO ---");
mockEmpresa.ambiente = 'HOMOLOGACAO';
const resHom = buildNFePreviewXml(mockEmpresa, 1, 1, [mockItem], mockDest, { nomeMunicipioEmitente: 'JOAO PESSOA' });
// Match xNome inside dest tag structure roughly, or just check the specific string presence which is unique enough
const hasHomologText = resHom.xml.includes('NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');

console.log(`Ambiente: ${mockEmpresa.ambiente}`);
console.log(`Texto Homologação encontrado: ${hasHomologText}`);

if (hasHomologText) {
    console.log("PASS");
} else {
    // Debug: print dest block
    const destBlock = resHom.xml.match(/<dest>[\s\S]*?<\/dest>/)?.[0];
    console.error("FAIL. Dest Block: " + destBlock);
}


console.log("\n--- TEST PRODUCAO ---");
mockEmpresa.ambiente = 'PRODUCAO';
mockDest.razaoSocial = 'CLIENTE REAL EM PRODUCAO';

const resProd = buildNFePreviewXml(mockEmpresa, 1, 1, [mockItem], mockDest, { nomeMunicipioEmitente: 'JOAO PESSOA' });
const hasHomologTextProd = resProd.xml.includes('NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');
const hasRealName = resProd.xml.includes('CLIENTE REAL EM PRODUCAO');

console.log(`Ambiente: ${mockEmpresa.ambiente}`);
console.log(`Texto Homologação encontrado: ${hasHomologTextProd}`);
console.log(`Nome Real encontrado: ${hasRealName}`);

if (!hasHomologTextProd && hasRealName) {
    console.log("PASS");
} else {
    console.error("FAIL");
}
