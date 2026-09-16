/** Repete somente a persistência. Nunca executa novamente o refresh OAuth. */
export async function persistRotatedToken(
  save: () => Promise<"saved" | "conflict">,
  isAlreadySaved: () => Promise<boolean>,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await save();
      if (result === "saved") return;
      // A resposta da gravação anterior pode ter se perdido na rede.
      if (await isAlreadySaved()) return;
      throw new TokenSaveConflict();
    } catch (error) {
      if (error instanceof TokenSaveConflict) throw error;
      if (attempt === 2) throw new Error("Não foi possível persistir a renovação Mercado Livre. Verifique a conexão com o banco antes de reconectar.");
      await wait(250 * (attempt + 1));
    }
  }
}

class TokenSaveConflict extends Error {
  constructor() { super("A conta Mercado Livre mudou durante a renovação. Tente novamente."); }
}
