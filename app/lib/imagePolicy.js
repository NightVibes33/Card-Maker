export const ALLOWED_IMAGE_HOSTS = Object.freeze([
  'cdn.shopify.com',
  'www.animetowncreations.com',
  'animetowncreations.com',
  'stickyinkdesigns.com',
  'www.stickyinkdesigns.com',
  'cucucovers.com',
  'www.cucucovers.com',
  'styledcards.com',
  'www.styledcards.com'
]);

const ALLOWED_IMAGE_HOST_SET = new Set(ALLOWED_IMAGE_HOSTS);

export function parseAllowedRemoteImageUrl(value) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(String(value || ''));
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    !ALLOWED_IMAGE_HOST_SET.has(url.hostname.toLowerCase())
  ) {
    return null;
  }

  return url;
}

export function normalizeAllowedRemoteImageUrl(value) {
  return parseAllowedRemoteImageUrl(value)?.toString() || '';
}

export function isAllowedRemoteImageUrl(value) {
  return Boolean(parseAllowedRemoteImageUrl(value));
}
