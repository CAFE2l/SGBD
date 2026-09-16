"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useAuth } from "@/hooks/useAuth";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;
const EXPORT_SIZE = 512;

type Toast = { type: "ok" | "err"; text: string } | null;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar a imagem."));
    img.src = src;
  });
}

async function cropImageToBlob(
  src: string,
  crop: Area,
  size: number
): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas não suportado neste navegador.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    Math.round(crop.x),
    Math.round(crop.y),
    Math.round(crop.width),
    Math.round(crop.height),
    0,
    0,
    size,
    size
  );
  const render = (mime: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
  const blob =
    (await render("image/webp")) ?? (await render("image/jpeg"));
  if (!blob) throw new Error("Falha ao processar a imagem.");
  return blob;
}

export function ProfileAvatar() {
  const { user, updateProfile } = useAuth();
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropArea, setCropArea] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  if (!user) return null;

  const sessionUser = user;
  const photoURL = sessionUser.photoURL ?? null;
  const initial = (
    sessionUser.displayName?.[0] ?? sessionUser.email?.[0] ?? "?"
  ).toUpperCase();

  function showToast(type: "ok" | "err", text: string) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ type, text });
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      showToast("err", "Formato inválido. Envie PNG, JPG ou WEBP.");
      return;
    }
    if (file.size > MAX_SIZE) {
      showToast("err", "Imagem muito grande (máx. 5 MB).");
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(file);
    setCropSrc(urlRef.current);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropArea(null);
  }

  function closeCrop() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setCropSrc(null);
    setCropArea(null);
  }

  async function uploadAvatarFile(file: File): Promise<string> {
    const token = await sessionUser.getIdToken();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/profile/avatar", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      secure_url?: string;
    };
    if (!res.ok || !data.secure_url) {
      throw new Error(data.error ?? "Falha no upload, tente novamente.");
    }
    return data.secure_url;
  }

  async function onCropConfirm() {
    if (!cropSrc || !cropArea) return;
    setUploading(true);
    try {
      const blob = await cropImageToBlob(cropSrc, cropArea, EXPORT_SIZE);
      const file = new File([blob], "avatar.webp", { type: blob.type });
      const secureUrl = await uploadAvatarFile(file);
      await updateProfile({ photoURL: secureUrl });
      showToast("ok", "Foto de perfil atualizada.");
    } catch (err) {
      showToast(
        "err",
        err instanceof Error ? err.message : "Falha no upload, tente novamente."
      );
    } finally {
      setUploading(false);
      closeCrop();
    }
  }

  async function onRemove() {
    setRemoving(true);
    try {
      const token = await sessionUser.getIdToken();
      await fetch("/api/profile/avatar", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await updateProfile({ photoURL: null });
      showToast("ok", "Foto removida.");
    } catch {
      showToast("err", "Falha ao remover a foto, tente novamente.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="group relative h-16 w-16 shrink-0">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading || removing}
        className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-sky-400/15 ring-1 ring-white/10"
        title={photoURL ? "Alterar foto" : "Adicionar foto"}
      >
        {photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoURL}
            alt="Foto de perfil"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-3xl font-bold text-sky-300">{initial}</span>
        )}
        {uploading ? (
          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/60">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-sky-400/30 border-t-sky-400" />
          </span>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-slate-950/70 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden
            >
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            <span className="text-[10px] font-medium leading-none">
              Alterar foto
            </span>
          </span>
        )}
      </button>
      {photoURL && !uploading && !removing && (
        <button
          type="button"
          onClick={() => void onRemove()}
          title="Remover foto"
          className="pointer-events-none absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-rose-400/40 bg-rose-500 text-white opacity-0 shadow transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-rose-400"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="h-3 w-3"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png, image/jpeg, image/webp"
        className="hidden"
        onChange={onFilePicked}
      />

      {cropSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Editar foto de perfil"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <h2 className="mb-3 text-lg font-semibold text-white">
              Editar foto de perfil
            </h2>
            <p className="mb-3 text-xs text-slate-400">
              Ajuste o enquadramento — a foto será exibida em círculo.
            </p>
            <div className="relative h-72 w-full overflow-hidden rounded-xl bg-slate-950">
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, pixels) => setCropArea(pixels)}
              />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="text-xs text-slate-400">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCrop}
                disabled={uploading}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void onCropConfirm()}
                disabled={uploading}
                className="flex items-center gap-2 rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-300 disabled:opacity-50"
              >
                {uploading && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950/20 border-t-slate-950" />
                )}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[60] rounded-xl border px-4 py-3 text-sm text-white shadow-lg ${
            toast.type === "ok"
              ? "border-emerald-400/40 bg-emerald-500/95"
              : "border-rose-400/40 bg-rose-500/95"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}