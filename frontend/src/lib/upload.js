"use client";

const IMGBB_API_KEY = process.env.NEXT_PUBLIC_IMGBB_API_KEY;

export async function uploadScreenshot(file) {
  if (!IMGBB_API_KEY) throw new Error("imgbb API key not configured. Add NEXT_PUBLIC_IMGBB_API_KEY to your env vars.");
  const formData = new FormData();
  formData.append("image", file);
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error?.message || "Upload failed");
  return data.data.display_url;
}

export function validateImageFile(file) {
  const MAX_SIZE = 32 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error("Only JPEG, PNG, GIF, and WebP images are supported");
  if (file.size > MAX_SIZE) throw new Error("File size must be under 32MB");
}
