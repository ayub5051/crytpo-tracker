/* ============================================================================
   BLAZZER — authentication
   JWT signing/verification shared by the REST API and the WebSocket handshake.
   The static demo has no login form yet, so the API can mint a short-lived
   *guest* token; once real auth lands, issueUserToken() drops straight in.
   ========================================================================= */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export function signToken(payload, ttl = config.jwt.userTtl) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: ttl,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

export function issueGuestToken() {
  return signToken({ sub: `guest:${randomUUID()}`, role: 'guest' }, config.jwt.guestTtl);
}

export function issueUserToken(user) {
  return signToken(
    { sub: String(user.id), role: 'user', name: user.name || '' },
    config.jwt.userTtl
  );
}

/** Pull a bearer token from an Authorization header, if present. */
export function bearerFrom(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

export function requireAuth(req, res, next) {
  const token = bearerFrom(req);
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Gate internal ingestion behind the shared service key. */
export function requireService(req, res, next) {
  const provided = req.headers['x-service-key'];
  if (!config.serviceKey || provided !== config.serviceKey) {
    return res.status(401).json({ error: 'Invalid service key' });
  }
  return next();
}

/**
 * Extract a token from a WebSocket upgrade: `?token=` first, then the
 * `Sec-WebSocket-Protocol` header (`bearer, <token>`), so browsers that cannot
 * set headers can still authenticate.
 */
export function tokenFromUpgrade(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken;
  } catch {
    /* fall through to the header */
  }

  const proto = req.headers['sec-websocket-protocol'];
  if (proto) {
    const parts = proto.split(',').map((p) => p.trim());
    const bearerIndex = parts.indexOf('bearer');
    if (bearerIndex >= 0 && parts[bearerIndex + 1]) return parts[bearerIndex + 1];
    if (parts.length === 1) return parts[0];
  }
  return null;
}
