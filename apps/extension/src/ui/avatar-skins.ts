import type { AvatarSkin } from "@core";
export function avatarAsset(skin: AvatarSkin = "hypeman"): string {
  return skin === "hypeman" ? "hypeman.png" : `skins/${skin}.png`;
}
