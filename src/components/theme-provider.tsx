// src/components/theme-provider.tsx
"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { SessionPermissionsRefresher } from "@/components/session-permissions-refresher";

type NextThemesProps = React.ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider(props: NextThemesProps) {
  return <NextThemesProvider {...props} />;
}

export function Providers({
  children,
  session,
  ...props
}: {
  children: React.ReactNode;
  session?: Session | null;
} & NextThemesProps) {
  return (
    <SessionProvider session={session} refetchInterval={0} refetchOnWindowFocus={false}>
      <SessionPermissionsRefresher />
      <NextThemesProvider {...props}>{children}</NextThemesProvider>
    </SessionProvider>
  );
}
