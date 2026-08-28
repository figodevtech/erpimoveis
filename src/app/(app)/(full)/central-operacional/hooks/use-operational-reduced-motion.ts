"use client";

import * as React from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function useOperationalReducedMotion() {
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const syncPreference = () => setReducedMotion(mediaQuery.matches);

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);
    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  return reducedMotion;
}
