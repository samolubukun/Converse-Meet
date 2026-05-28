export const getApiBase = (): string => {
  // If running locally on a dev port separate from the Axum port 5000
  if (
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.port !== "5000"
  ) {
    return "http://localhost:5000";
  }
  // Otherwise, route requests directly to the hosting domain (e.g. Caddy, Nginx, or Axum itself)
  return window.location.origin;
};

export const getWsBase = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  if (
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.port !== "5000"
  ) {
    return `${protocol}://localhost:5000`;
  }
  return `${protocol}://${window.location.host}`;
};
