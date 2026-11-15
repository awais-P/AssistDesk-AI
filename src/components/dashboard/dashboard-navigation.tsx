"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { DashboardRouteSkeleton } from "./dashboard-route-skeleton";

type NavigationContextType = {
  targetHref: string | null;
  isPending: boolean;
  navigate: (href: string) => void;
};

const NavigationContext = createContext<NavigationContextType>({
  targetHref: null,
  isPending: false,
  navigate: () => {},
});

export function useDashboardNavigation() {
  return useContext(NavigationContext);
}

export function DashboardNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [targetHref, setTargetHref] = useState<string | null>(null);

  // Clear target href as soon as pathname catches up
  useEffect(() => {
    if (targetHref && pathname === targetHref.split("?")[0]) {
      setTargetHref(null);
    }
  }, [pathname, targetHref]);

  function navigate(href: string) {
    const cleanHref = href.split("?")[0];
    const currentClean = pathname.split("?")[0];

    // Already on this page
    if (cleanHref === currentClean) {
      return;
    }

    setTargetHref(href);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <NavigationContext.Provider value={{ targetHref, isPending, navigate }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function DashboardMainContent({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { targetHref, isPending } = useDashboardNavigation();

  const isSwitchingRoute =
    Boolean(targetHref) &&
    isPending &&
    Boolean(targetHref && pathname !== targetHref.split("?")[0]);

  if (isSwitchingRoute && targetHref) {
    return <DashboardRouteSkeleton href={targetHref} />;
  }

  return <>{children}</>;
}
