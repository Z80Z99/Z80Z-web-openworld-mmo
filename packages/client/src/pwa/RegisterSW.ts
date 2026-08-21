export interface SWRegistrationOptions {
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onError?: (error: Error) => void;
}

let registration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(
  options: SWRegistrationOptions = {},
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    // Listen for updates
    registration.addEventListener("updatefound", () => {
      const newWorker = registration?.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          options.onUpdate?.(registration!);
        }
      });
    });

    return registration;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    options.onError?.(err);
    return null;
  }
}

export function getRegistration(): ServiceWorkerRegistration | null {
  return registration;
}

export async function skipWaiting(): Promise<void> {
  const reg = registration;
  if (reg?.waiting) {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}
