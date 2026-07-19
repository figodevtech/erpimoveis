const CODE_128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

export type Code128Bar = { x: number; width: number };

export function encodeCode128C(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length % 2 !== 0) return null;

  const values: number[] = [];
  for (let index = 0; index < digits.length; index += 2) {
    values.push(Number(digits.slice(index, index + 2)));
  }

  const checksum = (105 + values.reduce((sum, item, index) => sum + item * (index + 1), 0)) % 103;
  const symbols = [105, ...values, checksum, 106];
  const quietZone = 10;
  const bars: Code128Bar[] = [];
  let cursor = quietZone;

  for (const symbol of symbols) {
    const pattern = CODE_128_PATTERNS[symbol];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) bars.push({ x: cursor, width });
      cursor += width;
    }
  }

  return { bars, width: cursor + quietZone, digits, checksum };
}
