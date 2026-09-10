export type DeviceProfile = "mobile" | "desktop";

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
  };
};

function isDesktopUserAgent(userAgent: string) {
  return (
    /Windows NT|Macintosh|X11|Linux x86_64|Linux i[3-6]86/i.test(userAgent) &&
    !/Android|Mobile|iPhone|iPad|iPod/i.test(userAgent)
  );
}

/**
 * Returns the UI profile from the browser's low-entropy UA Client Hint.
 * Browsers without Client Hints use a conservative desktop user-agent fallback;
 * every unknown device keeps the existing touch-first mobile experience.
 */
export function getClientDeviceProfile(): DeviceProfile {
  if (typeof navigator === "undefined") return "mobile";

  const userAgentData = (navigator as NavigatorWithUserAgentData).userAgentData;
  const desktopUserAgent =
    userAgentData?.mobile === false ||
    (userAgentData?.mobile === undefined && isDesktopUserAgent(navigator.userAgent));

  return desktopUserAgent && window.innerWidth >= 768 ? "desktop" : "mobile";
}

/** Runs in the document head before the application paints. */
export const DEVICE_PROFILE_BOOTSTRAP = `try {
  var uaData = navigator.userAgentData;
  var ua = navigator.userAgent || "";
  var desktopUserAgent = uaData ? uaData.mobile === false : /Windows NT|Macintosh|X11|Linux x86_64|Linux i[3-6]86/i.test(ua) && !/Android|Mobile|iPhone|iPad|iPod/i.test(ua);
  document.documentElement.dataset.uiDevice = desktopUserAgent && window.innerWidth >= 768 ? "desktop" : "mobile";
} catch (_) {
  document.documentElement.dataset.uiDevice = "mobile";
}`;
