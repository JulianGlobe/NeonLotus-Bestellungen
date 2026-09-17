import crypto from 'crypto';
import express from 'express';
import db from '../database.js';
import { processOverdueSanctions, getSanctionDeadline } from '../utils/sanctions.js';
import { ensureWeeklyDues, currentSakuraPersonnel, getFridayCycle, isAbsentOnFriday, isManuallyDuesExempt, weeklyBaseForRank } from '../utils/weeklyDues.js';

const router = express.Router();

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString('de-DE')}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('de-DE');
}

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getDashboardPassword() {
  return process.env.DASHBOARD_PASSWORD || '';
}

function getCookieSecret() {
  return process.env.DASHBOARD_SECRET || process.env.DISCORD_TOKEN || 'neon-lotus-dashboard';
}

function sessionToken() {
  return crypto
    .createHmac('sha256', getCookieSecret())
    .update(`personalverwaltung:${getDashboardPassword()}`)
    .digest('hex');
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const cookies = {};

  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join('='));
  }

  return cookies;
}

function isAuthenticated(req) {
  const password = getDashboardPassword();

  if (!password) {
    return false;
  }

  const cookies = parseCookies(req);
  const actual = cookies.nl_admin || '';
  const expected = sessionToken();

  if (!actual || actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(actual),
    Buffer.from(expected)
  );
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }

  return res.redirect('/personal/login');
}

function nav(active = 'overview') {
  const items = [
    ['overview', '/personal', 'Übersicht'],
    ['employees', '/personal/mitarbeiter', 'Personal'],
    ['bench', '/personal/ersatzbank', 'Ersatzbank'],
    ['sanctions', '/personal/sanktionen', 'Sanktionen'],
    ['absences', '/personal/abmeldungen', 'Abmeldungen'],
    ['lineup', '/personal/abmeldung-aufstellung', 'Abmeldung Aufstellung'],
    ['weekly', '/personal/wochenabgaben', 'Wochenabgaben'],
    ['cash', '/personal/kasse', 'Kasse'],
    ['clear', '/personal/komplett-clear', 'Datenbereinigung']
  ];

  return `
    <nav class="nav">
      ${items.map(([key, href, label]) => `
        <a class="nav-link ${active === key ? 'active' : ''}" href="${href}">
          ${label}
        </a>
      `).join('')}
    </nav>
  `;
}

function pageHeader(title, subtitle, active) {
  return `
    <div class="header-row">
      <div>
        <div class="eyebrow">SAKURA PERFORMANCE · VERWALTUNG</div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <a class="button secondary" href="/personal/logout">Abmelden</a>
    </div>
    ${nav(active)}
  `;
}

