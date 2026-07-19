
import { buildNFePreviewXml } from './buildNFe';
import { EmpresaRow, NFeItem } from './types';
import { escapeXml } from './xmlUtils';

// Mock mocks
const mockEmpresa: EmpresaRow = {
    id: 1,
    cnpj: '12345678000199',
    razaosocial: 'Empresa Teste',
    // ... (rest of fields empty/default)
    nomefantasia: '', inscricaoestadual: '', inscricaomunicipal: '', endereco: '', codigomunicipio: '3550308', regimetributario: '1', certificadocaminho: '', cschomologacao: '', cscproducao: '', ambiente: 'HOMOLOGACAO', createdat: '', updatedat: '', bairro: '', numero: '', complemento: '', cep: '', uf: 'SP', codigopais: '', nomepais: '', telefone: '', cnae: '', inscricaoestadualst: '', certificadosenha: ''
};

// Item with accents
const mockItem: NFeItem = {
    numeroItem: 1,
    codigoProduto: '123',
    descricao: 'PÃO DE AÇÚCAR MÃE', // Accents to test sanitization
    ncm: '12345678',
    cfop: '1102',
    unidade: 'UN',
    quantidade: 1,
    valorUnitario: 10,
    valorTotal: 10,
    csosn: '102',
    aliquotaIcms: 0
};

// Test 1: Entrada (tpNF=0) => Expect indFinal=0
const resultEntrada = buildNFePreviewXml(mockEmpresa, 1, 1, [mockItem], undefined, { tpNF: 0, nomeMunicipioEmitente: 'SAO PAULO' });

console.log("Checking Entrada (tpNF=0) => indFinal should be 0");
if (resultEntrada.xml.includes('<indFinal>0</indFinal>')) {
    console.log("PASS: indFinal is 0");
} else {
    console.error("FAIL: indFinal is " + resultEntrada.xml.match(/<indFinal>(.*?)<\/indFinal>/)?.[1]);
}

// Test 2: Sanitization
console.log("Checking Sanitization of 'PÃO DE AÇÚCAR MÃE' => 'PAO DE ACUCAR MAE'");
if (resultEntrada.xml.includes('<xProd>PAO DE ACUCAR MAE</xProd>')) {
    console.log("PASS: Sanitization worked");
} else {
    console.error("FAIL: Sanitization failed. Found: " + resultEntrada.xml.match(/<xProd>(.*?)<\/xProd>/)?.[1]);
    console.log("Raw escapeXml check:", escapeXml('PÃO'));
}
