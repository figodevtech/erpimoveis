/**
 * Remove acentos e caracteres especiais, mantendo apenas ASCII seguro.
 * Ãštil para campos da NF-e que nÃ£o aceitam UTF-8 pleno ou para evitar erros de validaÃ§Ã£o.
 */
export function sanitizeString(value: string | null | undefined): string {
    if (!value) return '';

    const normalizedPunctuation = value
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/\u00A0/g, ' ')
        .replace(/[\r\n\t]+/g, ' ');

    const str = normalizedPunctuation.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    return str
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/** Limite do tipo TNome usado pelas tags xNome da NF-e/NFC-e. */
export const NFE_XNOME_MAX_LENGTH = 60;

/**
 * Produz exatamente o texto que pode ser serializado em uma tag xNome.
 *
 * O corte acontece depois da sanitização e antes do escape XML. Assim, um
 * caractere como `&` conta como um caractere fiscal, e não como os cinco
 * caracteres da entidade `&amp;`. O trim final evita terminar o nome com um
 * espaço quando o corte cair entre duas palavras.
 */
export function truncateNfeXNome(value: string | null | undefined): string {
    return sanitizeString(value).slice(0, NFE_XNOME_MAX_LENGTH).trimEnd();
}

function decodeGeneratedXmlText(value: string): string {
    return value.replace(
        /&(amp|lt|gt|quot|apos);/g,
        (_entity, name: "amp" | "lt" | "gt" | "quot" | "apos") => ({
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
        })[name],
    );
}

/**
 * Corrige rascunhos antigos já persistidos antes de eles serem assinados.
 * Limita todas as ocorrências de xNome sem reserializar o documento inteiro,
 * preservando a ordem das tags exigida pelo leiaute.
 */
export function truncateNfeXNomeInXml(xml: string): string {
    return xml.replace(/<xNome>([\s\S]*?)<\/xNome>/g, (_tag, encodedValue: string) => {
        const fiscalValue = truncateNfeXNome(decodeGeneratedXmlText(encodedValue));
        return `<xNome>${escapeXml(fiscalValue)}</xNome>`;
    });
}

/**
 * Escapa caracteres reservados do XML.
 * TambÃ©m aplica sanitizaÃ§Ã£o (remove acentos) automaticamente para seguranÃ§a.
 */
export function escapeXml(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '';

    const str = typeof value === 'number' ? String(value) : sanitizeString(value);

    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
