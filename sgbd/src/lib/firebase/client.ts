import { initializeApp, type FirebaseApp } from "firebase/app";
import { config, isFirebaseConfigured } from "@/lib/config";

let app: FirebaseApp | null = null;

/**
 * Inicializa o Firebase no cliente (singleton).
 * Retorna null se as credenciais não estiverem configuradas.
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (!app) {
    app = initializeApp(config.firebase);
  }
  return app;
}

export interface FirebaseStatus {
  configured: boolean;
  appReady: boolean;
}

export function checkFirebaseStatus(): FirebaseStatus {
  const configured = isFirebaseConfigured();
  return { configured, appReady: configured && getFirebaseApp() !== null };
}
