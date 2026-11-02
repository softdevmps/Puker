/**
 * Persistencia con el SQLite que trae Node (`node:sqlite`).
 *
 * Elegido a propósito por sobre better-sqlite3: no necesita compilación nativa,
 * así que funciona igual en Windows, en Linux y dentro de Docker sin toolchain.
 *
 * Todo lo que acá se guarda es: quién sos y cómo te fue. Las mesas en curso
 * siguen viviendo en memoria.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { TournamentRecord } from '../tournament.js';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string | null;
  google_sub: string | null;
  avatar_url: string | null;
  bio: string;
  transfer_alias: string | null;
  created_at: number;
  last_seen_at: number;
}

export interface RankingRow {
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  /** Fichas netas: lo ganado menos lo apostado, sumando todas las manos. */
  net: number;
  hands: number;
  wins: number;
  biggestPot: number;
  bestHand: string | null;
  lastPlayedAt: number | null;
}

export interface HandRow {
  userId: number;
  roomCode: string;
  handNumber: number;
  netChips: number;
  won: boolean;
  potSize: number;
  handLabel: string | null;
  playedAt: number;
}

/**
 * `node:sqlite` devuelve filas como `Record<string, SQLOutputValue>`. El
 * esquema es nuestro, así que acá sabemos la forma real de cada fila; este
 * helper concentra esa afirmación en un solo lugar en vez de repartir casts.
 */
function asRow<T>(value: unknown): T | null {
  return (value as T | undefined) ?? null;
}