function layout(title, body) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0809;
      --panel: #141012;
      --panel2: #1b1418;
      --panel3: #21171d;
      --border: #3a2730;
      --border-soft: #2d2026;
      --text: #fff6fa;
      --muted: #c6adb8;
      --accent: #ff5da9;
      --accent2: #ff91c4;
      --accent-soft: rgba(255, 93, 169, .11);
      --good: #6de09d;
      --bad: #ff6d7d;
      --warn: #f5ca69;
      --shadow: 0 18px 60px rgba(0, 0, 0, .24);
    }

    * {
      box-sizing: border-box;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 80% -10%, rgba(255, 93, 169, .13), transparent 34rem),
        radial-gradient(circle at -5% 20%, rgba(255, 145, 196, .06), transparent 28rem),
        var(--bg);
      color: var(--text);
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .shell {
      width: min(1420px, calc(100% - 36px));
      margin: 0 auto;
      padding: 34px 0 72px;
    }

    .header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
    }

    .eyebrow {
      color: var(--accent2);
      font-size: 12px;
      letter-spacing: .18em;
      font-weight: 900;
      margin-bottom: 8px;
    }

    h1 {
      margin: 0;
      font-size: clamp(30px, 5vw, 46px);
      line-height: 1;
      letter-spacing: -.03em;
    }

    .header-row p,
    .muted {
      color: var(--muted);
    }

    .header-row p {
      margin: 10px 0 0;
    }

    .nav {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 18px 0 22px;
      scrollbar-width: thin;
    }

    .nav-link {
      flex: 0 0 auto;
      padding: 10px 14px;
      border-radius: 12px;
      color: var(--muted);
      border: 1px solid transparent;
      font-weight: 750;
    }

    .nav-link:hover {
      color: var(--text);
      background: rgba(255,255,255,.03);
      border-color: var(--border-soft);
    }

    .nav-link.active {
      color: white;
      background: var(--accent-soft);
      border-color: rgba(255, 93, 169, .35);
      box-shadow: inset 0 0 0 1px rgba(255,93,169,.05);
    }

    .grid {
      display: grid;
      gap: 16px;
    }

    .grid-4 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .grid-5 {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }

    .grid-3 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .grid-2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .card {
      background: linear-gradient(180deg, rgba(33,23,29,.98), rgba(20,16,18,.98));
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      box-shadow: var(--shadow);
    }

    .card h2 {
      margin: 0 0 12px;
      font-size: 18px;
      letter-spacing: -.01em;
    }

    .metric {
      padding: 18px;
    }

    .metric .label {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    .metric .value {
      margin-top: 6px;
      font-size: clamp(24px, 3vw, 34px);
      font-weight: 900;
      letter-spacing: -.03em;
    }

    .metric .hint {
      color: var(--muted);
      font-size: 12px;
      margin-top: 6px;
    }

    .section {
      margin-top: 16px;
    }

    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 12px;
    }

    .section-title h2 {
      margin: 0;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 9px 13px;
      border-radius: 11px;
      border: 1px solid var(--border);
      font-weight: 800;
      cursor: pointer;
      transition: .16s ease;
    }

    .button:hover {
      transform: translateY(-1px);
      border-color: rgba(255,93,169,.45);
    }

    .button.secondary {
      background: var(--panel2);
    }


    .danger-card {
      border-color: rgba(255, 109, 125, .45);
      background: linear-gradient(180deg, rgba(64,20,28,.72), rgba(20,16,18,.98));
    }
    .button.danger {
      background: rgba(255, 109, 125, .14);
      border-color: rgba(255, 109, 125, .48);
      color: #ffdce1;
    }
    .button.danger:hover {
      border-color: var(--bad);
      background: rgba(255, 109, 125, .22);
    }

    .search-row {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 14px;
    }

    .search {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #100c0e;
      color: var(--text);
      outline: none;
    }

    .search:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(255,93,169,.08);
    }

    .employee-list {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .employee {
      display: block;
      border: 1px solid var(--border-soft);
      border-radius: 15px;
      padding: 14px;
      background: rgba(255,255,255,.018);
      transition: .15s ease;
    }

    .employee:hover {
      border-color: rgba(255,93,169,.5);
      background: rgba(255,93,169,.055);
      transform: translateY(-1px);
    }

    .employee strong {
      display: block;
      font-size: 16px;
      margin-bottom: 6px;
    }

    .employee-meta {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 850;
      white-space: nowrap;
    }

    .badge.good {
      color: var(--good);
    }

    .badge.bad {
      color: var(--bad);
    }

    .badge.warn {
      color: var(--warn);
    }

    .badge.neutral {
      color: var(--muted);
    }

    .table-wrap {
      width: 100%;
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }

    th,
    td {
      padding: 12px 10px;
      border-bottom: 1px solid var(--border-soft);
      text-align: left;
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    tbody tr:hover td {
      background: rgba(255,255,255,.014);
    }

    .amount-in {
      color: var(--good);
      font-weight: 850;
    }

    .amount-out {
      color: var(--bad);
      font-weight: 850;
    }

    .rank-card {
      min-height: 96px;
    }

    .rank-card .rank {
      margin-top: 5px;
      font-size: 22px;
      font-weight: 900;
    }

    .empty {
      color: var(--muted);
      padding: 14px 0;
    }

    .login {
      width: min(430px, calc(100% - 32px));
      margin: 12vh auto 0;
    }

    .login input {
      width: 100%;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #100c0e;
      color: var(--text);
      margin: 14px 0 10px;
      outline: none;
    }

    .login button {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 12px 14px;
      background: linear-gradient(90deg, var(--accent), var(--accent2));
      color: white;
      font-weight: 900;
      cursor: pointer;
    }

    .backlink {
      display: inline-flex;
      color: var(--muted);
      margin-bottom: 12px;
      font-weight: 750;
    }

    .backlink:hover {
      color: var(--text);
    }

    .split {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, .8fr);
      gap: 16px;
    }

    .mini-list {
      display: grid;
      gap: 8px;
    }

    .mini-item {
      border: 1px solid var(--border-soft);
      background: rgba(255,255,255,.018);
      border-radius: 12px;
      padding: 11px 12px;
    }

    .mini-item strong {
      display: block;
      margin-bottom: 4px;
    }

    @media (max-width: 1050px) {
      .grid-4 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .grid-3,
      .employee-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .split {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 650px) {
      .shell {
        width: min(100% - 22px, 1420px);
        padding-top: 22px;
      }

      .header-row {
        align-items: stretch;
        flex-direction: column;
      }

      .header-row .button {
        align-self: flex-start;
      }

      .grid-4,
      .grid-3,
      .grid-2,
      .employee-list {
        grid-template-columns: 1fr;
      }

      .card {
        border-radius: 15px;
      }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function getEmployees() {
  return db.prepare(`
    SELECT
      e.discord_id,
      e.display_name,
      e.active,
      e.joined_at,
      e.left_at,
      MAX(CASE WHEN er.area = 'neon' AND er.active = 1 THEN er.rank_name END) AS neon_rank,
      MAX(CASE WHEN er.area = 'blacklist' AND er.active = 1 THEN er.rank_name END) AS blacklist_rank,
      MAX(CASE WHEN er.area = 'sakura' AND er.active = 1 THEN er.rank_name END) AS sakura_rank,
      MAX(CASE
        WHEN e.active = 1 AND er.active = 1 AND er.area = 'neon' THEN 'NL. ' || er.rank_name
        WHEN e.active = 1 AND er.active = 1 AND er.area = 'blacklist' THEN 'B. ' || er.rank_name
        WHEN e.active = 1 AND er.active = 1 AND er.area = 'sakura' THEN er.rank_name
        ELSE NULL
      END) AS framework_rank,
      (
        SELECT COUNT(*)
        FROM meeting_invitations mi
        WHERE mi.discord_id = e.discord_id
          AND COALESCE(mi.status, 'OPEN') = 'OPEN'
      ) AS meeting_count,
      (
        SELECT GROUP_CONCAT(el.label, '|||')
        FROM employee_labels el
        WHERE el.discord_id = e.discord_id
      ) AS labels
    FROM employees e
    LEFT JOIN employee_ranks er
      ON er.discord_id = e.discord_id
    GROUP BY e.discord_id, e.display_name, e.active, e.joined_at, e.left_at
    ORDER BY e.active DESC, LOWER(e.display_name)
  `).all();
}

function getCurrentCash() {
  return db.prepare(`
    SELECT *
    FROM cash_updates
    WHERE COALESCE(status, 'ACTIVE') != 'REVOKED'
    ORDER BY id DESC
    LIMIT 1
  `).get();
}

router.use(express.urlencoded({ extended: false }));

router.get('/login', (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect('/personal');
  }

  const configured = Boolean(getDashboardPassword());

  res.status(configured ? 200 : 503).send(
    layout(
      'Personalverwaltung Login',
      `<div class="login card">
        <div class="eyebrow">SAKURA PERFORMANCE · VERWALTUNG</div>
        <h1>Personalverwaltung</h1>
        <p class="muted">Geschützter Verwaltungsbereich für Neon Lotus & Sakura.</p>
        ${
          configured
            ? `<form method="post" action="/personal/login">
                <input
                  type="password"
                  name="password"
                  placeholder="Passwort"
                  autocomplete="current-password"
                  required
                >
                <button type="submit">Anmelden</button>
              </form>`
            : `<p class="empty">
                Es wurde noch kein <strong>DASHBOARD_PASSWORD</strong>
                in Railway gesetzt.
              </p>`
        }
      </div>`
    )
  );
});

router.post('/login', (req, res) => {
  const expected = getDashboardPassword();
  const supplied = String(req.body.password || '');

  if (!expected || supplied !== expected) {
    return res.status(401).send(
      layout(
        'Anmeldung fehlgeschlagen',
        `<div class="login card">
          <div class="eyebrow">SAKURA PERFORMANCE · VERWALTUNG</div>
          <h1>Anmeldung fehlgeschlagen</h1>
          <p class="muted">Das Passwort ist nicht korrekt.</p>
          <a class="button secondary" href="/personal/login">Zurück</a>
        </div>`
      )
    );
  }

  res.setHeader(
    'Set-Cookie',
    `nl_admin=${encodeURIComponent(sessionToken())}; Path=/personal; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
  );

  return res.redirect('/personal');
});

router.get('/logout', (_req, res) => {
  res.setHeader(
    'Set-Cookie',
    'nl_admin=; Path=/personal; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  );

  return res.redirect('/personal/login');
});

/* ÜBERSICHT */
router.get('/', requireAuth, (_req, res) => {
  const employees = getEmployees();
  const sanctions = db.prepare(`
    SELECT *
    FROM sanctions
    ORDER BY id DESC
  `).all();

  const sales = db.prepare(`
    SELECT *
    FROM sales
    ORDER BY id DESC
  `).all();

  const absences = db.prepare(`
    SELECT *
    FROM absences
    ORDER BY id DESC
  `).all();

  const activeEmployees = employees.filter(employee => employee.active).length;
  const nowMs = Date.now();
  const openSanctions = sanctions.filter(sanction => sanction.status === 'OPEN');
  const openSanctionAmount = openSanctions.reduce((sum, sanction) => sum + Number(sanction.amount || 0), 0);
  const currentCash = getCurrentCash();
  const cashBalance = Number(currentCash?.amount || 0);

  const recentActions = db.prepare(`
    SELECT
      pa.*,
      COALESCE(e.display_name, pa.discord_id) AS display_name
    FROM personnel_actions pa
    LEFT JOIN employees e
      ON e.discord_id = pa.discord_id
    ORDER BY pa.id DESC
    LIMIT 8
  `).all();

  const recentInvitations = db.prepare(`
    SELECT
      mi.*,
      COALESCE(target.display_name, mi.discord_id) AS display_name,
      COALESCE(inviter.display_name, mi.invited_by) AS invited_by_name
    FROM meeting_invitations mi
    LEFT JOIN employees target
      ON target.discord_id = mi.discord_id
    LEFT JOIN employees inviter
      ON inviter.discord_id = mi.invited_by
    ORDER BY mi.id DESC
    LIMIT 6
  `).all();

  const latestSanctions = db.prepare(`
    SELECT
      s.*,
      COALESCE(e.display_name, s.discord_id) AS display_name
    FROM sanctions s
    LEFT JOIN employees e
      ON e.discord_id = s.discord_id
    ORDER BY s.id DESC
    LIMIT 6
  `).all();

  res.send(
    layout(
      'Übersicht',
      `<div class="shell">
        ${pageHeader(
          'Übersicht',
          'Zentrale Übersicht über Personal, Sanktionen, Abmeldungen und Fraktionskasse.',
          'overview'
        )}

        <div class="grid grid-3">
          <div class="card metric">
            <div class="label">Aktives Personal</div>
            <div class="value">${formatNumber(activeEmployees)}</div>
            <div class="hint">${formatNumber(employees.length)} Personen insgesamt gespeichert</div>
          </div>

          <div class="card metric">
            <div class="label">Offene Sanktionen</div>
            <div class="value">${formatNumber(openSanctions.length)}</div>
            <div class="hint">${formatMoney(openSanctionAmount)} offen</div>
          </div>

          <div class="card metric">
            <div class="label">Fraktionskasse</div>
            <div class="value">${formatMoney(cashBalance)}</div>
            <div class="hint">${
              currentCash
                ? `Zuletzt aktualisiert ${formatDate(currentCash.created_at)}`
                : 'Noch kein Kassenstand hinterlegt'
            }</div>
          </div>
        </div>

        <div class="split section">
          <div class="card">
            <div class="section-title">
              <h2>📈 Letzte Personalaktionen</h2>
              <a class="button secondary" href="/personal/mitarbeiter">Personal öffnen</a>
            </div>

            <div class="mini-list">
              ${
                recentActions.length
                  ? recentActions.map(action => `
                    <div class="mini-item">
                      <strong>${escapeHtml(action.display_name)} · ${escapeHtml(action.action)}</strong>
                      <div class="muted">
                        ${action.area === 'neon' ? 'Neon Lotus' : action.area === 'sakura' ? 'Sakura' : '—'}
                        · ${escapeHtml(action.old_rank || '—')} → ${escapeHtml(action.new_rank || '—')}
                        · ${formatDate(action.created_at)}
                      </div>
                    </div>
                  `).join('')
                  : `<div class="empty">Noch keine Personalaktionen vorhanden.</div>`
              }
            </div>
          </div>

          <div class="card">
            <div class="section-title">
              <h2>⚠️ Neueste Sanktionen</h2>
              <a class="button secondary" href="/personal/sanktionen">Alle ansehen</a>
            </div>

            <div class="mini-list">
              ${
                latestSanctions.length
                  ? latestSanctions.map(sanction => `
                    <div class="mini-item">
                      <strong>#${sanction.id} · ${escapeHtml(sanction.display_name)} · ${formatMoney(sanction.amount)}</strong>
                      <div class="muted">
                        ${sanction.status === 'OPEN' ? '🔴 Offen' : sanction.status === 'PAID' ? '🟢 Bezahlt' : '↩️ Revidiert'}
                        · ${escapeHtml(sanction.reason)}
                        · ${formatDate(sanction.created_at)}
                      </div>
                    </div>
                  `).join('')
                  : `<div class="empty">Noch keine Sanktionen vorhanden.</div>`
              }
            </div>
          </div>
        </div>

        <div class="card section">
          <div class="section-title">
            <h2>📅 Letzte Gesprächseinladungen</h2>
            <a class="button secondary" href="/personal/mitarbeiter">Personal öffnen</a>
          </div>

          <div class="mini-list">
            ${
              recentInvitations.length
                ? recentInvitations.map(invitation => `
                  <div class="mini-item">
                    <strong>${escapeHtml(invitation.display_name)} · ${escapeHtml(invitation.reason)}</strong>
                    <div class="muted">
                      ${formatDate(invitation.created_at)}
                      · eingeladen durch ${escapeHtml(invitation.invited_by_name)}
                      ${invitation.note ? ` · ${escapeHtml(invitation.note)}` : ''}
                    </div>
                  </div>
                `).join('')
                : `<div class="empty">Noch keine Gesprächseinladungen vorhanden.</div>`
            }
          </div>
        </div>
      </div>`
    )
  );
});

/* PERSONAL */

router.get('/ersatzbank', requireAuth, (_req,res)=>{
  const rows=db.prepare(`
    SELECT tr.*,COALESCE(e.display_name,tr.discord_id) AS display_name
    FROM termination_records tr
    LEFT JOIN employees e ON e.discord_id=tr.discord_id
    WHERE tr.bench_active=1
    ORDER BY tr.terminated_at DESC
  `).all();
  const body=rows.length?rows.map(r=>`
    <tr>
      <td><strong>${escapeHtml(r.display_name)}</strong><div class="muted">${escapeHtml(r.discord_id)}</div></td>
      <td>${formatDate(r.terminated_at)}</td>
      <td>${escapeHtml(r.last_rank||'—')}</td>
      <td>${escapeHtml(r.note||'—')}</td>
    </tr>`).join(''):`<tr><td colspan="4" class="empty">Aktuell befindet sich niemand auf der Ersatzbank.</td></tr>`;
  res.send(layout('Ersatzbank',`<div class="shell">${pageHeader('Ersatzbank','Unbefristete Übersicht ehemaliger Mitarbeiter, die für eine mögliche Wiedereinstellung vorgemerkt sind.','bench')}
    <div class="card section"><div class="table-wrap"><table><thead><tr><th>Person</th><th>Kündigungsdatum</th><th>Letzter Rang</th><th>Vermerk</th></tr></thead><tbody>${body}</tbody></table></div></div>
  </div>`));
});

router.get('/mitarbeiter', requireAuth, (_req, res) => {
  const employees = getEmployees();
  const activeEmployees = employees.filter(employee => employee.active).length;
  const sakuraActive = employees.filter(employee => employee.active && employee.sakura_rank).length;
  const neonActive = employees.filter(employee => employee.active && employee.neon_rank).length;
  const blacklistActive = employees.filter(employee => employee.active && employee.blacklist_rank).length;

  const fixedLabelNames = {
    watch: 'Beobachtung',
    active: 'Aktiv',
    inactive: 'Inaktiv',
    dues_exempt: 'Abgaben befreit',
    friday_exempt: 'Freitags befreit'
  };
  const employeeLabels = employee => String(employee.labels || '')
    .split('|||')
    .filter(Boolean)
    .map(label => fixedLabelNames[label] || label);

  const cards = employees.length
    ? employees.map(employee => `
      <a
        class="employee employee-row"
        href="/personal/mitarbeiter/${encodeURIComponent(employee.discord_id)}"
        data-search="${escapeHtml(
          `${employee.display_name} ${employee.framework_rank || ''} ${employee.active ? 'aktiv' : 'inaktiv'} ${employeeLabels(employee).join(' ')} gespräche ${employee.meeting_count || 0}`.toLowerCase()
        )}"
      >
        <div class="section-title"><strong>👤 ${escapeHtml(employee.display_name)}</strong><span class="badge ${employee.active?'good':'neutral'}">${employee.active?'● Aktiv':'● Inaktiv'}</span></div>
        <div class="employee-meta">
          🎖️ <strong style="display:inline">Framework-Rang:</strong> ${employee.framework_rank ? escapeHtml(employee.framework_rank) : '—'}
          <br>
          📅 <strong style="display:inline">Offene Gespräche:</strong> ${formatNumber(employee.meeting_count || 0)}
          ${employeeLabels(employee).length ? `<br>🏷️ <strong style="display:inline">Labels:</strong> <span class="label-list">${employeeLabels(employee).map(label=>`<span class="badge neutral">${escapeHtml(label)}</span>`).join(' ')}</span>` : ''}
        </div>
      </a>
    `).join('')
    : `<div class="empty">Noch keine Mitarbeiter gespeichert.</div>`;

  res.send(
    layout(
      'Personal',
      `<div class="shell">
        ${pageHeader(
          'Personal',
          'Mitarbeiter durchsuchen und vollständige Personalakten öffnen.',
          'employees'
        )}

        <div class="grid grid-5">
          <div class="card metric">
            <div class="label">👥 Personal gesamt</div>
            <div class="value">${formatNumber(activeEmployees)}</div>
            <div class="hint">Aktives Personal · ${formatNumber(employees.length-activeEmployees)} inaktiv</div>
          </div>
          <div class="card metric">
            <div class="label">🌺 Sakura Personal</div>
            <div class="value">${formatNumber(sakuraActive)}</div>
            <div class="hint">Aktive Mitarbeiter mit Sakura-Rang</div>
          </div>
          <div class="card metric">
            <div class="label">🌸 Neon Lotus Personal</div>
            <div class="value">${formatNumber(neonActive)}</div>
            <div class="hint">Aktive Mitarbeiter mit Neon-Lotus-Rang</div>
          </div>
          <div class="card metric">
            <div class="label">🖤 Blacklist Personal</div>
            <div class="value">${formatNumber(blacklistActive)}</div>
            <div class="hint">Aktive Mitarbeiter mit Blacklist-Rang</div>
          </div>
          <div class="card metric">
            <div class="label">📁 Personalakten</div>
            <div class="value">${formatNumber(employees.length)}</div>
            <div class="hint">Durchsuchbare Datensätze</div>
          </div>
        </div>

        <div class="card section">
          <div class="search-row">
            <input
              id="employeeSearch"
              class="search"
              type="search"
              placeholder="Name, Rang oder Status suchen..."
            >
          </div>

          <div class="employee-list">
            ${cards}
          </div>
        </div>
      </div>

      <script>
        const search = document.getElementById('employeeSearch');
        const rows = [...document.querySelectorAll('.employee-row')];

        search?.addEventListener('input', () => {
          const term = search.value.trim().toLowerCase();

          for (const row of rows) {
            row.style.display =
              row.dataset.search.includes(term) ? '' : 'none';
          }
        });
      </script>`
    )
  );
});

/* MITARBEITERDETAIL */
router.get('/mitarbeiter/:discordId', requireAuth, (req, res) => {
  const discordId = req.params.discordId;
  const nowMs = Date.now();

  const employee = db.prepare(`
    SELECT * FROM employees
    WHERE discord_id = ?
  `).get(discordId);

  if (!employee) {
    return res.status(404).send(
      layout(
        'Nicht gefunden',
        `<div class="shell">
          ${pageHeader('Nicht gefunden', 'Der Mitarbeiter wurde nicht gefunden.', 'employees')}
          <div class="card">
            <a class="button secondary" href="/personal/mitarbeiter">Zurück zum Personal</a>
          </div>
        </div>`
      )
    );
  }

  const labels = db.prepare(`
    SELECT label
    FROM employee_labels
    WHERE discord_id = ?
    ORDER BY label
  `).all(discordId).map(row=>row.label);

  const hiringBlock = db.prepare(`
    SELECT * FROM hiring_blocks
    WHERE discord_id = ? AND revoked_at IS NULL
  `).get(discordId);
  const hiringBlockActive = hiringBlock && (
    Number(hiringBlock.indefinite) === 1 ||
    (hiringBlock.blocked_until && new Date(hiringBlock.blocked_until).getTime() > Date.now())
  );

  const ranks = db.prepare(`
    SELECT *
    FROM employee_ranks
    WHERE discord_id = ?
    ORDER BY area
  `).all(discordId);

  const sanctions = db.prepare(`
    SELECT *
    FROM sanctions
    WHERE discord_id = ?
    ORDER BY id DESC
  `).all(discordId);

  const sales = db.prepare(`
    SELECT *
    FROM sales
    WHERE discord_id = ?
    ORDER BY id DESC
  `).all(discordId);

  const absences = db.prepare(`
    SELECT *
    FROM absences
    WHERE discord_id = ?
    ORDER BY id DESC
  `).all(discordId);

  const actions = db.prepare(`
    SELECT *
    FROM personnel_actions
    WHERE discord_id = ?
    ORDER BY id DESC
  `).all(discordId);

  const meetingInvitations = db.prepare(`
    SELECT
      mi.*,
      COALESCE(e.display_name, mi.invited_by) AS invited_by_name
    FROM meeting_invitations mi
    LEFT JOIN employees e
      ON e.discord_id = mi.invited_by
    WHERE mi.discord_id = ?
    ORDER BY mi.id DESC
  `).all(discordId);

  const neonRank = ranks.find(rank => rank.area === 'neon' && rank.active);
  const sakuraRank = ranks.find(rank => rank.area === 'sakura' && rank.active);

  const openMeetingCount = meetingInvitations.filter(
    invitation => (invitation.status || 'OPEN') === 'OPEN'
  ).length;

  const openSanctions = sanctions.filter(sanction => sanction.status === 'OPEN');
  const openAmount = openSanctions.reduce((sum, sanction) => sum + Number(sanction.amount || 0), 0);
  const totalAmount = sanctions.reduce((sum, sanction) => sum + Number(sanction.amount || 0), 0);
  const totalSales = sales
    .filter(sale => (sale.status || 'ACTIVE') !== 'REVOKED')
    .reduce((sum, sale) => sum + Number(sale.amount || 0), 0);

  const meetingRows = meetingInvitations.length
    ? meetingInvitations.map(invitation => `
      <tr>
        <td>${formatDate(invitation.created_at)}</td>
        <td>${escapeHtml(invitation.reason)}</td>
        <td>${escapeHtml(invitation.note || '—')}</td>
        <td>${escapeHtml(invitation.invited_by_name || invitation.invited_by)}</td>
        <td>
          ${
            (invitation.status || 'OPEN') === 'COMPLETED'
              ? `<span class="badge good">Abgeschlossen</span>${invitation.completed_at ? `<div class="muted">${formatDate(invitation.completed_at)}</div>` : ''}`
              : '<span class="badge neutral">Offen</span>'
          }
        </td>
        <td>
          ${
            invitation.thread_id
              ? '<span class="badge good">Thread erstellt</span>'
              : '<span class="badge neutral">Kein Thread</span>'
          }
        </td>
      </tr>
    `).join('')
    : `<tr><td colspan="6" class="empty">Keine Gesprächseinladungen vorhanden.</td></tr>`;

  const sanctionRows = sanctions.length
    ? sanctions.map(sanction => `
      <tr>
        <td>#${sanction.id}</td>
        <td>${formatDate(sanction.created_at)}</td>
        <td>
          ${formatDate(getSanctionDeadline(sanction.created_at, sanction.escalation_level, sanction.deadline_extension_days).toISOString())}
          ${sanction.status === 'OPEN' && getSanctionDeadline(sanction.created_at, sanction.escalation_level, sanction.deadline_extension_days).getTime() < nowMs
            ? '<br><span class="badge bad">⚠️ Überfällig</span>'
            : ''}
        </td>
        <td>${formatMoney(sanction.amount)}</td>
        <td>
          <span class="badge ${sanction.status === 'OPEN' ? 'bad' : sanction.status === 'PAID' ? 'good' : 'neutral'}">
            ${sanction.status === 'OPEN' ? '🔴 Offen' : sanction.status === 'PAID' ? '🟢 Bezahlt' : '↩️ Revidiert'}
          </span>
        </td>
        <td>${escapeHtml(sanction.reason)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="5" class="empty">Keine Sanktionen vorhanden.</td></tr>`;

  const salesRows = sales.length
    ? sales.map(sale => `
      <tr>
        <td>${formatDate(sale.created_at)}</td>
        <td>${formatMoney(sale.amount)}</td>
        <td>${escapeHtml(sale.note || '—')}</td>
        <td>${(sale.status || 'ACTIVE') === 'REVOKED' ? '<span class="badge neutral">↩️ Revidiert</span>' : '<span class="badge good">Aktiv</span>'}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="3" class="empty">Keine Verkäufe vorhanden.</td></tr>`;

  const absenceRows = absences.length
    ? absences.map(absence => `
      <tr>
        <td>${escapeHtml(absence.date_from)}</td>
        <td>${escapeHtml(absence.date_to)}</td>
        <td>${escapeHtml(absence.reason || '—')}</td>
        <td>${formatDate(absence.created_at)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="4" class="empty">Keine Abmeldungen vorhanden.</td></tr>`;

  const actionRows = actions.length
    ? actions.map(action => `
      <tr>
        <td>${formatDate(action.created_at)}</td>
        <td>${escapeHtml(action.action)}</td>
        <td>${escapeHtml(
          action.area === 'neon'
            ? 'Neon Lotus'
            : action.area === 'blacklist'
              ? 'Blacklist'
              : action.area === 'sakura'
                ? 'Sakura'
                : action.area === 'global'
                  ? 'Global'
                  : '—'
        )}</td>
        <td>${escapeHtml(action.old_rank || '—')}</td>
        <td>${escapeHtml(action.new_rank || '—')}</td>
        <td>${escapeHtml(action.reason || '—')}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="6" class="empty">Kein Personalverlauf vorhanden.</td></tr>`;

  res.send(
    layout(
      `${employee.display_name} – Personalakte`,
      `<div class="shell">
        ${pageHeader(
          employee.display_name,
          `${employee.active ? '🟢 Aktiv' : '⚫ Inaktiv'} · Discord-ID ${employee.discord_id}`,
          'employees'
        )}

        <a class="backlink" href="/personal/mitarbeiter">← Zur Personalübersicht</a>

        <div class="card section">
          <div class="section-title"><h2>🏷️ Labels</h2><div class="muted">Mehrfachauswahl möglich</div></div>
          <form method="post" action="/personal/mitarbeiter/${employee.discord_id}/labels">
            <div style="display:flex;gap:18px;flex-wrap:wrap;margin:12px 0 18px">
              ${[
                ['watch','Beobachten'],
                ['active','Aktiv'],
                ['inactive','Inaktiv'],
                ['dues_exempt','Abgaben befreit'],
                ['friday_exempt','Freitags befreit']
              ].map(([value,label])=>`<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="labels" value="${value}" ${labels.includes(value)?'checked':''}> ${label}</label>`).join('')}
            </div>
            <div style="margin:0 0 18px">
              <div class="muted" style="margin-bottom:7px">Eigene Labels (mit Komma trennen)</div>
              <input class="search" style="width:100%;max-width:650px" type="text" name="custom_labels" maxlength="500"
                placeholder="z. B. Metro-Ausbilder, Gespräch geplant, Probezeit"
                value="${escapeHtml(labels.filter(label=>!['watch','active','inactive','dues_exempt','friday_exempt'].includes(label)).join(', '))}">
            </div>
            <button class="button" type="submit">Labels speichern</button>
          </form>
        </div>

        <div class="grid grid-4">
          <div class="card rank-card">
            <div class="muted">Neon Lotus</div>
            <div class="rank">${escapeHtml(neonRank?.rank_name || '—')}</div>
          </div>

          <div class="card rank-card">
            <div class="muted">Sakura</div>
            <div class="rank">${escapeHtml(sakuraRank?.rank_name || '—')}</div>
          </div>

          <div class="card metric">
            <div class="label">Offene Sanktionen</div>
            <div class="value">${formatNumber(openSanctions.length)}</div>
          </div>

          <div class="card metric">
            <div class="label">Offener Betrag</div>
            <div class="value">${formatMoney(openAmount)}</div>
          </div>

          <div class="card metric">
            <div class="label">Offene Gespräche</div>
            <div class="value">${formatNumber(openMeetingCount)}</div>
          </div>
        </div>

        <div class="card section">
          <div class="section-title">
            <h2>📅 Gesprächseinladungen</h2>
            <div class="muted">${openMeetingCount} offen · ${meetingInvitations.length} insgesamt</div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Anlass</th>
                  <th>Hinweis</th>
                  <th>Eingeladen durch</th>
                  <th>Status</th>
                  <th>Thread</th>
                </tr>
              </thead>
              <tbody>${meetingRows}</tbody>
            </table>
          </div>
        </div>

        <div class="card section">
          <div class="section-title">
            <h2>⚠️ Sanktionen</h2>
            <div class="muted">Gesamt: ${sanctions.length} · Summe: ${formatMoney(totalAmount)}</div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Datum</th>
                  <th>Betrag</th>
                  <th>Status</th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>${sanctionRows}</tbody>
            </table>
          </div>
        </div>

        <div class="card section">
          <div class="section-title">
            <h2>💰 Verkäufe</h2>
            <div class="muted">${sales.length} Verkäufe · ${formatMoney(totalSales)}</div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Betrag</th>
                  <th>Notiz</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${salesRows}</tbody>
            </table>
          </div>
        </div>

        <div class="card section">
          <h2>📅 Abmeldungen</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Von</th>
                  <th>Bis</th>
                  <th>Grund</th>
                  <th>Eingetragen</th>
                </tr>
              </thead>
              <tbody>${absenceRows}</tbody>
            </table>
          </div>
        </div>

        
        <div class="card section">
          <h2>🚪 Kündigung / Schuldenstatus</h2>
          ${(()=>{
            const openDebt=Number(db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM sanctions WHERE discord_id=? AND status='OPEN'`).get(employee.discord_id)?.total||0);
            const lastTermination=db.prepare(`SELECT * FROM termination_records WHERE discord_id=? ORDER BY id DESC LIMIT 1`).get(employee.discord_id);
            const bench=db.prepare(`SELECT * FROM termination_records WHERE discord_id=? AND bench_active=1 ORDER BY id DESC LIMIT 1`).get(employee.discord_id);
            return `
              ${openDebt>=1000000?`<p><span class="badge bad">⚠ Kündigung ausstehend – Schulden</span></p><p>Aktuell offene Sanktionen: <strong>${formatMoney(openDebt)}</strong></p>`:`<p class="muted">Aktuell offene Sanktionen: ${formatMoney(openDebt)}</p>`}
              ${bench?`<p><span class="badge warn">🪑 Ersatzbank</span></p><p>Kündigungsdatum: <strong>${formatDate(bench.terminated_at)}</strong><br>Letzter Rang: <strong>${escapeHtml(bench.last_rank||'—')}</strong><br>Vermerk: ${escapeHtml(bench.note||'—')}</p>`:''}
              ${lastTermination&&lastTermination.termination_type==='DEBT'?`<p><span class="badge bad">Kündigung mit Schulden</span></p><p>Schuldenstand bei Kündigung: <strong>${formatMoney(lastTermination.debt_amount)}</strong><br>Kündigungsdatum: ${formatDate(lastTermination.terminated_at)}<br>Letzter Rang: ${escapeHtml(lastTermination.last_rank||'—')}</p>`:''}
            `;
          })()}
        </div>

<div class="card section">
          <h2>📈 Personalverlauf</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Aktion</th>
                  <th>Bereich</th>
                  <th>Vorher</th>
                  <th>Nachher</th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>${actionRows}</tbody>
            </table>
          </div>
        </div>
<div class="card section ${hiringBlockActive?'danger-card':''}">
          <div class="section-title"><h2>🚫 Einstellungssperre</h2><div>${hiringBlockActive?'<span class="badge bad">Aktiv</span>':'<span class="badge neutral">Keine aktive Sperre</span>'}</div></div>
          ${hiringBlockActive ? `<p><strong>Gesperrt bis:</strong> ${Number(hiringBlock.indefinite)===1?'Unbefristet':formatDate(hiringBlock.blocked_until)}</p><p><strong>Grund:</strong> ${escapeHtml(hiringBlock.reason)}</p><p class="muted">Eingetragen durch ${escapeHtml(hiringBlock.created_by)} · ${formatDate(hiringBlock.created_at)}</p>` : '<p class="muted">Für diese Person besteht aktuell keine Einstellungssperre.</p>'}
          <form method="post" action="/personal/mitarbeiter/${employee.discord_id}/einstellungssperre">
            <div class="grid grid-2">
              <label><div class="muted">Dauer (1–30)</div><input class="search" type="number" name="duration_value" min="1" max="30" value="1"></label>
              <label><div class="muted">Einheit</div><select class="search" name="duration_unit"><option value="days">Tage</option><option value="weeks">Wochen</option><option value="months" selected>Monate</option><option value="years">Jahre</option></select></label>
            </div>
            <label style="display:flex;gap:8px;align-items:center;margin:14px 0"><input type="checkbox" name="indefinite" value="YES"> Unbefristete Einstellungssperre</label>
            <label><div class="muted">Grund</div><input class="search" name="reason" maxlength="500" required placeholder="Grund der Einstellungssperre"></label>
            <label style="display:block;margin-top:14px"><div class="muted">Deine Discord-ID</div><input class="search" name="discord_id" required autocomplete="off" placeholder="Discord-ID"></label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="button danger" name="action" value="set" type="submit">Sperre setzen / ersetzen</button>${hiringBlockActive?'<button class="button secondary" name="action" value="revoke" type="submit">Sperre aufheben</button>':''}</div>
          </form>
        </div>

        
      </div>`
    )
  );
});


router.post('/mitarbeiter/:discordId/einstellungssperre', requireAuth, (req,res)=>{
  const discordId=String(req.params.discordId||'').trim();
  const suppliedId=String(req.body.discord_id||'').trim();
  const action=String(req.body.action||'set');
  if(suppliedId!==COMPLETE_CLEAR_OWNER_ID){
    return res.status(403).send(layout('Nicht berechtigt',`<div class="shell">${pageHeader('Zugriff verweigert','Einstellungssperren sind ausschließlich für die fest hinterlegte Discord-ID freigegeben.','employees')}<div class="card danger-card section"><span class="badge bad">Nicht berechtigt</span><p>Die eingegebene Discord-ID besitzt keine Freigabe.</p><a class="button secondary" href="/personal/mitarbeiter/${encodeURIComponent(discordId)}">Zurück</a></div></div>`));
  }
  const employee=db.prepare(`SELECT discord_id FROM employees WHERE discord_id=?`).get(discordId);
  if(!employee)return res.status(404).send('Personalakte nicht gefunden.');
  const now=new Date();
  if(action==='revoke'){
    db.prepare(`UPDATE hiring_blocks SET revoked_by=?,revoked_at=? WHERE discord_id=? AND revoked_at IS NULL`).run(suppliedId,now.toISOString(),discordId);
    return res.redirect(`/personal/mitarbeiter/${encodeURIComponent(discordId)}`);
  }
  const indefinite=String(req.body.indefinite||'')==='YES';
  const value=Number(req.body.duration_value);
  const unit=String(req.body.duration_unit||'');
  const reason=String(req.body.reason||'').trim();
  if(!reason||(!indefinite&&(!Number.isInteger(value)||value<1||value>30||!['days','weeks','months','years'].includes(unit)))){
    return res.status(400).send('Ungültige Einstellungssperre.');
  }
  let until=null;
  if(!indefinite){
    const d=new Date(now);
    if(unit==='days')d.setDate(d.getDate()+value);
    if(unit==='weeks')d.setDate(d.getDate()+(value*7));
    if(unit==='months')d.setMonth(d.getMonth()+value);
    if(unit==='years')d.setFullYear(d.getFullYear()+value);
    until=d.toISOString();
  }
  db.prepare(`
    INSERT INTO hiring_blocks(discord_id,reason,duration_value,duration_unit,blocked_until,indefinite,created_by,created_at,revoked_by,revoked_at)
    VALUES(?,?,?,?,?,?,?,?,NULL,NULL)
    ON CONFLICT(discord_id) DO UPDATE SET
      reason=excluded.reason,duration_value=excluded.duration_value,duration_unit=excluded.duration_unit,
      blocked_until=excluded.blocked_until,indefinite=excluded.indefinite,created_by=excluded.created_by,
      created_at=excluded.created_at,revoked_by=NULL,revoked_at=NULL
  `).run(discordId,reason,indefinite?null:value,indefinite?null:unit,until,indefinite?1:0,suppliedId,now.toISOString());
  return res.redirect(`/personal/mitarbeiter/${encodeURIComponent(discordId)}`);
});

router.post('/mitarbeiter/:discordId/labels', requireAuth, (req,res)=>{
  const discordId=req.params.discordId;
  const allowed=new Set(['watch','active','inactive','dues_exempt','friday_exempt']);
  const raw=Array.isArray(req.body.labels)?req.body.labels:(req.body.labels?[req.body.labels]:[]);
  const fixed=raw.filter(label=>allowed.has(label));
  const custom=String(req.body.custom_labels||'')
    .split(',')
    .map(label=>label.trim())
    .filter(label=>label.length>=1&&label.length<=40)
    .filter(label=>!allowed.has(label))
    .slice(0,20);
  const labels=[...new Set([...fixed,...custom])];
  const now=new Date().toISOString();
  const tx=db.transaction(()=>{
    db.prepare(`DELETE FROM employee_labels WHERE discord_id=?`).run(discordId);
    const ins=db.prepare(`INSERT INTO employee_labels(discord_id,label,created_at) VALUES(?,?,?)`);
    for(const label of labels)ins.run(discordId,label,now);
  });
  tx();
  return res.redirect(`/personal/mitarbeiter/${encodeURIComponent(discordId)}`);
});

/* SANKTIONEN */
router.get('/sanktionen', requireAuth, (_req, res) => {
  processOverdueSanctions();
  const sanctions = db.prepare(`
    SELECT
      s.*,
      COALESCE(e.display_name, s.discord_id) AS display_name
    FROM sanctions s
    LEFT JOIN employees e
      ON e.discord_id = s.discord_id
    ORDER BY s.id DESC
  `).all();

  const open = sanctions.filter(sanction => sanction.status === 'OPEN');
  const paid = sanctions.filter(sanction => sanction.status === 'PAID');
  const revoked = sanctions.filter(sanction => sanction.status === 'REVOKED');
  const nowMs = Date.now();
  const overdue = open.filter(sanction =>
    getSanctionDeadline(sanction.created_at, sanction.escalation_level, sanction.deadline_extension_days).getTime() < nowMs
  );
  const totalAmount = sanctions.reduce((sum, sanction) => sum + Number(sanction.amount || 0), 0);
  const openAmount = open.reduce((sum, sanction) => sum + Number(sanction.amount || 0), 0);

  const rows = sanctions.length
    ? sanctions.map(sanction => `
      <tr class="filter-row" data-search="${escapeHtml(
        `${sanction.id} ${sanction.display_name} ${sanction.reason} ${sanction.status} ${sanction.amount}`.toLowerCase()
      )}">
        <td>#${sanction.id}</td>
        <td>
          <a href="/personal/mitarbeiter/${encodeURIComponent(sanction.discord_id)}">
            <strong>${escapeHtml(sanction.display_name)}</strong>
          </a>
        </td>
        <td>${formatDate(sanction.created_at)}</td>
        <td>
          ${formatDate(getSanctionDeadline(sanction.created_at, sanction.escalation_level, sanction.deadline_extension_days).toISOString())}
          ${sanction.status === 'OPEN' && getSanctionDeadline(sanction.created_at, sanction.escalation_level, sanction.deadline_extension_days).getTime() < nowMs
            ? '<br><span class="badge bad">⚠️ Überfällig</span>'
            : ''}
        </td>
        <td>${formatMoney(sanction.amount)}</td>
        <td>
          <span class="badge ${sanction.status === 'OPEN' ? 'bad' : sanction.status === 'PAID' ? 'good' : 'neutral'}">
            ${sanction.status === 'OPEN' ? '🔴 Offen' : sanction.status === 'PAID' ? '🟢 Bezahlt' : '↩️ Revidiert'}
          </span>
        </td>
        <td>${escapeHtml(sanction.reason)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="7" class="empty">Keine Sanktionen vorhanden.</td></tr>`;

  res.send(
    layout(
      'Sanktionen',
      `<div class="shell">
        ${pageHeader(
          'Sanktionen',
          'Vollständige Übersicht aller offenen, bezahlten und revidierten Sanktionen.',
          'sanctions'
        )}

        <div class="grid grid-4">
          <div class="card metric">
            <div class="label">Gesamt</div>
            <div class="value">${sanctions.length}</div>
          </div>
          <div class="card metric">
            <div class="label">Offen</div>
            <div class="value">${open.length}</div>
          </div>
          <div class="card metric">
            <div class="label">Bezahlt</div>
            <div class="value">${paid.length}</div>
          </div>
          <div class="card metric">
            <div class="label">Revidiert</div>
            <div class="value">${revoked.length}</div>
          </div>
          <div class="card metric">
            <div class="label">Überfällig</div>
            <div class="value">${overdue.length}</div>
            <div class="hint">Zahlungsfrist: 5 Tage</div>
          </div>
          <div class="card metric">
            <div class="label">Offener Betrag</div>
            <div class="value">${formatMoney(openAmount)}</div>
            <div class="hint">Gesamtsumme: ${formatMoney(totalAmount)}</div>
          </div>
        </div>

        <div class="card section">
          <div class="search-row">
            <input id="tableSearch" class="search" type="search" placeholder="Mitarbeiter, ID, Grund, Status oder Betrag suchen...">
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Mitarbeiter</th>
                  <th>Datum</th>
                  <th>Zahlungsfrist</th>
                  <th>Betrag</th>
                  <th>Status</th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>

      <script>
        const search = document.getElementById('tableSearch');
        const rows = [...document.querySelectorAll('.filter-row')];

        search?.addEventListener('input', () => {
          const term = search.value.trim().toLowerCase();
          for (const row of rows) {
            row.style.display = row.dataset.search.includes(term) ? '' : 'none';
          }
        });
      </script>`
    )
  );
});

/* ABMELDUNGEN */
router.get('/abmeldungen', requireAuth, (_req, res) => {
  const absences = db.prepare(`
    SELECT
      a.*,
      COALESCE(e.display_name, a.discord_id) AS display_name
    FROM absences a
    LEFT JOIN employees e
      ON e.discord_id = a.discord_id
    ORDER BY a.id DESC
  `).all();

  const rows = absences.length
    ? absences.map(absence => `
      <tr class="filter-row" data-search="${escapeHtml(
        `${absence.display_name} ${absence.date_from} ${absence.date_to} ${absence.reason || ''}`.toLowerCase()
      )}">
        <td>
          <a href="/personal/mitarbeiter/${encodeURIComponent(absence.discord_id)}">
            <strong>${escapeHtml(absence.display_name)}</strong>
          </a>
        </td>
        <td>${escapeHtml(absence.date_from)}</td>
        <td>${escapeHtml(absence.date_to)}</td>
        <td>${escapeHtml(absence.reason || '—')}</td>
        <td>${formatDate(absence.created_at)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="5" class="empty">Keine Abmeldungen vorhanden.</td></tr>`;

  res.send(
    layout(
      'Abmeldungen',
      `<div class="shell">
        ${pageHeader(
          'Abmeldungen',
          'Übersicht über alle eingetragenen Abwesenheiten.',
          'absences'
        )}

        <div class="grid grid-3">
          <div class="card metric">
            <div class="label">Abmeldungen gesamt</div>
            <div class="value">${absences.length}</div>
          </div>
        </div>

        <div class="card section">
          <div class="search-row">
            <input id="tableSearch" class="search" type="search" placeholder="Mitarbeiter, Zeitraum oder Grund suchen...">
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mitarbeiter</th>
                  <th>Von</th>
                  <th>Bis</th>
                  <th>Grund</th>
                  <th>Eingetragen</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>

      <script>
        const search = document.getElementById('tableSearch');
        const rows = [...document.querySelectorAll('.filter-row')];

        search?.addEventListener('input', () => {
          const term = search.value.trim().toLowerCase();
          for (const row of rows) {
            row.style.display = row.dataset.search.includes(term) ? '' : 'none';
          }
        });
      </script>`
    )
  );
});



/* ABMELDUNG AUFSTELLUNG */
router.get('/abmeldung-aufstellung', requireAuth, (req,res)=>{
  const parseIso=value=>{
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m)return null;
    const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    return Number.isNaN(d.getTime())?null:d;
  };
  const formatGerman=d=>`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  let friday=parseIso(req.query.freitag);
  if(!friday){
    const now=new Date(),delta=(now.getDay()-5+7)%7;
    friday=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    friday.setDate(friday.getDate()-delta);
  }
  // Auswahl immer auf den Freitag derselben Woche normalisieren.
  const shift=(5-friday.getDay()+7)%7;
  if(shift)friday.setDate(friday.getDate()+shift);
  const fridayGerman=formatGerman(friday);

  const personnel=db.prepare(`
    SELECT e.discord_id,e.display_name,
      COALESCE(er.rank_name,'—') AS rank_name,
      EXISTS(
        SELECT 1 FROM employee_labels el
        WHERE el.discord_id=e.discord_id AND el.label='friday_exempt'
      ) AS friday_exempt
    FROM employees e
    LEFT JOIN employee_ranks er ON er.discord_id=e.discord_id AND er.active=1
    WHERE e.active=1
    ORDER BY e.display_name COLLATE NOCASE
  `).all();

  const absences=db.prepare(`
    SELECT * FROM absences
    WHERE COALESCE(status,'ACTIVE')!='REVOKED'
  `).all();

  const parseGerman=value=>{
    const m=String(value||'').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if(!m)return null;
    return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));
  };
  const target=new Date(friday.getFullYear(),friday.getMonth(),friday.getDate()).getTime();
  const covering=new Map();
  for(const a of absences){
    const from=parseGerman(a.date_from),to=parseGerman(a.date_to);
    if(from&&to&&from.getTime()<=target&&to.getTime()>=target){
      if(!covering.has(a.discord_id))covering.set(a.discord_id,[]);
      covering.get(a.discord_id).push(a);
    }
  }
  const absent=personnel.filter(p=>covering.has(p.discord_id)||p.friday_exempt);
  const present=personnel.filter(p=>!covering.has(p.discord_id)&&!p.friday_exempt);
  const makeRows=(rows,isAbsent)=>rows.length?rows.map(p=>`
    <tr data-search="${escapeHtml(`${p.display_name} ${p.rank_name}`.toLowerCase())}">
      <td>${escapeHtml(p.display_name)}</td>
      <td>${escapeHtml(p.rank_name||'—')}</td>
      <td>${isAbsent?(covering.has(p.discord_id)?`<span class="badge good">Abgemeldet</span>`:`<span class="badge good">Freitags befreit</span>`):`<span class="badge bad">Nicht abgemeldet</span>`}</td>
      <td>${isAbsent?(covering.has(p.discord_id)?escapeHtml(covering.get(p.discord_id).map(a=>`#${a.id}: ${a.date_from}–${a.date_to}`).join(', ')):'Dauerhafte Freitagsbefreiung per Label'):'—'}</td>
    </tr>`).join(''):`<tr><td colspan="4" class="empty">Keine Personen.</td></tr>`;

  res.send(layout('Abmeldung Aufstellung',`<div class="shell">
    ${pageHeader('Abmeldung Aufstellung',`Wer am Freitag ${fridayGerman} abgemeldet, dauerhaft freitags befreit bzw. nicht abgemeldet ist.`,'lineup')}
    <div class="card section">
      <form method="get" action="/personal/abmeldung-aufstellung" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
        <label><div class="muted">Freitag auswählen</div><input class="search" type="date" name="freitag" value="${iso(friday)}"></label>
        <button class="button" type="submit">Aufstellung anzeigen</button>
      </form>
    </div>
    <div class="grid grid-3">
      <div class="card metric"><div class="label">Aktives Personal</div><div class="value">${personnel.length}</div></div>
      <div class="card metric"><div class="label">Abgemeldet / befreit</div><div class="value">${absent.length}</div></div>
      <div class="card metric"><div class="label">Nicht abgemeldet</div><div class="value">${present.length}</div></div>
    </div>
    <div class="card section"><div class="section-title"><h2>🏖️ Abgemeldet / freitags befreit</h2><div class="muted">Abmeldung umfasst den Freitag oder feste Freitagsbefreiung ist gesetzt</div></div>
      <div class="table-wrap"><table><thead><tr><th>Person</th><th>Framework-Rang</th><th>Status</th><th>Abmeldung</th></tr></thead><tbody>${makeRows(absent,true)}</tbody></table></div>
    </div>
    <div class="card section"><div class="section-title"><h2>⚠️ Nicht abgemeldet</h2><div class="muted">Übersicht für die Aufstellung / mögliche Sanktionen</div></div>
      <div class="table-wrap"><table><thead><tr><th>Person</th><th>Framework-Rang</th><th>Status</th><th>Abmeldung</th></tr></thead><tbody>${makeRows(present,false)}</tbody></table></div>
    </div>
  </div>`));
});

/* WOCHENABGABEN */
router.get('/wochenabgaben', requireAuth, (_req, res) => {
  // Beim Öffnen der Website den aktuellen Personalstand sofort mit der
  // Wochenabgaben-Tabelle abgleichen. So erscheinen neue/reaktivierte oder
  // ranggewechselte Mitarbeiter ohne vorherigen Discord-Befehl.
  ensureWeeklyDues();

  const cycle=getFridayCycle();
  const exemptPersonnel=currentSakuraPersonnel()
    .map(person=>({
      ...person,
      absenceExempt:isAbsentOnFriday(person.discord_id,cycle),
      manualExempt:isManuallyDuesExempt(person.discord_id)
    }))
    .filter(person=>person.absenceExempt||person.manualExempt||weeklyBaseForRank(person.rank_name)===0);

  const rows = db.prepare(`
    SELECT w.*, COALESCE(e.display_name,w.discord_id) AS display_name
    FROM weekly_dues w
    LEFT JOIN employees e ON e.discord_id=w.discord_id
    ORDER BY CASE WHEN w.status='OPEN' THEN 0 ELSE 1 END, w.amount_due DESC, display_name
  `).all();
  const history = db.prepare(`SELECT * FROM weekly_dues_history ORDER BY id DESC LIMIT 50`).all();
  const open = rows.filter(r=>r.status==='OPEN');
  const openAmount = open.reduce((s,r)=>s+Number(r.amount_due||0),0);
  const tableRows = rows.length ? rows.map(r=>`
    <tr data-search="${escapeHtml(`${r.display_name} ${r.rank_name} ${r.status}`.toLowerCase())}">
      <td>${escapeHtml(r.display_name)}</td><td>${escapeHtml(r.rank_name||'—')}</td>
      <td>${formatMoney(r.base_amount)}</td><td><strong>${formatMoney(r.amount_due)}</strong></td>
      <td><span class="badge ${r.status==='PAID'?'good':'bad'}">${r.status==='PAID'?'✓ Bezahlt':'● Offen'}</span></td>
      <td>${escapeHtml(r.cycle_start||'—')} – ${escapeHtml(r.cycle_end||'—')}</td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">Noch keine Wochenabgaben vorhanden. Sie werden beim ersten /wochenabgaben-Befehl angelegt.</td></tr>`;
  const historyRows = history.length ? history.map(h=>`
    <tr><td>${formatDate(h.created_at)}</td><td>${escapeHtml(h.discord_id)}</td><td>${escapeHtml(h.action)}</td><td>${formatMoney(h.amount_before)}</td><td>${formatMoney(h.amount_after)}</td></tr>`).join('') : `<tr><td colspan="5" class="empty">Noch keine Historie.</td></tr>`;
  res.send(layout('Wochenabgaben',`<div class="shell">${pageHeader('Wochenabgaben','Freitag bis Freitag · offene Beträge werden beim Wochenwechsel verdoppelt.','weekly')}
    <div class="grid grid-3"><div class="card metric"><div class="label">Offen</div><div class="value">${open.length}</div></div>
    <div class="card metric"><div class="label">Offener Gesamtbetrag</div><div class="value">${formatMoney(openAmount)}</div></div>
    <div class="card metric"><div class="label">Mitarbeiter mit Abgabe</div><div class="value">${rows.length}</div></div></div>
    <div class="card section"><div class="search-row"><input id="tableSearch" class="search" type="search" placeholder="Personal durchsuchen …"></div>
    <div class="table-wrap"><table><thead><tr><th>Person</th><th>Rang</th><th>Regulär</th><th>Fällig</th><th>Status</th><th>Zeitraum</th></tr></thead><tbody id="weeklyRows">${tableRows}</tbody></table></div></div>
    <div class="card section"><h2>📚 Letzte Änderungen</h2><div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Discord-ID</th><th>Aktion</th><th>Vorher</th><th>Danach</th></tr></thead><tbody>${historyRows}</tbody></table></div></div>
    <script>const s=document.getElementById('tableSearch');s?.addEventListener('input',()=>{const q=s.value.toLowerCase();document.querySelectorAll('#weeklyRows tr[data-search]').forEach(r=>r.style.display=r.dataset.search.includes(q)?'':'none');});</script>
  </div>`));
});


/* KOMPLETT-CLEAR
   Die Website hat keine Discord-OAuth-Sitzung. Deshalb wird die fest freigegebene
   Discord-ID zusätzlich zur CLEAR-Bestätigung abgefragt. Nur die exakt hinterlegte
   ID wird akzeptiert. */
const COMPLETE_CLEAR_OWNER_ID = '339017861400100864';

router.get('/komplett-clear', requireAuth, (req, res) => {
  const state = req.query.status === 'inactive_done'
    ? `<div class="card section"><span class="badge good">✓ Inaktive Personalakten bereinigt</span><p class="muted">${escapeHtml(req.query.count || '0')} inaktive Personalakten wurden dauerhaft gelöscht.</p></div>`
    : req.query.status === 'single_done'
      ? `<div class="card section"><span class="badge good">✓ Personalakte gelöscht</span><p class="muted">Die ausgewählte Personalakte wurde vollständig aus der Verwaltung entfernt.</p></div>`
      : '';

  res.send(layout('Komplett-Clear', `<div class="shell">
    ${pageHeader(
      'Datenbereinigung',
      'Geschützte Bereinigung inaktiver oder gezielt ausgewählter Personalakten.',
      'clear'
    )}
    ${state}

    <div class="card section">
      <div class="section-title"><h2>🧹 Inaktive Personalakten bereinigen</h2></div>
      <p>Hier können ausschließlich bereits inaktive Personalakten gelöscht werden, deren letzte bekannte Aktivität länger als der gewählte Zeitraum zurückliegt. Aktive Mitarbeiter sind grundsätzlich ausgeschlossen.</p>
      <p class="muted">Diese Funktion verwendet dieselbe fest hinterlegte Discord-ID wie der Komplett-Clear. Die ID wird nicht angezeigt.</p>
      <form method="post" action="/personal/komplett-clear/inaktive">
        <div class="grid grid-2">
          <label>
            <div class="muted">Deine Discord-ID</div>
            <input class="search" name="discord_id" autocomplete="off" required placeholder="Discord-ID">
          </label>
          <label>
            <div class="muted">Inaktiv seit mindestens</div>
            <select class="search" name="months" required>
              <option value="3">3 Monaten</option>
              <option value="6" selected>6 Monaten</option>
              <option value="12">12 Monaten</option>
            </select>
          </label>
        </div>
        <div style="margin-top:14px">
          <label>
            <div class="muted">Bestätigung</div>
            <input class="search" name="confirmation" autocomplete="off" required placeholder="CLEAR">
          </label>
        </div>
        <label style="display:flex;gap:10px;align-items:flex-start;margin:18px 0">
          <input type="checkbox" name="final_confirmation" value="YES" required style="margin-top:4px">
          <span>Ich bestätige, dass die betroffenen inaktiven Personalakten einschließlich ihrer zugehörigen Historien dauerhaft gelöscht werden sollen.</span>
        </label>
        <button class="button danger" type="submit">🧹 Inaktive Personalakten bereinigen</button>
      </form>
    </div>

    <div class="card section">
      <div class="section-title"><h2>🎯 Einzelne Personalakte vollständig löschen</h2></div>
      <p>Hier kann eine einzelne Personalakte gezielt und vollständig aus der Verwaltung entfernt werden, zum Beispiel bei einer versehentlichen Einstellung.</p>
      <p class="muted">Aktive und inaktive Akten können ausgewählt werden. Discord-Rollen werden dabei nicht verändert. Diese Funktion ist ausschließlich für dieselbe autorisierte Discord-ID wie der bisherige Global Clear freigegeben.</p>
      <form method="post" action="/personal/komplett-clear/einzelakte">
        <div class="grid grid-2">
          <label>
            <div class="muted">Deine Discord-ID</div>
            <input class="search" name="discord_id" autocomplete="off" required placeholder="Discord-ID">
          </label>
          <label>
            <div class="muted">Zu löschende Person</div>
            <select class="search" name="target_discord_id" required>
              <option value="">Person auswählen …</option>
              ${getEmployees().map(employee=>`<option value="${escapeHtml(employee.discord_id)}">${escapeHtml(employee.display_name)} · ${employee.active?'Aktiv':'Inaktiv'} · ${escapeHtml(employee.discord_id)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="margin-top:14px">
          <label>
            <div class="muted">Bestätigung</div>
            <input class="search" name="confirmation" autocomplete="off" required placeholder="CLEAR">
          </label>
        </div>
        <label style="display:flex;gap:10px;align-items:flex-start;margin:18px 0">
          <input type="checkbox" name="final_confirmation" value="YES" required style="margin-top:4px">
          <span>Ich bestätige, dass genau diese Personalakte einschließlich ihrer zugehörigen Historien dauerhaft gelöscht werden soll.</span>
        </label>
        <button class="button danger" type="submit">🗑️ Einzelne Personalakte löschen</button>
      </form>
    </div>
  </div>`));
});



router.post('/komplett-clear/einzelakte', requireAuth, (req, res) => {
  const suppliedId=String(req.body.discord_id||'').trim();
  const targetId=String(req.body.target_discord_id||'').trim();
  const confirmation=String(req.body.confirmation||'').trim();
  const finalConfirmation=String(req.body.final_confirmation||'');

  if(suppliedId!==COMPLETE_CLEAR_OWNER_ID){
    return res.status(403).send(layout('Nicht berechtigt', `<div class="shell">
      ${pageHeader('Zugriff verweigert','Diese Funktion ist ausschließlich für die fest hinterlegte Discord-ID freigegeben.','clear')}
      <div class="card danger-card section"><span class="badge bad">Nicht berechtigt</span><p>Die eingegebene Discord-ID besitzt keine Freigabe für diese Funktion.</p><a class="button secondary" href="/personal/komplett-clear">Zurück</a></div>
    </div>`));
  }
  if(!targetId||confirmation!=='CLEAR'||finalConfirmation!=='YES'){
    return res.status(400).send(layout('Bestätigung fehlt', `<div class="shell">
      ${pageHeader('Bestätigung fehlgeschlagen','Die Personalakte wurde nicht gelöscht.','clear')}
      <div class="card danger-card section"><p>Bitte eine Person auswählen, exakt <strong>CLEAR</strong> eingeben und die Checkbox bestätigen.</p><a class="button secondary" href="/personal/komplett-clear">Zurück</a></div>
    </div>`));
  }

  const employee=db.prepare(`SELECT discord_id,display_name FROM employees WHERE discord_id=?`).get(targetId);
  if(!employee){
    return res.status(404).send(layout('Akte nicht gefunden', `<div class="shell">
      ${pageHeader('Personalakte nicht gefunden','Es wurde nichts gelöscht.','clear')}
      <div class="card section"><p>Die ausgewählte Personalakte existiert nicht mehr.</p><a class="button secondary" href="/personal/komplett-clear">Zurück</a></div>
    </div>`));
  }

  const deleteForId=(table,id)=>{
    try{return db.prepare(`DELETE FROM ${table} WHERE discord_id=?`).run(id).changes;}
    catch(error){
      if(String(error?.message||'').includes('no such table'))return 0;
      if(String(error?.message||'').includes('no such column'))return 0;
      throw error;
    }
  };

  const clearOne=db.transaction(()=>{
    const related=[
      'weekly_dues_history','weekly_dues','meeting_invitations','sanctions',
      'absences','personnel_actions','employee_ranks','employee_labels','hiring_blocks',
      'sales','cash_transactions','inventory_transactions','termination_records'
    ];
    for(const table of related)deleteForId(table,targetId);
    return db.prepare(`DELETE FROM employees WHERE discord_id=?`).run(targetId).changes;
  });

  const deleted=clearOne();
  try{db.exec('VACUUM');}
  catch(error){console.warn('VACUUM nach Einzelakten-Clear fehlgeschlagen:',error);}

  console.warn(`🎯 Einzelakten-Clear ausgeführt. Ziel: ${employee.display_name} (${targetId}). Gelöscht: ${deleted}.`);
  return res.redirect('/personal/komplett-clear?status=single_done');
});

router.post('/komplett-clear/inaktive', requireAuth, (req, res) => {
  const suppliedId=String(req.body.discord_id||'').trim();
  const confirmation=String(req.body.confirmation||'').trim();
  const finalConfirmation=String(req.body.final_confirmation||'');
  const months=Number(req.body.months);

  if(suppliedId!==COMPLETE_CLEAR_OWNER_ID){
    return res.status(403).send(layout('Nicht berechtigt', `<div class="shell">
      ${pageHeader('Zugriff verweigert','Diese Bereinigung ist ausschließlich für die fest hinterlegte Discord-ID freigegeben.','clear')}
      <div class="card danger-card section"><span class="badge bad">Nicht berechtigt</span><p>Die eingegebene Discord-ID besitzt keine Freigabe für diese Funktion.</p><a class="button secondary" href="/personal/komplett-clear">Zurück</a></div>
    </div>`));
  }
  if(![3,6,12].includes(months)||confirmation!=='CLEAR'||finalConfirmation!=='YES'){
    return res.status(400).send(layout('Bestätigung fehlt', `<div class="shell">
      ${pageHeader('Bestätigung fehlgeschlagen','Die Bereinigung wurde nicht ausgeführt.','clear')}
      <div class="card danger-card section"><p>Bitte einen gültigen Zeitraum wählen, exakt <strong>CLEAR</strong> eingeben und die Checkbox bestätigen.</p><a class="button secondary" href="/personal/komplett-clear">Zurück</a></div>
    </div>`));
  }

  const cutoff=new Date();
  cutoff.setMonth(cutoff.getMonth()-months);
  const cutoffIso=cutoff.toISOString();

  // Für inaktive Mitarbeiter wird der jüngste bekannte Zeitstempel aus
  // Mitarbeiterstamm, Rangverlauf und Personalaktionen als letzte Aktivität verwendet.
  const candidates=db.prepare(`
    SELECT e.discord_id
    FROM employees e
    WHERE e.active=0
      AND MAX(
        COALESCE(e.updated_at,''),
        COALESCE(e.created_at,''),
        COALESCE((SELECT MAX(er.joined_at) FROM employee_ranks er WHERE er.discord_id=e.discord_id),''),
        COALESCE((SELECT MAX(pa.created_at) FROM personnel_actions pa WHERE pa.discord_id=e.discord_id),'')
      ) < ?
  `).all(cutoffIso).map(row=>row.discord_id);

  if(!candidates.length){
    return res.redirect('/personal/komplett-clear?status=inactive_done&count=0');
  }

  const deleteForId=(table,id)=>{
    try{return db.prepare(`DELETE FROM ${table} WHERE discord_id=?`).run(id).changes;}
    catch(error){
      if(String(error?.message||'').includes('no such table'))return 0;
      if(String(error?.message||'').includes('no such column'))return 0;
      throw error;
    }
  };

  const clearInactive=db.transaction(()=>{
    let employeeCount=0;
    const related=[
      'weekly_dues_history','weekly_dues','meeting_invitations','sanctions',
      'absences','personnel_actions','employee_ranks','employee_labels','hiring_blocks',
      'sales','cash_transactions','inventory_transactions','termination_records'
    ];
    for(const id of candidates){
      for(const table of related)deleteForId(table,id);
      employeeCount+=db.prepare(`DELETE FROM employees WHERE discord_id=? AND active=0`).run(id).changes;
    }
    return employeeCount;
  });

  const deletedCount=clearInactive();

  // VACUUM darf nicht innerhalb einer Transaktion laufen. Es gibt tatsächlich
  // ungenutzte SQLite-Seiten an das Dateisystem zurück.
  try{db.exec('VACUUM');}
  catch(error){console.warn('VACUUM nach Inaktiv-Clear fehlgeschlagen:',error);}

  console.warn(`🧹 Inaktiv-Clear (${months} Monate) ausgeführt. Gelöschte Personalakten: ${deletedCount}.`);
  return res.redirect(`/personal/komplett-clear?status=inactive_done&count=${deletedCount}`);
});




/* LEGACY-WEITERLEITUNG */
router.get('/verkaeufe', requireAuth, (_req, res) => {
  return res.redirect('/personal');
});

/* KASSE */
router.get('/kasse', requireAuth, (_req, res) => {
  const updates = db.prepare(`
    SELECT *
    FROM cash_updates
    ORDER BY id DESC
  `).all();

  const activeUpdates = updates.filter(
    update => (update.status || 'ACTIVE') !== 'REVOKED'
  );

  const current = activeUpdates[0] || null;
  const previous = activeUpdates[1] || null;
  const currentAmount = Number(current?.amount || 0);
  const previousAmount = Number(previous?.amount || 0);
  const lastDifference = current
    ? currentAmount - previousAmount
    : 0;

  const rows = updates.length
    ? updates.map((update, index) => {
      const nextActive = updates
        .slice(index + 1)
        .find(item => (item.status || 'ACTIVE') !== 'REVOKED');

      const priorAmount = Number(nextActive?.amount || 0);
      const difference = Number(update.amount || 0) - priorAmount;
      const differenceText =
        difference === 0
          ? '$0'
          : `${difference > 0 ? '+' : '-'}$${Math.abs(difference).toLocaleString('de-DE')}`;

      return `
        <tr class="filter-row" data-search="${escapeHtml(
          `${update.id} ${update.amount} ${update.performed_by} ${update.status || 'ACTIVE'}`.toLowerCase()
        )}">
          <td>#${update.id}</td>
          <td>${formatDate(update.created_at)}</td>
          <td><strong>${formatMoney(update.amount)}</strong></td>
          <td class="${difference > 0 ? 'amount-in' : difference < 0 ? 'amount-out' : ''}">
            ${differenceText}
          </td>
          <td>${escapeHtml(update.performed_by)}</td>
          <td>
            ${
              (update.status || 'ACTIVE') === 'REVOKED'
                ? '<span class="badge neutral">↩️ Revidiert</span>'
                : current && Number(current.id) === Number(update.id)
                  ? '<span class="badge good">Aktuell</span>'
                  : '<span class="badge neutral">Historie</span>'
            }
          </td>
        </tr>
      `;
    }).join('')
    : `<tr><td colspan="6" class="empty">Noch keine Kassenstände vorhanden.</td></tr>`;

  const diffText =
    lastDifference === 0
      ? '$0'
      : `${lastDifference > 0 ? '+' : '-'}$${Math.abs(lastDifference).toLocaleString('de-DE')}`;

  res.send(
    layout(
      'Kasse',
      `<div class="shell">
        ${pageHeader(
          'Fraktionskasse',
          'Aktueller Gesamtstand der Fraktionskasse mit nachvollziehbarer Änderungshistorie.',
          'cash'
        )}

        <div class="grid grid-3">
          <div class="card metric">
            <div class="label">Aktueller Stand</div>
            <div class="value">${formatMoney(currentAmount)}</div>
            <div class="hint">${
              current
                ? `Stand vom ${formatDate(current.created_at)}`
                : 'Noch kein Stand hinterlegt'
            }</div>
          </div>

          <div class="card metric">
            <div class="label">Letzte Änderung</div>
            <div class="value">${diffText}</div>
            <div class="hint">Differenz zum vorherigen aktiven Stand</div>
          </div>

          <div class="card metric">
            <div class="label">Aktualisierungen</div>
            <div class="value">${activeUpdates.length}</div>
            <div class="hint">${updates.length - activeUpdates.length} revidiert</div>
          </div>
        </div>

        <div class="card section">
          <div class="section-title">
            <div>
              <h2>💰 Änderungshistorie</h2>
              <div class="muted">
                Aktualisierung erfolgt in Discord über
                <strong>/kasse aktualisieren betrag:&lt;Betrag&gt;</strong>.
              </div>
            </div>
          </div>

          <div class="search-row">
            <input id="tableSearch" class="search" type="search" placeholder="ID, Betrag oder Discord-ID suchen...">
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Datum</th>
                  <th>Gesamtstand</th>
                  <th>Änderung</th>
                  <th>Aktualisiert durch</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>

      <script>
        const search = document.getElementById('tableSearch');
        const rows = [...document.querySelectorAll('.filter-row')];

        search?.addEventListener('input', () => {
          const term = search.value.trim().toLowerCase();
          for (const row of rows) {
            row.style.display = row.dataset.search.includes(term) ? '' : 'none';
          }
        });
      </script>`
    )
  );
});


/* LEGACY-WEITERLEITUNG */
router.get('/lager', requireAuth, (_req, res) => {
  return res.redirect('/personal');
});

export default router;
