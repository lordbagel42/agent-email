-- Temp email addresses created by agents
CREATE TABLE IF NOT EXISTS temp_emails (
    address TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_temp_emails_user ON temp_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_temp_emails_expires ON temp_emails(expires_at);

-- Received emails
CREATE TABLE IF NOT EXISTS received_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    sender TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT,
    body_html TEXT,
    message_id TEXT,
    received_at TEXT NOT NULL,
    FOREIGN KEY (recipient) REFERENCES temp_emails(address)
);

CREATE INDEX IF NOT EXISTS idx_received_emails_recipient ON received_emails(recipient);
