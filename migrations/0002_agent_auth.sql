-- Agent-auth plugin tables (agentHost, agent, agentCapabilityGrant, approvalRequest)
-- and device-authorization plugin table (deviceCode).
-- Generated manually from plugin schema definitions to match expected column names.

CREATE TABLE IF NOT EXISTS "agentHost" (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT,
    userId TEXT REFERENCES "user"(id) ON DELETE CASCADE,
    defaultCapabilities TEXT,
    publicKey TEXT,
    kid TEXT,
    jwksUrl TEXT,
    enrollmentTokenHash TEXT,
    enrollmentTokenExpiresAt INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    activatedAt INTEGER,
    expiresAt INTEGER,
    lastUsedAt INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "agentHost_userId_idx" ON "agentHost"(userId);
CREATE INDEX IF NOT EXISTS "agentHost_kid_idx" ON "agentHost"(kid);
CREATE INDEX IF NOT EXISTS "agentHost_enrollmentTokenHash_idx" ON "agentHost"(enrollmentTokenHash);
CREATE INDEX IF NOT EXISTS "agentHost_status_idx" ON "agentHost"(status);

CREATE TABLE IF NOT EXISTS "agent" (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    userId TEXT REFERENCES "user"(id) ON DELETE CASCADE,
    hostId TEXT NOT NULL REFERENCES "agentHost"(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    mode TEXT NOT NULL DEFAULT 'delegated',
    publicKey TEXT NOT NULL,
    kid TEXT,
    jwksUrl TEXT,
    lastUsedAt INTEGER,
    activatedAt INTEGER,
    expiresAt INTEGER,
    metadata TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_userId_idx" ON "agent"(userId);
CREATE INDEX IF NOT EXISTS "agent_hostId_idx" ON "agent"(hostId);
CREATE INDEX IF NOT EXISTS "agent_status_idx" ON "agent"(status);
CREATE INDEX IF NOT EXISTS "agent_kid_idx" ON "agent"(kid);

CREATE TABLE IF NOT EXISTS "agentCapabilityGrant" (
    id TEXT NOT NULL PRIMARY KEY,
    agentId TEXT NOT NULL REFERENCES "agent"(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    deniedBy TEXT REFERENCES "user"(id) ON DELETE CASCADE,
    grantedBy TEXT REFERENCES "user"(id) ON DELETE CASCADE,
    expiresAt INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    constraints TEXT
);

CREATE INDEX IF NOT EXISTS "agentCapabilityGrant_agentId_idx" ON "agentCapabilityGrant"(agentId);
CREATE INDEX IF NOT EXISTS "agentCapabilityGrant_capability_idx" ON "agentCapabilityGrant"(capability);
CREATE INDEX IF NOT EXISTS "agentCapabilityGrant_grantedBy_idx" ON "agentCapabilityGrant"(grantedBy);
CREATE INDEX IF NOT EXISTS "agentCapabilityGrant_status_idx" ON "agentCapabilityGrant"(status);

CREATE TABLE IF NOT EXISTS "approvalRequest" (
    id TEXT NOT NULL PRIMARY KEY,
    method TEXT NOT NULL,
    agentId TEXT REFERENCES "agent"(id) ON DELETE CASCADE,
    hostId TEXT REFERENCES "agentHost"(id) ON DELETE CASCADE,
    userId TEXT REFERENCES "user"(id) ON DELETE CASCADE,
    capabilities TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    userCodeHash TEXT,
    loginHint TEXT,
    bindingMessage TEXT,
    clientNotificationToken TEXT,
    clientNotificationEndpoint TEXT,
    deliveryMode TEXT,
    interval INTEGER NOT NULL DEFAULT 5,
    lastPolledAt INTEGER,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "approvalRequest_agentId_idx" ON "approvalRequest"(agentId);
CREATE INDEX IF NOT EXISTS "approvalRequest_hostId_idx" ON "approvalRequest"(hostId);
CREATE INDEX IF NOT EXISTS "approvalRequest_userId_idx" ON "approvalRequest"(userId);
CREATE INDEX IF NOT EXISTS "approvalRequest_status_idx" ON "approvalRequest"(status);

-- Device-authorization plugin table
CREATE TABLE IF NOT EXISTS "deviceCode" (
    id TEXT NOT NULL PRIMARY KEY,
    deviceCode TEXT NOT NULL UNIQUE,
    userCode TEXT NOT NULL UNIQUE,
    userId TEXT,
    expiresAt INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    lastPolledAt INTEGER,
    pollingInterval INTEGER NOT NULL DEFAULT 5,
    clientId TEXT,
    scope TEXT
);

CREATE INDEX IF NOT EXISTS "deviceCode_deviceCode_idx" ON "deviceCode"(deviceCode);
CREATE INDEX IF NOT EXISTS "deviceCode_userCode_idx" ON "deviceCode"(userCode);
