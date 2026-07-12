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
