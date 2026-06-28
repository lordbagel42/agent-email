-- Better Auth core tables (camelCase columns - better-auth default)
CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);

CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expiresAt INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON session(userId);
CREATE INDEX IF NOT EXISTS session_token_idx ON session(token);

CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS account_userId_idx ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

-- MCP / OAuth Provider plugin tables (camelCase)
CREATE TABLE IF NOT EXISTS oauthApplication (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL UNIQUE,
    clientSecret TEXT,
    name TEXT NOT NULL,
    icon TEXT,
    metadata TEXT,
    redirectUrls TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'public',
    disabled INTEGER NOT NULL DEFAULT 0,
    scope TEXT,
    clientSecretExpiresAt INTEGER,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);

CREATE TABLE IF NOT EXISTS oauthAccessToken (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    clientId TEXT NOT NULL,
    sessionId TEXT,
    refreshId TEXT,
    userId TEXT,
    referenceId TEXT,
    scopes TEXT,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    expiresAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauthRefreshToken (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    clientId TEXT NOT NULL,
    sessionId TEXT,
    userId TEXT,
    referenceId TEXT,
    scopes TEXT,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    expiresAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauthConsent (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    clientId TEXT NOT NULL,
    referenceId TEXT,
    scopes TEXT,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);

CREATE TABLE IF NOT EXISTS oauthAuthorizationCode (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    clientId TEXT NOT NULL,
    userId TEXT NOT NULL,
    redirectUri TEXT NOT NULL,
    scopes TEXT,
    codeChallenge TEXT,
    codeChallengeMethod TEXT,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
