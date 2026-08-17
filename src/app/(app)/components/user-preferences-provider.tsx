"use client";

import * as React from "react";
import { useSession } from "next-auth/react";

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
  enabled: true,
  effective: false,
};

const UserPreferencesContext = React.createContext<UserPreferencesContextValue>({
  radio: DEFAULT_RADIO,
  loading: true,
  savingRadio: false,
  setRadioEnabled: async () => undefined,
});

function fallbackRadio(permitted: boolean, enabled = true): RadioPreference {
  return { permitted, enabled, effective: permitted && enabled };
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const sessionPermitted = permissionSetHas(session?.user?.permissoes, PERMS.RADIOS);
  const [radio, setRadio] = React.useState<RadioPreference>(DEFAULT_RADIO);
  const [loading, setLoading] = React.useState(true);
  const [savingRadio, setSavingRadio] = React.useState(false);

  React.useEffect(() => {
    if (status === "loading") return;

    if (status !== "authenticated") {
      setRadio(DEFAULT_RADIO);
      setLoading(false);
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
          throw new Error(payload.error || "Não foi possível carregar suas preferências.");
        }
        setRadio(payload.data.radio);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[preferencias] falha ao carregar", error);
        // Em uma implantação gradual, a indisponibilidade da nova tabela não
        // remove um recurso que já funcionava para o usuário.
        setRadio(fallbackRadio(sessionPermitted));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadPreferences();
    return () => controller.abort();
  }, [sessionPermitted, status]);

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
