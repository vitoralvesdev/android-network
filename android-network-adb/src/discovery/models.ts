export function isAppleModel(model?: string): boolean {
  if (!model) return false;
  return /^(MacBook|Macmini|iMac|MacPro|Mac|iPhone|iPad|iPod|AppleTV|Apple TV|AudioAccessory|HomePod|Watch|Vision)/i.test(
    model.trim(),
  );
}

export function isAndroidModel(model?: string): boolean {
  return !!model && /android|google|chromecast/i.test(model);
}
