"use client";

import * as React from "react";
import { useSessionReady } from "@/components/use-session-ready";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

type RadioPreference = {
  permitted: boolean;
  enabled: boolean;
  effective: boolean;
};

type PreferencesPayload = {
  data?: {
    radio?: RadioPreference;
  };
  error?: string;
};

type UserPreferencesContextValue = {
  radio: RadioPreference;
  loading: boolean;
  savingRadio: boolean;
  setRadioEnabled: (enabled: boolean) => Promise<void>;
};

const DEFAULT_RADIO: RadioPreference = {
  permitted: false,
  enabled: false,
  effective: false,
};

const UserPreferencesContext = React.createContext<UserPreferencesContextValue>({
  radio: DEFAULT_RADIO,
  loading: true,
  savingRadio: false,
  setRadioEnabled: async () => undefined,
});

function fallbackRadio(permitted: boolean, enabled = false): RadioPreference {
  return { permitted, enabled, effective: permitted && enabled };
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { session, status, ready, userId } = useSessionReady();
  const sessionPermitted = permissionSetHas(session?.user?.permissoes, PERMS.RADIOS);
  // Booleano, nao o status: o "loading" passageiro da renovacao de permissoes
  // nao pode refazer a busca. Logout e troca de usuario refazem na hora.
  const semSessao = status === "unauthenticated";
  const [radio, setRadio] = React.useState<RadioPreference>(DEFAULT_RADIO);
  const [loading, setLoading] = React.useState(true);
  const [savingRadio, setSavingRadio] = React.useState(false);

  React.useEffect(() => {
    if (!ready || !userId) {
      if (semSessao) {
        setRadio(DEFAULT_RADIO);
        setLoading(false);
      }
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    async function loadPreferences() {
      try {
        const response = await fetch("/api/me/preferencias", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as PreferencesPayload;
        if (!response.ok || !payload.data?.radio) {
          setRadio(fallbackRadio(sessionPermitted));
          return;
        }
        setRadio(payload.data.radio);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[preferencias] usando configuração local temporária", error);
        // Sem resposta da API, mantemos o padrão desligado em vez de exibir um
        // player que o usuário talvez não tenha ligado.
        setRadio(fallbackRadio(sessionPermitted));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    const timer = window.setTimeout(() => void loadPreferences(), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ready, semSessao, sessionPermitted, userId]);

  const setRadioEnabled = React.useCallback(
    async (enabled: boolean) => {
      if (savingRadio) return;

      const previous = radio;
      const optimistic = fallbackRadio(previous.permitted, enabled);
      setRadio(optimistic);
      setSavingRadio(true);

      try {
        const response = await fetch("/api/me/preferencias", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ radio: { enabled } }),
        });
        const payload = (await response.json().catch(() => ({}))) as PreferencesPayload;
        if (!response.ok || !payload.data?.radio) {
          throw new Error(payload.error || "Não foi possível salvar sua preferência.");
        }
        setRadio(payload.data.radio);
      } catch (error) {
        setRadio(previous);
        throw error;
      } finally {
        setSavingRadio(false);
      }
    },
    [radio, savingRadio],
  );

  const value = React.useMemo(
    () => ({ radio, loading, savingRadio, setRadioEnabled }),
    [loading, radio, savingRadio, setRadioEnabled],
  );

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  return React.useContext(UserPreferencesContext);
}
