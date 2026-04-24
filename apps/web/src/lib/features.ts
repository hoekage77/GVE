function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}

export function isMetaChatUiEnabled(): boolean {
  const flag = import.meta.env.VITE_CHAT_META_UI;
  if (flag === undefined) {
    return true;
  }
  return parseBooleanFlag(flag);
}
