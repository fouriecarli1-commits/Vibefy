/**
 * Address classification.
 *
 * Lives on its own, with no dependencies, so that the parts of the engine which
 * run inside the web app — ownership verification, intake screening — can reach
 * it without pulling in a browser driver and an HTTP dispatcher.
 */
import { isIP } from 'node:net';

/**
 * Addresses no assessment may ever reach, whatever the customer declared:
 * loopback, link-local (which is where cloud metadata lives), and the private
 * ranges. Checked against the *resolved* address rather than the hostname, so a
 * domain that resolves inward — deliberately or by rebinding — is still refused.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number) as [number, number, number, number];
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return false;
  }
  return false;
}
