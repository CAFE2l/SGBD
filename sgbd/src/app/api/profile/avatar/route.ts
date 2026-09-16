import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";
import { config, isCloudinaryConfigured } from "@/lib/config";
import { UnauthorizedError, verifyFirebaseIdToken } from "@/lib/firebase/verify-token";

export const runtime = "nodejs";

const AVATAR_FOLDER = "sgbd-web/avatars";
const AVATAR_SIZE = 400;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

function avatarPublicId(uid: string) {
  return `${AVATAR_FOLDER}/${uid}`;
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });
}

/** Extrai e valida o ID token do header Authorization. */
async function authorize(req: NextRequest): Promise<string> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new UnauthorizedError("Token de autenticação ausente.");
  const payload = await verifyFirebaseIdToken(token);
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new UnauthorizedError("Token inválido.");
  }
  return payload.sub;
}

/** Faz upload/sobrescreve o avatar do usuário e resolve para secure_url. */
function uploadAvatar(buffer: Buffer, publicId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: true,
        resource_type: "image",
        transformation: [
          { width: AVATAR_SIZE, height: AVATAR_SIZE, crop: "fill", gravity: "face" },
          { fetch_format: "auto", quality: "auto" },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else if (!result?.secure_url) reject(new Error("Cloudinary não retornou uma URL."));
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

export async function POST(req: NextRequest) {
  let uid: string;
  try {
    uid = await authorize(req);
  } catch (e) {
    const status = e instanceof UnauthorizedError ? 401 : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha na autenticação." },
      { status }
    );
  }

  if (!isCloudinaryConfigured()) {
    return NextResponse.json(
      { error: "Cloudinary não configurado no servidor." },
      { status: 501 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Formato inválido. Envie PNG, JPG ou WEBP." },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Arquivo muito grande (máx. 5 MB)." },
        { status: 400 }
      );
    }

    configureCloudinary();
    const buffer = Buffer.from(await file.arrayBuffer());
    const secureUrl = await uploadAvatar(buffer, avatarPublicId(uid));

    return NextResponse.json({ secure_url: secureUrl });
  } catch (e) {
    console.error("[avatar] upload failed:", e);
    return NextResponse.json(
      { error: "Falha no upload, tente novamente." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  let uid: string;
  try {
    uid = await authorize(req);
  } catch (e) {
    const status = e instanceof UnauthorizedError ? 401 : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha na autenticação." },
      { status }
    );
  }

  if (!isCloudinaryConfigured()) {
    return NextResponse.json(
      { error: "Cloudinary não configurado no servidor." },
      { status: 501 }
    );
  }

  try {
    configureCloudinary();
    const result = await cloudinary.uploader.destroy(avatarPublicId(uid));
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[avatar] remove failed:", e);
    return NextResponse.json(
      { error: "Falha ao remover a foto, tente novamente." },
      { status: 500 }
    );
  }
}