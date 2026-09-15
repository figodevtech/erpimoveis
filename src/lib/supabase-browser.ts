"use client";

import { createClient } from "@supabase/supabase-js";

import { chatRealtimeAccessToken } from "@/lib/chat/realtime-token";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabaseBrowser = createClient(url, anon, {
  // Este cliente nao usa Supabase Auth. Evita criar outro GoTrueClient e
  // preserva o anon key para REST/Storage; o JWT privado fica so no Realtime.
  accessToken: async () => anon,
  realtime: {
    params: { eventsPerSecond: 5 },
    // O SupabaseClient injeta um `accessToken` proprio que devolve o anon key
    // quando nao ha sessao do Supabase Auth, e o `subscribe()` do realtime-js
    // chama `setAuth()` sem argumento a cada join bem-sucedido. Sem este
    // override o JWT do chat e trocado pelo anon logo apos o primeiro join e
    // todo rejoin de canal privado passa a ser recusado pelo servidor -- o
    // Realtime caia na primeira oscilacao de rede e so voltava com reload.
    // O token do chat permanece restrito ao Realtime. Operacoes de Auth devem
    // usar o cliente de @/lib/supabase, que mantem a sessao de recuperacao.
    accessToken: chatRealtimeAccessToken,
  },
});
