
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator < 1) return;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || Object.hasOwn(process.env, key)) return;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

loadEnvFile(path.resolve(process.env.IQRO_ENV_FILE || path.join(__dirname, '.env')));

const PORT = Number(process.env.PORT || 4720);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_DB_FILE = path.join(__dirname, 'data', 'app-db.json');
const DB_FILE = path.resolve(process.env.IQRO_DATA_FILE || DEFAULT_DB_FILE);
const DATA_DIR = path.dirname(DB_FILE);
const DEV_OWNER_PHONE = '6285111344717';
const LEGACY_OWNER_PHONE = '6281234567890';
const DEV_OWNER_NAME = 'Pemilik Iqro';
const DEV_OWNER_PASSWORD = 'Admin#Iqro2026';
const MAX_MEMORIAL_NAMES = 20;
const MAX_MEMORIAL_NAME_LENGTH = 80;
const DAILY_READING_TIME_ZONE = 'Asia/Jakarta';
const DAILY_READING_HISTORY_DAYS = 93;
const PRAYER_TIMES_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const prayerTimesCache = new Map();
const PRAYER_LOCATIONS = Object.freeze({
  jakarta: { label: 'Jakarta', latitude: -6.2088, longitude: 106.8456 },
  bandung: { label: 'Bandung', latitude: -6.9175, longitude: 107.6191 },
  semarang: { label: 'Semarang', latitude: -6.9667, longitude: 110.4167 },
  yogyakarta: { label: 'Yogyakarta', latitude: -7.7956, longitude: 110.3695 },
  surabaya: { label: 'Surabaya', latitude: -7.2575, longitude: 112.7521 },
  medan: { label: 'Medan', latitude: 3.5952, longitude: 98.6722 },
  palembang: { label: 'Palembang', latitude: -2.9909, longitude: 104.7566 },
  denpasar: { label: 'Denpasar', latitude: -8.6500, longitude: 115.2167 },
  banjarmasin: { label: 'Banjarmasin', latitude: -3.3186, longitude: 114.5944 },
  balikpapan: { label: 'Balikpapan', latitude: -1.2379, longitude: 116.8529 },
  makassar: { label: 'Makassar', latitude: -5.1477, longitude: 119.4327 },
  manado: { label: 'Manado', latitude: 1.4748, longitude: 124.8421 },
  jayapura: { label: 'Jayapura', latitude: -2.5916, longitude: 140.6690 }
});
const SURAH_AYAT_COUNTS = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6];

function nowIso() {
  return new Date().toISOString();
}

function readingDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DAILY_READING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((output, part) => {
    if (part.type !== 'literal') output[part.type] = part.value;
    return output;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseReadingDateKey(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function readingDateKeyFromUtcDate(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function shiftReadingDateKey(dateKey, dayOffset) {
  const date = parseReadingDateKey(dateKey);
  if (!date) return dateKey;
  date.setUTCDate(date.getUTCDate() + Number(dayOffset || 0));
  return readingDateKeyFromUtcDate(date);
}

function countDailyAyatInRange(records, startDateKey, endDateKey) {
  if (!isObj(records)) return 0;
  return Object.entries(records).reduce((total, [dateKey, ayahKeys]) => {
    if (dateKey < startDateKey || dateKey > endDateKey || !Array.isArray(ayahKeys)) return total;
    return total + ayahKeys.length;
  }, 0);
}

function readingPeriodComparison(current, previous) {
  const safeCurrent = Math.max(0, Number(current) || 0);
  const safePrevious = Math.max(0, Number(previous) || 0);
  return { current: safeCurrent, previous: safePrevious, difference: safeCurrent - safePrevious };
}

function isObj(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, fallback = '', maxLength = 80) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, maxLength) : fallback;
}

function normalizeMemorialNames(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const names = [];
  value.forEach((item) => {
    const name = cleanText(item, '', MAX_MEMORIAL_NAME_LENGTH);
    const key = name.toLocaleLowerCase('id-ID');
    if (!name || seen.has(key) || names.length >= MAX_MEMORIAL_NAMES) return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

function cleanPassword(value) {
  return String(value || '').trim();
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 64;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  let normalized = digits;
  if (normalized.startsWith('0')) normalized = `62${normalized.slice(1)}`;
  else if (normalized.startsWith('8')) normalized = `62${normalized}`;
  if (!normalized.startsWith('62')) return '';
  if (normalized.length < 10 || normalized.length > 16) return '';
  return normalized;
}

function phoneDisplay(phone) {
  return phone ? `+${phone}` : '';
}

function localPhoneDisplay(phone) {
  const normalized = String(phone || '');
  return normalized.startsWith('62') ? `0${normalized.slice(2)}` : normalized;
}

function normalizeAdminUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  return /^[a-z0-9._-]{3,40}$/.test(username) ? username : '';
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifySecret(secret, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const derived = crypto.scryptSync(secret, parts[1], 64).toString('hex');
  return safeCompare(derived, parts[2]);
}

function generateTemporaryPassword() {
  const randomNumber = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  return `iqro-${randomNumber}`;
}

function generatePasswordResetRequestCode() {
  const randomNumber = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  return `RST-${randomNumber}`;
}

const whatsappRtlMark = '\u200F';
const whatsappLtrMark = '\u200E';
const whatsappRtlIsolate = '\u2067';
const whatsappLtrIsolate = '\u2066';
const whatsappPopDirectionalIsolate = '\u2069';
const whatsappOpeningSalam = `${whatsappRtlMark}${whatsappRtlIsolate}السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ${whatsappPopDirectionalIsolate}${whatsappRtlMark}`;
const whatsappClosingSalam = `${whatsappRtlMark}${whatsappRtlIsolate}وَالسَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ${whatsappPopDirectionalIsolate}${whatsappRtlMark}`;

function whatsappLeftAligned(value) {
  return `${whatsappLtrMark}${whatsappLtrIsolate}${value}${whatsappPopDirectionalIsolate}${whatsappLtrMark}`;
}

function whatsappResetDelivery(user, temporaryPassword) {
  const message = `${whatsappOpeningSalam}

${whatsappLeftAligned(`${user.name}, berikut password sementara akun Iqro Anda:`)}

${whatsappLeftAligned(`*${temporaryPassword}*`)}

${whatsappLeftAligned('Silakan login menggunakan password tersebut, lalu buat password baru untuk mengamankan akun Anda.')}

${whatsappClosingSalam}`;
  return whatsappDelivery(user.phone, message);
}

function whatsappDelivery(phone, message) {
  const encodedMessage = encodeURIComponent(message);
  return {
    channel: 'whatsapp-app',
    appUrl: `whatsapp://send?phone=${phone}&text=${encodedMessage}`,
    url: `https://wa.me/${phone}?text=${encodedMessage}`
  };
}

function whatsappRegistrationRequestDelivery(db, user) {
  const owner = db.users.find((item) => item.role === 'owner');
  if (!owner?.phone) return null;
  const message = `${whatsappOpeningSalam}

${whatsappLeftAligned(`Izin Admin, saya ${user.name} dengan nomor ${localPhoneDisplay(user.phone)} baru saja membuat akun Iqro. Mohon perkenannya untuk dibantu aktivasi akun saya ya 🙏`)}

${whatsappClosingSalam}`;
  return whatsappDelivery(owner.phone, message);
}

function whatsappActivationDelivery(user) {
  const message = `${whatsappOpeningSalam}

${whatsappLeftAligned(`Alhamdulillah, akun Iqro atas nama ${user.name} telah diaktifkan.`)}

${whatsappLeftAligned(`Silakan login menggunakan nomor ${localPhoneDisplay(user.phone)} dan password yang Anda buat saat mendaftar. Selamat melanjutkan perjalanan tilawah Anda.`)}

${whatsappClosingSalam}`;
  return whatsappDelivery(user.phone, message);
}

function whatsappPasswordResetRequestDelivery(db, user, request) {
  const owner = db.users.find((item) => item.role === 'owner');
  if (!owner?.phone) return null;
  const message = `${whatsappOpeningSalam}

${whatsappLeftAligned(`Izin Admin, saya ${user.name} dengan nomor ${localPhoneDisplay(user.phone)} ingin mengajukan reset password akun Iqro.`)}

${whatsappLeftAligned(`Kode permohonan: *${request.code}*`)}

${whatsappClosingSalam}`;
  return whatsappDelivery(owner.phone, message);
}
function emptyDb() {
  return { users: [], sessions: [], friendships: [], friendRequests: [], groups: [], progressByUserId: {}, dailyReadingByUserId: {} };
}

function normalizeUser(value) {
  if (!isObj(value)) return null;
  const phone = normalizePhone(value.phone);
  if (!phone) return null;
  const createdAt = String(value.createdAt || nowIso());
  const role = value.role === 'owner' || value.role === 'admin' ? 'owner' : 'user';
  const requestedStatus = String(value.accountStatus || '').toLowerCase();
  const accountStatus = role === 'owner'
    ? 'active'
    : (['pending', 'active', 'suspended'].includes(requestedStatus) ? requestedStatus : 'active');
  const rawResetRequest = isObj(value.passwordResetRequest) ? value.passwordResetRequest : null;
  const passwordResetRequest = rawResetRequest?.code && rawResetRequest?.requestedAt
    ? {
        code: cleanText(rawResetRequest.code, '', 24),
        requestedAt: String(rawResetRequest.requestedAt)
      }
    : null;
  return {
    id: String(value.id || `usr_${crypto.randomUUID()}`),
    phone,
    name: cleanText(value.name, `Sahabat ${phone.slice(-4)}`, 60),
    memorialNames: normalizeMemorialNames(value.memorialNames),
    role,
    accountStatus,
    passwordHash: typeof value.passwordHash === 'string' ? value.passwordHash : '',
    mustChangePassword: Boolean(value.mustChangePassword),
    passwordResetAt: String(value.passwordResetAt || ''),
    passwordResetRequest,
    shareReadingStats: value.shareReadingStats === true,
    createdAt,
    updatedAt: String(value.updatedAt || createdAt),
    lastLoginAt: String(value.lastLoginAt || '')
  };
}

function normalizeAdmin(value) {
  if (!isObj(value)) return null;
  const username = normalizeAdminUsername(value.username);
  if (!username) return null;
  const createdAt = String(value.createdAt || nowIso());
  return {
    id: String(value.id || `adm_${crypto.randomUUID()}`),
    username,
    passwordHash: typeof value.passwordHash === 'string' ? value.passwordHash : '',
    createdAt,
    updatedAt: String(value.updatedAt || createdAt),
    lastLoginAt: String(value.lastLoginAt || ''),
    mustRotatePassword: Boolean(value.mustRotatePassword)
  };
}

function normalizeSession(value) {
  if (!isObj(value) || !value.token) return null;
  const subjectType = String(value.subjectType || (value.userId ? 'user' : '')).trim();
  const subjectId = String(value.subjectId || value.userId || '').trim();
  if (subjectType !== 'user' || !subjectId) return null;
  return {
    token: String(value.token),
    subjectType: 'user',
    subjectId,
    createdAt: String(value.createdAt || nowIso()),
    lastUsedAt: String(value.lastUsedAt || value.createdAt || nowIso()),
    expiresAt: String(value.expiresAt || new Date(Date.now() + SESSION_TTL_MS).toISOString())
  };
}

function normalizeFriendship(value) {
  if (!isObj(value)) return null;
  const userAId = String(value.userAId || '').trim();
  const userBId = String(value.userBId || '').trim();
  if (!userAId || !userBId || userAId === userBId) return null;
  return { id: String(value.id || `fr_${crypto.randomUUID()}`), userAId, userBId, createdAt: String(value.createdAt || nowIso()) };
}

function normalizeFriendRequest(value) {
  if (!isObj(value)) return null;
  const fromUserId = String(value.fromUserId || '').trim();
  const toUserId = String(value.toUserId || '').trim();
  if (!fromUserId || !toUserId || fromUserId === toUserId) return null;
  return {
    id: String(value.id || `frq_${crypto.randomUUID()}`),
    fromUserId,
    toUserId,
    createdAt: String(value.createdAt || nowIso())
  };
}

function normalizeGroup(value) {
  if (!isObj(value)) return null;
  const ownerUserId = String(value.ownerUserId || '').trim();
  if (!ownerUserId) return null;
  const memberIds = Array.isArray(value.memberIds)
    ? [...new Set(value.memberIds.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
  if (!memberIds.includes(ownerUserId)) memberIds.unshift(ownerUserId);
  return {
    id: String(value.id || `grp_${crypto.randomUUID()}`),
    name: cleanText(value.name, 'Group Keluarga', 80),
    ownerUserId,
    memberIds,
    createdAt: String(value.createdAt || nowIso())
  };
}

function normalizeProgressMap(value) {
  if (!isObj(value)) return {};
  const output = {};
  Object.entries(value).forEach(([userId, record]) => {
    if (!isObj(record)) return;
    const surah = Math.max(1, Math.min(114, Number(record.surah) || 1));
    const totalAyat = SURAH_AYAT_COUNTS[surah - 1] || Math.max(1, Number(record.totalAyat) || 1);
    output[String(userId)] = {
      surah,
      ayat: Math.max(1, Math.min(totalAyat, Number(record.ayat) || 1)),
      nama: cleanText(record.nama, `Surah ${surah}`, 80),
      totalAyat,
      updatedAt: String(record.updatedAt || nowIso())
    };
  });
  return output;
}

function normalizeDailyReadingMap(value) {
  if (!isObj(value)) return {};
  const output = {};
  Object.entries(value).forEach(([userId, records]) => {
    if (!isObj(records)) return;
    const normalizedRecords = {};
    Object.entries(records)
      .filter(([dateKey]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, DAILY_READING_HISTORY_DAYS)
      .forEach(([dateKey, ayahKeys]) => {
        if (!Array.isArray(ayahKeys)) return;
        const validKeys = [...new Set(ayahKeys.map((item) => String(item || '').trim()).filter((key) => {
          const match = key.match(/^(\d{1,3}):(\d{1,3})$/);
          if (!match) return false;
          const surah = Number(match[1]);
          const ayat = Number(match[2]);
          return surah >= 1 && surah <= 114 && ayat >= 1 && ayat <= SURAH_AYAT_COUNTS[surah - 1];
        }))];
        if (validKeys.length) normalizedRecords[dateKey] = validKeys;
      });
    if (Object.keys(normalizedRecords).length) output[String(userId)] = normalizedRecords;
  });
  return output;
}

function normalizeDb(value) {
  const raw = isObj(value) ? value : {};
  return {
    users: Array.isArray(raw.users) ? raw.users.map(normalizeUser).filter(Boolean) : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions.map(normalizeSession).filter(Boolean) : [],
    friendships: Array.isArray(raw.friendships) ? raw.friendships.map(normalizeFriendship).filter(Boolean) : [],
    friendRequests: Array.isArray(raw.friendRequests) ? raw.friendRequests.map(normalizeFriendRequest).filter(Boolean) : [],
    groups: Array.isArray(raw.groups) ? raw.groups.map(normalizeGroup).filter(Boolean) : [],
    progressByUserId: normalizeProgressMap(raw.progressByUserId),
    dailyReadingByUserId: normalizeDailyReadingMap(raw.dailyReadingByUserId)
  };
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2));
}

function readDb() {
  ensureStore();
  try {
    return normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (error) {
    return emptyDb();
  }
}

function writeDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(normalizeDb(db), null, 2));
}

function bootstrapManagerSeed() {
  const envPhone = normalizePhone(process.env.IQRO_OWNER_PHONE || process.env.IQRO_ADMIN_PHONE);
  const envPassword = cleanPassword(process.env.IQRO_OWNER_PASSWORD || process.env.IQRO_ADMIN_PASSWORD);
  const envName = cleanText(process.env.IQRO_OWNER_NAME || process.env.IQRO_ADMIN_NAME, 'Pemilik Iqro', 60);
  if (envPhone && validPassword(envPassword)) return { phone: envPhone, password: envPassword, name: envName };
  if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
    return { phone: DEV_OWNER_PHONE, password: DEV_OWNER_PASSWORD, name: DEV_OWNER_NAME };
  }
  return null;
}

function ensureBootstrapManager(db) {
  const seed = bootstrapManagerSeed();
  if (!seed) return false;
  let user = db.users.find((item) => item.phone === seed.phone);
  if (!user) {
    user = createUser(seed.phone, seed.name, seed.password, { accountStatus: 'active' });
    user.role = 'owner';
    db.users.push(user);
    return true;
  }

  let changed = false;
  if (user.role !== 'owner') {
    user.role = 'owner';
    changed = true;
  }
  if (user.accountStatus !== 'active') {
    user.accountStatus = 'active';
    changed = true;
  }
  if (!user.passwordHash) {
    user.passwordHash = hashSecret(seed.password);
    changed = true;
  }
  if (changed) user.updatedAt = nowIso();
  return changed;
}

function migrateLegacyOwnerPhone(db) {
  const legacyOwner = db.users.find((user) => user.phone === LEGACY_OWNER_PHONE && user.role === 'owner');
  if (!legacyOwner || db.users.some((user) => user.id !== legacyOwner.id && user.phone === DEV_OWNER_PHONE)) return false;
  legacyOwner.phone = DEV_OWNER_PHONE;
  legacyOwner.updatedAt = nowIso();
  return true;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}
function cleanupSessions(db) {
  const before = db.sessions.length;
  const now = Date.now();
  const userIds = new Set(db.users.map((user) => user.id));
  db.sessions = db.sessions.filter((session) => {
    const expiresAt = Date.parse(session.expiresAt || '');
    return Number.isFinite(expiresAt) && expiresAt > now && session.subjectType === 'user' && userIds.has(session.subjectId);
  });
  return before !== db.sessions.length;
}

function issueSession(db, subjectType, subjectId) {
  const timestamp = nowIso();
  const session = {
    token: crypto.randomBytes(24).toString('hex'),
    subjectType,
    subjectId,
    createdAt: timestamp,
    lastUsedAt: timestamp,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  db.sessions.push(session);
  return session;
}

function authContext(req, db, subjectType) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return { subject: null, changed: false, token: '' };
  const token = header.slice('Bearer '.length).trim();
  if (!token) return { subject: null, changed: false, token: '' };
  const session = db.sessions.find((item) => item.token === token && item.subjectType === subjectType);
  if (!session) return { subject: null, changed: false, token };
  const collection = subjectType === 'admin' ? db.admins : db.users;
  const subject = collection.find((item) => item.id === session.subjectId) || null;
  if (!subject) {
    db.sessions = db.sessions.filter((item) => item.token !== token);
    return { subject: null, changed: true, token };
  }
  session.lastUsedAt = nowIso();
  return { subject, changed: true, token };
}

function revokeSessions(db, subjectType, subjectId, keepToken = '') {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => {
    const isTarget = session.subjectType === subjectType && session.subjectId === subjectId;
    if (!isTarget) return true;
    if (keepToken && session.token === keepToken) return true;
    return false;
  });
  return before - db.sessions.length;
}

function progressRecord(db, userId) {
  const raw = db.progressByUserId[userId];
  if (!isObj(raw)) return null;
  const surah = Math.max(1, Math.min(114, Number(raw.surah) || 1));
  const totalAyat = SURAH_AYAT_COUNTS[surah - 1] || Math.max(1, Number(raw.totalAyat) || 1);
  return {
    surah,
    ayat: Math.max(1, Math.min(totalAyat, Number(raw.ayat) || 1)),
    nama: cleanText(raw.nama, `Surah ${surah}`, 80),
    totalAyat,
    updatedAt: String(raw.updatedAt || nowIso())
  };
}

function dailyReadingView(db, userId) {
  const date = readingDateKey();
  const records = db.dailyReadingByUserId?.[userId] || {};
  const todayDate = parseReadingDateKey(date);
  const yesterdayDateKey = shiftReadingDateKey(date, -1);
  const day = readingPeriodComparison(
    countDailyAyatInRange(records, date, date),
    countDailyAyatInRange(records, yesterdayDateKey, yesterdayDateKey)
  );

  const mondayOffset = todayDate ? (todayDate.getUTCDay() + 6) % 7 : 0;
  const currentWeekStart = shiftReadingDateKey(date, -mondayOffset);
  const previousWeekStart = shiftReadingDateKey(currentWeekStart, -7);
  const previousWeekEnd = shiftReadingDateKey(date, -7);
  const week = readingPeriodComparison(
    countDailyAyatInRange(records, currentWeekStart, date),
    countDailyAyatInRange(records, previousWeekStart, previousWeekEnd)
  );

  const currentYear = todayDate?.getUTCFullYear() || new Date().getUTCFullYear();
  const currentMonth = todayDate?.getUTCMonth() || 0;
  const currentDay = todayDate?.getUTCDate() || 1;
  const currentMonthStart = readingDateKeyFromUtcDate(new Date(Date.UTC(currentYear, currentMonth, 1)));
  const previousMonthStartDate = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
  const previousMonthLastDay = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
  const previousMonthEndDate = new Date(Date.UTC(
    previousMonthStartDate.getUTCFullYear(),
    previousMonthStartDate.getUTCMonth(),
    Math.min(currentDay, previousMonthLastDay)
  ));
  const previousMonthStart = readingDateKeyFromUtcDate(previousMonthStartDate);
  const previousMonthEnd = readingDateKeyFromUtcDate(previousMonthEndDate);
  const previousMonthFullEnd = readingDateKeyFromUtcDate(new Date(Date.UTC(currentYear, currentMonth, 0)));
  const previousMonthTotal = countDailyAyatInRange(records, previousMonthStart, previousMonthFullEnd);
  const month = readingPeriodComparison(
    countDailyAyatInRange(records, currentMonthStart, date),
    countDailyAyatInRange(records, previousMonthStart, previousMonthEnd)
  );

  return {
    date,
    ayatCount: day.current,
    hasReadToday: day.current > 0,
    comparisonBasis: 'period-to-date',
    comparisons: { day, week, month },
    totals: {
      today: day.current,
      week: week.current,
      currentMonth: month.current,
      previousMonth: previousMonthTotal
    }
  };
}

function recordDailyAyah(db, userId, surah, ayat) {
  const date = readingDateKey();
  if (!isObj(db.dailyReadingByUserId)) db.dailyReadingByUserId = {};
  if (!isObj(db.dailyReadingByUserId[userId])) db.dailyReadingByUserId[userId] = {};
  if (!Array.isArray(db.dailyReadingByUserId[userId][date])) db.dailyReadingByUserId[userId][date] = [];
  const key = `${surah}:${ayat}`;
  if (db.dailyReadingByUserId[userId][date].includes(key)) return false;
  db.dailyReadingByUserId[userId][date].push(key);
  return true;
}

function ayahSequenceNumber(surah, ayat) {
  const safeSurah = Math.max(1, Math.min(114, Number(surah) || 1));
  const totalAyat = SURAH_AYAT_COUNTS[safeSurah - 1] || 1;
  const safeAyat = Math.max(1, Math.min(totalAyat, Number(ayat) || 1));
  return SURAH_AYAT_COUNTS.slice(0, safeSurah - 1).reduce((sum, value) => sum + value, 0) + safeAyat;
}

function ayahPositionFromSequence(sequenceNumber) {
  let remaining = Math.max(1, Math.min(
    SURAH_AYAT_COUNTS.reduce((sum, value) => sum + value, 0),
    Number(sequenceNumber) || 1
  ));

  for (let index = 0; index < SURAH_AYAT_COUNTS.length; index += 1) {
    if (remaining <= SURAH_AYAT_COUNTS[index]) {
      return { surah: index + 1, ayat: remaining };
    }
    remaining -= SURAH_AYAT_COUNTS[index];
  }

  return { surah: 114, ayat: SURAH_AYAT_COUNTS[113] };
}

function recordDailyProgressRange(db, userId, previousProgress, nextProgress) {
  const nextSequence = ayahSequenceNumber(nextProgress?.surah, nextProgress?.ayat);
  const previousSequence = previousProgress
    ? ayahSequenceNumber(previousProgress.surah, previousProgress.ayat)
    : null;
  const startSequence = previousSequence !== null && nextSequence > previousSequence
    ? previousSequence + 1
    : (previousSequence === null ? nextSequence - Math.max(1, Number(nextProgress?.ayat) || 1) + 1 : nextSequence);

  let recorded = 0;
  for (let sequence = startSequence; sequence <= nextSequence; sequence += 1) {
    const position = ayahPositionFromSequence(sequence);
    if (recordDailyAyah(db, userId, position.surah, position.ayat)) recorded += 1;
  }
  return recorded;
}

function computeProgressSummary(progress) {
  if (!progress) return null;
  const currentAyatCount = SURAH_AYAT_COUNTS[progress.surah - 1] || progress.totalAyat || 1;
  const ayat = Math.max(1, Math.min(currentAyatCount, Number(progress.ayat) || 1));
  const totalAyat = SURAH_AYAT_COUNTS.reduce((sum, value) => sum + value, 0);
  const beforeCurrent = SURAH_AYAT_COUNTS.slice(0, progress.surah - 1).reduce((sum, value) => sum + value, 0);
  const readAyat = beforeCurrent + ayat;
  return { readAyat, totalAyat, currentAyatCount, percent: totalAyat > 0 ? Number(((readAyat / totalAyat) * 100).toFixed(2)) : 0 };
}

function friendIds(db, userId) {
  const ids = new Set();
  db.friendships.forEach((friendship) => {
    if (friendship.userAId === userId) ids.add(friendship.userBId);
    if (friendship.userBId === userId) ids.add(friendship.userAId);
  });
  return [...ids];
}

function userGroupCount(db, userId) {
  return db.groups.filter((group) => Array.isArray(group.memberIds) && group.memberIds.includes(userId)).length;
}

function isFriend(db, firstUserId, secondUserId) {
  return db.friendships.some((friendship) => (
    (friendship.userAId === firstUserId && friendship.userBId === secondUserId) ||
    (friendship.userAId === secondUserId && friendship.userBId === firstUserId)
  ));
}

function findFriendRequest(db, firstUserId, secondUserId) {
  return db.friendRequests.find((request) => (
    (request.fromUserId === firstUserId && request.toUserId === secondUserId) ||
    (request.fromUserId === secondUserId && request.toUserId === firstUserId)
  ));
}

function userView(db, user, options = {}) {
  if (!user) return null;
  const includeProgress = options.includeProgress !== false;
  const progress = includeProgress ? progressRecord(db, user.id) : null;
  const summary = includeProgress ? computeProgressSummary(progress) : null;
  const view = {
    id: user.id,
    name: cleanText(user.name, 'Sahabat Iqro', 60),
    phone: user.phone,
    phoneDisplay: phoneDisplay(user.phone),
    role: user.role === 'owner' || user.role === 'admin' ? 'owner' : 'user',
    accountStatus: user.role === 'owner' ? 'active' : user.accountStatus,
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordResetAt: String(user.passwordResetAt || ''),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    isOwner: Boolean(options.isOwner),
    shareReadingStats: Boolean(user.shareReadingStats)
  };
  if (includeProgress) {
    view.progress = progress
      ? (options.progressSummaryOnly ? { updatedAt: progress.updatedAt, summary } : { ...progress, summary })
      : null;
  }
  if (options.includeDailyReading) view.dailyReading = dailyReadingView(db, user.id);
  if (options.includeMemorialNames) view.memorialNames = normalizeMemorialNames(user.memorialNames);
  if (options.includeAdminFields) view.hasPassword = Boolean(user.passwordHash);
  if (options.includeAdminFields) view.passwordResetRequest = user.passwordResetRequest || null;
  return view;
}

function groupView(db, group, viewerUserId) {
  const members = (Array.isArray(group.memberIds) ? group.memberIds : [])
    .map((memberId) => db.users.find((user) => user.id === memberId))
    .filter(Boolean)
    .map((user) => {
      const canViewStats = user.id === viewerUserId || (
        user.shareReadingStats === true && isFriend(db, viewerUserId, user.id)
      );
      return userView(db, user, {
        isOwner: user.id === group.ownerUserId,
        includeProgress: canViewStats,
        progressSummaryOnly: true,
        includeDailyReading: canViewStats
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'id-ID'));
  const ready = members.filter((member) => member.progress?.summary?.percent != null);
  const averagePercent = ready.length ? Number((ready.reduce((sum, member) => sum + member.progress.summary.percent, 0) / ready.length).toFixed(2)) : null;
  return {
    id: group.id,
    name: cleanText(group.name, 'Group Keluarga', 80),
    ownerUserId: group.ownerUserId,
    memberCount: members.length,
    averagePercent,
    createdAt: group.createdAt,
    members
  };
}

function appState(db, user) {
  const friends = friendIds(db, user.id)
    .map((friendUserId) => db.users.find((item) => item.id === friendUserId))
    .filter(Boolean)
    .map((friend) => userView(db, friend, {
      includeProgress: false,
      includeDailyReading: friend.shareReadingStats === true
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'id-ID'));
  const incomingFriendRequests = db.friendRequests
    .filter((request) => request.toUserId === user.id)
    .map((request) => ({
      id: request.id,
      createdAt: request.createdAt,
      user: userView(db, db.users.find((item) => item.id === request.fromUserId), { includeProgress: false })
    }))
    .filter((request) => request.user?.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const outgoingFriendRequests = db.friendRequests
    .filter((request) => request.fromUserId === user.id)
    .map((request) => ({
      id: request.id,
      createdAt: request.createdAt,
      user: userView(db, db.users.find((item) => item.id === request.toUserId), { includeProgress: false })
    }))
    .filter((request) => request.user?.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const groups = db.groups
    .filter((group) => Array.isArray(group.memberIds) && group.memberIds.includes(user.id))
    .map((group) => groupView(db, group, user.id))
    .sort((left, right) => left.name.localeCompare(right.name, 'id-ID'));
  return {
    requiresPasswordChange: Boolean(user.mustChangePassword),
    user: userView(db, user, { includeMemorialNames: true, includeDailyReading: true }),
    friends,
    incomingFriendRequests,
    outgoingFriendRequests,
    groups
  };
}

function managerState(db, manager, options = {}) {
  const pageSize = 25;
  const search = cleanText(options.search, '', 80).toLocaleLowerCase('id-ID');
  const phoneSearch = String(options.search || '').replace(/\D/g, '');
  const normalizedPhoneSearch = phoneSearch ? normalizePhone(phoneSearch) : '';
  const requestedPageValue = Number(options.page);
  const requestedPage = Number.isFinite(requestedPageValue) && requestedPageValue > 0
    ? Math.floor(requestedPageValue)
    : 1;
  const filteredUsers = [...db.users]
    .filter((user) => {
      if (!search) return true;
      const name = cleanText(user.name, '', 60).toLocaleLowerCase('id-ID');
      const phone = String(user.phone || '');
      const localPhone = phone.startsWith('62') ? `0${phone.slice(2)}` : phone;
      return name.includes(search) || (
        phoneSearch && (
          phone.includes(phoneSearch) ||
          localPhone.includes(phoneSearch) ||
          (normalizedPhoneSearch && phone.includes(normalizedPhoneSearch))
        )
      );
    })
    .sort((left, right) => {
      const resetDifference = (Date.parse(right.passwordResetRequest?.requestedAt || '') || 0)
        - (Date.parse(left.passwordResetRequest?.requestedAt || '') || 0);
      if (resetDifference !== 0) return resetDifference;
      return (Date.parse(right.createdAt || '') || 0) - (Date.parse(left.createdAt || '') || 0);
    });
  const totalItems = filteredUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const users = filteredUsers
    .slice((page - 1) * pageSize, page * pageSize)
    .map((user) => userView(db, user, { includeAdminFields: true, includeProgress: false }));
  return {
    manager: userView(db, manager, { includeProgress: false }),
    stats: {
      userCount: db.users.length,
      pendingCount: db.users.filter((user) => user.accountStatus === 'pending').length,
      passwordResetRequestCount: db.users.filter((user) => Boolean(user.passwordResetRequest)).length
    },
    pagination: { page, pageSize, totalItems, totalPages },
    users
  };
}

function createUser(phone, name, password, options = {}) {
  const timestamp = nowIso();
  const accountStatus = ['pending', 'active', 'suspended'].includes(options.accountStatus)
    ? options.accountStatus
    : 'active';
  return {
    id: `usr_${crypto.randomUUID()}`,
    phone,
    name: cleanText(name, `Sahabat ${phone.slice(-4)}`, 60),
    memorialNames: [],
    shareReadingStats: false,
    role: 'user',
    accountStatus,
    passwordHash: hashSecret(password),
    mustChangePassword: false,
    passwordResetAt: '',
    passwordResetRequest: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: accountStatus === 'active' ? timestamp : ''
  };
}

function needUser(auth, finish) {
  if (!auth.subject) {
    finish(401, { message: 'Silakan login dengan nomor HP dan password terlebih dahulu.' });
    return false;
  }
  return true;
}

function needManager(auth, finish) {
  if (!needUser(auth, finish)) return false;
  if (auth.subject.role !== 'owner') {
    finish(403, { message: 'Hanya pemilik aplikasi yang dapat mengelola user.' });
    return false;
  }
  return true;
}

function cleanPrayerTime(value) {
  const match = String(value || '').match(/\b([01]\d|2[0-3]):[0-5]\d\b/);
  return match ? match[0] : '';
}

function defaultPrayerDate() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DAILY_READING_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date()).replaceAll('/', '-');
}

async function fetchPrayerTimes(location, date) {
  const cacheLocationKey = location.key === 'gps'
    ? `gps:${location.latitude.toFixed(1)}:${location.longitude.toFixed(1)}`
    : location.key;
  const cacheKey = `${cacheLocationKey}:${date}`;
  const cached = prayerTimesCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < PRAYER_TIMES_CACHE_TTL_MS) {
    return { ...cached.payload, cached: true };
  }

  const endpoint = new URL(`https://api.aladhan.com/v1/timings/${date}`);
  endpoint.searchParams.set('latitude', String(location.latitude));
  endpoint.searchParams.set('longitude', String(location.longitude));
  endpoint.searchParams.set('method', '20');
  endpoint.searchParams.set('school', '0');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`PRAYER_SOURCE_${response.status}`);
    const upstream = await response.json();
    const data = upstream?.data;
    if (Number(upstream?.code) !== 200 || !data?.timings) throw new Error('PRAYER_SOURCE_INVALID');

    const timingKeys = ['Imsak', 'Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    const timings = Object.fromEntries(timingKeys.map((key) => [key, cleanPrayerTime(data.timings[key])]));
    if (['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].some((key) => !timings[key])) {
      throw new Error('PRAYER_TIMINGS_INCOMPLETE');
    }

    const payload = {
      location: { key: location.key, label: location.label },
      timezone: String(data.meta?.timezone || DAILY_READING_TIME_ZONE),
      method: String(data.meta?.method?.name || 'Kementerian Agama Republik Indonesia'),
      date: {
        gregorian: String(data.date?.gregorian?.date || date),
        weekday: String(data.date?.gregorian?.weekday?.en || ''),
        hijri: {
          day: String(data.date?.hijri?.day || ''),
          month: String(data.date?.hijri?.month?.en || ''),
          year: String(data.date?.hijri?.year || '')
        }
      },
      timings
    };
    prayerTimesCache.set(cacheKey, { savedAt: Date.now(), payload });
    if (prayerTimesCache.size > 120) {
      const oldestKey = prayerTimesCache.keys().next().value;
      prayerTimesCache.delete(oldestKey);
    }
    return { ...payload, cached: false };
  } finally {
    clearTimeout(timeout);
  }
}

function createServer() {
  ensureStore();
  return http.createServer(async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (!requestUrl.pathname.startsWith('/api/')) {
      sendJson(res, 404, { message: 'Route API tidak ditemukan.' });
      return;
    }

    const db = readDb();
    const managementOptions = {
      search: requestUrl.searchParams.get('q') || '',
      page: requestUrl.searchParams.get('page') || '1'
    };
    let dirty = false;
    if (migrateLegacyOwnerPhone(db)) dirty = true;
    if (ensureBootstrapManager(db)) dirty = true;
    if (cleanupSessions(db)) dirty = true;
    const userAuth = authContext(req, db, 'user');
    if (userAuth.changed) dirty = true;

    const finish = (statusCode, payload) => {
      if (dirty) {
        writeDb(db);
        dirty = false;
      }
      sendJson(res, statusCode, payload);
    };

    try {
      if (requestUrl.pathname === '/api/health' && req.method === 'GET') {
        finish(200, {
          ok: true,
          service: 'iqro-api',
          port: PORT,
          dataFile: DB_FILE,
          accessModel: 'owner-account',
          ownerConfigured: db.users.some((user) => user.role === 'owner'),
          passwordResetDelivery: 'whatsapp-link'
        });
        return;
      }

      if (requestUrl.pathname === '/api/prayer-times' && req.method === 'GET') {
        if (!needUser(userAuth, finish)) return;
        const requestedDate = String(requestUrl.searchParams.get('date') || '');
        const date = /^\d{2}-\d{2}-\d{4}$/.test(requestedDate) ? requestedDate : defaultPrayerDate();
        const rawLatitude = requestUrl.searchParams.get('latitude');
        const rawLongitude = requestUrl.searchParams.get('longitude');
        const hasLatitude = rawLatitude !== null && rawLatitude.trim() !== '';
        const hasLongitude = rawLongitude !== null && rawLongitude.trim() !== '';
        if (hasLatitude !== hasLongitude) {
          return finish(400, { message: 'Koordinat lokasi belum lengkap.' });
        }

        let location;
        if (hasLatitude && hasLongitude) {
          const latitude = Number(rawLatitude);
          const longitude = Number(rawLongitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
            || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return finish(400, { message: 'Koordinat lokasi tidak valid.' });
          }
          location = {
            key: 'gps',
            label: 'Lokasi saat ini',
            latitude: Number(latitude.toFixed(1)),
            longitude: Number(longitude.toFixed(1))
          };
        } else {
          const requestedLocation = String(requestUrl.searchParams.get('city') || 'jakarta').toLowerCase();
          const locationKey = Object.hasOwn(PRAYER_LOCATIONS, requestedLocation) ? requestedLocation : '';
          if (!locationKey) return finish(400, { message: 'Kota jadwal salat belum tersedia.' });
          location = { key: locationKey, ...PRAYER_LOCATIONS[locationKey] };
        }

        try {
          const schedule = await fetchPrayerTimes(location, date);
          finish(200, schedule);
        } catch (error) {
          finish(502, { message: 'Jadwal salat belum dapat dimuat. Silakan coba kembali beberapa saat lagi.' });
        }
        return;
      }

      const passwordChangeRouteAllowed = (
        (requestUrl.pathname === '/api/auth/logout' && req.method === 'POST') ||
        (requestUrl.pathname === '/api/me' && req.method === 'GET') ||
        (requestUrl.pathname === '/api/me/complete-password-reset' && req.method === 'PUT')
      );
      if (userAuth.subject?.mustChangePassword && !passwordChangeRouteAllowed) {
        finish(428, { message: 'Buat password baru terlebih dahulu sebelum mengakses fitur Iqro.', ...appState(db, userAuth.subject) });
        return;
      }

      if (requestUrl.pathname === '/api/auth/register' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const phone = normalizePhone(body.phone);
        const password = cleanPassword(body.password);
        const name = cleanText(body.name, '', 60);
        const rewardConsent = body.rewardConsent === true;
        if (!phone) return finish(400, { message: 'Nomor HP belum valid. Gunakan format seperti 08xxxxxxxxxx.' });
        if (!name) return finish(400, { message: 'Nama wajib diisi untuk membuat akun.' });
        if (!validPassword(password)) return finish(400, { message: 'Password minimal 6 karakter.' });
        if (!rewardConsent) return finish(400, { message: 'Persetujuan akad kebaikan perlu dicentang sebelum mengirim permohonan.' });
        const existingUser = db.users.find((item) => item.phone === phone);
        if (existingUser) {
          if (existingUser.accountStatus === 'pending' && verifySecret(password, existingUser.passwordHash)) {
            return finish(200, {
              message: 'Permohonan akun Anda sudah tercatat dan masih menunggu persetujuan pemilik.',
              user: userView(db, existingUser, { includeProgress: false }),
              delivery: whatsappRegistrationRequestDelivery(db, existingUser)
            });
          }
          return finish(409, { message: 'Nomor HP sudah terdaftar. Silakan masuk atau hubungi pemilik Iqro.' });
        }

        const user = createUser(phone, name, password, { accountStatus: 'pending' });
        db.users.push(user);
        const delivery = whatsappRegistrationRequestDelivery(db, user);
        dirty = true;
        finish(201, {
          message: 'Permohonan akun berhasil dibuat dan sedang menunggu persetujuan pemilik.',
          user: userView(db, user, { includeProgress: false }),
          delivery
        });
        return;
      }

      if (requestUrl.pathname === '/api/auth/forgot-password' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const phone = normalizePhone(body.phone);
        const senderPhoneConfirmed = body.senderPhoneConfirmed === true;
        if (!phone) return finish(400, { message: 'Nomor HP belum valid. Gunakan format seperti 08xxxxxxxxxx.' });
        if (!senderPhoneConfirmed) {
          return finish(400, { message: 'Konfirmasi penggunaan nomor WhatsApp yang sama perlu dicentang.' });
        }

        const user = db.users.find((item) => item.phone === phone);
        if (!user) return finish(404, { message: 'Nomor HP belum terdaftar di Iqro.' });
        if (user.accountStatus === 'pending') {
          return finish(409, { message: 'Akun ini masih menunggu aktivasi. Hubungi pemilik Iqro untuk menyelesaikan aktivasi.' });
        }

        const existingRequest = user.passwordResetRequest;
        const existingRequestAge = Date.now() - (Date.parse(existingRequest?.requestedAt || '') || 0);
        const request = existingRequest && existingRequestAge < 15 * 60 * 1000
          ? existingRequest
          : { code: generatePasswordResetRequestCode(), requestedAt: nowIso() };
        user.passwordResetRequest = request;
        user.updatedAt = nowIso();
        dirty = true;
        finish(200, {
          message: 'Permintaan reset password sudah dicatat dan menunggu diproses pemilik.',
          request: { code: request.code, requestedAt: request.requestedAt },
          delivery: whatsappPasswordResetRequestDelivery(db, user, request)
        });
        return;
      }

      if (requestUrl.pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const phone = normalizePhone(body.phone);
        const password = cleanPassword(body.password);
        if (!phone) return finish(400, { message: 'Nomor HP belum valid. Gunakan format seperti 08xxxxxxxxxx.' });
        if (!validPassword(password)) return finish(400, { message: 'Password minimal 6 karakter.' });

        const user = db.users.find((item) => item.phone === phone);
        if (!user) return finish(401, { message: 'Nomor HP belum terdaftar. Silakan buat akun terlebih dahulu.' });
        if (!user.passwordHash) {
          user.passwordHash = hashSecret(password);
          user.updatedAt = nowIso();
        } else if (!verifySecret(password, user.passwordHash)) {
          return finish(401, { message: 'Nomor HP atau password tidak cocok.' });
        }

        if (user.accountStatus === 'pending') {
          return finish(403, { message: 'Permohonan akun Anda masih menunggu persetujuan pemilik Iqro.' });
        }
        if (user.accountStatus === 'suspended') {
          return finish(403, { message: 'Akun Anda sedang dinonaktifkan. Silakan hubungi pemilik Iqro.' });
        }

        user.lastLoginAt = nowIso();
        user.passwordResetRequest = null;
        const session = issueSession(db, 'user', user.id);
        dirty = true;
        finish(200, { message: 'Login berhasil.', token: session.token, ...appState(db, user) });
        return;
      }

      if (requestUrl.pathname === '/api/auth/logout' && req.method === 'POST') {
        if (!needUser(userAuth, finish)) return;
        if (revokeSessions(db, 'user', userAuth.subject.id) > 0) dirty = true;
        finish(200, { message: 'Sesi berhasil diakhiri.' });
        return;
      }

      if (requestUrl.pathname === '/api/me' && req.method === 'GET') {
        if (!needUser(userAuth, finish)) return;
        finish(200, appState(db, userAuth.subject));
        return;
      }

      if (requestUrl.pathname === '/api/me' && req.method === 'PUT') {
        if (!needUser(userAuth, finish)) return;
        const body = await parseJsonBody(req);
        const nextName = cleanText(body.name, '', 60);
        if (!nextName) return finish(400, { message: 'Nama tampilan tidak boleh kosong.' });
        userAuth.subject.name = nextName;
        userAuth.subject.updatedAt = nowIso();
        dirty = true;
        finish(200, { message: 'Nama tampilan berhasil diperbarui.', ...appState(db, userAuth.subject) });
        return;
      }

      if (requestUrl.pathname === '/api/me/privacy' && req.method === 'PUT') {
        if (!needUser(userAuth, finish)) return;
        const body = await parseJsonBody(req);
        if (typeof body.shareReadingStats !== 'boolean') {
          return finish(400, { message: 'Pilihan berbagi statistik tidak valid.' });
        }
        userAuth.subject.shareReadingStats = body.shareReadingStats;
        userAuth.subject.updatedAt = nowIso();
        dirty = true;
        finish(200, {
          message: body.shareReadingStats
            ? 'Statistik tilawah sekarang dibagikan kepada teman yang sudah Anda setujui.'
            : 'Statistik tilawah sekarang bersifat privat.',
          ...appState(db, userAuth.subject)
        });
        return;
      }

      if (requestUrl.pathname === '/api/me/memorial-names' && req.method === 'PUT') {
        if (!needUser(userAuth, finish)) return;
        const body = await parseJsonBody(req);
        if (!Array.isArray(body.names)) return finish(400, { message: 'Daftar nama Tahlil tidak valid.' });
        if (body.names.length > MAX_MEMORIAL_NAMES) return finish(400, { message: `Nama untuk Tahlil maksimal ${MAX_MEMORIAL_NAMES}.` });
        if (body.names.some((item) => typeof item !== 'string')) return finish(400, { message: 'Setiap nama Tahlil harus berupa teks.' });
        const cleanedNames = body.names.map((item) => cleanText(item, '', MAX_MEMORIAL_NAME_LENGTH + 1));
        if (cleanedNames.some((name) => !name)) return finish(400, { message: 'Nama untuk Tahlil tidak boleh kosong.' });
        if (cleanedNames.some((name) => name.length > MAX_MEMORIAL_NAME_LENGTH)) return finish(400, { message: `Setiap nama maksimal ${MAX_MEMORIAL_NAME_LENGTH} karakter.` });
        const memorialNames = normalizeMemorialNames(cleanedNames);
        if (memorialNames.length !== cleanedNames.length) return finish(400, { message: 'Nama yang sama tidak perlu ditambahkan dua kali.' });
        userAuth.subject.memorialNames = memorialNames;
        userAuth.subject.updatedAt = nowIso();
        dirty = true;
        finish(200, { message: 'Daftar nama Tahlil berhasil diperbarui.', ...appState(db, userAuth.subject) });
        return;
      }

      if (requestUrl.pathname === '/api/me/password' && req.method === 'PUT') {
        if (!needUser(userAuth, finish)) return;
        const body = await parseJsonBody(req);
        const currentPassword = cleanPassword(body.currentPassword);
        const newPassword = cleanPassword(body.newPassword);
        if (!verifySecret(currentPassword, userAuth.subject.passwordHash)) return finish(401, { message: 'Password lama tidak cocok.' });
        if (!validPassword(newPassword)) return finish(400, { message: 'Password baru minimal 6 karakter.' });
        userAuth.subject.passwordHash = hashSecret(newPassword);
        userAuth.subject.mustChangePassword = false;
        userAuth.subject.passwordResetAt = '';
        userAuth.subject.updatedAt = nowIso();
        revokeSessions(db, 'user', userAuth.subject.id, userAuth.token);
        dirty = true;
        finish(200, { message: 'Password akun berhasil diganti.', ...appState(db, userAuth.subject) });
        return;
      }

      if (requestUrl.pathname === '/api/me/complete-password-reset' && req.method === 'PUT') {
        if (!needUser(userAuth, finish)) return;
        if (!userAuth.subject.mustChangePassword) return finish(400, { message: 'Akun ini tidak sedang menunggu pembuatan password baru.' });
        const body = await parseJsonBody(req);
        const newPassword = cleanPassword(body.newPassword);
        if (!validPassword(newPassword)) return finish(400, { message: 'Password baru minimal 6 karakter.' });
        if (verifySecret(newPassword, userAuth.subject.passwordHash)) return finish(400, { message: 'Password baru tidak boleh sama dengan password sementara.' });
        userAuth.subject.passwordHash = hashSecret(newPassword);
        userAuth.subject.mustChangePassword = false;
        userAuth.subject.passwordResetAt = '';
        userAuth.subject.updatedAt = nowIso();
        revokeSessions(db, 'user', userAuth.subject.id, userAuth.token);
        dirty = true;
        finish(200, { message: 'Password baru berhasil dibuat. Semua fitur Iqro sudah terbuka.', ...appState(db, userAuth.subject) });
        return;
      }

      if (requestUrl.pathname === '/api/progress' && req.method === 'POST') {
        if (!needUser(userAuth, finish)) return;
        const body = await parseJsonBody(req);
        const surah = Math.max(1, Math.min(114, Number(body.surah) || 1));
        const totalAyat = SURAH_AYAT_COUNTS[surah - 1] || Math.max(1, Number(body.totalAyat) || 1);
        const previousProgress = progressRecord(db, userAuth.subject.id);
        db.progressByUserId[userAuth.subject.id] = {
          surah,
          ayat: Math.max(1, Math.min(totalAyat, Number(body.ayat) || 1)),
          nama: cleanText(body.nama, `Surah ${surah}`, 80),
          totalAyat,
          updatedAt: nowIso()
        };
        if (body.trackDaily === true) {
          recordDailyProgressRange(db, userAuth.subject.id, previousProgress, db.progressByUserId[userAuth.subject.id]);
        }
        dirty = true;
        finish(200, { message: 'Progress tilawah tersimpan ke akun.', ...appState(db, userAuth.subject) });
        return;
      }

      if (requestUrl.pathname === '/api/friends' && req.method === 'POST') {
        if (!needUser(userAuth, finish)) return;
        const body = await parseJsonBody(req);
        const phone = normalizePhone(body.phone);
        if (!phone) return finish(400, { message: 'Nomor HP teman belum valid.' });
        const friend = db.users.find((item) => item.phone === phone);
        if (!friend) return finish(404, { message: 'Nomor HP tersebut belum pernah login di Iqro.' });
        if (friend.accountStatus !== 'active') return finish(409, { message: 'Akun teman tersebut belum aktif.' });
        if (friend.id === userAuth.subject.id) return finish(400, { message: 'Nomor HP Anda sendiri tidak bisa ditambahkan sebagai teman.' });
        if (isFriend(db, userAuth.subject.id, friend.id)) {
          return finish(200, { message: `${friend.name} sudah ada di daftar teman Anda.`, ...appState(db, userAuth.subject) });
        }
        const existingRequest = findFriendRequest(db, userAuth.subject.id, friend.id);
        if (existingRequest) {
          const message = existingRequest.fromUserId === userAuth.subject.id
            ? `Permintaan pertemanan kepada ${friend.name} masih menunggu persetujuan.`
            : `${friend.name} sudah mengirim permintaan kepada Anda. Silakan terima dari daftar permintaan masuk.`;
          return finish(200, { message, ...appState(db, userAuth.subject) });
        }
        db.friendRequests.push({
          id: `frq_${crypto.randomUUID()}`,
          fromUserId: userAuth.subject.id,
          toUserId: friend.id,
          createdAt: nowIso()
        });
        dirty = true;
        finish(200, { message: `Permintaan pertemanan dikirim kepada ${friend.name}.`, ...appState(db, userAuth.subject) });
        return;
      }

      const friendRequestMatch = requestUrl.pathname.match(/^\/api\/friend-requests\/([^/]+)\/(accept|decline)$/);
      if (friendRequestMatch && req.method === 'POST') {
        if (!needUser(userAuth, finish)) return;
        const requestId = decodeURIComponent(friendRequestMatch[1]);
        const action = friendRequestMatch[2];
        const friendRequest = db.friendRequests.find((item) => item.id === requestId);
        if (!friendRequest || friendRequest.toUserId !== userAuth.subject.id) {
          return finish(404, { message: 'Permintaan pertemanan tidak ditemukan.' });
        }
        const requester = db.users.find((item) => item.id === friendRequest.fromUserId);
        db.friendRequests = db.friendRequests.filter((item) => item.id !== friendRequest.id);
        if (action === 'accept' && requester && !isFriend(db, userAuth.subject.id, requester.id)) {
          db.friendships.push({
            id: `fr_${crypto.randomUUID()}`,
            userAId: requester.id,
            userBId: userAuth.subject.id,
            createdAt: nowIso()
          });
        }
        dirty = true;
        finish(200, {
          message: action === 'accept'
            ? `${requester?.name || 'Sahabat'} sekarang menjadi teman Anda.`
            : 'Permintaan pertemanan ditolak.',
          ...appState(db, userAuth.subject)
        });
        return;
      }

      if (requestUrl.pathname === '/api/groups' && req.method === 'POST') {
        if (!needUser(userAuth, finish)) return;
        const body = await parseJsonBody(req);
        const name = cleanText(body.name, '', 80);
        if (!name) return finish(400, { message: 'Nama group tidak boleh kosong.' });
        if (body.memberIds !== undefined && !Array.isArray(body.memberIds)) return finish(400, { message: 'Daftar anggota group tidak valid.' });
        const selectedMemberIds = [...new Set((Array.isArray(body.memberIds) ? body.memberIds : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean))];
        if (selectedMemberIds.length > 100) return finish(400, { message: 'Anggota group maksimal 100 kontak.' });
        const availableFriendIds = new Set(friendIds(db, userAuth.subject.id));
        if (selectedMemberIds.some((memberId) => !availableFriendIds.has(memberId))) {
          return finish(400, { message: 'Semua anggota group harus berasal dari daftar teman Anda.' });
        }
        const memberIds = [userAuth.subject.id, ...selectedMemberIds];
        db.groups.push({ id: `grp_${crypto.randomUUID()}`, name, ownerUserId: userAuth.subject.id, memberIds, createdAt: nowIso() });
        dirty = true;
        finish(200, { message: `Group ${name} berhasil dibuat.`, ...appState(db, userAuth.subject) });
        return;
      }

      const addMemberMatch = requestUrl.pathname.match(/^\/api\/groups\/([^/]+)\/members$/);
      if (addMemberMatch && req.method === 'POST') {
        if (!needUser(userAuth, finish)) return;
        const group = db.groups.find((item) => item.id === addMemberMatch[1]);
        if (!group) return finish(404, { message: 'Group tidak ditemukan.' });
        if (group.ownerUserId !== userAuth.subject.id) return finish(403, { message: 'Hanya admin group yang dapat menambahkan anggota.' });
        const body = await parseJsonBody(req);
        const phone = normalizePhone(body.phone);
        if (!phone) return finish(400, { message: 'Nomor HP anggota belum valid.' });
        const member = db.users.find((item) => item.phone === phone);
        if (!member) return finish(404, { message: 'Nomor HP anggota belum pernah login di Iqro.' });
        if (!isFriend(db, userAuth.subject.id, member.id) && member.id !== userAuth.subject.id) return finish(400, { message: 'Tambahkan sebagai teman dulu sebelum masuk ke group.' });
        if (!group.memberIds.includes(member.id)) {
          group.memberIds.push(member.id);
          dirty = true;
        }
        finish(200, { message: `${member.name} berhasil masuk ke group ${group.name}.`, ...appState(db, userAuth.subject) });
        return;
      }

      const removeMemberMatch = requestUrl.pathname.match(/^\/api\/groups\/([^/]+)\/members\/([^/]+)$/);
      if (removeMemberMatch && req.method === 'DELETE') {
        if (!needUser(userAuth, finish)) return;
        const groupId = decodeURIComponent(removeMemberMatch[1]);
        const memberId = decodeURIComponent(removeMemberMatch[2]);
        const group = db.groups.find((item) => item.id === groupId);
        if (!group) return finish(404, { message: 'Group tidak ditemukan.' });
        if (group.ownerUserId !== userAuth.subject.id) return finish(403, { message: 'Hanya admin group yang dapat menghapus anggota.' });
        if (memberId === group.ownerUserId) return finish(400, { message: 'Admin group tidak dapat dihapus dari group.' });
        if (!group.memberIds.includes(memberId)) return finish(404, { message: 'Anggota tidak ditemukan di group ini.' });
        const member = db.users.find((item) => item.id === memberId);
        group.memberIds = group.memberIds.filter((item) => item !== memberId);
        dirty = true;
        finish(200, {
          message: `${member?.name || 'Anggota'} berhasil dikeluarkan dari group ${group.name}.`,
          ...appState(db, userAuth.subject)
        });
        return;
      }

      if (requestUrl.pathname === '/api/manage/users' && req.method === 'GET') {
        if (!needManager(userAuth, finish)) return;
        finish(200, managerState(db, userAuth.subject, managementOptions));
        return;
      }

      const resetMatch = requestUrl.pathname.match(/^\/api\/manage\/users\/([^/]+)\/reset-password$/);
      if (resetMatch && req.method === 'POST') {
        if (!needManager(userAuth, finish)) return;
        const user = db.users.find((item) => item.id === resetMatch[1]);
        if (!user) return finish(404, { message: 'User tidak ditemukan.' });
        if (user.id === userAuth.subject.id) return finish(400, { message: 'Gunakan menu Ganti Password untuk akun Anda sendiri.' });

        const temporaryPassword = generateTemporaryPassword();
        const delivery = whatsappResetDelivery(user, temporaryPassword);
        user.passwordHash = hashSecret(temporaryPassword);
        user.mustChangePassword = true;
        user.passwordResetAt = nowIso();
        user.passwordResetRequest = null;
        user.updatedAt = user.passwordResetAt;
        const revokedSessionCount = revokeSessions(db, 'user', user.id);
        dirty = true;
        finish(200, {
          message: `WhatsApp untuk ${phoneDisplay(user.phone)} sudah dibuka. Periksa pesannya lalu tekan Kirim.`,
          revokedSessionCount,
          temporaryPassword,
          delivery,
          ...managerState(db, userAuth.subject, managementOptions)
        });
        return;
      }

      const statusMatch = requestUrl.pathname.match(/^\/api\/manage\/users\/([^/]+)\/status$/);
      if (statusMatch && req.method === 'PUT') {
        if (!needManager(userAuth, finish)) return;
        const user = db.users.find((item) => item.id === statusMatch[1]);
        if (!user) return finish(404, { message: 'User tidak ditemukan.' });
        if (user.id === userAuth.subject.id || user.role === 'owner') {
          return finish(400, { message: 'Status akun pemilik tidak dapat diubah.' });
        }

        const body = await parseJsonBody(req);
        const accountStatus = String(body.accountStatus || '').toLowerCase();
        if (!['active', 'suspended'].includes(accountStatus)) {
          return finish(400, { message: 'Status akun belum valid.' });
        }

        user.accountStatus = accountStatus;
        user.updatedAt = nowIso();
        const revokedSessionCount = accountStatus === 'active' ? 0 : revokeSessions(db, 'user', user.id);
        const delivery = accountStatus === 'active' ? whatsappActivationDelivery(user) : null;
        dirty = true;
        finish(200, {
          message: accountStatus === 'active'
            ? `Akun ${user.name} berhasil diaktifkan.`
            : `Akun ${user.name} berhasil dinonaktifkan.`,
          revokedSessionCount,
          delivery,
          ...managerState(db, userAuth.subject, managementOptions)
        });
        return;
      }

      const deleteMatch = requestUrl.pathname.match(/^\/api\/manage\/users\/([^/]+)$/);
      if (deleteMatch && req.method === 'DELETE') {
        if (!needManager(userAuth, finish)) return;
        const user = db.users.find((item) => item.id === deleteMatch[1]);
        if (!user) return finish(404, { message: 'User tidak ditemukan.' });
        if (user.id === userAuth.subject.id) return finish(400, { message: 'Akun pemilik aplikasi tidak dapat dihapus.' });

        const revokedSessionCount = revokeSessions(db, 'user', user.id);
        const friendshipCount = db.friendships.length;
        db.friendships = db.friendships.filter((item) => item.userAId !== user.id && item.userBId !== user.id);
        const removedFriendshipCount = friendshipCount - db.friendships.length;
        const friendRequestCount = db.friendRequests.length;
        db.friendRequests = db.friendRequests.filter((item) => item.fromUserId !== user.id && item.toUserId !== user.id);
        const removedFriendRequestCount = friendRequestCount - db.friendRequests.length;
        delete db.progressByUserId[user.id];
        delete db.dailyReadingByUserId[user.id];

        let transferredGroupCount = 0;
        let removedGroupCount = 0;
        db.groups = db.groups.flatMap((group) => {
          const nextMemberIds = group.memberIds.filter((memberId) => memberId !== user.id);
          if (group.ownerUserId !== user.id) return [{ ...group, memberIds: nextMemberIds }];
          if (!nextMemberIds.length) {
            removedGroupCount += 1;
            return [];
          }
          transferredGroupCount += 1;
          return [{ ...group, ownerUserId: nextMemberIds[0], memberIds: nextMemberIds }];
        });
        db.users = db.users.filter((item) => item.id !== user.id);
        dirty = true;
        finish(200, {
          message: `Akun ${user.name} berhasil dihapus.`,
          cleanup: { revokedSessionCount, removedFriendshipCount, removedFriendRequestCount, transferredGroupCount, removedGroupCount },
          ...managerState(db, userAuth.subject, managementOptions)
        });
        return;
      }
      finish(404, { message: 'Endpoint API tidak ditemukan.' });
    } catch (error) {
      if (error.message === 'INVALID_JSON') return finish(400, { message: 'Format data tidak valid. Gunakan JSON yang benar.' });
      if (error.message === 'PAYLOAD_TOO_LARGE') return finish(413, { message: 'Ukuran data terlalu besar.' });
      console.error('[iqro-api] unexpected error', error);
      finish(500, { message: 'Terjadi kendala pada server Iqro.' });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`[iqro-api] listening on http://${HOST}:${PORT}`);
    console.log(`[iqro-api] data store: ${DB_FILE}`);
  });
}

module.exports = {
  createServer,
  normalizePhone,
  computeProgressSummary,
  recordDailyProgressRange,
  dailyReadingView,
  isValidPassword: validPassword
};
