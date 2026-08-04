"use client";

import * as React from "react";
import { useSession } from "next-auth/react";

export function SessionPermissionsRefresher() {
  const { status, update } = useSession();
  const refreshed = React.useRef(false);

  React.useEffect(() => {
    if (status !== "authenticated" || refreshed.current) return;

    refreshed.current = true;
    void update();
  }, [status, update]);

  return null;
}
