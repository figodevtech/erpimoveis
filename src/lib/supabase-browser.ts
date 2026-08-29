"use client";

import { createClient } from "@supabase/supabase-js";

import { chatRealtimeAccessToken } from "@/lib/chat/realtime-token";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabaseBrowser = createClient(url, anon, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    params: { eventsPerSecond: 5 },
    // O SupabaseClient injeta um `accessToken` proprio que devolve o anon key
    // quando nao ha sessao do Supabase Auth, e o `subscribe()` do realtime-js
    // chama `setAuth()` sem argumento a cada join bem-sucedido. Sem este
    // override o JWT do chat e trocado pelo anon logo apos o primeiro join e
    // todo rejoin de canal privado passa a ser recusado pelo servidor -- o
    // Realtime caia na primeira oscilacao de rede e so voltava com reload.
    // Declarado aqui dentro de `realtime` de proposito: na raiz das opcoes ele
    // trocaria tambem o token de REST/Storage e transformaria `supabase.auth`
    // em um Proxy que lanca.
    accessToken: chatRealtimeAccessToken,
  },
});
