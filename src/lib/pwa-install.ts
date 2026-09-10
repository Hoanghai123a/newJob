import { useEffect, useMemo, useState } from "react";

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();

function emit() {
  subscribers.forEach((subscriber) => subscriber(deferredPrompt));
}

function setDeferredPrompt(prompt: BeforeInstallPromptEvent | null) {
  deferredPrompt = prompt;
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event: Event) => {
    event.preventDefault();
    setDeferredPrompt(event as BeforeInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => setDeferredPrompt(null));
}

export function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosDevice() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isIpadOs = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return isIos || isIpadOs;
}

export function isAndroidDevice() {
  if (typeof window === "undefined") return false;
  return /android/i.test(window.navigator.userAgent);
}

export function installPwaPromptListeners() {
  return () => undefined;
}

export function usePwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    deferredPrompt,
  );
  const isIos = useMemo(() => isIosDevice(), []);
  const isAndroid = useMemo(() => isAndroidDevice(), []);

  useEffect(() => {
    subscribers.add(setInstallPrompt);
    setInstallPrompt(deferredPrompt);
    return () => {
      subscribers.delete(setInstallPrompt);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return "unavailable" as const;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setDeferredPrompt(null);
    return choice.outcome;
  };

  return { installPrompt, installApp, isAndroid, isIos };
}
