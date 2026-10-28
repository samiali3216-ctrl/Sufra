export function validPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

export function createPushService(db, origin, pushSender) {
  return {
    publicKey: "",
    async deliver(announcement) {
      return { sent: 0, failed: 0 };
    },
  };
}
