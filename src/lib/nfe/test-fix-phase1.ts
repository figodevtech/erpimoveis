
import { buildNFePreviewXml } from './buildNFe';
import { EmpresaRow, NFeItem } from './types';

// Mock mocks
const mockEmpresa: EmpresaRow = {
    id: 1,
    cnpj: '12345678000199',
    razaosocial: 'Empresa Teste SP',
    nomefantasia: 'Teste',
    inscricaoestadual: '123',
    inscricaomunicipal: '456',
    endereco: 'Rua Teste',
    codigomunicipio: '3550308', // SP
    regimetributario: '1',
    certificadocaminho: '',
    cschomologacao: '',
    cscproducao: '',
    ambiente: 'HOMOLOGACAO',
    createdat: '',
    updatedat: '',
    bairro: 'Bairro',
    numero: '100',
    complemento: '',
    cep: '01000000',
    uf: 'SP', // Should map to 35
    codigopais: '1058',
    nomepais: 'BRASIL',
    telefone: '',
    cnae: '',
    inscricaoestadualst: '',
    certificadosenha: ''
};

const mockItem: NFeItem = {
    numeroItem: 1,
    codigoProduto: '123',
    descricao: 'Produto com CEST',
    ncm: '12345678',
    cest: '1234567', // CEST Test
    cfop: '5102',
    unidade: 'UN',
    quantidade: 1,
    valorUnitario: 100,
    valorTotal: 100,
    csosn: '102',
    aliquotaIcms: 0
};

const result = buildNFePreviewXml(mockEmpresa, 1, 1, [mockItem], undefined, { nomeMunicipioEmitente: 'SAO PAULO' });

console.log("Checking UF (Expected 35):");
if (result.xml.includes('<cUF>35</cUF>')) {
    console.log("PASS: cUF is 35");
} else {
    console.error("FAIL: cUF not 35. Found: " + result.xml.match(/<cUF>(.*?)<\/cUF>/)?.[1]);
}

console.log("Checking CEST (Expected 1234567):");
if (result.xml.includes('<CEST>1234567</CEST>')) {
    console.log("PASS: CEST found");
} else {
    console.error("FAIL: CEST not found");
}