/** Migraciones en orden. Nunca se edita una ya aplicada: se agrega otra. */
const MIGRATIONS: { name: string; sql: string }[] = [
  // Las migraciones aplicadas se mantienen intactas.
  {
    name: '001-inicial',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    NOT NULL UNIQUE,
        display_name  TEXT    NOT NULL,
        password_hash TEXT,
        google_sub    TEXT    UNIQUE,
        avatar_url    TEXT,
        created_at    INTEGER NOT NULL,
        last_seen_at  INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        token_hash  TEXT    PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);

      -- Una fila por jugador por mano. De acá sale todo el ranking.
      CREATE TABLE hand_results (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room_code   TEXT    NOT NULL,
        hand_number INTEGER NOT NULL,
        net_chips   INTEGER NOT NULL,
        won         INTEGER NOT NULL,
        pot_size    INTEGER NOT NULL,
        hand_label  TEXT,
        played_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_hands_user ON hand_results(user_id);
      CREATE INDEX idx_hands_played ON hand_results(played_at);
    `,
  },
  {
    name: '002-torneos',
    sql: `
      CREATE TABLE tournament_records (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE tournament_members (
        tournament_id TEXT NOT NULL REFERENCES tournament_records(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        PRIMARY KEY(tournament_id, user_id)
      );
      CREATE INDEX idx_tournament_member_user ON tournament_members(user_id);
    `,
  },
  {
    name: '003-perfiles',
    sql: `
      ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN transfer_alias TEXT;
      CREATE TABLE user_avatars (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        revision TEXT NOT NULL,
        image BLOB NOT NULL
      );
    `,
  },
];

export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true });
    }

    this.db = new DatabaseSync(file);
    // WAL aguanta mejor lecturas concurrentes mientras se escribe.
    if (file !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        name       TEXT    PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    const applied = new Set(
      (this.db.prepare('SELECT name FROM migrations').all() as { name: string }[]).map(
        (row) => row.name,
      ),
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(migration.sql);
        this.db
          .prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)')
          .run(migration.name, Date.now());
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw new Error(`Falló la migración ${migration.name}: ${(error as Error).message}`);
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // ------------------------------------------------------------------ users

  findUserById(id: number): UserRow | null {
    return asRow<UserRow>(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }

  findUserByUsername(username: string): UserRow | null {
    return asRow<UserRow>(
      this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase()),
    );
  }

  findUserByGoogleSub(sub: string): UserRow | null {
    return asRow<UserRow>(this.db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub));
  }

  createUser(input: {
    username: string;
    displayName: string;
    passwordHash?: string | null;
    googleSub?: string | null;
    avatarUrl?: string | null;
  }): UserRow {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, google_sub, avatar_url, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.username.toLowerCase(),
        input.displayName,
        input.passwordHash ?? null,
        input.googleSub ?? null,
        input.avatarUrl ?? null,
        now,
        now,
      );

    const created = this.findUserById(Number(result.lastInsertRowid));
    if (!created) throw new Error('No se pudo crear el usuario');
    return created;
  }

  /** Vincula una cuenta de Google a un usuario que ya existía por contraseña. */
  linkGoogle(userId: number, googleSub: string, avatarUrl: string | null): void {
    this.db
      .prepare('UPDATE users SET google_sub = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?')
      .run(googleSub, avatarUrl, userId);
  }

  setPasswordHash(userId: number, passwordHash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
  }

  updateDisplayName(userId: number, displayName: string): void {
    this.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, userId);
  }

  updateProfile(userId: number, profile: { displayName: string; bio: string; transferAlias: string | null; avatar?: Buffer | null }): UserRow {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE users SET display_name = ?, bio = ?, transfer_alias = ? WHERE id = ?')
        .run(profile.displayName, profile.bio, profile.transferAlias, userId);
      if (profile.avatar !== undefined) {
        let avatarUrl: string | null = null;
        if (profile.avatar === null) this.db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(userId);
        else {
          const revision = createHash('sha256').update(profile.avatar).digest('hex').slice(0, 24);
          this.db.prepare(`INSERT INTO user_avatars (user_id, revision, image) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, image = excluded.image`)
            .run(userId, revision, profile.avatar);
          avatarUrl = `/api/auth/avatar/${userId}/${revision}`;
        }
        this.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, userId);
      }
      const user = this.findUserById(userId);
      if (!user) throw new Error('No existe la cuenta');
      this.db.exec('COMMIT');
      return user;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  avatarFor(userId: number, revision: string): Uint8Array | null {
    const row = this.db.prepare('SELECT image FROM user_avatars WHERE user_id = ? AND revision = ?').get(userId, revision) as { image: Uint8Array } | undefined;
    return row?.image ?? null;
  }

  touchUser(userId: number): void {
    this.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), userId);
  }

  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return row.n;
  }

  // --------------------------------------------------------------- sessions

  createSession(tokenHash: string, userId: number, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, Date.now(), expiresAt);
  }

  /** Devuelve el usuario de una sesión vigente, o null si venció o no existe. */
  findUserBySessionToken(tokenHash: string): UserRow | null {
    return asRow<UserRow>(
      this.db
        .prepare(
          `SELECT u.* FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(tokenHash, Date.now()),
    );
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteExpiredSessions(): number {
    const result = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    return Number(result.changes);
  }

  // ------------------------------------------------------------ resultados

  saveTournament(record: TournamentRecord): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO tournament_records (id, room_code, started_at, record_json)
        VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json`)
        .run(record.id, record.roomCode, record.startedAt, JSON.stringify(record));
      const addMember = this.db.prepare('INSERT OR IGNORE INTO tournament_members (tournament_id, user_id) VALUES (?, ?)');
      for (const userId of record.userIds) addMember.run(record.id, userId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  tournamentsFor(userId: number): TournamentRecord[] {
    const rows = this.db.prepare(`SELECT r.record_json FROM tournament_records r
      JOIN tournament_members m ON m.tournament_id = r.id
      WHERE m.user_id = ? ORDER BY r.started_at DESC LIMIT 50`).all(userId) as { record_json: string }[];
    return rows.map((row) => JSON.parse(row.record_json) as TournamentRecord);
  }

  /** Guarda todas las filas de una mano en una sola transacción. */
  recordHand(rows: HandRow[]): void {
    if (rows.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO hand_results
         (user_id, room_code, hand_number, net_chips, won, pot_size, hand_label, played_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.exec('BEGIN');
    try {
      for (const row of rows) {
        insert.run(
          row.userId,
          row.roomCode,
          row.handNumber,
          Math.round(row.netChips),
          row.won ? 1 : 0,
          Math.round(row.potSize),
          row.handLabel,
          row.playedAt,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Ranking general. Incluye a quien todavía no jugó ninguna mano (en 0), para
   * que alguien recién registrado se vea en la tabla.
   */
  ranking(limit = 100): RankingRow[] {
    const rows = this.db
      .prepare(
        `SELECT
           u.id                                   AS userId,
           u.display_name                         AS displayName,
           u.avatar_url                           AS avatarUrl,
           COALESCE(SUM(h.net_chips), 0)          AS net,
           COUNT(h.id)                            AS hands,
           COALESCE(SUM(h.won), 0)                AS wins,
           COALESCE(MAX(CASE WHEN h.won = 1 THEN h.pot_size END), 0) AS biggestPot,
           MAX(h.played_at)                       AS lastPlayedAt
         FROM users u
         LEFT JOIN hand_results h ON h.user_id = u.id
         GROUP BY u.id
         ORDER BY net DESC, wins DESC, hands DESC
         LIMIT ?`,
      )
      .all(limit) as Omit<RankingRow, 'bestHand'>[];

    // La mejor mano mostrada se busca aparte: meterla en el GROUP BY de arriba
    // obligaba a una subconsulta por fila bastante más cara de leer.
    const bestHand = this.db.prepare(
      `SELECT hand_label FROM hand_results
       WHERE user_id = ? AND won = 1 AND hand_label IS NOT NULL
       ORDER BY pot_size DESC LIMIT 1`,
    );

    return rows.map((row) => ({
      ...row,
      bestHand:
        (bestHand.get(row.userId) as { hand_label: string } | undefined)?.hand_label ?? null,
    }));
  }

  statsFor(userId: number): RankingRow | null {
    return this.ranking(1000).find((row) => row.userId === userId) ?? null;
  }
}
