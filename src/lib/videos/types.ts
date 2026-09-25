export type VideoKind = "entrada" | "saida" | "os" | "produto" | "venda";
// osId is the legacy transport field for the parent entity ID. kind namespaces it.
export type VideoTarget = { osId: number; itemId: number; kind: VideoKind; category?: string };
