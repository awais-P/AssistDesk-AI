"use client";

import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * Keeps the signed-in team member marked as online while the dashboard is open,
 * which drives the widget's online/offline status and operator-offline replies.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    function sendHeartbeat() {
      fetch("/api/presence", { method: "POST" }).catch(() => {
        // Presence is best effort; the next heartbeat will try again.
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        sendHeartbeat();
      }
    }

    sendHeartbeat();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
