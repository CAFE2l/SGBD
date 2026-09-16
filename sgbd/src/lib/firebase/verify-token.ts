import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "@/lib/config";

const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  }
  return jwks;
}

/** Erro usado para sinalizar requisições não autenticadas nas API routes. */
export class UnauthorizedError extends Error {
  constructor(message = "Não autorizado.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Valida um ID token do Firebase Auth no servidor (RS256 contra as chaves
 * públicas do projeto) e retorna o payload verificado (contém `sub` = uid).
 * Só deve ser usado em API routes — nunca no cliente.
 */
export async function verifyFirebaseIdToken(token: string): Promise<JWTPayload> {
  if (!config.firebase.projectId) {
    throw new UnauthorizedError("Firebase não configurado no servidor.");
  }
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://securetoken.google.com/${config.firebase.projectId}`,
      audience: config.firebase.projectId,
      algorithms: ["RS256"],
    });
    return payload;
  } catch {
    throw new UnauthorizedError("Sessão expirada. Faça login novamente.");
  }
}