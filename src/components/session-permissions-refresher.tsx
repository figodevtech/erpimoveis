"use client";

import * as React from "react";
import { useSession } from "next-auth/react";

export function SessionPermissionsRefresher() {
  const { status, update } = useSession();
  const updateRef = React.useRef(update);
  const refreshingRef = React.useRef(false);
  const initialRefreshDoneRef = React.useRef(false);

  React.useEffect(() => {
    updateRef.current = update;
  }, [update]);

  React.useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;

    const refreshPermissions = async () => {
      if (!active || refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        await updateRef.current();
      } finally {
        refreshingRef.current = false;
      }
    };

    if (!initialRefreshDoneRef.current) {
      initialRefreshDoneRef.current = true;
      void refreshPermissions();
    }

    const interval = window.setInterval(() => {
      void refreshPermissions();
    }, 5 * 60 * 1000);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshPermissions();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [status]);

  return null;
}
